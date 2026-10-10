import { expect, test } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import {
  LocalPostgres,
  literal as q,
  waitForLock,
} from "../helpers/local-postgres.mjs";
import {
  careEditor,
  careFixture,
  careScreenshot,
  careSourcePicker,
} from "./care-journey";
import {
  account,
  checked,
  disposeCareFixtures,
  localClients,
  login,
} from "./local-fixtures";

import { courseFixture, removeCourseCare } from "./course-fixtures";

test.use({ trace: "off" });

test("course → private draft → whole-cycle plan → completed meeting advice → immutable guardian history", async ({
  browser,
  baseURL,
}) => {
  const f = await careFixture(browser, baseURL),
    courses: string[] = [];
  const sql = await new LocalPostgres().ready();
  try {
    await mkdir("output/course-care", { recursive: true });
    const cycle = await courseFixture(
      f.db,
      f.staffDb,
      f.ownerDb,
      f.dog,
      courses,
      sql,
    );
    const staffUrl = `/admin/courses/${cycle.id}?enrollment=${cycle.enrollment}`;
    await f.staff.goto(staffUrl);
    const panel = f.staff.getByRole("region", {
      name: `Zalecenia: ${f.dogName}`,
      exact: true,
    });
    await panel
      .getByRole("link", { name: "Przygotuj plan całego kursu", exact: true })
      .click();
    const form = await careEditor(f.staff);
    await expect(
      form.getByRole("region", { name: "Powiązanie planu", exact: true }),
    ).toContainText("Plan całego kursu");
    await expect(
      form.getByLabel("Kurs, którego dotyczą zalecenia"),
    ).toBeHidden();
    await careSourcePicker(form);
    await expect(
      form.getByLabel("Kurs, którego dotyczą zalecenia"),
    ).toHaveValue(cycle.enrollment);
    await expect(form.getByLabel("Zakres zaleceń kursowych")).toHaveValue("");
    await form
      .getByLabel("Tytuł planu", { exact: true })
      .fill("Plan całego kursu");
    await form
      .getByLabel("Zalecenia dla opiekuna", { exact: true })
      .fill("PRYWATNY SZKIC: spokojne ćwiczenia w fikcyjnym parku.");
    await form
      .getByRole("button", { name: "Zapisz szkic", exact: true })
      .click();
    await expect(form.getByRole("status")).toContainText("Szkic zapisany");
    await expect(
      form.getByLabel("Kurs, którego dotyczą zalecenia"),
    ).toHaveValue(cycle.enrollment);
    expect(
      await checked(
        f.ownerDb.from("care_drafts").select("body").eq("dog_id", f.dog),
      ),
    ).toEqual([]);
    await f.guardian.goto(
      `/app/courses/${cycle.id}?enrollment=${cycle.enrollment}`,
    );
    const ownPanel = f.guardian.getByRole("region", {
      name: `Zalecenia: ${f.dogName}`,
      exact: true,
    });
    await expect(ownPanel.getByText(/Jest zapisany szkic/)).toHaveCount(0);
    await expect(
      f.guardian.getByText("PRYWATNY SZKIC", { exact: false }),
    ).toHaveCount(0);
    const stale = await f.staffContext.newPage();
    await stale.goto(
      `/admin/dogs/${f.dog}/care?enrollment=${cycle.enrollment}`,
    );
    const staleForm = await careEditor(stale);
    await careSourcePicker(staleForm);
    await staleForm
      .getByLabel("Tytuł planu", { exact: true })
      .fill("Moja starsza karta");
    await staleForm
      .getByLabel("Zalecenia dla opiekuna", { exact: true })
      .fill("Treść, którą należy zachować po konflikcie.");
    await form
      .getByLabel("Zalecenia dla opiekuna", { exact: true })
      .fill("Ćwicz trzy spokojne podejścia. Zakończ przed zmęczeniem psa.");
    await form
      .getByRole("button", { name: "Opublikuj dla opiekuna", exact: true })
      .click();
    await expect(form.getByRole("status")).toContainText("Plan opublikowany");
    await staleForm
      .getByRole("button", { name: "Opublikuj dla opiekuna", exact: true })
      .click();
    await expect(staleForm.getByRole("alert")).toContainText(
      "Plan zmienił się",
    );
    await expect(
      staleForm.getByLabel("Tytuł planu", { exact: true }),
    ).toHaveValue("Moja starsza karta");
    await expect(
      staleForm.getByLabel("Zalecenia dla opiekuna", { exact: true }),
    ).toHaveValue("Treść, którą należy zachować po konflikcie.");
    await expect(
      staleForm.getByLabel("Kurs, którego dotyczą zalecenia"),
    ).toHaveValue(cycle.enrollment);
    await stale.close();

    await f.staff.goto(staffUrl);
    await panel
      .getByText("Przygotuj zalecenia po spotkaniu", { exact: true })
      .click();
    await panel.getByRole("link", { name: /^Spotkanie 1 ·/ }).click();
    const meetingForm = await careEditor(f.staff);
    // Opening another source must preserve the saved whole-cycle draft.
    await expect(
      meetingForm.getByRole("region", {
        name: "Powiązanie planu",
        exact: true,
      }),
    ).toContainText("Plan całego kursu");
    const savedBody = await meetingForm
      .getByLabel("Zalecenia dla opiekuna", { exact: true })
      .inputValue();
    const savedVersion = await meetingForm
      .locator('input[name="expected_version"]')
      .inputValue();
    expect(savedBody).toBe(
      "Ćwicz trzy spokojne podejścia. Zakończ przed zmęczeniem psa.",
    );
    await careSourcePicker(meetingForm);
    await expect(
      meetingForm.getByLabel("Zakres zaleceń kursowych"),
    ).toHaveValue("");
    await meetingForm
      .getByRole("button", {
        name: "Powiąż ten szkic z wybranym kursem",
        exact: true,
      })
      .click();
    await expect(
      meetingForm.getByLabel("Zakres zaleceń kursowych"),
    ).toHaveValue(cycle.sessions[0].id);
    await expect(
      meetingForm.getByRole("region", {
        name: "Powiązanie planu",
        exact: true,
      }),
    ).toContainText("Spotkanie 1");
    await expect(
      meetingForm.getByLabel("Zalecenia dla opiekuna", { exact: true }),
    ).toHaveValue(savedBody);
    await expect(
      meetingForm.locator('input[name="expected_version"]'),
    ).toHaveValue(savedVersion);
    await expect(
      meetingForm.getByRole("button", {
        name: "Opublikuj dla opiekuna",
        exact: true,
      }),
    ).toBeDisabled();
    await meetingForm
      .getByLabel("Tytuł planu", { exact: true })
      .fill("Zalecenia po pierwszym spotkaniu");
    await meetingForm
      .getByLabel("Zalecenia dla opiekuna", { exact: true })
      .fill(
        "Po spotkaniu: spokojne mijanie drugiego psa z bezpiecznego dystansu.",
      );
    await meetingForm
      .getByRole("button", { name: "Zapisz szkic", exact: true })
      .click();
    await expect(meetingForm.getByRole("status")).toContainText(
      "Szkic zapisany",
    );
    await expect(
      meetingForm.getByLabel("Zakres zaleceń kursowych"),
    ).toHaveValue(cycle.sessions[0].id);
    await careScreenshot(
      f.staff,
      "output/course-care/private-meeting-draft-390.png",
      390,
    );

    // Only this synthetic meeting moves into the past; the server clock is unchanged.
    await checked(
      f.db
        .from("course_sessions")
        .update({ starts_at: new Date(Date.now() - 2 * 3600000).toISOString() })
        .eq("id", cycle.sessions[0].id),
    );
    await f.staff.goto(staffUrl);
    const firstCard = f.staff.locator("#spotkanie-1");
    await firstCard.getByText("Obecności uczestników", { exact: true }).click();
    const attendance = firstCard.getByRole("form", {
      name: `Obecność: ${f.dogName}`,
      exact: true,
    });
    await attendance.getByRole("combobox").selectOption("present");
    await attendance
      .getByRole("button", { name: "Zapisz obecność", exact: true })
      .click();
    await expect(attendance.getByRole("status")).toHaveText(
      "Obecność zapisana.",
    );
    await firstCard
      .getByText("Zakończ lub odwołaj spotkanie", { exact: true })
      .click();
    const end = firstCard.getByRole("form", {
      name: "Zmiana spotkania 1",
      exact: true,
    });
    await end.getByRole("combobox").selectOption("complete");
    await end
      .getByRole("button", { name: "Zapisz zmianę", exact: true })
      .click();
    await expect(end.getByRole("status")).toHaveText(
      "Zmiana spotkania zapisana.",
    );
    await panel
      .getByRole("link", { name: "Otwórz szkic zaleceń", exact: true })
      .click();
    const completedForm = await careEditor(f.staff);
    await careSourcePicker(completedForm);
    await expect(
      completedForm.getByLabel("Zakres zaleceń kursowych"),
    ).toHaveValue(cycle.sessions[0].id);
    await completedForm
      .getByRole("button", { name: "Opublikuj dla opiekuna", exact: true })
      .click();
    await expect(completedForm.getByRole("status")).toContainText(
      "Plan opublikowany",
    );
    const versions = await checked(
      f.ownerDb
        .from("care_plan_versions")
        .select("id,revision,body,course_enrollment_id,course_session_id")
        .eq("dog_id", f.dog)
        .order("revision"),
    );
    expect(versions).toHaveLength(2);
    expect(versions![0]).toMatchObject({
      revision: 1,
      course_enrollment_id: cycle.enrollment,
      course_session_id: null,
    });
    expect(versions![1]).toMatchObject({
      revision: 2,
      course_enrollment_id: cycle.enrollment,
      course_session_id: cycle.sessions[0].id,
    });
    expect(
      await checked(
        f.outsiderDb
          .from("care_plan_versions")
          .select("body")
          .eq("dog_id", f.dog),
      ),
    ).toEqual([]);
    expect(
      await checked(
        f.outsiderDb.rpc("course_care_feed", {
          p_course: cycle.id,
          p_enrollments: [cycle.enrollment],
        }),
      ),
    ).toEqual([]);
    await f.guardian.goto(
      `/app/courses/${cycle.id}?enrollment=${cycle.enrollment}`,
    );
    await expect(
      ownPanel.getByRole("link", { name: "Plan całego kursu", exact: true }),
    ).toBeVisible();
    await expect(
      ownPanel.getByRole("link", {
        name: "Zalecenia po pierwszym spotkaniu",
        exact: true,
      }),
    ).toBeVisible();
    await careScreenshot(
      f.guardian,
      "output/course-care/guardian-course-320.png",
      320,
    );
    await ownPanel
      .getByRole("link", { name: "Plan całego kursu", exact: true })
      .click();
    await expect(f.guardian).toHaveURL(
      new RegExp(`/app/care/plans/${versions![0].id}$`),
    );
    await expect(
      f.guardian.getByText("Wcześniejsza wersja", { exact: true }),
    ).toBeVisible();
    await expect(
      f.guardian.getByText(versions![0].body, { exact: true }),
    ).toBeVisible();
    await expect(
      f.guardian.getByRole("link", { name: "Otwórz kurs →", exact: true }),
    ).toHaveAttribute(
      "href",
      `/app/courses/${cycle.id}?enrollment=${cycle.enrollment}#zalecenia-${cycle.enrollment}`,
    );
    await f.guardian.goto(`/app/care/plans/${versions![1].id}`);
    await expect(
      f.guardian.getByRole("link", {
        name: "Otwórz spotkanie kursu →",
        exact: true,
      }),
    ).toHaveAttribute(
      "href",
      `/app/courses/${cycle.id}?enrollment=${cycle.enrollment}#spotkanie-${cycle.sessions[0].id}`,
    );
    await careScreenshot(
      f.guardian,
      "output/course-care/guardian-publication-390.png",
      390,
    );
    expect(
      await checked(
        f.ownerDb
          .from("notifications")
          .select("id")
          .eq("dog_id", f.dog)
          .eq("kind", "plan_published"),
      ),
    ).toHaveLength(2);
    // Care follows the current dog guardian, while the course enrollment and
    // its financial history still belong to the original applicant.
    await checked(
      f.db.from("dogs").update({ guardian_id: f.outsider.id }).eq("id", f.dog),
    );
    expect(
      await checked(
        f.ownerDb.from("care_plan_versions").select("id").eq("dog_id", f.dog),
      ),
    ).toEqual([]);
    expect(
      await checked(
        f.outsiderDb
          .from("care_plan_versions")
          .select("id")
          .eq("dog_id", f.dog),
      ),
    ).toHaveLength(2);
    await login(f.guardian, f.outsider, "client");
    await f.guardian.goto(`/app/care/plans/${versions![1].id}`);
    await expect(
      f.guardian.getByText(versions![1].body, { exact: true }),
    ).toBeVisible();
    await expect(
      f.guardian.getByRole("link", {
        name: "Otwórz spotkanie kursu →",
        exact: true,
      }),
    ).toHaveCount(0);
  } finally {
    await sql.close();
    try {
      await removeCourseCare(f.db, [f.dog], courses);
    } finally {
      await f.dispose();
    }
  }
});

test("course care: observed PostgreSQL locks serialize publication, cancellation and enrollment retry", async ({
  baseURL,
}) => {
  const { db, client } = localClients(baseURL),
    staff = client(),
    ownerApi = client();
  const users: string[] = [],
    dogs: string[] = [],
    courses: string[] = [];
  const observer = await new LocalPostgres().ready();
  try {
    const admin = await account(db, users, "admin"),
      owner = await account(db, users, "client");
    for (const [api, user] of [
      [staff, admin],
      [ownerApi, owner],
    ] as const)
      await checked(
        api.auth.signInWithPassword({
          email: user.email,
          password: user.password,
        }),
      );
    const dog = await checked(
      db
        .from("dogs")
        .insert({ name: "Blokady zaleceń kursów", guardian_id: owner.id })
        .select("id")
        .single(),
    );
    if (!dog) throw new Error("Missing local course-care dog fixture");
    dogs.push(dog.id);
    const publish = (e: string, version: number) =>
      `select public.save_care_plan(${q(dog.id)},${version},'Plan z transakcji','Spokojne ćwiczenia próbne.',null,true,null,${q(e)},null);`;
    const cancel = (e: string) =>
      `select public.change_course_enrollment(${q(e)},2,'cancel','Rezygnacja w próbie blokad');`;
    const first = await courseFixture(
      db,
      staff,
      ownerApi,
      dog.id,
      courses,
      observer,
    );
    const publication = await new LocalPostgres().ready(),
      cancellation = await new LocalPostgres().ready();
    let waiting: Promise<unknown> | undefined;
    try {
      await publication.asUser(admin.id);
      await publication.query(publish(first.enrollment, 0));
      await cancellation.asUser(owner.id);
      waiting = cancellation.query(cancel(first.enrollment));
      // Attach rejection immediately; cleanup below also waits for this command.
      waiting.catch(() => {});
      await waitForLock(observer, publication, cancellation);
      await publication.query("commit;");
      await waiting;
      await cancellation.query("commit;");
    } finally {
      await Promise.all([publication.close(), cancellation.close()]);
      if (waiting) await waiting;
    }
    expect(
      await checked(
        db
          .from("care_plan_versions")
          .select("id")
          .eq("course_enrollment_id", first.enrollment),
      ),
    ).toHaveLength(1);
    const second = await courseFixture(
      db,
      staff,
      ownerApi,
      dog.id,
      courses,
      observer,
    );
    const cancelFirst = await new LocalPostgres().ready(),
      publishSecond = await new LocalPostgres().ready();
    let rejected: Promise<{ error: unknown }> | undefined;
    try {
      await cancelFirst.asUser(owner.id);
      await cancelFirst.query(cancel(second.enrollment));
      await publishSecond.asUser(admin.id);
      rejected = publishSecond.query(publish(second.enrollment, 1)).then(
        () => ({ error: null }),
        (error) => ({ error }),
      );
      await waitForLock(observer, cancelFirst, publishSecond);
      await cancelFirst.query("commit;");
      expect(String((await rejected).error)).toContain(
        "Wybierz przyjęte zgłoszenie",
      );
    } finally {
      await Promise.all([cancelFirst.close(), publishSecond.close()]);
      if (rejected) await rejected;
    }
    expect(
      await checked(
        db
          .from("care_plan_versions")
          .select("id")
          .eq("course_enrollment_id", second.enrollment),
      ),
    ).toEqual([]);
    const third = await courseFixture(
      db,
      staff,
      ownerApi,
      dog.id,
      courses,
      observer,
    );
    const request = await new LocalPostgres().ready(),
      advice = await new LocalPostgres().ready();
    let pending: Promise<unknown> | undefined;
    try {
      await request.asUser(owner.id);
      await request.query(
        `select public.request_course_enrollment(${q(third.enrollment)},${q(third.id)},${q(dog.id)},2);`,
      );
      await advice.asUser(admin.id);
      pending = advice.query(publish(third.enrollment, 1));
      pending.catch(() => {});
      await waitForLock(observer, request, advice);
      await request.query("commit;");
      await pending;
      await advice.query("commit;");
    } finally {
      await Promise.all([request.close(), advice.close()]);
      if (pending) await pending;
    }
    expect(
      await checked(
        db.from("course_enrollments").select("id").eq("course_id", third.id),
      ),
    ).toHaveLength(1);
    expect(
      await checked(
        db.from("care_plan_versions").select("id").eq("dog_id", dog.id),
      ),
    ).toHaveLength(2);
    expect(
      await checked(
        db
          .from("care_drafts")
          .select("version,course_enrollment_id")
          .eq("dog_id", dog.id)
          .single(),
      ),
    ).toMatchObject({ version: 2, course_enrollment_id: third.enrollment });
  } finally {
    await observer.close();
    await Promise.all([staff.auth.signOut(), ownerApi.auth.signOut()]);
    try {
      await removeCourseCare(db, dogs, courses);
    } finally {
      await disposeCareFixtures(db, users, dogs);
    }
  }
});
