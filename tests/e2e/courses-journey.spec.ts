import { expect, test, type Page } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import {
  localClients,
  checked,
  account,
  login,
  disposeCareFixtures,
} from "./local-fixtures";
test.use({ trace: "off" });
const serviceId = "60000000-0000-4000-8000-000000000001";
const courseForm = (page: Page) =>
  page.getByRole("form", { name: "Zmiana kursu", exact: true });
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
      name: "Nowy cykl kursu",
      exact: true,
    });
    await create.getByLabel("Usługa", { exact: true }).selectOption(serviceId);
    const title = `Kurs panelu ${crypto.randomUUID().slice(0, 8)}`;
    await create.getByLabel("Nazwa cyklu").fill(title);
    await create.getByLabel("Liczba psów z opiekunami").fill("1");
    await create
      .getByLabel("Okolica widoczna przed przyjęciem")
      .fill("Park próbnego kursu");
    await create
      .getByLabel("Dokładna zbiórka po przyjęciu")
      .fill("PRYWATNY PUNKT PANELU");
    const first = `${new Date().getUTCFullYear() + 2}-01-15T14:00`;
    await create.getByLabel("Spotkanie 1", { exact: true }).fill(first);
    await create
      .getByRole("button", { name: "Uzupełnij co tydzień", exact: true })
      .click();
    await expect(create.getByLabel("Spotkanie 2", { exact: true })).toHaveValue(
      `${new Date().getUTCFullYear() + 2}-01-22T14:00`,
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
        name: "Zgłoszenie na kurs",
        exact: true,
      });
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
    async function decision(name: string, intent: string, success = true) {
      const card = staff.getByRole("article", {
        name: `Zgłoszenie: ${name}`,
        exact: true,
      });
      await card.getByText("Decyzja o zgłoszeniu", { exact: true }).click();
      const form = card.getByRole("form", {
        name: `Decyzja: ${name}`,
        exact: true,
      });
      await form.getByRole("combobox").selectOption(intent);
      await form
        .getByRole("button", { name: "Zapisz zmianę", exact: true })
        .click();
      if (success)
        await expect(form.getByRole("status")).toHaveText("Decyzja zapisana.");
    }
    await decision(names[0], "accept");
    await decision(names[1], "accept", false); // A failed decision must leave the card and controls usable.
    const reserve = staff.getByRole("article", {
      name: `Zgłoszenie: ${names[1]}`,
      exact: true,
    });
    await expect(reserve.getByRole("alert")).toHaveText(
      "Brak wolnych miejsc na kursie.",
    );
    await reserve.getByRole("combobox").selectOption("waitlist");
    await reserve
      .getByRole("button", { name: "Zapisz zmianę", exact: true })
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
      name: "Zgłoszenie na kurs",
      exact: true,
    });
    await staleEnrollment
      .getByLabel("Pies", { exact: true })
      .selectOption(extraDog!.id);
    const staleMeeting = stale.locator("#spotkanie-1");
    await staleMeeting
      .getByText("Zmień termin lub zbiórkę", { exact: true })
      .click();
    const staleForm = stale.getByRole("form", {
      name: "Termin spotkania 1",
      exact: true,
    });
    await staleForm
      .getByLabel("Dokładna zbiórka po przyjęciu")
      .fill("ZACHOWANY STARY WPIS");
    await staleForm
      .getByLabel("Powód zmiany dla opiekuna")
      .fill("Wpis w starej karcie");
    const meeting = staff.locator("#spotkanie-1");
    await meeting
      .getByText("Zmień termin lub zbiórkę", { exact: true })
      .click();
    const edit = staff.getByRole("form", {
      name: "Termin spotkania 1",
      exact: true,
    });
    const moved = first.replace("-15T", "-16T");
    await edit.getByLabel("Termin (czas polski)").fill(moved);
    await edit
      .getByLabel("Dokładna zbiórka po przyjęciu")
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
      staleForm.getByLabel("Dokładna zbiórka po przyjęciu"),
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
    ).toHaveAttribute("href", `/app/courses/${id}`);
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
    await courseForm(staff).getByRole("combobox").selectOption("cancel");
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
    const now = Date.now();
    const first = new Date(now + 2 * 86400000);
    first.setUTCHours(9, 30, 0, 0);
    const occupied = await checked(
      api.rpc(
        "calendar_appointments",
        {
          p_from: new Date(now).toISOString(),
          p_to: new Date(now + 31 * 86400000).toISOString(),
        },
        { get: true },
      ),
    );
    const available = () =>
      !occupied!.some(
        (event: { status: string; starts_at: string; ends_at: string }) =>
          event.status !== "completed" &&
          Array.from(
            { length: 5 },
            (_, i) => first.getTime() + i * 7 * 86400000,
          ).some(
            (at) =>
              at < Date.parse(event.ends_at) &&
              at + 60 * 60000 > Date.parse(event.starts_at),
          ),
      );
    while (!available() && first.getTime() < now + 3 * 86400000)
      first.setTime(first.getTime() + 15 * 60000);
    expect(available()).toBe(true);
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
    await expect(next).toHaveAttribute("href", `/app/courses/${id}`);
    await next.click();
    await expect(ownPage).toHaveURL(`/app/courses/${id}`);
    // Move only this fixture's first meeting into the past to test its clock gate
    // without changing the database/server clock or any existing appointments.
    await checked(
      db
        .from("course_sessions")
        .update({ starts_at: new Date(Date.now() - 2 * 3600000).toISOString() })
        .eq("id", sessions![0].id),
    );
    await staff.goto(`/admin/courses/${id}`);
    const firstCard = staff.locator("#spotkanie-1");
    await firstCard.getByText("Obecności uczestników", { exact: true }).click();
    const attendance = firstCard.getByRole("form", {
      name: `Obecność: ${dogName}`,
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
    await expect(
      firstCard.getByText("Zakończone", { exact: true }),
    ).toBeVisible();
    for (let n = 2; n <= 5; n++) {
      const card = staff.locator(`#spotkanie-${n}`);
      await card
        .getByText("Zakończ lub odwołaj spotkanie", { exact: true })
        .click();
      const end = card.getByRole("form", {
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
    await courseForm(staff).getByRole("combobox").selectOption("complete");
    await courseForm(staff)
      .getByRole("button", { name: "Zapisz zmianę", exact: true })
      .click();
    await expect(courseForm(staff).getByRole("status")).toHaveText(
      "Zmiana kursu zapisana.",
    );
    await ownPage.goto(`/app/courses/${id}`);
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
    if (courses.length)
      await checked(db.from("courses").delete().in("id", courses));
    await disposeCareFixtures(db, users, dogs);
  }
});
