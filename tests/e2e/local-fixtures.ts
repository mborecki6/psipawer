import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { expect, test as base, type Page } from "@playwright/test";
import { LocalPostgres } from "../helpers/local-postgres.mjs";
import { selectLocalPractitioner } from "../helpers/local-practice.mjs";
import { cleanupOwnedFixture } from "../helpers/owned-fixture-cleanup.mjs";

const practices = new Map<SupabaseClient, () => Promise<void>>();

// The automatic teardown is a last resort if a scenario's own cleanup throws
// before it reaches disposeCareFixtures. It restores configuration and still
// leaves the scenario failed; it never conceals incomplete fixture deletion.
export const test = base.extend<{ localPracticeCleanup: void }>({
  localPracticeCleanup: [
    async ({ browserName }, run) => {
      void browserName;
      try {
        await run();
      } finally {
        await cleanupSteps(
          ...[...practices.keys()].map(
            (db) => () => restoreLocalPractitioner(db),
          ),
        );
      }
    },
    { auto: true },
  ],
});

// A scenario explicitly names its own conducting account. Merely creating an
// administrator never changes the practice's configuration.
export async function setupLocalPractitioner(
  db: SupabaseClient,
  ownedUsers: string[],
  practitionerId: string,
) {
  if (!ownedUsers.includes(practitionerId) || practices.has(db))
    throw new Error("Select one owned practitioner per fixture lifecycle.");
  let sql = await new LocalPostgres().ready();
  try {
    const practice = await selectLocalPractitioner(
      {
        query: (statement) => sql.query(statement),
        json: (statement) => sql.json(statement),
      },
      practitionerId,
    );
    practices.set(db, async () => {
      try {
        if (sql.ended) sql = await new LocalPostgres().ready();
        await practice.restore();
      } finally {
        await sql.close();
      }
    });
  } catch (error) {
    await sql.close();
    throw error;
  }
}

export async function restoreLocalPractitioner(db: SupabaseClient) {
  const restore = practices.get(db);
  if (!restore) return;
  await restore();
  practices.delete(db);
}

export async function cleanupSteps(...steps: (() => Promise<unknown>)[]) {
  const errors: unknown[] = [];
  for (const step of steps) {
    try {
      await step();
    } catch (error) {
      errors.push(error);
    }
  }
  if (errors.length)
    throw new AggregateError(
      errors,
      "Local fixture cleanup was not completed.",
    );
}

// Read every occupied interval, including other administrators and legacy null
// assignments. A fixture may choose a free time; it must never move old data.
export async function freeCalendarStart(
  db: SupabaseClient,
  {
    after = Date.now() + 30 * 86400000,
    before = after + 366 * 86400000,
    durationMinutes = 120,
    offsetsMinutes = [0],
    afterLast = false,
  }: {
    after?: number;
    before?: number;
    durationMinutes?: number;
    offsetsMinutes?: number[];
    afterLast?: boolean;
  } = {},
) {
  const intervals: number[][] = [];
  for (let from = 0; ; from += 500) {
    const rows = await checked(
      db
        .from("calendar_slots")
        .select("occupied")
        .order("occupied")
        .range(from, from + 499),
    );
    for (const row of rows || []) {
      const range = String(row.occupied)
        .slice(1, -1)
        .split(",")
        .map((part) => Date.parse(part.replaceAll('"', "")));
      if (range.length !== 2 || !range.every(Number.isFinite))
        throw new Error("Fixture needs finite occupied intervals.");
      intervals.push(range);
    }
    if (!rows || rows.length < 500) break;
  }
  if (afterLast) {
    after = Math.max(after, ...intervals.map(([, end]) => end)) + 86400000;
    before = Math.max(before, after + 86400000);
  }
  const step = 15 * 60000;
  for (let at = Math.ceil(after / step) * step; at <= before; at += step) {
    if (
      offsetsMinutes.every((offset) =>
        intervals.every(
          ([start, end]) =>
            at + offset * 60000 >= end ||
            at + (offset + durationMinutes) * 60000 <= start,
        ),
      )
    )
      return new Date(at).toISOString();
  }
  throw new Error(
    "No unoccupied fixture interval; preserve existing appointments.",
  );
}

export function localClients(baseURL: string | undefined) {
  for (const value of [baseURL, process.env.NEXT_PUBLIC_SUPABASE_URL]) {
    const parsed = new URL(value || "");
    if (
      !["http:", "https:"].includes(parsed.protocol) ||
      !["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname) ||
      parsed.username ||
      parsed.password ||
      parsed.pathname !== "/" ||
      parsed.search ||
      parsed.hash
    )
      throw new Error("E2E requires an explicitly local app and database.");
  }
  const api = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  const secret = process.env.SUPABASE_SECRET_KEY;
  if (!key || !secret)
    throw new Error("Run pnpm local:e2e with local credentials.");
  const options = {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      fetch: (input: RequestInfo | URL, init?: RequestInit) =>
        fetch(input, {
          ...init,
          redirect: "error",
          signal: AbortSignal.timeout(20000),
        }),
    },
  };
  return {
    db: createClient(api, secret, options),
    client: () => createClient(api, key, options),
  };
}
export async function checked<
  T extends { data: unknown; error: { message: string } | null },
>(result: PromiseLike<T>): Promise<T["data"]> {
  const { data, error } = await result;
  if (error) throw new Error(error.message);
  return data;
}
export async function account(
  db: SupabaseClient,
  ids: string[],
  role: "admin" | "client",
) {
  const email = `psi-e2e-${role}-${crypto.randomUUID()}@example.test`;
  const password = `Psi-E2E!${crypto.randomUUID()}`;
  const data = await checked(
    db.auth.admin.createUser({ email, password, email_confirm: true }),
  );
  if (!data.user) throw new Error("Local fixture account missing");
  ids.push(data.user.id);
  await checked(
    db
      .from("profiles")
      .update({
        full_name: `Test ${role}`,
        phone: "000 000 000",
        area: "Okolica testowa",
      })
      .eq("id", data.user.id),
  );
  await checked(
    db.from("user_roles").update({ role }).eq("user_id", data.user.id),
  );
  return { id: data.user.id, email, password };
}
export async function login(
  page: Page,
  user: { email: string; password: string },
  role: "admin" | "client",
) {
  await page.goto("/login");
  await page.getByLabel("Twój e-mail").fill(user.email);
  await page.getByLabel("Hasło", { exact: true }).fill(user.password);
  await page.getByRole("button", { name: "Zaloguj się", exact: true }).click();
  // Development compilation can overlap local SQL test workers. Performance
  // targets are measured separately against a compiled build.
  await expect(page).toHaveURL(role === "admin" ? /\/admin$/ : /\/app$/, {
    timeout: 15000,
  });
}
// Delete only IDs belonging to this test, in FK order. Cleanup errors fail the
// test instead of accumulating misleading demo data across subsequent runs.
export async function disposeCareFixtures(
  db: SupabaseClient,
  users: string[],
  dogs: string[],
  disposeRelated?: () => Promise<void>,
) {
  await cleanupOwnedFixture({
    data: async () => {
      if (dogs.length) {
        const followups = await checked(
          db.from("care_follow_ups").select("id").in("dog_id", dogs),
        );
        if (followups?.length)
          await checked(
            db
              .from("care_follow_up_history")
              .delete()
              .in(
                "follow_up_id",
                followups.map((f) => f.id),
              ),
          );
        for (const table of [
          "care_control_invitations",
          "care_reporting_entitlements",
          "care_follow_ups",
          "care_progress",
          "care_events",
          "care_drafts",
          "care_plan_versions",
        ])
          await checked(db.from(table).delete().in("dog_id", dogs));
        const consultations = await checked(
          db.from("consultations").select("id").in("dog_id", dogs),
        );
        if (consultations?.length) {
          const ids = consultations.map((c) => c.id);
          const history = await checked(
            db
              .from("consultation_history")
              .select("id")
              .in("consultation_id", ids),
          );
          if (history?.length)
            await checked(
              db
                .from("consultation_events")
                .delete()
                .in(
                  "history_id",
                  history.map((h) => h.id),
                ),
            );
          await checked(
            db.from("consultation_history").delete().in("consultation_id", ids),
          );
          await checked(
            db.from("payments").delete().in("consultation_id", ids),
          );
          await checked(db.from("consultations").delete().in("id", ids));
        }
        await disposeRelated?.();
        await checked(db.from("dog_notes").delete().in("dog_id", dogs));
        await checked(db.from("dogs").delete().in("id", dogs));
      }
    },
    restore: () => restoreLocalPractitioner(db),
    accounts: async () => {
      if (users.length) {
        await checked(db.from("audit_events").delete().in("actor_id", users));
        await cleanupSteps(
          ...users.map((id) => () => checked(db.auth.admin.deleteUser(id))),
        );
      }
    },
  });
}
