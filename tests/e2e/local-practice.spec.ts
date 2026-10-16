import { expect } from "@playwright/test";
import { selectLocalPractitioner } from "../helpers/local-practice.mjs";
import { cleanupOwnedFixture } from "../helpers/owned-fixture-cleanup.mjs";
import { test, freeCalendarStart } from "./local-fixtures";
import type { SupabaseClient } from "@supabase/supabase-js";

const original = "10000000-0000-4000-8000-000000000001";
const practitioner = "10000000-0000-4000-8000-000000000002";
const other = "10000000-0000-4000-8000-000000000003";

// No browser, PostgreSQL or accounts: exercise the fixture lifecycle itself.
function database(initial: string | null = original, allowed = true) {
  let primary = initial;
  return {
    current: () => primary,
    replace: (id: string | null) => {
      primary = id;
    },
    async json(sql: string) {
      const result = sql.includes("select to_json(exists(") ? allowed : primary;
      // psql prints SQL NULL as an empty line. LocalPostgres filters empty
      // lines, so a nullable scalar needs an explicit JSON-null fallback.
      const stdout =
        result === null && !/coalesce\s*\(/i.test(sql)
          ? ""
          : JSON.stringify(result);
      const rows = [stdout].filter(Boolean);
      if (rows.length !== 1)
        throw new Error("Query must return exactly one JSON result");
      return JSON.parse(rows[0]);
    },
    async query(sql: string) {
      const value = sql.match(
        /set primary_practitioner_id=(null|'[^']+')/,
      )?.[1];
      if (!value) throw new Error("Unexpected fixture query");
      primary = value === "null" ? null : value.slice(1, -1);
    },
  };
}

test("fixture explicitly selects one practitioner and restores its previous primary", async () => {
  const db = database();
  const practice = await selectLocalPractitioner(db, practitioner);
  expect(db.current()).toBe(practitioner);
  await practice.restore();
  expect(db.current()).toBe(original);
});

test("missing-primary fixture is deliberate and restores a configured environment", async () => {
  const db = database();
  const practice = await selectLocalPractitioner(db, null);
  expect(db.current()).toBeNull();
  await practice.restore();
  expect(db.current()).toBe(original);
});

test("an already unconfigured practice survives the psql JSON-null boundary", async () => {
  const db = database(null);
  const practice = await selectLocalPractitioner(db, null);
  expect(db.current()).toBeNull();
  await practice.restore();
  expect(db.current()).toBeNull();
});

test("fixture cannot select an account outside its disposable administrator scope", async () => {
  const db = database(original, false);
  await expect(selectLocalPractitioner(db, practitioner)).rejects.toThrow(
    "existing local fixture",
  );
  expect(db.current()).toBe(original);
});

test("a failed scenario restores an originally absent primary before deleting its user", async () => {
  const db = database(null);
  let userRemoved = false;
  await expect(
    (async () => {
      const practice = await selectLocalPractitioner(db, practitioner);
      try {
        throw new Error("Injected scenario failure");
      } finally {
        await practice.restore();
        expect(db.current()).toBeNull();
        userRemoved = true;
      }
    })(),
  ).rejects.toThrow("Injected scenario failure");
  expect(userRemoved).toBe(true);
  expect(db.current()).toBeNull();
});

test("cleanup failure still restores primary and cannot be reported as a pass", async () => {
  const db = database();
  const practice = await selectLocalPractitioner(db, practitioner);
  const failure = new Error("Injected cleanup failure");
  let userRemoved = false;
  await expect(
    cleanupOwnedFixture({
      data: async () => {
        throw failure;
      },
      restore: () => practice.restore(),
      accounts: async () => {
        userRemoved = true;
      },
    }),
  ).rejects.toMatchObject({
    errors: [failure],
    cleanupStages: ["data"],
  });
  expect(db.current()).toBe(original);
  expect(userRemoved).toBe(false);
});

test("restoration never overwrites a different runner's new primary", async () => {
  const db = database();
  const practice = await selectLocalPractitioner(db, practitioner);
  db.replace(other);
  await expect(practice.restore()).rejects.toThrow(
    "Another test changed primary",
  );
  expect(db.current()).toBe(other);
});

test("free fixture time checks every page and every meeting of a series", async () => {
  const at = Date.parse("2030-01-10T10:00:00Z");
  const ranges = Array.from({ length: 500 }, (_, n) => ({
    occupied: `["2020-01-01T${String(n % 24).padStart(2, "0")}:00:00Z","2020-01-01T${String(n % 24).padStart(2, "0")}:15:00Z")`,
  }));
  const queries: number[] = [];
  const query = {
    select: () => query,
    order: () => query,
    range: async (from: number) => {
      queries.push(from);
      return {
        error: null,
        data:
          from === 0
            ? ranges
            : [{ occupied: '["2030-01-17T10:00:00Z","2030-01-17T11:00:00Z")' }],
      };
    },
  };
  const db = { from: () => query } as unknown as SupabaseClient;
  expect(
    await freeCalendarStart(db, {
      after: at,
      before: at + 2 * 3600000,
      durationMinutes: 60,
      offsetsMinutes: [0, 7 * 1440],
    }),
  ).toBe("2030-01-10T11:00:00.000Z");
  expect(queries).toEqual([0, 500]);
});
