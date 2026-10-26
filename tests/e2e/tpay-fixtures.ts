import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { expect, test, type Browser, type Page } from "@playwright/test";
import { LocalPostgres, literal as q } from "../helpers/local-postgres.mjs";
import { cleanupOwnedFixture } from "../helpers/owned-fixture-cleanup.mjs";
import type {
  OnlinePaymentAttempt,
  OnlinePaymentKind,
} from "../../src/modules/payments/types";
import {
  account,
  checked,
  cleanupSteps,
  disposeCareFixtures,
  freeCalendarStart,
  localClients,
  login,
  restoreLocalPractitioner,
  setupLocalPractitioner,
} from "./local-fixtures";

export const paymentKinds = [
  "registration",
  "consultation",
  "course",
  "fitness",
] as const;
const practice = "00000000-0000-4000-8000-000000000001";
const targetTables = {
  registration: "walk_registrations",
  consultation: "consultations",
  course: "course_enrollments",
  fitness: "fitness_packages",
} as const;
const paymentColumns = {
  registration: "registration_id",
  consultation: "consultation_id",
  course: "course_enrollment_id",
  fitness: "fitness_package_id",
} as const;
export type PaymentTarget = {
  kind: OnlinePaymentKind;
  id: string;
  parent: string;
  title: string;
  date: string;
};
export type Receipt = {
  id: string;
  guardian_id: string;
  dog_id: string;
  amount_cents: number;
  method: string;
  status: string;
  author_id: string | null;
  online_attempt_id: string | null;
};

/** These fixtures deliberately require the explicit local runner, never dotenv. */
export async function paymentFixtures(
  browser: Browser,
  baseURL: string | undefined,
) {
  const { db, client } = localClients(baseURL);
  assert.equal(
    process.env.TPAY_MODE,
    "simulator",
    "E2E must never contact a payment operator",
  );
  assert.equal(
    process.env.TPAY_ENABLED,
    "true",
    "Run with the local simulator enabled",
  );
  assert(
    !process.env.VERCEL && !process.env.VERCEL_ENV,
    "Local payment E2E only",
  );
  const users: string[] = [],
    dogs: string[] = [],
    services: string[] = [];
  const walks: string[] = [],
    courses: string[] = [],
    fitness: string[] = [];
  const suffix = crypto.randomUUID().slice(0, 8);
  let sql = await new LocalPostgres().ready();
  const staffContext = await browser.newContext({
    baseURL,
    viewport: { width: 1440, height: 1000 },
  });
  const ownerContext = await browser.newContext({
    baseURL,
    viewport: { width: 390, height: 844 },
  });
  const guardian = await ownerContext.newPage(),
    staff = await staffContext.newPage();
  const own = client(),
    stranger = client(),
    adminApi = client(),
    anonymous = client();
  let originalSettings: Record<string, unknown> | undefined;
  let originalPrimary: string | null | undefined;
  let currentSettings: Record<string, unknown> | undefined;
  let disposed = false;
  const readSettings = () =>
    sql.json(
      "select to_jsonb(s) from public.online_payment_settings s where singleton;",
    );
  async function settings(patch: Record<string, unknown>) {
    if (sql.ended) sql = await new LocalPostgres().ready();
    assert(currentSettings, "Settings must be captured before mutation");
    assert.deepEqual(
      await readSettings(),
      currentSettings,
      "Another test owns payment settings",
    );
    const next = { ...currentSettings, ...patch };
    const keys = Object.keys(next).filter((key) => key !== "singleton");
    assert(
      keys.every((key) => /^[a-z_]+$/.test(key)),
      "Unexpected settings column",
    );
    await sql.query(`update public.online_payment_settings s set (${keys.join(",")})=(
      select ${keys.join(",")} from jsonb_populate_record(null::public.online_payment_settings,${q(JSON.stringify(next))}::jsonb))
      where singleton and to_jsonb(s)=${q(JSON.stringify(currentSettings))}::jsonb;`);
    assert.deepEqual(
      await readSettings(),
      next,
      "Payment settings were not changed",
    );
    currentSettings = next;
  }
  async function dispose() {
    if (disposed) return;
    disposed = true;
    await cleanupSteps(
      () => ownerContext.close(),
      () => staffContext.close(),
      ...[own, stranger, adminApi].map((api) => () => api.auth.signOut()),
      () =>
        cleanupOwnedFixture({
          data: async () => {
            if (dogs.length) {
              const ids = dogs.map(q).join(",");
              // Break the two non-deferrable FKs without violating the paid check.
              // Both sides are restricted to this lifecycle's owned dog IDs.
              await sql.query(`begin;
              update public.online_payment_attempts set status='failed',payment_id=null
                where dog_id in (${ids});
              delete from public.online_payment_notifications where attempt_id in
                (select id from public.online_payment_attempts where dog_id in (${ids}));
              delete from public.audit_events where entity_id in
                (select id from public.online_payment_attempts where dog_id in (${ids})
                  union all select id from public.payments where dog_id in (${ids}));
              delete from public.payments where dog_id in (${ids});
              delete from public.online_payment_attempts where dog_id in (${ids});
              commit;`);
              // Care and reporting references must be removed before course/fitness.
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
                      followups.map((row) => row.id),
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
            }
            if (fitness.length)
              await checked(
                db.from("fitness_packages").delete().in("id", fitness),
              );
            if (courses.length)
              await checked(db.from("courses").delete().in("id", courses));
            if (walks.length)
              await checked(db.from("walks").delete().in("id", walks));
          },
          restore: async () => {
            await cleanupSteps(
              async () => {
                if (originalSettings && currentSettings)
                  await settings(originalSettings);
              },
              () => restoreLocalPractitioner(db),
            );
          },
          accounts: async () => {
            // Existing helper also handles consultation events/history and dogs.
            await disposeCareFixtures(db, users, dogs);
            if (services.length) {
              await checked(
                db
                  .from("service_revisions")
                  .delete()
                  .in("service_id", services),
              );
              await checked(db.from("services").delete().in("id", services));
            }
          },
        }),
      async () => {
        if (sql.ended) sql = await new LocalPostgres().ready();
        const owned = await sql.json(`select json_build_object(
          'users',(select count(*) from auth.users where id=any(array[${users.map(q).join(",")}]::uuid[])),
          'dogs',(select count(*) from public.dogs where id=any(array[${dogs.map(q).join(",")}]::uuid[])),
          'attempts',(select count(*) from public.online_payment_attempts where dog_id=any(array[${dogs.map(q).join(",")}]::uuid[])),
          'payments',(select count(*) from public.payments where dog_id=any(array[${dogs.map(q).join(",")}]::uuid[])),
          'services',(select count(*) from public.services where id=any(array[${services.map(q).join(",")}]::uuid[])));`);
        const restoredSettings = await readSettings();
        const restoredPrimary = await sql.json(
          `select coalesce(to_json(primary_practitioner_id),'null'::json) from public.calendar_settings where practice_id=${q(practice)};`,
        );
        writeFileSync(
          test.info().outputPath("cleanup-evidence.json"),
          JSON.stringify(
            {
              owned,
              settings: { before: originalSettings, after: restoredSettings },
              primary: { before: originalPrimary, after: restoredPrimary },
            },
            null,
            2,
          ),
        );
        assert.deepEqual(owned, {
          users: 0,
          dogs: 0,
          attempts: 0,
          payments: 0,
          services: 0,
        });
        if (originalSettings)
          assert.deepEqual(restoredSettings, originalSettings);
        if (originalPrimary !== undefined)
          assert.equal(restoredPrimary, originalPrimary);
      },
      () => sql.close(),
    );
  }
  try {
    originalSettings = await readSettings();
    originalPrimary = await sql.json(
      `select coalesce(to_json(primary_practitioner_id),'null'::json) from public.calendar_settings where practice_id=${q(practice)};`,
    );
    currentSettings = originalSettings;
    await settings({ enabled: true, walk_gate: "accepted" });
    const admin = await account(db, users, "admin"),
      owner = await account(db, users, "client"),
      other = await account(db, users, "client");
    await setupLocalPractitioner(db, users, admin.id);
    for (const [api, user] of [
      [own, owner],
      [stranger, other],
      [adminApi, admin],
    ] as const)
      await checked(
        api.auth.signInWithPassword({
          email: user.email,
          password: user.password,
        }),
      );
    const dog = crypto.randomUUID(),
      dogName = `Figa BLIK ${suffix}`;
    dogs.push(dog);
    await checked(
      db.from("dogs").insert({ id: dog, guardian_id: owner.id, name: dogName }),
    );
    await checked(
      adminApi.rpc("qualify_dog", {
        p_request_id: crypto.randomUUID(),
        p_dog: dog,
        p_expected_status: "new",
        p_expected_version: 0,
        p_status: "approved",
        p_note: "Fikcyjna kwalifikacja lokalnego E2E płatności",
      }),
    );
    await login(guardian, owner, "client");
    await login(staff, admin, "admin");
    async function catalog(kind: Exclude<OnlinePaymentKind, "registration">) {
      const id = crypto.randomUUID();
      services.push(id);
      const title = `${kind === "course" ? "Kurs" : kind === "fitness" ? "PSI FITNESS" : "Konsultacja"} BLIK ${suffix}`;
      await checked(
        db.from("services").insert({
          id,
          practice_id: practice,
          name: title,
          description: "Fikcyjna oferta lokalnego E2E",
          kind:
            kind === "course"
              ? "course"
              : kind === "fitness"
                ? "package"
                : "individual",
          booking_flow: kind === "course" ? "catalogue" : kind,
          meeting_mode: kind === "consultation" ? "online" : "in_person",
          course_format: kind === "course" ? "group" : null,
          price_cents: 10000,
          price_unit: "za całość",
          duration_minutes: 60,
          sessions_count: kind === "consultation" ? 1 : 2,
          source_url: "https://www.psipawer.pl/lokalny-test",
          is_test_price: true,
        }),
      );
      return { id, title };
    }
    async function create(
      kind: OnlinePaymentKind,
      accepted = true,
    ): Promise<PaymentTarget> {
      const date = await freeCalendarStart(db, {
        after: Date.now() + 3 * 366 * 86400000,
        durationMinutes: 60,
        afterLast: true,
      });
      if (kind === "registration") {
        const title = `Spacer BLIK ${suffix}`;
        const walk = await checked(
          adminApi.rpc("create_walk", {
            payload: {
              starts_at: date,
              duration_minutes: 60,
              public_location: title,
              exact_location: "FIKCYJNY PARK TESTOWY",
              type: "Spacer testowy",
              price_cents: 10000,
              capacity: 3,
              booking_mode: accepted ? "automatic" : "approval",
              info: "Lokalne E2E",
              cancellation_deadline_hours: 24,
            },
          }),
        );
        assert.equal(typeof walk, "string");
        walks.push(walk);
        const id = await checked(
          own.rpc("register_dog", { p_walk: walk, p_dog: dog }),
        );
        assert.equal(typeof id, "string");
        return { kind, id, parent: walk, title, date };
      }
      const service = await catalog(kind),
        id = crypto.randomUUID();
      if (kind === "consultation") {
        await checked(
          own.rpc("request_consultation", {
            p_id: id,
            p_dog: dog,
            p_topic: "Lokalny test należności BLIK",
            p_availability: "Popołudnie",
            p_service: service.id,
            p_expected_service_version: 1,
          }),
        );
        if (accepted)
          await checked(
            adminApi.rpc("change_consultation", {
              p_id: id,
              p_expected_version: 1,
              p_action: "schedule",
              p_starts_at: date,
              p_duration: 60,
              p_mode: "online",
              p_location: "FIKCYJNE SPOTKANIE ONLINE",
              p_note: "Lokalne E2E",
            }),
          );
        return { kind, id, parent: id, title: service.title, date };
      }
      if (kind === "fitness") {
        fitness.push(id);
        await checked(
          own.rpc("request_fitness_package", {
            p_id: id,
            p_dog: dog,
            p_service: service.id,
            p_expected_service_version: 1,
            p_topic: "Spokojna praca testowa",
            p_availability: "Popołudnie",
          }),
        );
        if (accepted)
          await checked(
            adminApi.rpc("change_fitness_package", {
              p_id: id,
              p_expected_version: 1,
              p_action: "accept",
              p_note: "Lokalne E2E",
              p_request_id: crypto.randomUUID(),
            }),
          );
        return { kind, id, parent: id, title: service.title, date };
      }
      courses.push(id);
      await checked(
        adminApi.rpc("create_course", {
          p_id: id,
          p_service: service.id,
          p_expected_service_version: 1,
          p_title: service.title,
          p_capacity: 3,
          p_public_location: "FIKCYJNY PARK TESTOWY",
          p_exact_location: "FIKCYJNA ZBIÓRKA",
          p_starts: [
            date,
            new Date(Date.parse(date) + 7 * 86400000).toISOString(),
          ],
        }),
      );
      await checked(
        adminApi.rpc("change_course", {
          p_id: id,
          p_expected_version: 1,
          p_action: "publish",
          p_note: "",
        }),
      );
      const enrollment = crypto.randomUUID();
      await checked(
        own.rpc("request_course_enrollment", {
          p_id: enrollment,
          p_course: id,
          p_dog: dog,
          p_expected_course_version: 2,
        }),
      );
      if (accepted)
        await checked(
          adminApi.rpc("change_course_enrollment", {
            p_id: enrollment,
            p_expected_version: 1,
            p_action: "accept",
            p_note: "Lokalne E2E",
          }),
        );
      return { kind, id: enrollment, parent: id, title: service.title, date };
    }
    const attempts = (target: PaymentTarget) =>
      checked(
        db
          .from("online_payment_attempts")
          .select("*")
          .eq("target_kind", target.kind)
          .eq("target_id", target.id)
          .order("created_at"),
      ).then((rows) => (rows || []) as OnlinePaymentAttempt[]);
    const attempt = (id: string) =>
      checked(
        db.from("online_payment_attempts").select("*").eq("id", id).single(),
      ).then((row) => row as OnlinePaymentAttempt);
    const payments = (target: PaymentTarget): Promise<Receipt[]> =>
      sql.json(
        `select coalesce(json_agg(to_jsonb(p) order by p.created_at,p.id),'[]') from public.payments p where ${paymentColumns[target.kind]}=${q(target.id)};`,
      );
    const due = (target: PaymentTarget): Promise<number> =>
      sql.json(
        target.kind === "registration"
          ? `select to_json(greatest(w.price_cents-(select coalesce(sum(p.amount_cents),0) from public.payments p where p.registration_id=r.id and p.status='paid'),0)) from public.walk_registrations r join public.walks w on w.id=r.walk_id where r.id=${q(target.id)};`
          : `select to_json(due_cents) from public.${target.kind === "consultation" ? "consultation_balances" : target.kind === "course" ? "course_balances" : "fitness_balances"} where id=${q(target.id)};`,
      );
    const state = (target: PaymentTarget) =>
      checked(
        db
          .from(targetTables[target.kind])
          .select("*")
          .eq("id", target.id)
          .single(),
      );
    async function manual(target: PaymentTarget, cents: number) {
      assert(["registration", "consultation"].includes(target.kind));
      await checked(
        adminApi.rpc("record_payment", {
          p_registration: target.kind === "registration" ? target.id : null,
          p_package: null,
          p_consultation: target.kind === "consultation" ? target.id : null,
          p_amount_cents: cents,
          p_method: "transfer",
          p_note: "Fikcyjna częściowa wpłata E2E",
          p_request_id: crypto.randomUUID(),
        }),
      );
    }
    return {
      db,
      own,
      stranger,
      anonymous,
      adminApi,
      owner,
      other,
      admin,
      dog,
      dogName,
      sql,
      guardian,
      staff,
      ownerContext,
      create,
      settings,
      attempt,
      attempts,
      payments,
      due,
      state,
      manual,
      dispose,
    };
  } catch (error) {
    await dispose();
    throw error;
  }
}

export type PaymentFixtures = Awaited<ReturnType<typeof paymentFixtures>>;
export const checkoutForm = (page: Page) =>
  page.locator("form").filter({ has: page.locator('[name="target_kind"]') });
export const simulationForm = (page: Page) =>
  page.locator("form").filter({
    has: page.getByRole("combobox", { name: /Wynik lokalnego testu/ }),
  });
export async function openSummary(
  f: PaymentFixtures,
  target: PaymentTarget,
  cents = 10000,
  page = f.guardian,
) {
  await page.goto(`/app/finance?charge=${target.kind}-${target.id}`);
  const charge = page.locator(`#charge-${target.kind}-${target.id}`);
  await expect(charge).toContainText(f.dogName);
  await charge.getByRole("link", { name: /Zapłać BLIKIEM/ }).click();
  const summary = page.getByRole("region", { name: "Podsumowanie płatności" });
  await expect(summary).toContainText(f.dogName);
  await expect(summary).toContainText(target.title);
  await expect(
    summary.locator("dl div").filter({
      has: page.locator("dt", { hasText: "Do zapłaty w tej próbie" }),
    }),
  ).toContainText(`${(cents / 100).toFixed(2).replace(".", ",")}`);
  await expect(page.getByLabel("Testowy tryb płatności")).toContainText(
    "bez połączenia z Tpay",
  );
  return checkoutForm(page);
}
export async function start(
  f: PaymentFixtures,
  target: PaymentTarget,
  page = f.guardian,
) {
  await checkoutForm(page)
    .getByRole("button", {
      name: "Rozpocznij lokalną symulację BLIK",
      exact: true,
    })
    .click();
  await expect(page).toHaveURL(/\/app\/payments\/[a-f0-9-]+$/);
  const id = new URL(page.url()).pathname.split("/").at(-1)!;
  const attempt = await f.attempt(id);
  expect(attempt).toMatchObject({
    target_kind: target.kind,
    target_id: target.id,
    guardian_id: f.owner.id,
    dog_id: f.dog,
    environment: "simulator",
    merchant_id: "LOCAL-SIMULATOR",
    status: "pending",
    payment_id: null,
  });
  return attempt;
}
export async function simulate(
  f: PaymentFixtures,
  id: string,
  outcome: "success" | "failure" = "success",
  page = f.guardian,
) {
  await page.goto(`/app/payments/${id}`);
  await simulationForm(page)
    .getByLabel("Wynik lokalnego testu")
    .selectOption(outcome);
  await simulationForm(page)
    .getByRole("button", {
      name: "Zapisz wynik lokalnej symulacji",
      exact: true,
    })
    .click();
  await expect
    .poll(() => f.attempt(id))
    .toMatchObject({ status: outcome === "success" ? "paid" : "failed" });
  return f.attempt(id);
}
