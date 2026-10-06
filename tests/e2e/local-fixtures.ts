import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { expect, type Page } from "@playwright/test";

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
        db.from("consultation_history").select("id").in("consultation_id", ids),
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
      await checked(db.from("payments").delete().in("consultation_id", ids));
      await checked(db.from("consultations").delete().in("id", ids));
    }
    await disposeRelated?.();
    await checked(db.from("dog_notes").delete().in("dog_id", dogs));
    await checked(db.from("dogs").delete().in("id", dogs));
  }
  if (users.length) {
    await checked(db.from("audit_events").delete().in("actor_id", users));
    for (const id of users) await checked(db.auth.admin.deleteUser(id));
  }
}
