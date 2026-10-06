// Full physical backup of this project's local cluster and file backend only.
// No remote URLs, default Docker context, resets or destructive source restore.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import {
  createReadStream,
  readFileSync,
  writeFileSync,
  mkdirSync,
  openSync,
  closeSync,
  chmodSync,
  lstatSync,
  appendFileSync,
  fsyncSync,
} from "node:fs";
import { resolve } from "node:path";
import { parseEnv } from "node:util";
import {
  backupId,
  artifacts,
  checksum,
  localBackupConfiguration,
  validateBackup,
  ownedRestoreResource,
  restoreEnvironment,
  privateFile,
  validateRestoreJournal,
} from "./backup-guards.mjs";
import {
  durablePrivateJSON as privateJSON,
  withBackupMutex,
  withBackupOperation,
  backupOperation,
  sourceLease,
  claimSourceLease,
  releaseSourceLease,
  assertDeadProcess,
} from "./backup-operation.mjs";

const root = process.cwd();
const sourceDB = "supabase_db_psi-pawer";
const docker = resolve(root, ".local/tools/docker-29.8.1/docker/docker");
const socket = `unix://${resolve(root, ".local/lima/psi/sock/docker.sock")}`;
const env = {
  PATH: process.env.PATH,
  DOCKER_CONFIG: resolve(root, ".local/docker-config"),
};
const prefix = ["--host", socket];
const log = (message) => console.log(`Kopia lokalna: ${message}`);
let operationDirectory;

function capture(args, input) {
  backupOperation()?.assertActive();
  try {
    return execFileSync(docker, [...prefix, ...args], {
      env,
      cwd: root,
      input,
      encoding: "utf8",
      timeout: 30000,
      maxBuffer: 64 * 1024 * 1024,
      stdio: [input === undefined ? "ignore" : "pipe", "pipe", "pipe"],
    });
  } catch (error) {
    // CLI errors can contain database rows, environment values or credentials.
    if (operationDirectory && error.stderr?.length) {
      const path = resolve(operationDirectory, "operations.log");
      appendFileSync(path, error.stderr, { mode: 0o600 });
      chmodSync(path, 0o600);
    }
    throw new Error("Lokalne narzędzie nie zakończyło operacji poprawnie.");
  }
}
function inspect(type, name) {
  // Docker's generic inspect can resolve a volume after a same-named container
  // is removed. Always select the namespace explicitly, especially in cleanup.
  return JSON.parse(capture([type, "inspect", name]))[0];
}
function inspectIfPresent(type, name) {
  try {
    return inspect(type, name);
  } catch (error) {
    // A failed observation is not proof that a resource is absent. Confirm
    // absence with a second, independent listing; otherwise retain the journal.
    const names = capture(
      type === "container"
        ? ["ps", "-a", "--format", "{{.Names}}"]
        : [type, "ls", "--format", "{{.Name}}"],
    );
    if (names.trim().split("\n").includes(name)) throw error;
    return null;
  }
}
function backupDirectory(id, create = false) {
  backupId(id);
  const parent = resolve(root, ".local/backups");
  mkdirSync(parent, { recursive: true, mode: 0o700 });
  assert(
    lstatSync(parent).isDirectory() && !lstatSync(parent).isSymbolicLink(),
  );
  const directory = resolve(parent, id);
  assert.equal(
    lstatSync(parent).mode & 0o077,
    0,
    "Katalog kopii musi być prywatny.",
  );
  if (create) mkdirSync(directory, { mode: 0o700 });
  assert(
    lstatSync(directory).isDirectory() &&
      !lstatSync(directory).isSymbolicLink(),
  );
  assert.equal(
    lstatSync(directory).mode & 0o077,
    0,
    "Katalog kopii musi być prywatny.",
  );
  return directory;
}
function configuration() {
  assert.equal(
    JSON.parse(readFileSync(resolve(root, "package.json"), "utf8")).name,
    "psi-pawer",
  );
  const values = parseEnv(
    readFileSync(resolve(root, ".env.test.local"), "utf8"),
  );
  return localBackupConfiguration(values);
}
function sql(container, statement) {
  return capture(
    [
      "exec",
      "-i",
      container,
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
    statement + "\n",
  ).trim();
}
function inventory(container) {
  // Hash every row rather than relying on matching record counts. Temporary
  // state is excluded from physical backups and cannot change application data.
  const rows = JSON.parse(
    sql(
      container,
      `begin;
    create temporary table psi_backup_inventory(schema_name text,table_name text,rows bigint,digest text) on commit drop;
    do $inventory$ declare t record; n bigint; h text; begin
      for t in select n.nspname,c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace
        where left(n.nspname,3)<>'pg_' and n.nspname<>'information_schema' and c.relkind in ('r','p') order by 1,2 loop
        execute format('select count(*),md5(coalesce(string_agg(md5(to_jsonb(r)::text),'''' order by md5(to_jsonb(r)::text)),'''')) from %I.%I r',t.nspname,t.relname) into n,h;
        insert into psi_backup_inventory values(t.nspname,t.relname,n,h);
      end loop;
    end $inventory$;
    select coalesce(json_agg(i order by schema_name,table_name),'[]') from psi_backup_inventory i;
    commit;`,
    ),
  );
  const schema = capture([
    "exec",
    container,
    "pg_dump",
    "-U",
    "postgres",
    "-d",
    "postgres",
    "--schema-only",
  ]).replace(/^\\(?:un)?restrict .*$/gm, "");
  return { rows, schema_sha256: checksum(schema) };
}
const treeScript = `const fs=require('fs'),path=require('path'),crypto=require('crypto');
  const rows=[];function visit(dir){for(const item of fs.readdirSync(dir).sort()){
    const file=path.join(dir,item),s=fs.lstatSync(file);if(s.isSymbolicLink())throw Error('symlink');
    if(s.isDirectory())visit(file);else if(s.isFile())rows.push({path:path.relative('/mnt',file),bytes:s.size,sha256:crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')});
    else throw Error('special file');}}visit('/mnt');console.log(JSON.stringify(rows));`;
function storageTree(container) {
  return JSON.parse(capture(["exec", container, "node", "-e", treeScript]));
}
async function stream(args, directory, { input, output } = {}) {
  const scope = backupOperation();
  scope?.assertActive();
  const stderr = openSync(resolve(directory, "operations.log"), "a", 0o600);
  chmodSync(resolve(directory, "operations.log"), 0o600);
  const stdout = output ? openSync(output, "wx", 0o600) : "ignore";
  try {
    await new Promise((done, fail) => {
      const child = spawn(docker, [...prefix, ...args], {
        cwd: root,
        env,
        stdio: [input ? "pipe" : "ignore", stdout, stderr],
      });
      const timeout = setTimeout(() => child.kill("SIGTERM"), 120000);
      const interrupt = () => child.kill("SIGTERM");
      if (scope) scope.child = child;
      let source;
      if (input) {
        source = createReadStream(input);
        source.on("error", interrupt);
        child.stdin.on("error", () => {});
        source.pipe(child.stdin);
      }
      child.once("error", () => {
        interrupt();
      });
      child.once("close", (code) => {
        clearTimeout(timeout);
        source?.destroy();
        if (scope) scope.child = null;
        if (code === 0 && !scope?.interrupted) done();
        else
          fail(
            new Error(
              "Operacja kopii nie zakończyła się poprawnie; szczegóły pozostają w prywatnym logu.",
            ),
          );
      });
    });
  } finally {
    if (typeof stdout === "number") {
      try {
        fsyncSync(stdout);
      } finally {
        closeSync(stdout);
      }
    }
    closeSync(stderr);
  }
}
function writeReplicationRule(id, contents) {
  // A killed writer can leave only its own staging file, never a half-written
  // live HBA. Rename is on the same filesystem; preserve original permissions.
  const staging = `/etc/postgresql/.psi-hba-${backupId(id)}.tmp`;
  capture(
    [
      "exec",
      "-i",
      "--user=root",
      sourceDB,
      "sh",
      "-c",
      'set -eu; umask 077; cp -p "$2" "$1"; cat > "$1"; mv -f "$1" "$2"',
      "psi-hba",
      staging,
      "/etc/postgresql/pg_hba.conf",
    ],
    contents,
  );
  assert.equal(
    capture([
      "exec",
      sourceDB,
      "psql",
      "-X",
      "-A",
      "-t",
      "-U",
      "supabase_admin",
      "-d",
      "postgres",
      "-c",
      "select pg_reload_conf(); select count(*) from pg_hba_file_rules where error is not null;",
    ]).trim(),
    "t\n0",
    "Ustawienia połączeń nie zostały przeładowane.",
  );
}
function restoreReplicationRule(journal) {
  if (!journal.hba_planned) return;
  assert.equal(
    inspect("container", sourceDB).Id,
    journal.source_db_id,
    "Źródłowa baza została zastąpiona; nie zmieniam jej ustawień.",
  );
  const path = resolve(
    backupDirectory(journal.id),
    "replication-hba-original.txt",
  );
  privateFile(path);
  const original = readFileSync(path, "utf8");
  assert.equal(checksum(original), journal.hba_original_sha256);
  const current = capture([
    "exec",
    sourceDB,
    "cat",
    "/etc/postgresql/pg_hba.conf",
  ]);
  assert(
    [journal.hba_original_sha256, journal.hba_temporary_sha256].includes(
      checksum(current),
    ),
    "Ustawienia źródła zmieniły się poza kopią; nie nadpisuję ich.",
  );
  writeReplicationRule(journal.id, original);
  assert.equal(
    checksum(capture(["exec", sourceDB, "cat", "/etc/postgresql/pg_hba.conf"])),
    journal.hba_original_sha256,
  );
  journal.hba_restored = true;
}
function resume(journal) {
  let failure;
  try {
    restoreReplicationRule(journal);
  } catch (error) {
    failure = error;
  }
  for (const planned of [...journal.paused].reverse()) {
    try {
      assert(
        /^supabase_(studio|pg_meta|storage|rest|realtime|inbucket|auth|kong)_psi-pawer$/.test(
          planned.name,
        ),
      );
      const current = inspect("container", planned.name);
      assert.equal(
        current.Id,
        planned.id,
        "Kontener źródłowy został zastąpiony; nie zmieniam jego stanu.",
      );
      if (current.State.Paused) capture(["unpause", planned.name]);
      assert(inspect("container", planned.name).State.Running);
    } catch (error) {
      failure ??= error;
    }
  }
  journal.resumed = !failure;
  if (failure) throw failure;
}
export async function createLocalBackup(options = {}) {
  configuration();
  return withBackupMutex(root, "source", (checkMutex) =>
    withBackupOperation((scope) => createBackup(options, scope, checkMutex)),
  );
}
async function createBackup({ onStage }, scope, checkMutex) {
  const credentials = configuration();
  assert.equal(sourceLease(root), null, "Najpierw odzyskaj przerwaną kopię.");
  const id = randomUUID(),
    directory = backupDirectory(id, true);
  operationDirectory = directory;
  const journalPath = resolve(directory, "manifest.json");
  const journal = {
    version: 1,
    id,
    source: "psi-pawer-local",
    status: "creating",
    pid: process.pid,
    started_at: new Date().toISOString(),
    paused: [],
    resumed: false,
  };
  privateJSON(journalPath, journal);
  const stage = async (phase) => {
    checkMutex();
    journal.phase = phase;
    privateJSON(journalPath, journal);
    await scope.stage(onStage, { phase, id });
  };
  let leased = false;
  log(`próba ${id}; przygotowuję spójny zapis`);
  try {
    claimSourceLease(root, id);
    leased = true;
    await stage("source-inspect");
    const containers = capture([
      "ps",
      "--filter",
      "name=supabase_",
      "--format",
      "{{json .}}",
    ])
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line))
      .map((row) => inspect("container", row.Names));
    // Keep the runtime config private: it includes local signing/DB credentials.
    const runtime = Object.fromEntries(
      ["db", "auth", "rest", "storage"].map((service) => {
        const c = inspect("container", `supabase_${service}_psi-pawer`);
        assert(
          c.State.Running &&
            !c.State.Paused &&
            /^sha256:[0-9a-f]{64}$/.test(c.Image),
        );
        return [service, { image: c.Image, environment: c.Config.Env }];
      }),
    );
    assert(
      runtime.storage.environment.includes(`SERVICE_KEY=${credentials.secret}`),
    );
    assert(runtime.storage.environment.includes(`ANON_KEY=${credentials.key}`));
    assert(runtime.storage.environment.includes("STORAGE_BACKEND=file"));
    journal.source_db_id = inspect("container", sourceDB).Id;
    const mounts = inspect("container", "supabase_storage_psi-pawer").Mounts;
    assert(
      mounts.some(
        (m) =>
          m.Type === "volume" &&
          m.Name === "supabase_storage_psi-pawer" &&
          m.Destination === "/mnt",
      ),
    );
    assert.equal(
      sql(
        sourceDB,
        "select count(*) from pg_tablespace where spcname not in ('pg_default','pg_global');",
      ),
      "0",
    );
    privateJSON(resolve(directory, "runtime.json"), runtime);
    journal.copy_container = `psi-backup-${id}-files`;
    privateJSON(journalPath, journal);
    capture([
      "run",
      "-d",
      "--pull=never",
      "--name",
      journal.copy_container,
      "--label",
      `psi.backup.run=${id}`,
      "--network=none",
      "--read-only",
      "--user=root",
      "--mount",
      "type=volume,src=supabase_storage_psi-pawer,dst=/mnt,readonly",
      "--entrypoint",
      "node",
      runtime.storage.image,
      "-e",
      "setInterval(()=>{},1000000)",
    ]);
    for (const c of containers.filter(
      (c) => c.Name.endsWith("_psi-pawer") && c.Name !== `/${sourceDB}`,
    )) {
      assert(
        c.State.Running && !c.State.Paused,
        "Przed kopią wszystkie lokalne usługi muszą działać.",
      );
      journal.paused.push({ name: c.Name.slice(1), id: c.Id });
      privateJSON(journalPath, journal); // Accepted pause remains recoverable if its response is lost.
      capture(["pause", c.Name.slice(1)]);
      await stage("source-pausing");
    }
    journal.inventory = inventory(sourceDB);
    journal.storage_tree = storageTree(journal.copy_container);
    // Preserve the ordinary config before installing a socket-only peer rule.
    // The CLI's HBA has no replication rule; no TCP or password access is added.
    await stream(
      ["exec", sourceDB, "tar", "-czf", "-", "-C", "/etc/postgresql", "."],
      directory,
      { output: resolve(directory, "database-config.tar.gz") },
    );
    const hba = capture([
      "exec",
      sourceDB,
      "cat",
      "/etc/postgresql/pg_hba.conf",
    ]);
    const temporaryHba = `${hba}\n# Psi Pawer local backup ${id}\nlocal replication postgres peer\n`;
    writeFileSync(resolve(directory, "replication-hba-original.txt"), hba, {
      mode: 0o600,
      flag: "wx",
    });
    const originalFD = openSync(
      resolve(directory, "replication-hba-original.txt"),
      "r",
    );
    try {
      fsyncSync(originalFD);
    } finally {
      closeSync(originalFD);
    }
    journal.hba_original_sha256 = checksum(hba);
    journal.hba_temporary_sha256 = checksum(temporaryHba);
    journal.hba_planned = true;
    privateJSON(journalPath, journal);
    writeReplicationRule(id, temporaryHba);
    await stage("source-frozen");
    await stream(
      [
        "exec",
        "--user=postgres",
        sourceDB,
        "pg_basebackup",
        "-U",
        "postgres",
        "-w",
        "-D",
        "-",
        "--format=tar",
        "--wal-method=fetch",
        "--checkpoint=fast",
        "--compress=gzip:1",
        "--manifest-checksums=SHA256",
      ],
      directory,
      { output: resolve(directory, "database.tar.gz") },
    );
    await stage("database-archived");
    // Read the frozen file volume through the read-only helper. No filesystem
    // or metadata write can race this archive while source services are paused.
    await stream(
      ["exec", journal.copy_container, "tar", "-czf", "-", "-C", "/mnt", "."],
      directory,
      { output: resolve(directory, "storage.tar.gz") },
    );
    assert.deepEqual(storageTree(journal.copy_container), journal.storage_tree);
    assert.deepEqual(
      inventory(sourceDB),
      journal.inventory,
      "Dane zmieniły się podczas zapisu kopii.",
    );
    journal.artifacts = Object.fromEntries(
      artifacts.map((name) => {
        const bytes = readFileSync(resolve(directory, name));
        return [name, { bytes: bytes.length, sha256: checksum(bytes) }];
      }),
    );
    journal.status = "ready";
  } catch (error) {
    journal.status = "failed";
    throw error;
  } finally {
    scope.cleaning = true;
    try {
      resume(journal);
    } finally {
      try {
        removeCopyContainer(journal);
        journal.copy_removed = true;
        if (leased && journal.resumed) releaseSourceLease(root, id);
      } finally {
        journal.finished_at = new Date().toISOString();
        privateJSON(journalPath, journal);
      }
    }
  }
  assert(journal.resumed);
  log(`kopia ${id} zapisana; usługi wznowione`);
  return { id, directory, manifest: journal };
}

function removeCopyContainer(journal) {
  if (!journal.copy_container) return;
  const current = inspectIfPresent("container", journal.copy_container);
  if (!current) return;
  assert.equal(current.Name, `/psi-backup-${backupId(journal.id)}-files`);
  assert.equal(current.Config.Labels?.["psi.backup.run"], journal.id);
  assert(
    current.Mounts.every(
      (m) =>
        m.Type === "volume" &&
        m.Name === "supabase_storage_psi-pawer" &&
        m.RW === false,
    ),
  );
  capture(["rm", "-f", journal.copy_container]);
}

export async function recoverBackup(id) {
  configuration();
  return withBackupMutex(root, "source", () => recoverSource(id));
}
function recoverSource(id) {
  const directory = backupDirectory(id);
  operationDirectory = directory;
  const path = resolve(directory, "manifest.json");
  privateFile(path);
  const journal = JSON.parse(readFileSync(path, "utf8"));
  assert.equal(journal.id, id);
  assert.equal(journal.source, "psi-pawer-local");
  const lease = sourceLease(root);
  assert(lease === null || lease === id, "Blokada należy do innej kopii.");
  if (journal.resumed && journal.copy_removed && lease === null) return journal;
  // A completed older ready backup is also a no-op, not a failed copy.
  if (
    journal.status === "ready" &&
    journal.resumed &&
    journal.hba_restored &&
    lease === null
  )
    return journal;
  assertDeadProcess(journal.pid);
  resume(journal);
  removeCopyContainer(journal);
  journal.copy_removed = true;
  releaseSourceLease(root, id);
  journal.status = "failed";
  journal.recovered_at = new Date().toISOString();
  privateJSON(path, journal);
  log("wznowiono dokładnie te usługi, które wstrzymała przerwana kopia");
  return journal;
}

export async function verifyLocalBackup(id, check, options = {}) {
  configuration();
  return withBackupOperation((scope) =>
    verifyBackup(id, check, options, scope),
  );
}
async function verifyBackup(id, check, { onStage }, scope) {
  configuration();
  const directory = backupDirectory(id);
  operationDirectory = directory;
  const manifest = validateBackup(
    directory,
    JSON.parse(readFileSync(resolve(directory, "manifest.json"), "utf8")),
  );
  assert.equal(manifest.id, id);
  const runtime = JSON.parse(
    readFileSync(resolve(directory, "runtime.json"), "utf8"),
  );
  const run = randomUUID(),
    base = `psi-restore-${run}`;
  const report = {
    version: 1,
    backup_id: id,
    run_id: run,
    source: "psi-pawer-local",
    pid: process.pid,
    status: "running",
    started_at: new Date().toISOString(),
    checks_passed: false,
    cleanup: false,
    resources: [],
  };
  const resources = report.resources;
  const reportPath = resolve(directory, `restore-${run}.json`);
  const labels = [
    "--label",
    `psi.restore.run=${run}`,
    "--label",
    "psi.restore.project=psi-pawer",
  ];
  const mount = (role, destination) => [
    "--mount",
    `type=volume,src=${base}-${role},dst=${destination}`,
  ];
  const create = (type, role, args) => {
    const name = `${base}-${role}`;
    const resource = { type, name };
    resources.push(resource); // Persist before a potentially accepted creation.
    privateJSON(reportPath, report);
    capture(
      type === "container"
        ? ["run", "-d", "--pull=never", "--name", name, ...labels, ...args]
        : [type, "create", ...labels, ...args, name],
    );
    const current = ownedRestoreResource(inspect(type, name), run);
    if (type !== "volume") resource.id = current.Id;
    privateJSON(reportPath, report);
    return name;
  };
  let phase = "resources";
  const stage = async (value) => {
    phase = value;
    report.phase = value;
    privateJSON(reportPath, report);
    await scope.stage(onStage, { phase: value, backup_id: id, run_id: run });
  };
  privateJSON(reportPath, report);
  log(`odtwarzam ${id} w osobnych zasobach ${run}`);
  try {
    create("network", "network", ["--internal"]);
    for (const role of ["data", "config", "storage"])
      create("volume", role, []);
    const prep = create("container", "prepare", [
      "--network=none",
      "--user=root",
      ...mount("data", "/var/lib/postgresql/data"),
      ...mount("config", "/etc/postgresql"),
      "--entrypoint",
      "/bin/sleep",
      runtime.db.image,
      "infinity",
    ]);
    const files = create("container", "files", [
      "--network",
      `${base}-network`,
      "--user=root",
      ...mount("storage", "/mnt"),
      "--entrypoint",
      "node",
      runtime.storage.image,
      "-e",
      "setInterval(()=>{},1000000)",
    ]);
    await stage("resources-created");
    phase = "extract";
    for (const [name, target, destination] of [
      ["database.tar.gz", prep, "/var/lib/postgresql/data"],
      ["database-config.tar.gz", prep, "/etc/postgresql"],
      ["storage.tar.gz", files, "/mnt"],
    ])
      await stream(
        ["exec", "-i", target, "tar", "-xzf", "-", "-C", destination],
        directory,
        { input: resolve(directory, name) },
      );
    capture([
      "exec",
      prep,
      "chown",
      "-R",
      "postgres:postgres",
      "/var/lib/postgresql/data",
    ]);
    capture(["exec", prep, "chmod", "0700", "/var/lib/postgresql/data"]);
    phase = "physical-integrity";
    await stream(
      [
        "exec",
        "--user=postgres",
        prep,
        "pg_verifybackup",
        "--exit-on-error",
        "/var/lib/postgresql/data",
      ],
      directory,
    );
    report.physical_integrity = true;
    assert.deepEqual(
      storageTree(files),
      manifest.storage_tree,
      "Pliki Storage nie odpowiadają kopii.",
    );
    report.storage_files = manifest.storage_tree.length;
    capture(["rm", "-f", prep]);
    phase = "database-start";
    const database = create("container", "db", [
      "--network",
      `${base}-network`,
      "--user=postgres",
      "--shm-size=256m",
      ...mount("data", "/var/lib/postgresql/data"),
      ...mount("config", "/etc/postgresql"),
      "--entrypoint",
      "postgres",
      runtime.db.image,
      "-D",
      "/var/lib/postgresql/data",
      "-c",
      "config_file=/etc/postgresql/postgresql.conf",
      "-c",
      "ssl=off",
      "-c",
      "listen_addresses=*",
    ]);
    let ready = false;
    for (let i = 0; i < 60; i++) {
      try {
        ready = sql(database, "select 1;") === "1";
      } catch {
        /* Startup/WAL recovery. */
      }
      if (ready) break;
      assert(
        inspect("container", database).State.Running,
        "Odtworzona baza zakończyła proces podczas uruchamiania.",
      );
      await new Promise((done) => setTimeout(done, 500));
    }
    assert(ready, "Odtworzona baza nie uruchomiła się.");
    phase = "database-compare";
    assert.deepEqual(
      inventory(database),
      manifest.inventory,
      "Schemat lub dane odtworzonej bazy różnią się od kopii.",
    );
    report.database_tables = manifest.inventory.rows.length;
    report.database_rows = manifest.inventory.rows.reduce(
      (sum, row) => sum + row.rows,
      0,
    );
    // Sidecars get their preserved local signing keys but an isolated DB URL.
    phase = "services-start";
    for (const service of ["auth", "rest", "storage"]) {
      const path = resolve(directory, `restore-${run}-${service}.env`);
      writeFileSync(
        path,
        restoreEnvironment(runtime[service].environment, database),
        { mode: 0o600 },
      );
      chmodSync(path, 0o600);
      create("container", service, [
        "--network",
        `${base}-network`,
        "--env-file",
        path,
        ...(service === "storage" ? mount("storage", "/mnt") : []),
        runtime[service].image,
      ]);
    }
    const httpScript = `const fs=require('fs');(async()=>{const p=JSON.parse(fs.readFileSync(0,'utf8'));const r=await fetch(p.url,{method:p.method||'GET',headers:p.headers,body:p.body===undefined?undefined:JSON.stringify(p.body),redirect:'error',signal:AbortSignal.timeout(15000)});const bytes=Buffer.from(await r.arrayBuffer());console.log(JSON.stringify({status:r.status,body:bytes.toString('base64')}));})().catch(()=>process.exitCode=1);`;
    const http = (service, path, options = {}) => {
      assert(["auth", "rest", "storage"].includes(service));
      assert(path.startsWith("/") && !path.startsWith("//"));
      const port = service === "auth" ? 9999 : service === "rest" ? 3000 : 5000;
      const result = JSON.parse(
        capture(
          ["exec", "-i", files, "node", "-e", httpScript],
          JSON.stringify({
            ...options,
            url: `http://${base}-${service}:${port}${path}`,
          }),
        ),
      );
      return {
        status: result.status,
        bytes: Buffer.from(result.body, "base64"),
      };
    };
    for (const [service, path] of [
      ["auth", "/health"],
      ["rest", "/"],
      ["storage", "/status"],
    ]) {
      let up = false;
      for (let i = 0; i < 60; i++) {
        try {
          up = http(service, path).status === 200;
        } catch {
          /* Isolated service startup. */
        }
        if (up) break;
        assert(
          inspect("container", `${base}-${service}`).State.Running,
          "Odtworzona usługa zakończyła proces podczas uruchamiania.",
        );
        await new Promise((done) => setTimeout(done, 500));
      }
      assert(up, "Odtworzona usługa nie jest gotowa.");
    }
    report.services_ready = true;
    await stage("services-ready");
    phase = "api-verification";
    if (check)
      await scope.stage(
        () =>
          check({ http, sql: (statement) => sql(database, statement), report }),
        { phase },
      );
    report.checks_passed = true;
    report.status = "ready";
  } catch (error) {
    report.failed_phase = phase;
    report.status = "failed";
    throw error;
  } finally {
    scope.cleaning = true;
    report.cleanup = cleanupRestore(report, directory, reportPath);
    report.finished_at = new Date().toISOString();
    privateJSON(reportPath, report);
    assert(
      report.cleanup,
      "Nie wszystkie własne zasoby odtworzenia zostały usunięte.",
    );
  }
  log(
    `odtworzenie potwierdzone; ${report.database_tables} tabel i ${report.storage_files} plików; zasoby próbne usunięte`,
  );
  return report;
}

function cleanupRestore(report, directory, reportPath) {
  validateRestoreJournal(report, report.backup_id, report.run_id);
  let clean = true;
  for (const resource of [...report.resources].reverse()) {
    try {
      const current = inspectIfPresent(resource.type, resource.name);
      if (current) {
        ownedRestoreResource(current, report.run_id);
        if (resource.id)
          assert.equal(
            current.Id,
            resource.id,
            "Zasób odtworzenia został zastąpiony.",
          );
        if (!report.checks_passed && resource.type === "container") {
          // Diagnostics are best effort and must never prevent owned cleanup.
          try {
            const logs = spawnSync(
              docker,
              [...prefix, "logs", "--tail", "100", resource.name],
              {
                cwd: root,
                env,
                encoding: "utf8",
                timeout: 10000,
                stdio: ["ignore", "pipe", "pipe"],
              },
            );
            appendFileSync(
              resolve(directory, "operations.log"),
              (logs.stdout ?? "") + (logs.stderr ?? ""),
              { mode: 0o600 },
            );
          } catch {
            /* The manifest still records cleanup independently. */
          }
        }
        capture(
          resource.type === "container"
            ? ["rm", "-f", resource.name]
            : [resource.type, "rm", resource.name],
        );
        assert.equal(inspectIfPresent(resource.type, resource.name), null);
      }
      resource.removed = true;
      privateJSON(reportPath, report);
    } catch {
      clean = false;
    }
  }
  return clean;
}

export async function recoverRestore(id, run) {
  configuration();
  backupId(id);
  backupId(run);
  return withBackupMutex(root, run, () => {
    const directory = backupDirectory(id);
    operationDirectory = directory;
    const path = resolve(directory, `restore-${run}.json`);
    privateFile(path);
    const report = validateRestoreJournal(
      JSON.parse(readFileSync(path, "utf8")),
      id,
      run,
    );
    if (!report.cleanup) assertDeadProcess(report.pid);
    if (report.status === "running") {
      report.status = "failed";
      report.checks_passed = false;
      report.failed_phase = report.phase;
    }
    report.cleanup = cleanupRestore(report, directory, path);
    report.recovered_at = new Date().toISOString();
    privateJSON(path, report);
    assert(
      report.cleanup,
      "Nie wszystkie własne zasoby odtworzenia zostały usunięte.",
    );
    log(
      "zasoby przerwanego odtworzenia zostały usunięte; źródło pozostaje bez zmian",
    );
    return report;
  });
}
