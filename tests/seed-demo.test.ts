import { afterEach, beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({
  createClient: vi.fn(),
  createUser: vi.fn(),
  exists: vi.fn(),
  mkdir: vi.fn(),
  write: vi.fn(),
  inserts: vi.fn(),
}));
vi.mock("@supabase/supabase-js", () => ({ createClient: m.createClient }));
vi.mock("node:fs", () => ({
  existsSync: m.exists,
  mkdirSync: m.mkdir,
  writeFileSync: m.write,
}));
beforeEach(() => {
  vi.resetModules();
  vi.resetAllMocks();
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:54321");
  vi.stubEnv("SUPABASE_SECRET_KEY", "fake-local-secret");
  vi.stubEnv("PSI_ALLOW_DEMO_SEED", "yes");
  m.exists.mockReturnValue(false);
  m.createUser.mockImplementation(async () => ({
    data: { user: { id: crypto.randomUUID() } },
    error: null,
  }));
  m.createClient.mockReturnValue({
    auth: { admin: { createUser: m.createUser } },
    from: (table: string) => {
      const result = () => ({
        data: { id: crypto.randomUUID(), name: "Test" },
        error: null,
      });
      const chain = {
        insert: (data: object) => {
          m.inserts(table, data);
          return chain;
        },
        update: () => chain,
        eq: () => chain,
        select: () => chain,
        single: async () => result(),
        then: (resolve: (v: object) => unknown) =>
          Promise.resolve(resolve(result())),
      };
      return chain;
    },
  });
  vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});
it("creates login-ready fixture accounts with unique passwords and a private manifest, without printing credentials", async () => {
  await import("../scripts/seed-demo.mjs");
  expect(m.createUser).toHaveBeenCalledTimes(3);
  const users = m.createUser.mock.calls.map(([user]) => user);
  expect(new Set(users.map((u) => u.password)).size).toBe(3);
  for (const user of users) {
    expect(user.email_confirm).toBe(true);
    expect(user.password.length).toBeGreaterThanOrEqual(12);
    expect(user.email).toMatch(/@example\.test$/);
  }
  const manifest = JSON.parse(m.write.mock.calls.at(-1)![1]);
  expect(m.write.mock.calls.at(-1)![0]).toBe(".local/accounts.json");
  expect(manifest.status).toBe("ready");
  expect(manifest.accounts).toHaveLength(3);
  expect(m.write.mock.calls[0][2]).toEqual({ mode: 0o600, flag: "wx" });
  expect(JSON.stringify(manifest)).not.toContain("fake-local-secret");
  for (const user of users)
    expect(JSON.stringify(vi.mocked(console.log).mock.calls)).not.toContain(
      user.password,
    );
  const walks = m.inserts.mock.calls.filter(([table]) => table === "walks");
  expect(walks).toHaveLength(3);
  expect(walks.every(([, data]) => data.price_cents === 10000)).toBe(true);
});
it.each([
  "https://project.supabase.co",
  "http://localhost/path",
  "http://localhost?key=x",
  "http://u:p@localhost",
])(
  "rejects %s before touching Auth or creating a credential file",
  async (url) => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", url);
    await expect(import("../scripts/seed-demo.mjs")).rejects.toThrow(
      "restricted",
    );
    expect(m.createUser).not.toHaveBeenCalled();
    expect(m.write).not.toHaveBeenCalled();
  },
);
it("refuses to overwrite an earlier set of accounts or generate duplicates", async () => {
  m.exists.mockReturnValue(true);
  await expect(import("../scripts/seed-demo.mjs")).rejects.toThrow(
    "już zapisane dane",
  );
  expect(m.createUser).not.toHaveBeenCalled();
  expect(m.write).not.toHaveBeenCalled();
});
it("preserves the pending credentials if a local Auth request fails, without claiming completion", async () => {
  m.createUser.mockRejectedValueOnce(new Error("offline"));
  await expect(import("../scripts/seed-demo.mjs")).rejects.toThrow("offline");
  const manifest = JSON.parse(m.write.mock.calls.at(-1)![1]);
  expect(manifest.status).toBe("creating");
  expect(manifest.accounts[0].password).toBeTruthy();
  expect(manifest.accounts[0].id).toBeNull();
});
