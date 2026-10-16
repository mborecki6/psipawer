import { describe, expect, it, vi } from "vitest";
import {
  chmodSync,
  closeSync,
  lstatSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  accessTarget,
  accessRecipients,
  directory,
  expiryEvidence,
  planAccess,
  applyAccess,
  validatePlan,
  supabaseAccessAdapter,
  privateAccessFiles,
  writeAccessCheckpoint,
} from "../scripts/lib/manual-client-access.mjs";

const target = accessTarget({
  PSI_MANUAL_SUPABASE_URL: "http://127.0.0.1:54321",
  PSI_MANUAL_APP_ORIGIN: "http://localhost:3000",
});
const token = "a".repeat(64);
const id = "11111111-1111-4111-8111-111111111111";
type TestUser = {
  id: string;
  email: string;
  user_metadata?: object;
  confirmation_sent_at?: string;
  recovery_sent_at?: string;
};
type TestIdentity = {
  userId?: string;
  profileId?: string;
  role?: string;
} | null;
type TestRecord = {
  status?: string;
  url?: string;
  expiresAt?: string | null;
  expiryStatus?: string;
  reason?: string;
};
const input = (...recipients: Array<{ email: string; intent: string }>) => ({
  version: 1,
  recipients,
});
const recipient = (email = "client@example.test", intent = "new") => ({
  email,
  intent,
});
function fixture(users: TestUser[] = [], roles: Record<string, string> = {}) {
  const state = structuredClone(users);
  const adapter = {
    listUsers: vi.fn(async (page: number, size: number) =>
      structuredClone(state.slice((page - 1) * size, page * size)),
    ),
    identity: vi.fn<(userId: string) => Promise<TestIdentity>>(
      async (userId) => ({
        userId,
        profileId: userId,
        role: roles[userId] || "client",
      }),
    ),
    generateLink: vi.fn<
      (params: { email: string; type: string }) => Promise<{
        user: TestUser;
        properties: { hashed_token: string; verification_type: string };
      }>
    >(async ({ email, type }) => {
      let user = state.find((u) => u.email === email);
      if (!user) {
        user = { id, email };
        state.push(user);
      }
      return {
        user: {
          ...user,
          confirmation_sent_at: "2026-10-15T10:00:00.000Z",
          recovery_sent_at: "2026-10-15T10:00:00.000Z",
        },
        properties: { hashed_token: token, verification_type: type },
      };
    }),
  };
  return { adapter, state };
}
async function planned(
  adapter: ReturnType<typeof fixture>["adapter"],
  recipients = [recipient()],
  expiry: {
    seconds: number;
    source: string;
    checkedAt: string;
    supabaseOrigin?: string;
  } | null = null,
) {
  return planAccess({ input: input(...recipients), adapter, target, expiry });
}
async function applied(
  adapter: ReturnType<typeof fixture>["adapter"],
  plan: Awaited<ReturnType<typeof planAccess>>,
) {
  const events: TestRecord[] = [];
  const result = await applyAccess({
    plan,
    adapter,
    target,
    checkpoint: (row: TestRecord) => events.push(row),
  });
  return { result, events };
}

describe("manual client access plan", () => {
  it("normalizes and deduplicates without creating accounts or tokens", async () => {
    const { adapter } = fixture();
    const plan = await planned(adapter, [
      recipient(" Client@Example.test "),
      recipient(),
    ]);
    expect(plan.rows).toEqual([
      { ...recipient(), status: "planned", userId: null, tokenType: "invite" },
    ]);
    expect(adapter.generateLink).not.toHaveBeenCalled();
    expect(JSON.stringify(plan)).not.toContain(token);
  });
  it.each([
    { version: 1, recipients: [] },
    input(recipient("invalid")),
    input(recipient("a@b.test", "admin")),
    input(recipient("a@b.test", "new"), recipient("A@B.test", "access")),
  ])("rejects invalid or conflicting input", (data) =>
    expect(() => accessRecipients(data)).toThrow(),
  );
  it("looks beyond the first 1000 Auth accounts and page 9", async () => {
    const users = Array.from({ length: 2011 }, (_, index) => ({
      id: `id-${index}`,
      email: `person${index}@example.test`,
    }));
    const { adapter } = fixture(users);
    const plan = await planned(adapter, [
      recipient("person2010@example.test", "access"),
    ]);
    expect(adapter.listUsers).toHaveBeenLastCalledWith(11, 200);
    expect(plan.rows[0].userId).toBe("id-2010");
  });
  it("does not interpret an incomplete or moving directory as a missing user", async () => {
    const adapter = {
      listUsers: vi.fn(async () =>
        Array.from({ length: 200 }, (_, i) => ({ id: `id-${i}` })),
      ),
    };
    await expect(directory(adapter)).rejects.toThrow("directory_changed");
  });
  it("blocks every administrator by its current database role, regardless of address", async () => {
    const { adapter } = fixture([{ id, email: "someone-new@example.test" }], {
      [id]: "admin",
    });
    const plan = await planned(adapter, [
      recipient("someone-new@example.test", "access"),
    ]);
    expect(plan.rows[0]).toHaveProperty("reason", "staff_account");
    await expect(applied(adapter, plan)).rejects.toThrow("plan_not_applicable");
    expect(adapter.generateLink).not.toHaveBeenCalled();
  });
  it.each([
    null,
    { userId: id, profileId: id, role: "other" },
    { userId: id, role: "client" },
  ])(
    "fails closed for missing or inconsistent role/profile",
    async (identity) => {
      const { adapter } = fixture([{ id, email: "client@example.test" }]);
      adapter.identity.mockResolvedValue(identity);
      expect(
        (await planned(adapter, [recipient(undefined, "access")])).rows[0]
          .reason,
      ).toBe("inconsistent_identity");
    },
  );
  it("requires an explicit access intent for existing clients and never creates a missing recovery account", async () => {
    const { adapter } = fixture([{ id, email: "client@example.test" }]);
    expect((await planned(adapter)).rows[0].reason).toBe("account_exists");
    expect(
      (await planned(adapter, [recipient("absent@example.test", "access")]))
        .rows[0].reason,
    ).toBe("account_missing");
    expect(adapter.generateLink).not.toHaveBeenCalled();
  });
  it("rejects an edited plan and a different destination", async () => {
    const { adapter } = fixture();
    const plan = await planned(adapter);
    expect(() => validatePlan({ ...plan, rows: [] }, target)).toThrow(
      "plan_not_applicable",
    );
    expect(() =>
      validatePlan(plan, { ...target, appOrigin: "https://other.test" }),
    ).toThrow("plan_not_applicable");
  });
  it.each([
    ["http://project.supabase.co", "https://app.test", true],
    ["https://project.supabase.co", "https://app.test", false],
    ["http://127.0.0.1:54321", "https://app.test", true],
    ["http://127.0.0.1:54321/path", "http://localhost:3000", false],
    ["http://u:p@localhost:54321", "http://localhost:3000", false],
  ])("rejects unintended targets", (db, app, hosted) => {
    expect(() =>
      accessTarget(
        { PSI_MANUAL_SUPABASE_URL: db, PSI_MANUAL_APP_ORIGIN: app },
        hosted,
      ),
    ).toThrow();
  });
});

describe("manual access execution", () => {
  it("checkpoints before Auth, creates an invite link for a new client and never consumes it", async () => {
    const { adapter } = fixture();
    const plan = await planned(adapter);
    const events: TestRecord[] = [];
    adapter.generateLink.mockImplementationOnce(async (params) => {
      expect(events).toHaveLength(1);
      expect(events[0]).toHaveProperty("status", "pending");
      expect(events[0]).not.toHaveProperty("url");
      expect(params).toEqual({ type: "invite", email: "client@example.test" });
      return {
        user: { id, email: params.email },
        properties: { hashed_token: token, verification_type: "invite" },
      };
    });
    const result = await applyAccess({
      plan,
      adapter,
      target,
      checkpoint: (row: TestRecord) => events.push(row),
    });
    expect(result.complete).toBe(true);
    expect(events.at(-1)!.url).toBe(
      `http://localhost:3000/auth/invitation?token_hash=${token}`,
    );
    expect(events.at(-1)!.expiresAt).toBeNull();
    expect(events.at(-1)!.expiryStatus).toBe("unverified");
  });
  it("preserves the existing client's identity and passes no metadata, password or profile update", async () => {
    const existing = {
      id,
      email: "client@example.test",
      user_metadata: { private: "kept" },
    };
    const { adapter, state } = fixture([existing]);
    const { result } = await applied(
      adapter,
      await planned(adapter, [recipient(undefined, "access")]),
    );
    expect(adapter.generateLink).toHaveBeenCalledExactlyOnceWith({
      type: "magiclink",
      email: existing.email,
    });
    expect(state).toEqual([existing]);
    expect(result.records[0].userId).toBe(id);
    expect(new URL(result.records[0].url!).pathname).toBe("/auth/access");
  });
  it("rechecks all recipients before any mutation and rejects a newly promoted admin", async () => {
    const { adapter } = fixture([{ id, email: "client@example.test" }]);
    const plan = await planned(adapter, [recipient(undefined, "access")]);
    adapter.identity.mockResolvedValue({
      userId: id,
      profileId: id,
      role: "admin",
    });
    await expect(applied(adapter, plan)).rejects.toThrow("plan_changed");
    expect(adapter.generateLink).not.toHaveBeenCalled();
  });
  it("refuses a new account that appeared after the plan", async () => {
    const { adapter, state } = fixture();
    const plan = await planned(adapter);
    state.push({ id, email: "client@example.test" });
    await expect(applied(adapter, plan)).rejects.toThrow("plan_changed");
    expect(adapter.generateLink).not.toHaveBeenCalled();
  });
  it.each([
    "wrong-id",
    "wrong-email",
    "wrong-type",
    "staff",
    "missing-profile",
    "missing-token",
  ])("withholds credentials on a provider mismatch: %s", async (mode) => {
    const { adapter } = fixture([{ id, email: "client@example.test" }]);
    const plan = await planned(adapter, [recipient(undefined, "access")]);
    adapter.generateLink.mockImplementationOnce(async () => {
      if (mode === "staff")
        adapter.identity.mockResolvedValue({
          userId: id,
          profileId: id,
          role: "admin",
        });
      if (mode === "missing-profile")
        adapter.identity.mockResolvedValue({ userId: id, role: "client" });
      return {
        user: {
          id: mode === "wrong-id" ? "other" : id,
          email:
            mode === "wrong-email"
              ? "other@example.test"
              : "client@example.test",
        },
        properties: {
          hashed_token: mode === "missing-token" ? "short" : token,
          verification_type: mode === "wrong-type" ? "signup" : "magiclink",
        },
      };
    });
    const { result, events } = await applied(adapter, plan);
    expect(result.complete).toBe(false);
    expect(result.records[0].status).toBe("uncertain");
    expect(JSON.stringify(events)).not.toContain(token);
  });
  it("does not retry or process the next recipient after a possibly accepted request", async () => {
    const { adapter } = fixture();
    const plan = await planned(adapter, [
      recipient(),
      recipient("second@example.test"),
    ]);
    adapter.generateLink.mockRejectedValueOnce(
      new Error(`response includes ${token}`),
    );
    const { result, events } = await applied(adapter, plan);
    expect(adapter.generateLink).toHaveBeenCalledTimes(1);
    expect(result.complete).toBe(false);
    expect(events.at(-1)!.reason).toBe("provider_result_unknown");
    expect(JSON.stringify(events)).not.toContain(token);
  });
  it("does not call Auth if durable checkpointing fails", async () => {
    const { adapter } = fixture();
    const plan = await planned(adapter);
    await expect(
      applyAccess({
        plan,
        adapter,
        target,
        checkpoint: () => {
          throw new Error("disk full");
        },
      }),
    ).rejects.toThrow("disk full");
    expect(adapter.generateLink).not.toHaveBeenCalled();
  });
  it("derives expiry only from explicit matching configuration and the provider's sent timestamp", async () => {
    const { adapter } = fixture();
    const expiry = {
      seconds: 3600,
      source: "local-auth-config",
      checkedAt: "2026-01-01T00:00:00Z",
      supabaseOrigin: target.supabaseOrigin,
    };
    const { result } = await applied(
      adapter,
      await planned(adapter, [recipient()], expiry),
    );
    expect(result.records[0].expiresAt).toBe("2026-10-15T11:00:00.000Z");
    expect(result.records[0].expiryStatus).toBe("configured");
    expect(() => expiryEvidence({ ...expiry, seconds: 0 })).toThrow(
      "invalid_expiry_evidence",
    );
    await expect(
      planned(adapter, [recipient("other@example.test")], {
        ...expiry,
        supabaseOrigin: "https://other.supabase.co",
      }),
    ).rejects.toThrow("expiry_target_mismatch");
  });
  it("accepts a Management read snapshot and binds its source project to the target", () => {
    const evidence = expiryEvidence(
      {
        seconds: 3600,
        source:
          "Supabase Management GET /v1/projects/projectref/config/auth:mailer_otp_exp",
        checkedAt: "2026-01-01T00:00:00Z",
      },
      new Date(),
      "https://projectref.supabase.co",
    );
    expect(evidence!.supabaseOrigin).toBe("https://projectref.supabase.co");
    expect(() =>
      expiryEvidence(evidence, new Date(), target.supabaseOrigin),
    ).toThrow("expiry_target_mismatch");
  });
  it("keeps raw provider failures out of adapter errors", async () => {
    const client = {
      auth: {
        admin: {
          generateLink: vi.fn(async () => ({ error: new Error(token) })),
        },
      },
    };
    await expect(
      supabaseAccessAdapter(client).generateLink({
        type: "magiclink",
        email: "client@example.test",
      }),
    ).rejects.toThrow("provider_unavailable");
  });
});

describe("private operator files", () => {
  function temporary(
    run: (files: ReturnType<typeof privateAccessFiles>, root: string) => void,
  ) {
    const sandbox = mkdtempSync(
      join(realpathSync(tmpdir()), "psi-manual-access-"),
    );
    const root = join(sandbox, "repository");
    mkdirSync(root, { mode: 0o700 });
    try {
      run(privateAccessFiles(root, join(sandbox, "private")), root);
    } finally {
      rmSync(sandbox, { recursive: true, force: true });
    }
  }
  it("requires an absolute private directory outside the repository, including ignored .local", () =>
    temporary((files, root) => {
      expect(() => privateAccessFiles(root, "relative-private")).toThrow(
        "absolute_private_directory_required",
      );
      expect(() => privateAccessFiles(root, root)).toThrow(
        "private_directory_in_repository",
      );
      expect(() =>
        privateAccessFiles(root, join(root, ".local/manual-client-access")),
      ).toThrow("private_directory_in_repository");
      for (const name of [
        "input.json",
        "plan.json",
        "result.jsonl",
        "expiry.json",
      ]) {
        expect(() => files.read(join(root, ".local", name))).toThrow(
          "private_path_in_repository",
        );
        expect(() => files.open(join(root, ".local", name))).toThrow(
          "private_path_in_repository",
        );
      }
      // Configuring the default only resolves parents; it writes no files.
      const defaults = privateAccessFiles(root);
      expect(defaults.privateRoot.startsWith(`${root}/`)).toBe(false);
    }));
  it("creates owner-only files and directories; keeps every durable journal entry", () =>
    temporary((files) => {
      const file = files.open(join(files.privateRoot, "result.jsonl"));
      try {
        writeAccessCheckpoint(file.fd, { status: "pending" });
        writeAccessCheckpoint(file.fd, { status: "ready", url: token });
        expect(lstatSync(file.full).mode & 0o777).toBe(0o600);
        expect(lstatSync(files.privateRoot).mode & 0o777).toBe(0o700);
        expect(
          readFileSync(file.full, "utf8")
            .trim()
            .split("\n")
            .map((line) => JSON.parse(line)),
        ).toEqual([{ status: "pending" }, { status: "ready", url: token }]);
        expect(() => files.open(file.full)).toThrow();
        expect(readFileSync(file.full, "utf8")).toContain(token);
      } finally {
        closeSync(file.fd);
      }
    }));
  it("refuses public input permissions, public directories and paths outside the private area", () =>
    temporary((files, root) => {
      mkdirSync(files.privateRoot, { recursive: true, mode: 0o700 });
      const inputPath = join(files.privateRoot, "input.json");
      writeFileSync(inputPath, "{}", { mode: 0o600 });
      expect(files.read(inputPath)).toEqual({});
      chmodSync(inputPath, 0o644);
      expect(() => files.read(inputPath)).toThrow(
        "private_file_permissions_required",
      );
      expect(() => files.open(join(root, "escaped.json"))).toThrow(
        "private_path_in_repository",
      );
      chmodSync(files.privateRoot, 0o755);
      expect(() => files.open(join(files.privateRoot, "result.jsonl"))).toThrow(
        "private_directory_permissions_required",
      );
    }));
  it("refuses symlinks in an output or its ancestor without replacing the target", () =>
    temporary((files, root) => {
      mkdirSync(files.privateRoot, { recursive: true, mode: 0o700 });
      const existing = join(root, "existing.json");
      writeFileSync(existing, "preserved", { mode: 0o600 });
      const link = join(files.privateRoot, "link.json");
      symlinkSync(existing, link);
      expect(() => files.open(link)).toThrow("symlink_not_allowed");
      expect(() => files.read(link)).toThrow("symlink_not_allowed");
      const ancestor = join(files.privateRoot, "ancestor");
      symlinkSync(root, ancestor);
      expect(() => files.open(join(ancestor, "new.json"))).toThrow(
        "symlink_not_allowed",
      );
      expect(readFileSync(existing, "utf8")).toBe("preserved");
    }));
  it("refuses a configured symlink directory and hard-linked credential input", () =>
    temporary((files, root) => {
      mkdirSync(files.privateRoot, { recursive: true, mode: 0o700 });
      const alias = join(dirname(files.privateRoot), "private-alias");
      symlinkSync(files.privateRoot, alias);
      expect(() => privateAccessFiles(root, alias)).toThrow(
        "symlink_not_allowed",
      );
      const original = join(files.privateRoot, "original.json");
      const hardlink = join(files.privateRoot, "hardlink.json");
      writeFileSync(original, "{}", { mode: 0o600 });
      linkSync(original, hardlink);
      expect(() => files.read(hardlink)).toThrow(
        "private_file_permissions_required",
      );
      expect(() => files.open(hardlink)).toThrow();
      expect(readFileSync(original, "utf8")).toBe("{}");
    }));
});
