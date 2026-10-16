import { expect, type Browser } from "@playwright/test";
import {
  test,
  account,
  checked,
  cleanupSteps,
  disposeCareFixtures,
  freeCalendarStart,
  localClients,
  login,
  setupLocalPractitioner,
} from "./local-fixtures";
import { careFixture, publishCarePlan } from "./care-journey";
import { loseCommittedReply, noticesAndAudit } from "./transport-journey";

async function requestFixture(browser: Browser, baseURL: string | undefined) {
  const { db, client } = localClients(baseURL);
  const users: string[] = [],
    dogs: string[] = [],
    courses: string[] = [],
    packages: string[] = [];
  const context = await browser.newContext({
    baseURL,
    viewport: { width: 390, height: 844 },
  });
  const page = await context.newPage(),
    staff = client();
  const dispose = async () =>
    cleanupSteps(
      () => context.close(),
      () => staff.auth.signOut(),
      () =>
        disposeCareFixtures(db, users, dogs, async () => {
          // Course enrollments can own reporting entitlements. Remove the
          // dog's care records first, then the course's dependent sources.
          if (courses.length)
            await checked(db.from("courses").delete().in("id", courses));
          if (packages.length) {
            await checked(
              db.from("payments").delete().in("fitness_package_id", packages),
            );
            await checked(
              db.from("fitness_packages").delete().in("id", packages),
            );
          }
        }),
      async () => {
        if (users.length)
          expect(
            await checked(db.from("profiles").select("id").in("id", users)),
          ).toEqual([]);
      },
    );
  try {
    const practitioner = await account(db, users, "admin");
    const owner = await account(db, users, "client");
    await setupLocalPractitioner(db, users, practitioner.id);
    // This is an explicitly owned local fixture, never a real person's account.
    expect(practitioner.email).toMatch(/^psi-e2e-admin-.+@example\.test$/);
    expect(
      await checked(
        db.from("calendar_settings").select("primary_practitioner_id").single(),
      ),
    ).toEqual({ primary_practitioner_id: practitioner.id });
    await checked(staff.auth.signInWithPassword(practitioner));
    const dog = crypto.randomUUID();
    dogs.push(dog);
    await checked(
      db.from("dogs").insert({
        id: dog,
        guardian_id: owner.id,
        name: "Fikcyjny pies próby połączenia",
      }),
    );
    await login(page, owner, "client");
    return {
      db,
      staff,
      dog,
      owner,
      practitioner,
      page,
      courses,
      packages,
      dispose,
    };
  } catch (error) {
    await dispose();
    throw error;
  }
}

test("onboarding profile UPDATE retains contact fields after a committed response is lost", async ({
  browser,
  baseURL,
}) => {
  const { db } = localClients(baseURL),
    users: string[] = [];
  const context = await browser.newContext({
    baseURL,
    viewport: { width: 390, height: 844 },
  });
  const page = await context.newPage();
  try {
    const owner = await account(db, users, "client");
    await checked(
      db
        .from("profiles")
        .update({ full_name: "", phone: "", area: "" })
        .eq("id", owner.id),
    );
    await page.goto("/login");
    await page.getByLabel("Twój e-mail").fill(owner.email);
    await page.getByLabel("Hasło", { exact: true }).fill(owner.password);
    await page
      .getByRole("button", { name: "Zaloguj się", exact: true })
      .click();
    await expect(page).toHaveURL(/\/complete-profile$/);
    const fields = {
      full_name: `Odbiór profilu ${crypto.randomUUID()}`,
      phone: "000 000 000",
      area: "Fikcyjna okolica",
    };
    const form = page.locator("main form");
    for (const [name, value] of Object.entries(fields))
      await form.locator(`[name="${name}"]`).fill(value);
    const saved = () =>
      checked(
        db
          .from("profiles")
          .select("id,full_name,phone,area")
          .eq("id", owner.id),
      );
    const expected = [{ id: owner.id, ...fields }];
    await loseCommittedReply(page, form, fields.full_name, async () => {
      expect(await saved()).toEqual(expected);
    });
    await expect(page).toHaveURL(/\/complete-profile$/);
    for (const [name, value] of Object.entries(fields))
      await expect(form.locator(`[name="${name}"]`)).toHaveValue(value);
    await form
      .getByRole("button", { name: "Zapisz i przejdź dalej", exact: true })
      .click();
    await expect(page).toHaveURL(/\/app$/);
    await expect.poll(saved).toEqual(expected);
  } finally {
    await cleanupSteps(
      () => context.close(),
      () => disposeCareFixtures(db, users, []),
    );
  }
});

test("care response keeps its uncertain UUID and plan through history pagination until exact retry confirms one response", async ({
  browser,
  baseURL,
}) => {
  const f = await careFixture(browser, baseURL);
  try {
    await publishCarePlan(
      f.staff,
      "Plan próby utraty odpowiedzi",
      "Fikcyjne zalecenia do lokalnego odbioru.",
    );
    // Six older versions make the actual history navigation available. These
    // publications belong to this dog and are removed by the fixture cleanup.
    for (let version = 1; version <= 6; version++)
      await checked(
        f.staffDb.rpc("save_care_plan", {
          p_dog: f.dog,
          p_expected_version: version,
          p_title: `Wersja planu do paginacji ${version + 1}`,
          p_body: "Fikcyjne zalecenia do lokalnej próby paginacji.",
          p_follow_up_on: null,
          p_publish: true,
          p_consultation: null,
        }),
      );
    await f.guardian.goto(`/app/dogs/${f.dog}/care`);
    const form = f.guardian.locator("#odpowiedz form");
    const fields = {
      attempted: "Spokojna próba w fikcyjnym parku.",
      went_well: "Krótki odpoczynek.",
      difficult: "Fikcyjne rozproszenia.",
    };
    for (const [name, value] of Object.entries(fields))
      await form.locator(`[name="${name}"]`).fill(value);
    const id = await form.locator('[name="id"]').inputValue();
    const plan = await form.locator('[name="plan_id"]').inputValue();
    const saved = () =>
      checked(
        f.db
          .from("care_progress")
          .select("id,plan_id,attempted,went_well,difficult")
          .eq("dog_id", f.dog),
      );
    const effects = async () => ({
      ...(await noticesAndAudit(
        f.db,
        id,
        "care_progress_submitted",
        "progress_submitted",
      )),
      events: await checked(
        f.db
          .from("care_events")
          .select("id")
          .eq("entity_id", id)
          .eq("kind", "progress_submitted")
          .order("id"),
      ),
    });
    let first: Awaited<ReturnType<typeof effects>> | undefined;
    const expected = [{ id, plan_id: plan, ...fields }];
    await loseCommittedReply(f.guardian, form, id, async () => {
      expect(await saved()).toEqual(expected);
      first = await effects();
      expect(first.events).toHaveLength(1);
    });
    for (const [name, value] of Object.entries(fields))
      await expect(form.locator(`[name="${name}"]`)).toHaveValue(value);
    await expect(form.locator('[name="id"]')).toHaveValue(id);
    await expect(form.locator('[name="plan_id"]')).toHaveValue(plan);
    const history = f.guardian.locator("#historia");
    await history.locator("summary").click();
    await history
      .getByRole("link", { name: "Następna →", exact: true })
      .click();
    await expect(f.guardian).toHaveURL(/history=2.*progress=1#historia$/);
    await expect(history.getByRole("navigation")).toContainText("Strona 2");
    // This is a real Next Link transition, not a reload. New server props
    // cannot turn the uncertain write into a second intentional response.
    for (const [name, value] of Object.entries(fields))
      await expect(form.locator(`[name="${name}"]`)).toHaveValue(value);
    await expect(form.locator('[name="id"]')).toHaveValue(id);
    await expect(form.locator('[name="plan_id"]')).toHaveValue(plan);
    expect(await saved()).toEqual(expected);
    await form
      .getByRole("button", {
        name: "Przekaż odpowiedź prowadzącej",
        exact: true,
      })
      .click();
    await expect(form.getByRole("status")).toContainText("Odpowiedź zapisana");
    await expect.poll(saved).toEqual(expected);
    expect(await effects()).toEqual(first);
    // A confirmed success may prepare another report; this one's fields reset.
    for (const name of Object.keys(fields))
      await expect(form.locator(`[name="${name}"]`)).toHaveValue("");
  } finally {
    await f.dispose();
  }
});

test("course enrollment preserves its request UUID, selected dog and course version after lost confirmation", async ({
  browser,
  baseURL,
}) => {
  const f = await requestFixture(browser, baseURL);
  try {
    const service = "60000000-0000-4000-8000-000000000001";
    const catalog = await checked(
      f.db
        .from("services")
        .select("version,sessions_count,duration_minutes")
        .eq("id", service)
        .single(),
    );
    if (!catalog) throw new Error("Missing local course catalogue fixture");
    const offsetsMinutes = Array.from(
      { length: catalog.sessions_count },
      (_, n) => n * 7 * 1440,
    );
    const first = await freeCalendarStart(f.db, {
      durationMinutes: catalog.duration_minutes,
      offsetsMinutes,
    });
    const course = crypto.randomUUID();
    f.courses.push(course);
    await checked(
      f.staff.rpc("create_course", {
        p_id: course,
        p_service: service,
        p_expected_service_version: catalog.version,
        p_title: "Fikcyjny kurs próby połączenia",
        p_capacity: 2,
        p_public_location: "Fikcyjna okolica",
        p_exact_location: "FIKCYJNA ZBIÓRKA",
        p_starts: offsetsMinutes.map((offset) =>
          new Date(Date.parse(first) + offset * 60000).toISOString(),
        ),
      }),
    );
    await checked(
      f.staff.rpc("change_course", {
        p_id: course,
        p_expected_version: 1,
        p_action: "publish",
        p_note: "",
      }),
    );
    await f.page.goto(`/app/courses/${course}`);
    const form = f.page.getByRole("form", {
      name: "Zgłoszenie na kurs",
      exact: true,
    });
    await form.getByLabel("Pies", { exact: true }).selectOption(f.dog);
    const id = await form.locator('[name="id"]').inputValue();
    const version = await form.locator('[name="course_version"]').inputValue();
    const saved = () =>
      checked(
        f.db
          .from("course_enrollments")
          .select("id,dog_id,status,version,selected_course_version")
          .eq("course_id", course),
      );
    const effects = async () => ({
      ...(await noticesAndAudit(
        f.db,
        id,
        "course_enrollment_requested",
        "course_enrollment_requested",
        "course_enrollment_id",
      )),
      history: await checked(
        f.db
          .from("course_history")
          .select("id")
          .eq("enrollment_id", id)
          .eq("action", "requested")
          .order("id"),
      ),
    });
    const expected = [
      {
        id,
        dog_id: f.dog,
        status: "requested",
        version: 1,
        selected_course_version: Number(version),
      },
    ];
    let firstEffects: Awaited<ReturnType<typeof effects>> | undefined;
    await loseCommittedReply(f.page, form, id, async () => {
      expect(await saved()).toEqual(expected);
      firstEffects = await effects();
      expect(firstEffects.history).toHaveLength(1);
    });
    await expect(form.getByLabel("Pies", { exact: true })).toHaveValue(f.dog);
    await expect(form.locator('[name="id"]')).toHaveValue(id);
    await expect(form.locator('[name="course_version"]')).toHaveValue(version);
    await form
      .getByRole("button", { name: "Zgłoś psa na kurs", exact: true })
      .click();
    await expect(form.getByRole("status")).toContainText("Zgłoszenie zapisane");
    await expect.poll(saved).toEqual(expected);
    expect(await effects()).toEqual(firstEffects);
  } finally {
    await f.dispose();
  }
});

test("fitness request retains its fields and UUID after committed response loss and retries once", async ({
  browser,
  baseURL,
}) => {
  const f = await requestFixture(browser, baseURL);
  try {
    const service = "60000000-0000-4000-8000-000000000006";
    await f.page.goto(`/app/fitness/new?service=${service}`);
    const form = f.page
      .locator("form")
      .filter({ has: f.page.locator('[name="topic"]') });
    await form.locator('select[name="service_id"]').selectOption(service);
    await form.locator('select[name="dog_id"]').selectOption(f.dog);
    const fields = {
      topic: "Fikcyjna spokojna praca nad ruchem.",
      availability: "Fikcyjne popołudnia.",
    };
    for (const [name, value] of Object.entries(fields))
      await form.locator(`[name="${name}"]`).fill(value);
    const confirmation = form.getByRole("checkbox", {
      name: "Zapoznałem/am się z ceną i zakresem całego pakietu.",
      exact: true,
    });
    await confirmation.check();
    const id = await form.locator('[name="id"]').inputValue();
    const version = await form.locator('[name="service_version"]').inputValue();
    f.packages.push(id);
    const saved = () =>
      checked(
        f.db
          .from("fitness_packages")
          .select(
            "id,dog_id,status,version,service_id,service_version,topic,availability",
          )
          .eq("dog_id", f.dog),
      );
    const effects = async () => ({
      ...(await noticesAndAudit(
        f.db,
        id,
        "fitness_requested",
        "fitness_requested",
        "fitness_package_id",
      )),
      history: await checked(
        f.db
          .from("fitness_history")
          .select("id")
          .eq("package_id", id)
          .eq("action", "requested")
          .order("id"),
      ),
    });
    const expected = [
      {
        id,
        dog_id: f.dog,
        status: "requested",
        version: 1,
        service_id: service,
        service_version: Number(version),
        ...fields,
      },
    ];
    let firstEffects: Awaited<ReturnType<typeof effects>> | undefined;
    await loseCommittedReply(f.page, form, id, async () => {
      expect(await saved()).toEqual(expected);
      firstEffects = await effects();
      expect(firstEffects.history).toHaveLength(1);
    });
    for (const [name, value] of Object.entries(fields))
      await expect(form.locator(`[name="${name}"]`)).toHaveValue(value);
    await expect(form.locator('select[name="dog_id"]')).toHaveValue(f.dog);
    await expect(form.locator('select[name="service_id"]')).toHaveValue(
      service,
    );
    await expect(confirmation).toBeChecked();
    await expect(form.locator('[name="id"]')).toHaveValue(id);
    await expect(form.locator('[name="service_version"]')).toHaveValue(version);
    await form
      .getByRole("button", { name: "Wyślij zgłoszenie fitness", exact: true })
      .click();
    await expect(f.page).toHaveURL(new RegExp(`/app/fitness/${id}$`));
    await expect.poll(saved).toEqual(expected);
    expect(await effects()).toEqual(firstEffects);
  } finally {
    await f.dispose();
  }
});
