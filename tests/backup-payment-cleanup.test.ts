import { expect, it } from "vitest";
import type { LocalPostgres } from "./helpers/local-postgres.mjs";
import {
  disposeBackupPayments,
  prepareBackupPayments,
} from "./helpers/backup-payment-fixtures.mjs";

it("removes care/reporting and receipt dependencies for only owned dogs before their parent", async () => {
  const calls: string[] = [];
  const dogs = ["one-owned-dog", "two-owned-dog", "three-owned-dog"];
  const db = {
    json: async () => dogs.map((id) => ({ id, guardian_id: "owned-user" })),
    query: async (sql: string) => {
      calls.push(sql);
    },
    close: async () => {
      calls.push("CLOSE");
    },
  };
  await disposeBackupPayments(
    { owner: "owned-user", dogs },
    { connect: async () => db as unknown as LocalPostgres },
  );
  const all = calls.join("\n");
  expect(all.indexOf("care_control_invitations")).toBeLessThan(
    all.indexOf("delete from public.fitness_packages"),
  );
  expect(all.indexOf("care_reporting_entitlements")).toBeLessThan(
    all.indexOf("delete from public.fitness_packages"),
  );
  expect(all.indexOf("online_payment_notifications")).toBeLessThan(
    all.indexOf("delete from public.online_payment_attempts"),
  );
  expect(all.indexOf("payment_id=null")).toBeLessThan(
    all.indexOf("delete from public.payments"),
  );
  for (const dog of dogs) expect(all).toContain(dog);
  expect(all).not.toContain("truncate");
  expect(calls.at(-1)).toBe("CLOSE");
});

it("refuses another guardian's data before issuing any cleanup mutation", async () => {
  const calls: string[] = [];
  const db = {
    json: async () => [{ id: "owned-dog", guardian_id: "another-user" }],
    query: async (sql: string) => {
      calls.push(sql);
    },
    close: async () => {},
  };
  await expect(
    disposeBackupPayments(
      { owner: "owned-user", dogs: ["owned-dog"] },
      { connect: async () => db as unknown as LocalPostgres },
    ),
  ).rejects.toThrow("another guardian");
  expect(calls).toEqual([]);
});

it("preserves generated IDs for repair and uses a separate dog for each active payment fixture", async () => {
  const fixture: { dogs?: string[]; targets?: string[]; requests?: string[] } =
    {};
  const dogs = new Set<string>();
  const checkpoints: { dogs: string[]; targets: string[] }[] = [];
  let counter = 0;
  const db = {
    async query(sql: string) {
      if (sql.includes("insert into public.dogs")) {
        const match = sql.match(
          /insert into public.dogs[^;]+values\('([^']+)'/,
        );
        expect(match).not.toBeNull();
        expect(dogs.has(match![1])).toBe(false);
        dogs.add(match![1]);
        expect(checkpoints.at(-1)?.dogs).toContain(match![1]);
      }
    },
    async json(sql: string): Promise<unknown> {
      if (sql.includes("jsonb_build_object('online'"))
        return { online: { enabled: false }, email: { enabled: false } };
      if (sql.includes("begin_online_payment"))
        return { attempt: { id: `attempt-${++counter}` } };
      if (sql.includes("bind_online_payment"))
        return {
          id: `attempt-${counter}`,
          transaction_id: `transaction-${counter}`,
          transaction_title: `title-${counter}`,
        };
      if (sql.includes("record_online_payment_notification")) return {};
      if (sql.includes("public.payments r"))
        return [{ id: "payment1" }, { id: "payment2" }];
      if (sql.includes("public.business_email_outbox r"))
        return [{ status: "pending" }, { status: "uncertain" }];
      return [];
    },
    close: async () => {},
  };
  await prepareBackupPayments({
    owner: { id: "owned-user" },
    staff: { id: "owned-staff" },
    fixture,
    onStage: () =>
      checkpoints.push({
        dogs: [...(fixture.dogs || [])],
        targets: [...(fixture.targets || [])],
      }),
    connect: async () => db as unknown as LocalPostgres,
  });
  expect(dogs.size).toBe(3);
  expect(fixture.requests).toHaveLength(3);
  expect(fixture.targets).toHaveLength(3);
});

it("persists the exact account email before Auth can accept creation and lose its response", async () => {
  const { readFileSync } = await import("node:fs");
  const { runInNewContext } = await import("node:vm");
  const { default: assert } = await import("node:assert/strict");
  const source = readFileSync("tests/local/backup-restore.mjs", "utf8");
  // Execute the real journal and account-loop code in memory. No database,
  // credentials, filesystem writes or main catch/finally run in this harness.
  const journalFunctions = source.slice(
    source.indexOf("function privateJson("),
    source.indexOf("function recordFailure("),
  );
  const stage = source.slice(
    source.indexOf("const onStage = (value) =>"),
    source.indexOf("// Each operation releases"),
  );
  const accountLoop = source.slice(
    source.indexOf('  onStage("source-accounts");'),
    source.indexOf("  const owner = users[0]"),
  );
  const writes = new Map<string, string>();
  const events: string[] = [];
  const run = "65000000-0000-4000-8000-000000000001";
  const password = "Psi-backup!generated-fixture-secret";
  let durableAtAcceptance: string | undefined;
  const execution = runInNewContext(
    `${journalFunctions}\n${stage}\n(async () => {${accountLoop}})()`,
    {
      run,
      phase: "source-baseline",
      sourceBefore: [{ name: "profiles", rows: 1, digest: "baseline" }],
      sourceAuthBefore: "original-auth-hash",
      sourceSharedSettings: { online: { enabled: false } },
      users: [],
      dogs: [],
      files: [],
      leases: [],
      courses: [],
      fitness: { dogs: [], packages: [] },
      gifts: { cards: [], packages: [] },
      paymentFixture: {},
      journalPath: "memory-journal.json",
      writeFileSync(path: string, value: string, options: { mode: number }) {
        expect(options.mode).toBe(0o600);
        writes.set(path, value);
        events.push("write");
      },
      chmodSync(_path: string, mode: number) {
        expect(mode).toBe(0o600);
      },
      renameSync(from: string, to: string) {
        writes.set(to, writes.get(from)!);
        writes.delete(from);
        events.push("persist");
      },
      randomUUID: () => "generated-fixture-secret",
      checked: (value: { data: unknown }) => value.data,
      assert,
      db: {
        auth: {
          admin: {
            createUser: async (input: { email: string; password: string }) => {
              expect(input.email).toBe(`psi-backup-${run}-0@example.test`);
              expect(input.password).toBe(password);
              events.push("auth-accepted-response-lost");
              durableAtAcceptance = writes.get("memory-journal.json");
              throw new Error(
                "Auth accepted; response was lost before caller received the ID",
              );
            },
          },
        },
      },
    },
  );
  await expect(execution).rejects.toThrow("response was lost");
  const durable = JSON.parse(durableAtAcceptance!);
  expect(durable.users).toEqual([
    { email: `psi-backup-${run}-0@example.test`, role: "client" },
  ]);
  expect(durableAtAcceptance).not.toContain(password);
  expect(durable.users[0]).not.toHaveProperty("id");
  expect(events.at(-1)).toBe("auth-accepted-response-lost");
  expect(events.at(-2)).toBe("persist");
});
