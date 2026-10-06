// Real, independent PostgreSQL connections to this project's local VM only.
// No .env files, network DB URLs, passwords or default Docker contexts are used.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// Both Node's runner and Playwright invoke tests from the project directory.
// Avoid import.meta: Playwright also loads this helper from CommonJS tests.
const root = process.cwd();
assert.equal(
  JSON.parse(readFileSync(resolve(root, "package.json"), "utf8")).name,
  "psi-pawer",
  "Run local PostgreSQL tests from the Psi Pawer project directory",
);
const docker = resolve(root, ".local/tools/docker-29.8.1/docker/docker");
const socket = `unix://${resolve(root, ".local/lima/psi/sock/docker.sock")}`;

// Values come from generated fixtures, but still quote all SQL literals.
export const literal = (value) => `'${String(value).replaceAll("'", "''")}'`;

export class LocalPostgres {
  constructor({ database = "postgres" } = {}) {
    // Isolated migration rehearsals may use only their generated fixture name.
    // Neither arbitrary databases nor another server can be selected.
    assert(
      database === "postgres" ||
        /^psi_(fitness|gift|calendar)_[0-9a-f]{32}$/.test(database),
    );
    this.pending = null;
    this.buffer = "";
    this.errors = "";
    this.ended = false;
    this.child = spawn(
      docker,
      [
        "--host",
        socket,
        "exec",
        "-i",
        "supabase_db_psi-pawer",
        "env",
        "-i",
        "PATH=/usr/local/bin:/usr/bin:/bin",
        "LANG=C.UTF-8",
        `PGAPPNAME=psi-concurrency-${randomUUID()}`,
        "psql",
        "-X",
        "-A",
        "-t",
        "-q",
        "-U",
        "postgres",
        "-d",
        database,
        "-v",
        "ON_ERROR_STOP=1",
      ],
      {
        cwd: root,
        env: {
          PATH: process.env.PATH,
          DOCKER_CONFIG: resolve(root, ".local/docker-config"),
        },
        stdio: ["pipe", "pipe", "pipe"],
      },
    );
    this.child.stdout.setEncoding("utf8");
    this.child.stderr.setEncoding("utf8");
    this.child.stdout.on("data", (chunk) => {
      this.buffer += chunk;
      let index;
      while ((index = this.buffer.indexOf("\n")) >= 0) {
        const line = this.buffer.slice(0, index).replace(/\r$/, "");
        this.buffer = this.buffer.slice(index + 1);
        const task = this.pending;
        if (!task) continue;
        if (line === task.marker) {
          this.pending = null;
          clearTimeout(task.timeout);
          task.resolve(task.lines.filter(Boolean));
        } else task.lines.push(line);
      }
    });
    this.child.stderr.on("data", (chunk) => {
      this.errors += chunk;
    });
    this.child.stdin.on("error", (error) => this.fail(error));
    this.child.once("error", (error) => this.fail(error));
    this.closed = new Promise((done) => {
      this.child.once("close", (code) => {
        this.ended = true;
        // SQL and errors contain only this test's synthetic fixture data.
        this.fail(
          new Error(this.errors.trim() || `Local PostgreSQL exited: ${code}`),
        );
        done();
      });
    });
  }

  fail(error) {
    if (!this.pending) return;
    const task = this.pending;
    this.pending = null;
    clearTimeout(task.timeout);
    task.reject(error);
  }

  query(sql) {
    assert(!this.pending, "Use a separate connection for a concurrent query");
    assert(!this.ended, "PostgreSQL connection has ended");
    const marker = `psi_done_${randomUUID().replaceAll("-", "")}`;
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.fail(new Error("Local PostgreSQL command exceeded 20 seconds"));
        this.child.stdin.end("\n\\q\n");
      }, 20000);
      this.pending = { marker, lines: [], resolve, reject, timeout };
      this.child.stdin.write(`${sql}\n\\echo ${marker}\n`);
    });
  }

  async json(sql) {
    const lines = await this.query(sql);
    assert.equal(lines.length, 1, "Query must return exactly one JSON result");
    return JSON.parse(lines[0]);
  }

  async ready() {
    await this.query(`set statement_timeout='12s'; set lock_timeout='10s';
      set idle_in_transaction_session_timeout='20s'; set timezone='UTC';`);
    this.pid = await this.json("select to_json(pg_backend_pid());");
    return this;
  }

  async asUser(id) {
    await this.query(`begin; set local role authenticated;
      select set_config('request.jwt.claim.sub',${literal(id)},true);`);
    assert.deepEqual(
      await this.json(
        "select json_build_object('role',current_user,'user',auth.uid(),'isolation',current_setting('transaction_isolation'));",
      ),
      { role: "authenticated", user: id, isolation: "read committed" },
    );
  }

  async close() {
    if (!this.ended && !this.child.stdin.writableEnded)
      this.child.stdin.end("\n\\q\n");
    await this.closed;
  }
}

// Observe an actual server lock dependency. A Promise.all without this barrier
// could accidentally run sequentially and would not demonstrate a race.
export async function waitForLock(observer, holder, waiter) {
  assert.notEqual(holder.pid, waiter.pid);
  const deadline = Date.now() + 6000;
  do {
    if (waiter.ended)
      throw new Error(
        "Second transaction ended before a lock wait was observed",
      );
    const waiting = await observer.json(`select to_json(exists(
      select 1 from pg_stat_activity where pid=${waiter.pid}
      and wait_event_type='Lock' and ${holder.pid}=any(pg_blocking_pids(pid))));`);
    if (waiting) return;
    await new Promise((done) => setTimeout(done, 50));
  } while (Date.now() < deadline);
  throw new Error("No lock dependency observed between the two transactions");
}
