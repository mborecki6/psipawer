// Forced SIGTERM/SIGKILL against this harness's own, verified child processes.
// Uses only the fixed local Docker socket. No reset, cloud, email or real fixture.
import assert from "node:assert/strict";
import { execFileSync, fork } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { parseEnv } from "node:util";
import {
  checksum,
  localBackupConfiguration,
  validateBackup,
} from "../../scripts/lib/backup-guards.mjs";
import {
  durablePrivateJSON,
  sourceLease,
} from "../../scripts/lib/backup-operation.mjs";
import {
  createLocalBackup,
  verifyLocalBackup,
  recoverBackup,
  recoverRestore,
} from "../../scripts/lib/local-backup.mjs";

const root = process.cwd();
localBackupConfiguration(
  parseEnv(readFileSync(resolve(root, ".env.test.local"), "utf8")),
);
const docker = resolve(root, ".local/tools/docker-29.8.1/docker/docker");
const socket = `unix://${resolve(root, ".local/lima/psi/sock/docker.sock")}`;
function command(args, input) {
  try {
    return execFileSync(docker, ["--host", socket, ...args], {
      env: {
        PATH: process.env.PATH,
        DOCKER_CONFIG: resolve(root, ".local/docker-config"),
      },
      input,
      encoding: "utf8",
      timeout: 15000,
      stdio: [input === undefined ? "ignore" : "pipe", "pipe", "pipe"],
    }).trim();
  } catch {
    throw new Error("Local recovery test could not observe Docker");
  }
}
const rows = (args) =>
  command([...args, "--format", "{{json .}}"])
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
function resources() {
  return {
    container: rows(["ps", "-a"])
      .map((r) => r.Names)
      .sort(),
    volume: rows(["volume", "ls"])
      .map((r) => r.Name)
      .sort(),
    network: rows(["network", "ls"])
      .map((r) => r.Name)
      .sort(),
  };
}
function source() {
  const containers = rows(["ps", "-a"]).filter((r) =>
    /^supabase_.*_psi-pawer$/.test(r.Names),
  );
  assert.equal(containers.length, 9);
  return {
    containers: containers
      .map(({ Names }) => {
        const c = JSON.parse(command(["inspect", Names]))[0];
        return {
          name: Names,
          id: c.Id,
          running: c.State.Running,
          paused: c.State.Paused,
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name)),
    hba: checksum(
      command([
        "exec",
        "supabase_db_psi-pawer",
        "cat",
        "/etc/postgresql/pg_hba.conf",
      ]) + "\n",
    ),
    permissions: command([
      "exec",
      "supabase_db_psi-pawer",
      "stat",
      "-c",
      "%u:%g:%a",
      "/etc/postgresql/pg_hba.conf",
    ]),
    rows: command([
      "exec",
      "supabase_db_psi-pawer",
      "psql",
      "-X",
      "-A",
      "-t",
      "-q",
      "-U",
      "postgres",
      "-d",
      "postgres",
      "-v",
      "ON_ERROR_STOP=1",
      "-c",
      `select json_build_object('users',(select count(*) from auth.users),'dogs',(select count(*) from public.dogs),'profiles',(select count(*) from public.profiles),'files',(select count(*) from storage.objects),'services',(select count(*) from public.services),'migrations',(select count(*) from supabase_migrations.schema_migrations));`,
    ]),
  };
}
function journal(id, run) {
  return JSON.parse(
    readFileSync(
      resolve(
        root,
        ".local/backups",
        id,
        run ? `restore-${run}.json` : "manifest.json",
      ),
      "utf8",
    ),
  );
}
const children = [];
async function worker(mode, phase, id) {
  const child = fork(
    resolve(root, "tests/helpers/backup-interruption-worker.mjs"),
    [mode, phase, ...(id ? [id] : [])],
    {
      cwd: root,
      execPath: process.execPath,
      env: { PATH: process.env.PATH },
      stdio: ["ignore", "ignore", "ignore", "ipc"],
    },
  );
  const record = { child, details: null, closed: false };
  children.push(record);
  record.terminal = new Promise((done) =>
    child.once("close", (code, signal) => {
      record.closed = true;
      done({ code, signal });
    }),
  );
  record.details = await new Promise((done, fail) => {
    const timeout = setTimeout(
      () => fail(new Error("Worker stage was not observed within 45 seconds")),
      45000,
    );
    child.once("error", () => {
      clearTimeout(timeout);
      fail(new Error("Worker failed to start"));
    });
    child.once("exit", () => {
      clearTimeout(timeout);
      fail(new Error("Worker ended before its barrier"));
    });
    child.once("message", (details) => {
      clearTimeout(timeout);
      assert.equal(details.phase, phase);
      assert.equal(details.pid, child.pid);
      done(details);
    });
  });
  assert.equal(record.closed, false);
  return record;
}
async function stop(record, signal) {
  assert.equal(record.closed, false, "Do not signal a terminal handle");
  assert.equal(record.child.pid, record.details.pid);
  assert(record.child.kill(signal));
  let timer;
  try {
    const terminal = await Promise.race([
      record.terminal,
      new Promise((_, fail) => {
        timer = setTimeout(
          () => fail(new Error("Signalled worker remains unconfirmed")),
          20000,
        );
      }),
    ]);
    if (signal === "SIGKILL") assert.equal(terminal.signal, signal);
    else assert.equal(terminal.code, 71);
  } finally {
    clearTimeout(timer);
  }
}
async function mutexReleased() {
  for (let attempt = 0; attempt < 40; attempt++) {
    const count = command([
      "exec",
      "supabase_db_psi-pawer",
      "psql",
      "-X",
      "-A",
      "-t",
      "-U",
      "postgres",
      "-d",
      "postgres",
      "-c",
      "select count(*) from pg_stat_activity where application_name like 'psi-backup-mutex-%';",
    ]);
    if (count === "0") return;
    await new Promise((done) => setTimeout(done, 50));
  }
  throw new Error(
    "Killed worker's actual database mutex session has not ended",
  );
}
const run = randomUUID(),
  report = {
    run_id: run,
    started_at: new Date().toISOString(),
    scenarios: [],
    checks_passed: false,
    cleanup: false,
  };
const baseline = source(),
  initialResources = resources();
assert(baseline.containers.every((c) => c.running && !c.paused));
assert.equal(
  sourceLease(root),
  null,
  "Recover an earlier interrupted backup before running the rehearsal",
);
let complete;
try {
  complete = await createLocalBackup();
  assert.equal(complete.manifest.status, "ready");
  const readyBefore = checksum(
    readFileSync(resolve(complete.directory, "manifest.json")),
  );
  await recoverBackup(complete.id);
  assert.equal(
    checksum(readFileSync(resolve(complete.directory, "manifest.json"))),
    readyBefore,
    "Recovery must not invalidate a ready backup",
  );
  for (const signal of ["SIGTERM", "SIGKILL"]) {
    const record = await worker("create", "source-frozen");
    const id = record.details.id,
      frozen = source();
    assert.equal(sourceLease(root), id);
    assert.equal(frozen.containers.filter((c) => c.paused).length, 8);
    assert.notEqual(frozen.hba, baseline.hba);
    await assert.rejects(() => recoverBackup(id));
    await assert.rejects(() => createLocalBackup());
    assert.deepEqual(
      source(),
      frozen,
      "Rejected concurrent operations must not resume or mutate the owner's source",
    );
    await stop(record, signal);
    await mutexReleased();
    if (signal === "SIGKILL") {
      assert.equal(sourceLease(root), id);
      assert.deepEqual(source(), frozen);
      await assert.rejects(() => createLocalBackup(), /odzyskaj/);
      await recoverBackup(id);
    }
    const recovered = journal(id);
    assert.equal(recovered.status, "failed");
    assert.equal(recovered.resumed, true);
    assert.equal(recovered.hba_restored, true);
    assert.equal(recovered.copy_removed, true);
    assert.equal(sourceLease(root), null);
    assert.deepEqual(source(), baseline);
    assert.deepEqual(resources(), initialResources);
    await recoverBackup(id);
    await assert.rejects(() => verifyLocalBackup(id));
    assert.deepEqual(
      resources(),
      initialResources,
      "Incomplete verification must create no target resources",
    );
    report.scenarios.push({
      operation: "create",
      signal,
      backup_id: id,
      restored_source: true,
      rejected_incomplete: true,
      rejected_concurrent: true,
    });
    console.log(
      `Odzyskiwanie: kopia po ${signal} — źródło i blokada przywrócone.`,
    );
  }
  for (const [signal, phase] of [
    ["SIGTERM", "resources-created"],
    ["SIGKILL", "services-ready"],
  ]) {
    const record = await worker("verify", phase, complete.id),
      restore = record.details.run_id;
    const pending = journal(complete.id, restore);
    assert.equal(pending.status, "running");
    assert(pending.resources.length >= 6);
    assert.equal(pending.cleanup, false);
    const before = resources();
    process.kill(record.child.pid, 0);
    await assert.rejects(
      () => recoverRestore(complete.id, restore),
      /nadal istnieje/,
    );
    assert.deepEqual(resources(), before);
    assert.deepEqual(source(), baseline);
    await stop(record, signal);
    if (signal === "SIGKILL") {
      assert.deepEqual(resources(), before);
      await recoverRestore(complete.id, restore);
    }
    const recovered = journal(complete.id, restore);
    assert.equal(recovered.status, "failed");
    assert.equal(recovered.cleanup, true);
    assert.equal(recovered.checks_passed, false);
    assert(recovered.resources.every((r) => r.removed));
    assert.deepEqual(source(), baseline);
    assert.deepEqual(resources(), initialResources);
    await recoverRestore(complete.id, restore);
    validateBackup(complete.directory, journal(complete.id));
    report.scenarios.push({
      operation: "verify",
      signal,
      phase,
      restore_id: restore,
      removed_owned_resources: true,
      source_unchanged: true,
      rejected_live: true,
    });
    console.log(
      `Odzyskiwanie: odtworzenie po ${signal} — własne zasoby usunięte.`,
    );
  }
  const verified = await verifyLocalBackup(complete.id);
  assert(verified.checks_passed && verified.cleanup);
  report.valid_backup_id = complete.id;
  report.valid_backup_verified = true;
  report.checks_passed = true;
} finally {
  // Only children actually created by this harness can be terminated here.
  for (const record of children) {
    if (!record.closed) {
      record.child.kill("SIGTERM");
      await record.terminal;
    }
    const details = record.details;
    if (
      details?.id &&
      existsSync(resolve(root, ".local/backups", details.id, "manifest.json"))
    )
      await recoverBackup(details.id);
    if (details?.run_id)
      await recoverRestore(details.backup_id, details.run_id);
  }
  assert.deepEqual(source(), baseline);
  assert.deepEqual(resources(), initialResources);
  assert.equal(sourceLease(root), null);
  report.cleanup = true;
  report.finished_at = new Date().toISOString();
  durablePrivateJSON(
    resolve(root, ".local/backups", `recovery-${run}.json`),
    report,
  );
}
console.log(
  `Odzyskiwanie: cztery rzeczywiste przerwania i końcowe odtworzenie potwierdzone; raport ${run}.`,
);
