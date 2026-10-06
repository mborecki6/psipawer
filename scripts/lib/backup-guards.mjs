import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { lstatSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

export const artifacts = [
  "database.tar.gz",
  "database-config.tar.gz",
  "storage.tar.gz",
  "runtime.json",
];
export function backupId(value) {
  assert(
    typeof value === "string" &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
        value,
      ),
    "Wymagany identyfikator własnej lokalnej kopii.",
  );
  return value;
}
export function localBackupConfiguration(values) {
  assert.equal(values.NEXT_PUBLIC_SUPABASE_URL, "http://127.0.0.1:54321");
  assert.equal(values.NEXT_PUBLIC_APP_URL, "http://localhost:3000");
  assert(
    values.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY && values.SUPABASE_SECRET_KEY,
  );
  return {
    key: values.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    secret: values.SUPABASE_SECRET_KEY,
  };
}
export function privateFile(path) {
  const stat = lstatSync(path);
  assert(
    stat.isFile() && !stat.isSymbolicLink(),
    "Kopia wymaga zwykłych plików.",
  );
  assert.equal(stat.mode & 0o077, 0, "Pliki kopii muszą być prywatne.");
  return stat;
}
export function checksum(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}
export function validateBackup(directory, manifest) {
  backupId(manifest.id);
  assert.equal(manifest.version, 1);
  assert.equal(manifest.status, "ready");
  assert.equal(
    manifest.resumed,
    true,
    "Niepotwierdzone wznowienie źródłowych usług.",
  );
  assert.equal(manifest.source, "psi-pawer-local");
  if (manifest.hba_planned)
    assert.equal(
      manifest.hba_restored,
      true,
      "Niepotwierdzone odtworzenie ustawień źródła.",
    );
  assert.deepEqual(
    Object.keys(manifest.artifacts).sort(),
    [...artifacts].sort(),
  );
  for (const name of artifacts) {
    const path = resolve(directory, name);
    const stat = privateFile(path);
    assert.equal(
      stat.size,
      manifest.artifacts[name].bytes,
      "Rozmiar kopii zmienił się.",
    );
    assert.equal(
      checksum(readFileSync(path)),
      manifest.artifacts[name].sha256,
      "Integralność kopii niepotwierdzona.",
    );
  }
  return manifest;
}
export function ownedRestoreResource(resource, id) {
  backupId(id);
  const labels = resource.Config?.Labels ?? resource.Labels;
  assert.equal(
    labels?.["psi.restore.run"],
    id,
    "Zasób nie należy do tej próby odtworzenia.",
  );
  assert.equal(
    labels?.["psi.restore.project"],
    "psi-pawer",
    "Nieprawidłowy projekt zasobu.",
  );
  const name = resource.Name?.replace(/^\//, "");
  assert(name?.startsWith(`psi-restore-${id}-`), "Niedozwolona nazwa zasobu.");
  for (const mount of resource.Mounts ?? [])
    assert(
      mount.Type === "volume" && mount.Name?.startsWith(`psi-restore-${id}-`),
      "Odtwarzanie nie może montować danych źródłowych ani katalogów hosta.",
    );
  return resource;
}
export function validateRestoreJournal(journal, id, run) {
  assert.equal(journal.version, 1);
  assert.equal(journal.source, "psi-pawer-local");
  assert.equal(journal.backup_id, backupId(id));
  assert.equal(journal.run_id, backupId(run));
  assert(Number.isSafeInteger(journal.pid) && journal.pid > 0);
  assert(["running", "ready", "failed"].includes(journal.status));
  assert(Array.isArray(journal.resources) && journal.resources.length <= 11);
  const roles = {
    network: ["network"],
    volume: ["data", "config", "storage"],
    container: ["prepare", "files", "db", "auth", "rest", "storage"],
  };
  const seen = new Set();
  for (const resource of journal.resources) {
    assert(
      roles[resource.type]?.some(
        (role) => resource.name === `psi-restore-${run}-${role}`,
      ),
    );
    const identity = `${resource.type}:${resource.name}`;
    assert(!seen.has(identity), "Powtórzony zasób odtworzenia.");
    seen.add(identity);
    if (resource.id !== undefined) {
      assert(resource.type !== "volume" && /^[0-9a-f]{64}$/.test(resource.id));
    }
  }
  return journal;
}
export function restoreEnvironment(source, databaseHost) {
  assert(/^psi-restore-[0-9a-f-]{36}-db$/.test(databaseHost));
  const values = Object.fromEntries(
    source.map((entry) => {
      const index = entry.indexOf("=");
      assert(index > 0);
      return [entry.slice(0, index), entry.slice(index + 1)];
    }),
  );
  for (const key of [
    "GOTRUE_DB_DATABASE_URL",
    "PGRST_DB_URI",
    "DATABASE_URL",
    "VECTOR_DATABASE_URL",
  ]) {
    if (!values[key]) continue;
    const url = new URL(values[key]);
    assert(["postgres:", "postgresql:"].includes(url.protocol));
    assert.equal(
      url.hostname,
      "supabase_db_psi-pawer",
      "Konfiguracja wskazuje inną bazę.",
    );
    assert.equal(url.port, "5432");
    assert.equal(url.pathname, "/postgres");
    url.hostname = databaseHost;
    values[key] = url.toString();
  }
  // The isolated network has no external route or source mailbox. No recovery,
  // signup, invitation or reminder operation is called during verification.
  if ("GOTRUE_SMTP_HOST" in values)
    values.GOTRUE_SMTP_HOST = "mail-disabled.invalid";
  return (
    Object.entries(values)
      .map(([key, value]) => {
        assert(
          /^[A-Z][A-Z0-9_]*$/.test(key) && !/[\r\n\0]/.test(value),
          "Nieobsługiwany format konfiguracji.",
        );
        return `${key}=${value}`;
      })
      .join("\n") + "\n"
  );
}
