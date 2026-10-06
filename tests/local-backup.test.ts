import { describe, expect, it } from "vitest";
import {
  chmodSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import {
  artifacts,
  backupId,
  checksum,
  localBackupConfiguration,
  ownedRestoreResource,
  restoreEnvironment,
  validateBackup,
  validateRestoreJournal,
} from "../scripts/lib/backup-guards.mjs";
import {
  assertDeadProcess,
  claimSourceLease,
  releaseSourceLease,
  sourceLease,
  durablePrivateJSON,
} from "../scripts/lib/backup-operation.mjs";
import { mkdirSync, readFileSync, lstatSync } from "node:fs";

const id = "675988db-2b69-435e-bae4-16e4c177ced8";
const local = {
  NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
  NEXT_PUBLIC_APP_URL: "http://localhost:3000",
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "test-public",
  SUPABASE_SECRET_KEY: "test-local-secret",
};
describe("local backup boundaries and integrity", () => {
  it("refuses hosted, alternate, credential-bearing and redirected origins", () => {
    expect(localBackupConfiguration(local)).toEqual({
      key: "test-public",
      secret: "test-local-secret",
    });
    for (const origin of [
      "https://hosted.supabase.co",
      "http://localhost:54321",
      "http://127.0.0.1:54321/path",
      "http://user:password@127.0.0.1:54321",
      "http://127.0.0.1:54321?target=cloud",
    ])
      expect(() =>
        localBackupConfiguration({
          ...local,
          NEXT_PUBLIC_SUPABASE_URL: origin,
        }),
      ).toThrow();
    expect(() =>
      localBackupConfiguration({ ...local, SUPABASE_SECRET_KEY: "" }),
    ).toThrow();
    expect(() =>
      localBackupConfiguration({
        ...local,
        NEXT_PUBLIC_APP_URL: "https://psipawer.vercel.app",
      }),
    ).toThrow();
  });
  it("refuses path traversal and arbitrary backup names", () => {
    expect(backupId(id)).toBe(id);
    for (const value of [
      "../source",
      "../../.env.local",
      `${id}/../other`,
      id.toUpperCase(),
      "",
      "--linked",
    ])
      expect(() => backupId(value)).toThrow();
  });
  it("refuses a shared resource, forged label or source/host mount before cleanup", () => {
    const resource = {
      Name: `/psi-restore-${id}-db`,
      Config: {
        Labels: { "psi.restore.run": id, "psi.restore.project": "psi-pawer" },
      },
      Mounts: [{ Type: "volume", Name: `psi-restore-${id}-data` }],
    };
    expect(ownedRestoreResource(resource, id)).toBe(resource);
    for (const bad of [
      { ...resource, Name: "/supabase_db_psi-pawer" },
      { ...resource, Config: { Labels: {} } },
      {
        ...resource,
        Mounts: [{ Type: "volume", Name: "supabase_db_psi-pawer" }],
      },
      {
        ...resource,
        Mounts: [{ Type: "bind", Name: `psi-restore-${id}-data` }],
      },
    ])
      expect(() => ownedRestoreResource(bad, id)).toThrow();
  });
  it("changes only the approved database destination, preserves signing settings and disables mail", () => {
    const result = restoreEnvironment(
      [
        "PGRST_DB_URI=postgres://authenticator:fixture@supabase_db_psi-pawer:5432/postgres",
        'JWT_JWKS={"keys":[]}',
        "GOTRUE_SMTP_HOST=supabase_inbucket_psi-pawer",
      ],
      `psi-restore-${id}-db`,
    );
    expect(result).toContain(`@psi-restore-${id}-db:5432/postgres`);
    expect(result).toContain('JWT_JWKS={"keys":[]}');
    expect(result).toContain("GOTRUE_SMTP_HOST=mail-disabled.invalid");
    for (const uri of [
      "postgres://user:fixture@hosted.invalid:5432/postgres",
      "postgres://user:fixture@supabase_db_psi-pawer:5432/other",
      "https://supabase_db_psi-pawer:5432/postgres",
    ])
      expect(() =>
        restoreEnvironment([`DATABASE_URL=${uri}`], `psi-restore-${id}-db`),
      ).toThrow();
    expect(() =>
      restoreEnvironment(
        ["KEY=value\nDATABASE_URL=hosted"],
        `psi-restore-${id}-db`,
      ),
    ).toThrow();
    expect(() => restoreEnvironment([], "supabase_db_psi-pawer")).toThrow();
  });
  it("detects damaged, incomplete, exposed and symlinked artifacts", () => {
    const directory = mkdtempSync(resolve(tmpdir(), "psi-backup-integrity-"));
    const manifest = {
      version: 1,
      id,
      source: "psi-pawer-local",
      status: "ready",
      resumed: true,
      artifacts: {} as Record<string, { bytes: number; sha256: string }>,
    };
    try {
      for (const name of artifacts) {
        const bytes = Buffer.from(`fixture ${name}`);
        writeFileSync(resolve(directory, name), bytes, { mode: 0o600 });
        manifest.artifacts[name] = {
          bytes: bytes.length,
          sha256: checksum(bytes),
        };
      }
      expect(validateBackup(directory, manifest)).toBe(manifest);
      expect(() =>
        validateBackup(directory, { ...manifest, status: "creating" }),
      ).toThrow();
      expect(() =>
        validateBackup(directory, { ...manifest, resumed: false }),
      ).toThrow();
      expect(() =>
        validateBackup(directory, {
          ...manifest,
          hba_planned: true,
          hba_restored: false,
        }),
      ).toThrow();
      expect(() =>
        validateBackup(directory, {
          ...manifest,
          artifacts: {
            ...manifest.artifacts,
            "../secret": manifest.artifacts[artifacts[0]],
          },
        }),
      ).toThrow();
      const file = resolve(directory, artifacts[0]);
      writeFileSync(
        file,
        Buffer.from(`fixture ${artifacts[0]}`.replace("fixture", "damaged")),
      );
      expect(() => validateBackup(directory, manifest)).toThrow(/Integralność/);
      writeFileSync(file, Buffer.from(`fixture ${artifacts[0]}`));
      chmodSync(file, 0o644);
      expect(() => validateBackup(directory, manifest)).toThrow(/prywatne/);
      chmodSync(file, 0o600);
      rmSync(file);
      symlinkSync(resolve(directory, artifacts[1]), file);
      expect(() => validateBackup(directory, manifest)).toThrow(/zwykłych/);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
  it("keeps a crashed backup's exclusive lease until its own recovery", () => {
    const root = mkdtempSync(resolve(tmpdir(), "psi-backup-lease-"));
    try {
      mkdirSync(resolve(root, ".local/backups"), {
        recursive: true,
        mode: 0o700,
      });
      expect(sourceLease(root)).toBeNull();
      claimSourceLease(root, id);
      expect(sourceLease(root)).toBe(id);
      const other = "b8d3c19d-3de7-4412-bdf3-089a22434a24";
      expect(() => claimSourceLease(root, other)).toThrow();
      expect(() => releaseSourceLease(root, other)).toThrow();
      expect(sourceLease(root)).toBe(id);
      releaseSourceLease(root, id);
      releaseSourceLease(root, id);
      expect(sourceLease(root)).toBeNull();
      expect(() => assertDeadProcess(process.pid)).toThrow(/nadal istnieje/);
      for (const pid of [-1, 0, "1", null])
        expect(() => assertDeadProcess(pid)).toThrow();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
  it("rejects foreign or substituted resources in a recovery journal", () => {
    const journal = {
      version: 1,
      source: "psi-pawer-local",
      backup_id: id,
      run_id: id,
      pid: 1000,
      status: "running",
      resources: [
        { type: "volume", name: `psi-restore-${id}-storage` },
        {
          type: "container",
          name: `psi-restore-${id}-storage`,
          id: "a".repeat(64),
        },
      ],
    };
    expect(validateRestoreJournal(journal, id, id)).toBe(journal);
    for (const bad of [
      { ...journal, source: "cloud" },
      { ...journal, pid: 0 },
      { ...journal, run_id: "../source" },
      {
        ...journal,
        resources: [{ type: "container", name: "supabase_db_psi-pawer" }],
      },
      {
        ...journal,
        resources: [{ type: "image", name: `psi-restore-${id}-db` }],
      },
      { ...journal, resources: [journal.resources[0], journal.resources[0]] },
      { ...journal, resources: [{ ...journal.resources[1], id: "replaced" }] },
    ])
      expect(() => validateRestoreJournal(bad, id, id)).toThrow();
  });
  it("replaces the private journal with a complete record", () => {
    const directory = mkdtempSync(resolve(tmpdir(), "psi-backup-journal-"));
    try {
      const path = resolve(directory, "manifest.json");
      durablePrivateJSON(path, { status: "running", resources: [id] });
      durablePrivateJSON(path, { status: "failed", cleanup: true });
      expect(JSON.parse(readFileSync(path, "utf8"))).toEqual({
        status: "failed",
        cleanup: true,
      });
      expect(lstatSync(path).mode & 0o077).toBe(0);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
