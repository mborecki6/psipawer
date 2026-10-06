import { expect, test, type Page } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import {
  LocalPostgres,
  literal as q,
  waitForLock,
} from "../helpers/local-postgres.mjs";
import { careFixture, careScreenshot } from "./care-journey";
import { courseFixture, removeCourseCare } from "./course-fixtures";
import {
  account,
  checked,
  disposeCareFixtures,
  localClients,
} from "./local-fixtures";

test.use({ trace: "off" });
async function settings(page: Page) {
  await page.getByText("Edytuj nazwę i liczbę miejsc", { exact: true }).click();
  return page.getByRole("form", { name: "Ustawienia cyklu", exact: true });
}
test("course settings and completed attendance: stale cards retain fields, history and frozen balances", async ({
  browser,
  baseURL,
}) => {
  const f = await careFixture(browser, baseURL),
    courses: string[] = [],
    extraDogs: string[] = [];
  const sql = await new LocalPostgres().ready();
  try {
    await mkdir("output/course-edits", { recursive: true });
    const cycle = await courseFixture(
      f.db,
      f.staffDb,
      f.ownerDb,
      f.dog,
      courses,
      sql,
    );
    const enrollments = [cycle.enrollment];
    for (const [index, decision] of ["accept", "waitlist"].entries()) {
      const dog = await checked(
        f.db
          .from("dogs")
          .insert({
            name: `Ustawienia kursu ${index}`,
            guardian_id: f.owner.id,
          })
          .select("id")
          .single(),
      );
      if (!dog) throw new Error("Missing local course-edit dog fixture");
      extraDogs.push(dog.id);
      const enrollment = crypto.randomUUID();
      enrollments.push(enrollment);
      await checked(
        f.ownerDb.rpc("request_course_enrollment", {
          p_id: enrollment,
          p_course: cycle.id,
          p_dog: dog.id,
          p_expected_course_version: 2,
        }),
      );
      await checked(
        f.staffDb.rpc("change_course_enrollment", {
          p_id: enrollment,
          p_expected_version: 1,
          p_action: decision,
          p_note: "",
        }),
      );
    }
    const jobs = await checked(
      f.db
        .from("reminder_jobs")
        .select("id,status,generation,source_token")
        .in("dog_id", [f.dog, ...extraDogs])
        .order("id"),
    );
    const url = `/admin/courses/${cycle.id}?enrollment=${cycle.enrollment}`;
    await f.staff.goto(url);
    const edit = await settings(f.staff),
      stale = await f.staffContext.newPage();
    await stale.goto(url);
    const staleEdit = await settings(stale);
    await staleEdit.getByLabel("Nazwa cyklu").fill("Nazwa ze starszej karty");
    await staleEdit.getByLabel("Liczba psów z opiekunami").fill("4");
    await staleEdit
      .getByLabel("Powód zmiany ustawień")
      .fill("Treść starszej karty ma pozostać");
    await edit.getByLabel("Nazwa cyklu").fill("Zmiana ustawień kursu");
    await edit.getByLabel("Liczba psów z opiekunami").fill("1");
    await edit
      .getByLabel("Powód zmiany ustawień")
      .fill("Próba zmniejszenia grupy");
    await edit
      .getByRole("button", { name: "Zapisz ustawienia cyklu", exact: true })
      .click();
    await expect(edit.getByRole("alert")).toContainText(
      "liczby przyjętych psów",
    );
    await expect(edit.getByLabel("Nazwa cyklu")).toHaveValue(
      "Zmiana ustawień kursu",
    );
    await edit.getByLabel("Liczba psów z opiekunami").fill("3");
    await edit
      .getByRole("button", { name: "Zapisz ustawienia cyklu", exact: true })
      .click();
    await expect(edit.getByRole("status")).toContainText(
      "Ustawienia cyklu zapisane",
    );
    await staleEdit
      .getByRole("button", { name: "Zapisz ustawienia cyklu", exact: true })
      .click();
    await expect(staleEdit.getByRole("alert")).toContainText(
      "Kurs zmienił się",
    );
    await expect(staleEdit.getByLabel("Nazwa cyklu")).toHaveValue(
      "Nazwa ze starszej karty",
    );
    await expect(staleEdit.getByLabel("Liczba psów z opiekunami")).toHaveValue(
      "4",
    );
    await expect(staleEdit.getByLabel("Powód zmiany ustawień")).toHaveValue(
      "Treść starszej karty ma pozostać",
    );
    await careScreenshot(
      stale,
      "output/course-edits/stale-settings-390.png",
      390,
    );
    await stale.close();
    // A second successful edit from the same live form owns a fresh receipt
    // and the version returned by its previous successful save.
    await edit.getByLabel("Nazwa cyklu").fill("Druga nazwa kursu");
    await expect(edit.getByRole("status")).toHaveCount(0);
    await edit.getByLabel("Liczba psów z opiekunami").fill("4");
    await edit
      .getByLabel("Powód zmiany ustawień")
      .fill("Druga uzgodniona zmiana");
    await edit
      .getByRole("button", { name: "Zapisz ustawienia cyklu", exact: true })
      .click();
    await expect(edit.getByRole("status")).toContainText(
      "Ustawienia cyklu zapisane",
    );
    await expect(
      f.staff.getByRole("heading", { name: "Druga nazwa kursu", exact: true }),
    ).toBeVisible();
    expect(
      await checked(
        f.db
          .from("reminder_jobs")
          .select("id,status,generation,source_token")
          .in("dog_id", [f.dog, ...extraDogs])
          .order("id"),
      ),
    ).toEqual(jobs);
    expect(
      await checked(
        f.ownerDb
          .from("course_balances")
          .select("agreed_price_cents,charge_cents,version")
          .eq("id", cycle.enrollment)
          .single(),
      ),
    ).toMatchObject({
      agreed_price_cents: 10000,
      charge_cents: 10000,
      version: 2,
    });
    expect(
      await checked(
        f.staffDb
          .from("course_enrollments")
          .select("status")
          .eq("id", enrollments[2])
          .single(),
      ),
    ).toMatchObject({ status: "waitlisted" });
    expect(
      await checked(
        f.ownerDb
          .from("notifications")
          .select("id")
          .eq("course_enrollment_id", cycle.enrollment)
          .eq("kind", "course_updated"),
      ),
    ).toHaveLength(2);
    expect(
      (
        await f.ownerDb.rpc("edit_course", {
          p_id: cycle.id,
          p_expected_version: 4,
          p_title: "Fałszywa nazwa",
          p_capacity: 1,
          p_note: "Fałszywa zmiana",
          p_request_id: crypto.randomUUID(),
        })
      ).error,
    ).toBeTruthy();

    await checked(
      f.db
        .from("course_sessions")
        .update({ starts_at: new Date(Date.now() - 2 * 3600000).toISOString() })
        .eq("id", cycle.sessions[0].id),
    );
    for (const enrollment of enrollments.slice(0, 2))
      await checked(
        f.staffDb.rpc("record_course_attendance", {
          p_session: cycle.sessions[0].id,
          p_enrollment: enrollment,
          p_expected_version: 0,
          p_attendance: "present",
        }),
      );
    await checked(
      f.staffDb.rpc("change_course_session", {
        p_id: cycle.sessions[0].id,
        p_expected_version: 1,
        p_action: "complete",
        p_note: "",
      }),
    );
    await f.staff.goto(url);
    await expect(
      f.staff.getByText("Kurs w trakcie", { exact: true }),
    ).toBeVisible();
    const meeting = f.staff.locator("#spotkanie-1");
    await meeting.getByText("Obecności uczestników", { exact: true }).click();
    const correction = meeting.getByRole("form", {
      name: `Korekta obecności: ${f.dogName}`,
      exact: true,
    });
    const staleAttendance = await f.staffContext.newPage();
    await staleAttendance.goto(url);
    await staleAttendance
      .locator("#spotkanie-1")
      .getByText("Obecności uczestników", { exact: true })
      .click();
    const staleCorrection = staleAttendance.getByRole("form", {
      name: `Korekta obecności: ${f.dogName}`,
      exact: true,
    });
    await staleCorrection.getByRole("combobox").selectOption("excused");
    await staleCorrection
      .getByLabel("Powód korekty obecności")
      .fill("Starszy opis usprawiedliwienia");
    await correction.getByRole("combobox").selectOption("absent");
    await correction
      .getByLabel("Powód korekty obecności")
      .fill("Sprawdzona lista obecności");
    await correction
      .getByRole("button", { name: "Zapisz korektę obecności", exact: true })
      .click();
    await expect(correction.getByRole("status")).toContainText(
      "Korekta obecności zapisana",
    );
    await staleCorrection
      .getByRole("button", { name: "Zapisz korektę obecności", exact: true })
      .click();
    await expect(staleCorrection.getByRole("alert")).toContainText(
      "Obecność zmieniła się",
    );
    await expect(staleCorrection.getByRole("combobox")).toHaveValue("excused");
    await expect(
      staleCorrection.getByLabel("Powód korekty obecności"),
    ).toHaveValue("Starszy opis usprawiedliwienia");
    await careScreenshot(
      staleAttendance,
      "output/course-edits/stale-attendance-320.png",
      320,
    );
    await staleAttendance.close();
    for (const session of cycle.sessions.slice(1))
      await checked(
        f.staffDb.rpc("change_course_session", {
          p_id: session.id,
          p_expected_version: 1,
          p_action: "cancel",
          p_note: "Pozostałe fikcyjne spotkania odwołane",
        }),
      );
    const state = await checked(
      f.staffDb.from("courses").select("version").eq("id", cycle.id).single(),
    );
    await checked(
      f.staffDb.rpc("change_course", {
        p_id: cycle.id,
        p_expected_version: state!.version,
        p_action: "complete",
        p_note: "",
      }),
    );
    await f.staff.goto(url);
    await f.staff
      .locator("#spotkanie-1")
      .getByText("Obecności uczestników", { exact: true })
      .click();
    const after = f.staff.getByRole("form", {
      name: `Korekta obecności: ${f.dogName}`,
      exact: true,
    });
    await after.getByRole("combobox").selectOption("excused");
    await after
      .getByLabel("Powód korekty obecności")
      .fill("Uzgodnienie po zakończeniu całego kursu");
    await after
      .getByRole("button", { name: "Zapisz korektę obecności", exact: true })
      .click();
    await expect(after.getByRole("status")).toContainText(
      "Korekta obecności zapisana",
    );
    const receipts = await checked(
      f.ownerDb
        .from("course_attendance_corrections")
        .select(
          "source_version,result_version,previous_attendance,attendance,note",
        )
        .eq("enrollment_id", cycle.enrollment)
        .order("source_version"),
    );
    expect(receipts).toHaveLength(2);
    expect(receipts![0]).toMatchObject({
      source_version: 1,
      result_version: 2,
      previous_attendance: "present",
      attendance: "absent",
    });
    expect(receipts![1]).toMatchObject({
      source_version: 2,
      result_version: 3,
      previous_attendance: "absent",
      attendance: "excused",
    });
    expect(
      await checked(
        f.outsiderDb
          .from("course_attendance_corrections")
          .select("note")
          .eq("enrollment_id", cycle.enrollment),
      ),
    ).toEqual([]);
    await f.guardian.goto(
      `/app/courses/${cycle.id}?enrollment=${cycle.enrollment}`,
    );
    await expect(
      f.guardian.getByRole("heading", {
        name: "Druga nazwa kursu",
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      f.guardian.getByText("Skorygowana obecność", { exact: true }),
    ).toHaveCount(2);
    await careScreenshot(
      f.guardian,
      "output/course-edits/guardian-history-390.png",
      390,
    );
    expect(
      await checked(
        f.ownerDb
          .from("course_balances")
          .select("charge_cents,agreed_price_cents")
          .eq("id", cycle.enrollment)
          .single(),
      ),
    ).toMatchObject({ charge_cents: 10000, agreed_price_cents: 10000 });
  } finally {
    await sql.close();
    try {
      await removeCourseCare(f.db, [f.dog, ...extraDogs], courses);
    } finally {
      try {
        await disposeCareFixtures(f.db, [], extraDogs);
      } finally {
        await f.dispose();
      }
    }
  }
});

test("course edits: real capacity/acceptance and competing attendance correction locks", async ({
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
    for (let n = 0; n < 2; n++) {
      const dog = await checked(
        db
          .from("dogs")
          .insert({ name: `Blokady edycji kursu ${n}`, guardian_id: owner.id })
          .select("id")
          .single(),
      );
      dogs.push(dog!.id);
    }
    const edit = (course: string) =>
      `select public.edit_course(${q(course)},2,'Zmniejszona grupa',1,'Próba ograniczenia',${q(crypto.randomUUID())});`;
    for (const acceptFirst of [false, true]) {
      const cycle = await courseFixture(
          db,
          staff,
          ownerApi,
          dogs[0],
          courses,
          observer,
        ),
        other = crypto.randomUUID();
      await checked(
        ownerApi.rpc("request_course_enrollment", {
          p_id: other,
          p_course: cycle.id,
          p_dog: dogs[1],
          p_expected_course_version: 2,
        }),
      );
      const first = await new LocalPostgres().ready(),
        second = await new LocalPostgres().ready();
      let pending: Promise<{ error: unknown }> | undefined;
      try {
        await first.asUser(admin.id);
        await second.asUser(admin.id);
        const accept = `select public.change_course_enrollment(${q(other)},1,'accept','');`;
        await first.query(acceptFirst ? accept : edit(cycle.id));
        pending = second.query(acceptFirst ? edit(cycle.id) : accept).then(
          () => ({ error: null }),
          (error) => ({ error }),
        );
        await waitForLock(observer, first, second);
        await first.query("commit;");
        expect(String((await pending).error)).toContain(
          acceptFirst ? "liczby przyjętych psów" : "Brak wolnych miejsc",
        );
      } finally {
        await Promise.all([first.close(), second.close()]);
        if (pending) await pending;
      }
      const accepted = await checked(
        staff
          .from("course_enrollments")
          .select("id")
          .eq("course_id", cycle.id)
          .eq("status", "accepted"),
      );
      const capacity = await checked(
        staff.from("courses").select("capacity").eq("id", cycle.id).single(),
      );
      expect(accepted!.length).toBe(capacity!.capacity);
    }
    const course = courses[0],
      session = await checked(
        staff
          .from("course_sessions")
          .select("id")
          .eq("course_id", course)
          .eq("ordinal", 1)
          .single(),
      );
    const enrollment = await checked(
      staff
        .from("course_enrollments")
        .select("id")
        .eq("course_id", course)
        .eq("dog_id", dogs[0])
        .single(),
    );
    await checked(
      db
        .from("course_sessions")
        .update({ starts_at: new Date(Date.now() - 2 * 3600000).toISOString() })
        .eq("id", session!.id),
    );
    await checked(
      staff.rpc("record_course_attendance", {
        p_session: session!.id,
        p_enrollment: enrollment!.id,
        p_expected_version: 0,
        p_attendance: "present",
      }),
    );
    await checked(
      staff.rpc("change_course_session", {
        p_id: session!.id,
        p_expected_version: 1,
        p_action: "complete",
        p_note: "",
      }),
    );
    const a = await new LocalPostgres().ready(),
      b = await new LocalPostgres().ready();
    let pending: Promise<{ error: unknown }> | undefined;
    try {
      await a.asUser(admin.id);
      await b.asUser(admin.id);
      await a.query(
        `select public.correct_course_attendance(${q(session!.id)},${q(enrollment!.id)},1,'excused','Sprawdzona nieobecność');`,
      );
      pending = b
        .query(
          `select public.correct_course_attendance(${q(session!.id)},${q(enrollment!.id)},1,'absent','Inna treść korekty');`,
        )
        .then(
          () => ({ error: null }),
          (error) => ({ error }),
        );
      await waitForLock(observer, a, b);
      await a.query("commit;");
      expect(String((await pending).error)).toContain("Obecność zmieniła się");
    } finally {
      await Promise.all([a.close(), b.close()]);
      if (pending) await pending;
    }
    expect(
      await checked(
        staff.rpc("correct_course_attendance", {
          p_session: session!.id,
          p_enrollment: enrollment!.id,
          p_expected_version: 1,
          p_attendance: "excused",
          p_note: "Sprawdzona nieobecność",
        }),
      ),
    ).toBe(2);
    expect(
      await checked(
        staff
          .from("course_attendance_corrections")
          .select("source_version")
          .eq("session_id", session!.id),
      ),
    ).toHaveLength(1);
    const versions = await checked(
      staff.from("courses").select("id,version,capacity").in("id", courses),
    );
    const firstState = versions!.find((c) => c.id === courses[0])!,
      secondState = versions!.find((c) => c.id === courses[1])!;
    const key = crypto.randomUUID(),
      holder = await new LocalPostgres().ready(),
      waiter = await new LocalPostgres().ready();
    let reuse: Promise<{ error: unknown }> | undefined;
    try {
      await holder.asUser(admin.id);
      await waiter.asUser(admin.id);
      await holder.query(
        `select public.edit_course(${q(firstState.id)},${firstState.version},'Pierwszy zapis klucza',${firstState.capacity},'Oryginalne żądanie',${q(key)});`,
      );
      reuse = waiter
        .query(
          `select public.edit_course(${q(secondState.id)},${secondState.version},'Drugi cel klucza',${secondState.capacity},'Inny cel żądania',${q(key)});`,
        )
        .then(
          () => ({ error: null }),
          (error) => ({ error }),
        );
      await waitForLock(observer, holder, waiter);
      await holder.query("commit;");
      expect(String((await reuse).error)).toContain(
        "zapis ustawień został już użyty",
      );
    } finally {
      await Promise.all([holder.close(), waiter.close()]);
      if (reuse) await reuse;
    }
    expect(
      await checked(
        staff
          .from("courses")
          .select("version")
          .eq("id", secondState.id)
          .single(),
      ),
    ).toMatchObject({ version: secondState.version });
    expect(
      await checked(
        staff.from("course_settings_receipts").select("id").eq("id", key),
      ),
    ).toHaveLength(1);
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
