import { revealFor } from "./details-ui";
import { expect, type Page } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import {
  test,
  localClients,
  checked,
  account,
  login,
  disposeCareFixtures,
  setupLocalPractitioner,
  freeCalendarStart,
} from "./local-fixtures";
import { dateInput } from "./walk-journey";
import {
  openCourseCommand,
  openCourseMeeting,
  openCourseMeetingOptions,
  openCourseSection,
} from "./course-ui";
test.use({ trace: "off" });
const serviceId = "60000000-0000-4000-8000-000000000001";
const courseForm = (page: Page) =>
  page.getByRole("form", {
    includeHidden: true,
    name: "Zmiana kursu",
    exact: true,
  });
async function screenshot(page: Page, path: string, width: number) {
  await expect(
    page
      .getByRole("heading", { name: /Plan spotkań|Najpierw dobry plan\./ })
      .first(),
  ).toBeVisible();
  await page.setViewportSize({ width, height: width < 600 ? 844 : 1000 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.evaluate(() => {
    (document.activeElement as HTMLElement)?.blur();
    window.scrollTo(0, 0);
  });
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
  await page.screenshot({ path, fullPage: true });
}
test("course panels: create → requests → acceptance/reserve → stale meeting editor → calendar → cancellation", async ({
  browser,
  baseURL,
}) => {
  const { db } = localClients(baseURL),
    users: string[] = [],
    dogs: string[] = [],
    courses: string[] = [];
  const staffContext = await browser.newContext({
    baseURL,
    viewport: { width: 1440, height: 1000 },
  });
  const ownContext = await browser.newContext({
    baseURL,
    viewport: { width: 390, height: 844 },
  });
  const otherContext = await browser.newContext({
    baseURL,
    viewport: { width: 390, height: 844 },
  });
  const staff = await staffContext.newPage(),
    ownerPage = await ownContext.newPage(),
    otherPage = await otherContext.newPage();
  try {
    await mkdir("output/courses", { recursive: true });
    const leader = await account(db, users, "admin"),
      owner = await account(db, users, "client"),
      other = await account(db, users, "client");
    await setupLocalPractitioner(db, users, leader.id);
    const names = [
      `Kurs pierwszy ${crypto.randomUUID().slice(0, 6)}`,
      `Kurs rezerwa ${crypto.randomUUID().slice(0, 6)}`,
    ];
    for (const [i, guardian] of [owner.id, other.id].entries()) {
      const dog = await checked(
        db
          .from("dogs")
          .insert({ name: names[i], guardian_id: guardian })
          .select("id")
          .single(),
      );
      dogs.push(dog!.id);
    }
    const extraDog = await checked(
      db
        .from("dogs")
        .insert({ name: "Zapas do próby harmonogramu", guardian_id: owner.id })
        .select("id")
        .single(),
    );
    dogs.push(extraDog!.id);
    await login(staff, leader, "admin");
    await login(ownerPage, owner, "client");
    await login(otherPage, other, "client");
    let release!: () => void;
    const scripts = new Promise<void>((done) => {
      release = done;
    });
    await staff.route("**/_next/static/**/*.js*", async (route) => {
      await scripts;
      await route.continue();
    });
    try {
      await staff.goto(`/admin/courses/new?service=${serviceId}`, {
        waitUntil: "commit",
      });
      await expect(staff.getByLabel("Nazwa cyklu")).toBeVisible();
      await expect(staff.getByLabel("Nazwa cyklu")).toBeDisabled();
      await expect(
        staff.getByRole("button", { name: "Proszę czekać…", exact: true }),
      ).toBeDisabled();
    } finally {
      release();
      await staff.unrouteAll({ behavior: "wait" });
    }
    const create = staff.getByRole("form", {
      includeHidden: true,
      name: "Nowy cykl kursu",
      exact: true,
    });
    await create.getByLabel("Usługa", { exact: true }).selectOption(serviceId);
    const title = `Kurs panelu ${crypto.randomUUID().slice(0, 8)}`;
    await create.getByLabel("Nazwa cyklu").fill(title);
    await create.getByLabel("Liczba psów z opiekunami").fill("1");
    await create
      .getByLabel("Miejsce — okolica przed przyjęciem")
      .fill("Park próbnego kursu");
    await create
      .getByLabel("Dokładne miejsce zbiórki po przyjęciu")
      .fill("PRYWATNY PUNKT PANELU");
    const firstIso = await freeCalendarStart(db, {
      after: Date.UTC(new Date().getUTCFullYear() + 2, 0, 15, 12),
      offsetsMinutes: [
        0,
        1440,
        ...Array.from({ length: 4 }, (_, n) => (n + 1) * 7 * 1440),
      ],
    });
    const first = dateInput(firstIso);
    await create.getByLabel("Spotkanie 1", { exact: true }).fill(first);
    await create
      .getByRole("button", { name: "Uzupełnij co tydzień", exact: true })
      .click();
    await expect(create.getByLabel("Spotkanie 2", { exact: true })).toHaveValue(
      dateInput(new Date(Date.parse(firstIso) + 7 * 86400000).toISOString()),
    );
    await screenshot(staff, "output/courses/create-320.png", 320);
    const id = await create.locator('input[name="id"]').inputValue();
    courses.push(id);
    await create
      .getByRole("button", { name: "Zapisz szkic cyklu", exact: true })
      .click();
    await expect(staff).toHaveURL(/\/admin\/courses\/[0-9a-f-]+$/);
    await expect(
      staff.getByRole("heading", { name: title, exact: true }),
    ).toBeVisible();
    expect(
      await checked(
        db.from("course_sessions").select("id").eq("course_id", id),
      ),
    ).toHaveLength(5);
    await ownerPage.goto(`/app/courses/${id}`);
    await expect(
      ownerPage.getByRole("heading", { name: "Ten trop się urwał." }),
    ).toBeVisible();
    await openCourseCommand(staff);
    await courseForm(staff)
      .getByLabel("Zmiana kursu", { exact: true })
      .selectOption("publish");
    await courseForm(staff)
      .getByRole("button", { name: "Zapisz zmianę", exact: true })
      .click();
    await expect(courseForm(staff).getByRole("status")).toHaveText(
      "Zmiana kursu zapisana.",
    );
    for (const page of [ownerPage, otherPage]) {
      await page.goto(`/app/courses/${id}`);
      await expect(
        page.getByText("PRYWATNY PUNKT PANELU", { exact: false }),
      ).toHaveCount(0);
      const request = page.getByRole("form", {
        includeHidden: true,
        name: "Zgłoszenie na kurs",
        exact: true,
      });
      await revealFor(
        request.getByRole("button", {
          name: "Zgłoś psa na kurs",
          exact: true,
          includeHidden: true,
        }),
      );
      await request
        .getByRole("button", { name: "Zgłoś psa na kurs", exact: true })
        .click();
      await expect(request.getByRole("status")).toContainText(
        "Zgłoszenie zapisane",
      );
    }
    await staff
      .getByRole("link", { name: "Odśwież dane →", exact: true })
      .click();
    async function decision(name: string, success = true) {
      const card = staff.getByRole("article", {
        name: `Zgłoszenie: ${name}`,
        exact: true,
      });
      const form = card.getByRole("form", {
        name: `Decyzja: ${name}`,
        exact: true,
      });
      await expect(form).toBeVisible();
      await expect(form.getByRole("combobox")).toHaveCount(0);
      await form
        .getByRole("button", { name: `Przyjmij: ${name}`, exact: true })
        .click();
      if (success)
        await expect(form.getByRole("status")).toHaveText("Decyzja zapisana.");
    }
    await decision(names[0]);
    await decision(names[1], false); // A failed decision must leave the card and controls usable.
    const reserve = staff.getByRole("article", {
      name: `Zgłoszenie: ${names[1]}`,
      exact: true,
    });
    await expect(reserve.getByRole("alert")).toHaveText(
      "Brak wolnych miejsc na kursie.",
    );
    const reserveDecision = reserve.getByRole("form", {
      name: `Decyzja: ${names[1]}`,
      exact: true,
    });
    await reserveDecision
      .getByRole("button", {
        name: `Przenieś na rezerwę: ${names[1]}`,
        exact: true,
      })
      .click();
    await expect(reserve.getByRole("status")).toHaveText("Decyzja zapisana.");
    await ownerPage.reload();
    await otherPage.reload();
    await expect(
      ownerPage.getByText("PRYWATNY PUNKT PANELU", { exact: false }),
    ).toHaveCount(5);
    await expect(
      otherPage.getByText("PRYWATNY PUNKT PANELU", { exact: false }),
    ).toHaveCount(0);
    await expect(
      otherPage.getByRole("article", {
        name: `Zgłoszenie: ${names[1]}`,
        exact: true,
      }),
    ).toContainText("Lista rezerwowa");
    await screenshot(otherPage, "output/courses/reserve-390.png", 390);
    const stale = await staffContext.newPage();
    await stale.goto(`/admin/courses/${id}`);
    const staleRequest = await ownContext.newPage();
    await staleRequest.goto(`/app/courses/${id}`);
    const staleEnrollment = staleRequest.getByRole("form", {
      includeHidden: true,
      name: "Zgłoszenie na kurs",
      exact: true,
    });
    await revealFor(staleEnrollment.getByLabel("Pies", { exact: true }));
    await staleEnrollment
      .getByLabel("Pies", { exact: true })
      .selectOption(extraDog!.id);
    const staleMeeting = await openCourseMeetingOptions(stale, 1);
    await openCourseSection(staleMeeting, "Zmień termin lub miejsce");
    const staleForm = stale.getByRole("form", {
      includeHidden: true,
      name: "Termin spotkania 1",
      exact: true,
    });
    await staleForm
      .getByLabel("Dokładne miejsce zbiórki po przyjęciu")
      .fill("ZACHOWANY STARY WPIS");
    await staleForm
      .getByLabel("Powód zmiany dla opiekuna")
      .fill("Wpis w starej karcie");
    const meeting = await openCourseMeetingOptions(staff, 1);
    await openCourseSection(meeting, "Zmień termin lub miejsce");
    const edit = staff.getByRole("form", {
      includeHidden: true,
      name: "Termin spotkania 1",
      exact: true,
    });
    const firstMeetingId = await edit.locator('[name="id"]').inputValue();
    const moved = dateInput(
      new Date(Date.parse(firstIso) + 86400000).toISOString(),
    );
    await edit.getByLabel("Termin (czas polski)").fill(moved);
    await edit
      .getByLabel("Dokładne miejsce zbiórki po przyjęciu")
      .fill("NOWA PRYWATNA ZBIÓRKA");
    await edit
      .getByLabel("Powód zmiany dla opiekuna")
      .fill("Uzgodniony nowy punkt");
    await edit
      .getByRole("button", { name: "Zapisz termin i zbiórkę", exact: true })
      .click();
    await expect(edit.getByRole("status")).toContainText(
      "Pozostałe spotkania zachowały swoje dane",
    );
    await staleEnrollment
      .getByRole("button", { name: "Zgłoś psa na kurs", exact: true })
      .click();
    await expect(staleEnrollment.getByRole("alert")).toContainText(
      "Kurs zmienił się",
    );
    await expect(
      staleEnrollment.getByLabel("Pies", { exact: true }),
    ).toHaveValue(extraDog!.id);
    expect(
      await checked(
        db.from("course_enrollments").select("id").eq("course_id", id),
      ),
    ).toHaveLength(2);
    await staleRequest.close();
    await staleForm
      .getByRole("button", { name: "Zapisz termin i zbiórkę", exact: true })
      .click();
    await expect(staleForm.getByRole("alert")).toContainText(
      "Spotkanie zmieniło się",
    );
    await expect(
      staleForm.getByLabel("Dokładne miejsce zbiórki po przyjęciu"),
    ).toHaveValue("ZACHOWANY STARY WPIS");
    await screenshot(stale, "output/courses/stale-390.png", 390);
    await stale.close();
    await ownerPage.goto(`/app/calendar?date=${moved.slice(0, 10)}`);
    await expect(
      ownerPage.getByRole("heading", {
        name: `${title} · spotkanie 1/5`,
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      ownerPage.getByText("NOWA PRYWATNA ZBIÓRKA", { exact: false }),
    ).toBeVisible();
    await expect(
      ownerPage
        .getByRole("link", { name: "Otwórz szczegóły", exact: true })
        .first(),
    ).toHaveAttribute("href", `/app/courses/${id}#spotkanie-${firstMeetingId}`);
    await otherPage.goto(`/app/calendar?date=${moved.slice(0, 10)}`);
    await expect(otherPage.getByText(title, { exact: false })).toHaveCount(0);
    await ownerPage.goto(`/app/courses/${id}`);
    await screenshot(ownerPage, "output/courses/accepted-320.png", 320);
    await ownerPage
      .locator("#spotkanie-1")
      .screenshot({ path: "output/courses/meeting-320.png" });
    await screenshot(ownerPage, "output/courses/accepted-1440.png", 1440);
    await staff
      .getByRole("link", { name: "Odśwież dane →", exact: true })
      .click();
    await openCourseCommand(staff);
    const cancelCourse = courseForm(staff).getByRole("combobox", {
      includeHidden: true,
    });
    await revealFor(cancelCourse);
    await cancelCourse.selectOption("cancel");
    await courseForm(staff)
      .getByLabel("Powód dla opiekuna")
      .fill("Uzgodnione odwołanie próbnego cyklu");
    await courseForm(staff)
      .getByRole("button", { name: "Zapisz zmianę", exact: true })
      .click();
    await expect(courseForm(staff).getByRole("status")).toHaveText(
      "Zmiana kursu zapisana.",
    );
    await ownerPage.reload();
    await expect(
      ownerPage.getByText("NOWA PRYWATNA ZBIÓRKA", { exact: false }),
    ).toHaveCount(0);
    await expect(
      ownerPage.getByRole("article", {
        name: `Zgłoszenie: ${names[0]}`,
        exact: true,
      }),
    ).toContainText("Rezygnacja lub odwołanie");
    await expect(
      ownerPage.getByRole("article", {
        name: `Zgłoszenie: ${names[0]}`,
        exact: true,
      }),
    ).toContainText("100,00");
    expect(
      await checked(
        db
          .from("calendar_slots")
          .select("course_session_id")
          .in(
            "course_session_id",
            (await checked(
              db.from("course_sessions").select("id").eq("course_id", id),
            ))!.map((s) => s.id),
          ),
      ),
    ).toEqual([]);
  } finally {
    await staffContext.close();
    await ownContext.close();
    await otherContext.close();
    if (dogs.length)
      await checked(
        db.from("care_reporting_entitlements").delete().in("dog_id", dogs),
      );
    if (courses.length)
      await checked(db.from("courses").delete().in("id", courses));
    await disposeCareFixtures(db, users, dogs);
  }
});

test("course attendance panels: started meeting → recorded attendance → completed meeting → completed cycle", async ({
  browser,
  baseURL,
}) => {
  const { db, client } = localClients(baseURL),
    users: string[] = [],
    dogs: string[] = [],
    courses: string[] = [];
  const context = await browser.newContext({
      baseURL,
      viewport: { width: 1440, height: 1000 },
    }),
    staff = await context.newPage();
  const ownContext = await browser.newContext({
      baseURL,
      viewport: { width: 390, height: 844 },
    }),
    ownPage = await ownContext.newPage(),
    api = client();
  try {
    const leader = await account(db, users, "admin"),
      owner = await account(db, users, "client");
    await setupLocalPractitioner(db, users, leader.id);
    await checked(
      api.auth.signInWithPassword({
        email: leader.email,
        password: leader.password,
      }),
    );
    const dogName = `Obecność kursu ${crypto.randomUUID().slice(0, 8)}`;
    const dog = await checked(
      db
        .from("dogs")
        .insert({ name: dogName, guardian_id: owner.id })
        .select("id")
        .single(),
    );
    dogs.push(dog!.id);
    const service = await checked(
      db.from("services").select("version").eq("id", serviceId).single(),
    );
    const id = crypto.randomUUID(),
      enrollment = crypto.randomUUID();
    courses.push(id);
    const first = new Date(
      await freeCalendarStart(db, {
        after: Date.now() + 2 * 86400000,
        offsetsMinutes: Array.from({ length: 5 }, (_, n) => n * 7 * 1440),
      }),
    );
    await checked(
      api.rpc("create_course", {
        p_id: id,
        p_service: serviceId,
        p_expected_service_version: service!.version,
        p_title: "Kurs obecności",
        p_capacity: 1,
        p_public_location: "Publiczna okolica",
        p_exact_location: "Punkt obecności",
        p_starts: Array.from({ length: 5 }, (_, i) =>
          new Date(first.getTime() + i * 7 * 86400000).toISOString(),
        ),
      }),
    );
    await checked(
      api.rpc("change_course", {
        p_id: id,
        p_expected_version: 1,
        p_action: "publish",
        p_note: "",
      }),
    );
    const ownerApi = client();
    try {
      await checked(
        ownerApi.auth.signInWithPassword({
          email: owner.email,
          password: owner.password,
        }),
      );
      await checked(
        ownerApi.rpc("request_course_enrollment", {
          p_id: enrollment,
          p_course: id,
          p_dog: dog!.id,
          p_expected_course_version: 2,
        }),
      );
    } finally {
      await ownerApi.auth.signOut();
    }
    await checked(
      api.rpc("change_course_enrollment", {
        p_id: enrollment,
        p_expected_version: 1,
        p_action: "accept",
        p_note: "",
      }),
    );
    const sessions = await checked(
      db
        .from("course_sessions")
        .select("id,ordinal")
        .eq("course_id", id)
        .order("ordinal"),
    );
    await login(staff, leader, "admin");
    await login(ownPage, owner, "client");
    const next = ownPage.getByRole("link", {
      name: "Szczegóły spotkania →",
      exact: true,
    });
    await expect(next).toHaveAttribute(
      "href",
      `/app/courses/${id}#spotkanie-${sessions![0].id}`,
    );
    await next.click();
    await expect(ownPage).toHaveURL(
      `/app/courses/${id}#spotkanie-${sessions![0].id}`,
    );
    // Move only this fixture's first meeting into the past to test its clock gate
    // without changing the database/server clock or any existing appointments.
    await checked(
      db
        .from("course_sessions")
        .update({ starts_at: new Date(Date.now() - 2 * 3600000).toISOString() })
        .eq("id", sessions![0].id),
    );
    await staff.goto(`/admin/courses/${id}`);
    const firstCard = await openCourseMeeting(staff, 1);
    const attendance = firstCard.getByRole("form", {
      name: `Obecność: ${dogName}`,
      exact: true,
    });
    await expect(attendance).toBeVisible();
    await expect(attendance.getByRole("combobox")).toHaveCount(0);
    await expect(
      attendance.getByText("Nieoznaczono", { exact: true }),
    ).toBeVisible();
    await attendance
      .getByRole("button", { name: `Był: ${dogName}`, exact: true })
      .click();
    await expect(attendance.getByRole("status")).toHaveText(
      "Obecność zapisana.",
    );
    await openCourseMeetingOptions(staff, 1);
    await openCourseSection(firstCard, "Zakończ lub odwołaj spotkanie");
    const end = firstCard.getByRole("form", {
      includeHidden: true,
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
    await expect(
      firstCard.getByText("Zakończone", { exact: true }),
    ).toBeVisible();
    for (let n = 2; n <= 5; n++) {
      const card = await openCourseMeetingOptions(staff, n);
      await openCourseSection(card, "Zakończ lub odwołaj spotkanie");
      const end = card.getByRole("form", {
        includeHidden: true,
        name: `Zmiana spotkania ${n}`,
        exact: true,
      });
      await end.getByRole("combobox").selectOption("cancel");
      await end
        .getByLabel("Powód dla opiekuna")
        .fill("Odwołane spotkanie próby");
      await end
        .getByRole("button", { name: "Zapisz zmianę", exact: true })
        .click();
      await expect(end.getByRole("status")).toHaveText(
        "Zmiana spotkania zapisana.",
      );
    }
    await staff
      .getByRole("link", { name: "Odśwież dane →", exact: true })
      .click();
    await openCourseCommand(staff);
    await courseForm(staff).getByRole("combobox").selectOption("complete");
    await courseForm(staff)
      .getByRole("button", { name: "Zapisz zmianę", exact: true })
      .click();
    await expect(courseForm(staff).getByRole("status")).toHaveText(
      "Zmiana kursu zapisana.",
    );
    await ownPage.goto(`/app/courses/${id}`);
    await openCourseMeeting(ownPage, 1);
    await expect(ownPage.locator("#spotkanie-1")).toContainText("Obecny");
    await expect(ownPage.locator("#spotkanie-1")).toContainText("Zakończone");
    await screenshot(ownPage, "output/courses/attendance-390.png", 390);
    await ownPage
      .locator("#spotkanie-1")
      .screenshot({ path: "output/courses/attendance-card-390.png" });
    expect(
      await checked(
        db
          .from("course_attendance")
          .select("attendance,version")
          .eq("enrollment_id", enrollment),
      ),
    ).toEqual([{ attendance: "present", version: 1 }]);
  } finally {
    await context.close();
    await ownContext.close();
    await api.auth.signOut();
    if (dogs.length)
      await checked(
        db.from("care_reporting_entitlements").delete().in("dog_id", dogs),
      );
    if (courses.length)
      await checked(db.from("courses").delete().in("id", courses));
    await disposeCareFixtures(db, users, dogs);
  }
});
