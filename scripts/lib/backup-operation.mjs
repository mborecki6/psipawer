import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import {
  closeSync,
  chmodSync,
  fsyncSync,
  lstatSync,
  openSync,
  readlinkSync,
  renameSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import { backupId, checksum } from "./backup-guards.mjs";

export function durablePrivateJSON(path, value) {
  const temporary = `${path}.tmp`;
  const fd = openSync(temporary, "w", 0o600);
  try {
    chmodSync(temporary, 0o600);
    writeFileSync(fd, JSON.stringify(value, null, 2) + "\n");
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  renameSync(temporary, path);
  syncDirectory(dirname(path));
}
function syncDirectory(path) {
  const fd = openSync(path, "r");
  try {
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}
const leasePath = (root) => resolve(root, ".local/backups/.source-lock");
export function sourceLease(root) {
  try {
    assert(
      lstatSync(leasePath(root)).isSymbolicLink(),
      "Nieznana blokada kopii.",
    );
    return backupId(readlinkSync(leasePath(root)));
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}
export function claimSourceLease(root, id) {
  backupId(id);
  assert.equal(sourceLease(root), null, "Najpierw odzyskaj przerwaną kopię.");
  symlinkSync(id, leasePath(root)); // Exclusive creation; never replace a lease.
  syncDirectory(dirname(leasePath(root)));
}
export function releaseSourceLease(root, id) {
  const current = sourceLease(root);
  if (current === null) return;
  assert.equal(current, backupId(id), "Blokada należy do innej kopii.");
  unlinkSync(leasePath(root));
  syncDirectory(dirname(leasePath(root)));
}
export function assertDeadProcess(pid) {
  assert(Number.isSafeInteger(pid) && pid > 0, "Nieznany proces operacji.");
  try {
    process.kill(pid, 0);
  } catch (error) {
    if (error.code === "ESRCH") return;
    throw error;
  }
  throw new Error("Proces operacji nadal istnieje; odzyskiwanie odmówione.");
}

// The live PostgreSQL session serializes create/recover. A separate durable
// lease prevents a new backup from replacing the journal of a crashed process.
// No credentials, env files, hosted DB or transaction touching app rows.
export async function withBackupMutex(root, key, action) {
  const lock =
    key === "source"
      ? 1
      : Number.parseInt(checksum(backupId(key)).slice(0, 7), 16);
  const namespace = key === "source" ? 1347635522 : 1347635523;
  const docker = resolve(root, ".local/tools/docker-29.8.1/docker/docker");
  const child = spawn(
    docker,
    [
      "--host",
      `unix://${resolve(root, ".local/lima/psi/sock/docker.sock")}`,
      "exec",
      "-i",
      "supabase_db_psi-pawer",
      "env",
      "-i",
      "PATH=/usr/local/bin:/usr/bin:/bin",
      `PGAPPNAME=psi-backup-mutex-${namespace}-${lock}`,
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
    ],
    {
      cwd: root,
      env: {
        PATH: process.env.PATH,
        DOCKER_CONFIG: resolve(root, ".local/docker-config"),
      },
      stdio: ["pipe", "pipe", "ignore"],
    },
  );
  let failure,
    pending,
    buffer = "";
  const fail = () => {
    failure = new Error("Połączenie blokady lokalnej kopii zostało przerwane.");
    pending?.reject(failure);
  };
  child.stdin.on("error", fail);
  child.once("error", fail);
  const closed = new Promise((done) =>
    child.once("close", () => {
      fail();
      done();
    }),
  );
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    buffer += chunk;
    if (buffer.includes("\n") && pending) {
      pending.resolve(buffer.trim());
      pending = null;
    }
  });
  let timer;
  try {
    const acquired = await new Promise((resolve, reject) => {
      if (failure) return reject(failure);
      pending = { resolve, reject };
      timer = setTimeout(
        () => reject(new Error("Nie potwierdzono blokady lokalnej kopii.")),
        15000,
      );
      child.stdin.write(`select pg_try_advisory_lock(${namespace},${lock});\n`);
    });
    clearTimeout(timer);
    assert.equal(
      acquired,
      "t",
      "Inna operacja kopii lub odzyskiwania nadal działa.",
    );
    return await action(() => {
      if (failure) throw failure;
    });
  } finally {
    clearTimeout(timer);
    if (!child.stdin.destroyed && !child.stdin.writableEnded)
      child.stdin.end("\n\\q\n");
    const stop = setTimeout(() => child.kill("SIGTERM"), 5000);
    await closed;
    clearTimeout(stop);
  }
}

let current;
export async function withBackupOperation(action) {
  assert(!current, "Operacje kopii w jednym procesie muszą być kolejno.");
  let cancel;
  const cancelled = new Promise((done) => {
    cancel = done;
  });
  const scope = {
    interrupted: false,
    cleaning: false,
    child: null,
    assertActive() {
      if (this.interrupted && !this.cleaning)
        throw new Error("Operacja kopii została przerwana.");
    },
    async stage(observer, details) {
      await new Promise((done) => setImmediate(done));
      this.assertActive();
      await Promise.race([
        Promise.resolve().then(() => observer?.(details)),
        cancelled.then(() => this.assertActive()),
      ]);
      this.assertActive();
    },
  };
  const interrupt = () => {
    scope.interrupted = true;
    scope.child?.kill("SIGTERM");
    cancel();
  };
  process.on("SIGINT", interrupt);
  process.on("SIGTERM", interrupt);
  current = scope;
  try {
    return await action(scope);
  } finally {
    current = null;
    process.off("SIGINT", interrupt);
    process.off("SIGTERM", interrupt);
  }
}
export function backupOperation() {
  return current;
}
