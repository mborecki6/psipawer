import { revealFor } from "./details-ui";
import { expect, type Locator, type Page } from "@playwright/test";
import { LocalPostgres } from "../helpers/local-postgres.mjs";
import { completeServerAction } from "./action-completion";
import { careFixture } from "./care-journey";
import { courseFixture, removeCourseCare } from "./course-fixtures";
import {
  courseSection,
  expectCourseSectionOpen,
  openCourseCommand,
  openCourseMeeting,
  openCourseMeetingOptions,
  openCourseSection,
  openCourseSettings,
} from "./course-ui";
import { checked, test } from "./local-fixtures";

// Pause the real request so the user can collapse its ancestors while saving.
// No response or application state is mocked.
async function submitThenCollapse(
  page: Page,
  button: Locator,
  ancestors: Locator[],
  acknowledge: (remaining: () => number) => Promise<void>,
) {
  let release!: () => void, dispatched!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const observed = new Promise<void>((resolve) => {
    dispatched = resolve;
  });
  const target = new URL(page.url());
  const routeUrl = `${target.origin}${target.pathname}*`;
  await page.route(routeUrl, async (route) => {
    const request = route.request();
    if (request.method() === "POST" && request.headers()["next-action"]) {
      dispatched();
      await gate;
    }
    await route.continue();
  });
  let action: Promise<void> | undefined;
  try {
    action = completeServerAction(page, button, acknowledge);
    action.catch(() => {});
    await Promise.race([observed, action]);
    for (const details of ancestors) {
      await revealFor(details.locator(":scope > summary"));
      await details.locator(":scope > summary").click();
      await expectCourseSectionOpen(details, false);
    }
    release();
    await action;
  } finally {
    release();
    await page.unrouteAll({ behavior: "wait" });
    if (action) await action;
  }
}

test("compact course keeps one meeting open, follows anchors and preserves hidden edits across real action refreshes", async ({
  browser,
  baseURL,
}, info) => {
  const f = await careFixture(browser, baseURL),
    courses: string[] = [];
  const sql = await new LocalPostgres().ready();
  try {
    const cycle = await courseFixture(
      f.db,
      f.staffDb,
      f.ownerDb,
      f.dog,
      courses,
      sql,
    );
    const path = `/admin/courses/${cycle.id}?enrollment=${cycle.enrollment}`;
    await f.staff.goto(path);
    const meetings = f.staff.locator("[data-course-meeting]");
    await expect(meetings).toHaveCount(5);
    await expect(f.staff.locator("[data-course-meeting][open]")).toHaveCount(1);
    await expectCourseSectionOpen(meetings.nth(0), true);
    for (let n = 1; n < 5; n++)
      await expectCourseSectionOpen(meetings.nth(n), false);
    const settings = courseSection(f.staff, "Warunki i ustawienia cyklu"),
      history = courseSection(f.staff, "Historia kursu");
    await expectCourseSectionOpen(settings, false);
    await expectCourseSectionOpen(history, false);
    await expect(
      f.staff
        .locator("#spotkanie-1")
        .locator("p")
        .filter({ hasText: "FIKCYJNA ZBIÓRKA" }),
    ).toBeInViewport();
    await expectCourseSectionOpen(
      courseSection(f.staff.locator("#spotkanie-1"), "Opcje spotkania"),
      false,
    );
    await f.staff.screenshot({
      path: info.outputPath("compact-course-first-fold-1440.png"),
      animations: "disabled",
    });

    await f.staff.goto(`${path}#spotkanie-4`);
    await expectCourseSectionOpen(meetings.nth(3), true);
    await expect(f.staff.locator("[data-course-meeting][open]")).toHaveCount(1);
    await f.staff.goto(`${path}#spotkanie-${cycle.sessions[2].id}`);
    await expectCourseSectionOpen(meetings.nth(2), true);
    await expect(f.staff.locator("[data-course-meeting][open]")).toHaveCount(1);
    const thirdMeeting = f.staff.locator("#spotkanie-3"),
      thirdDisclosure = thirdMeeting.locator(":scope > details");
    // The page has no own meeting-anchor link. This temporary fixture link
    // exercises an actual repeated click on the current UUID hash.
    await f.staff.evaluate((session) => {
      const anchor = document.createElement("a");
      anchor.id = "course-same-hash-fixture-link";
      anchor.href = `#spotkanie-${session}`;
      anchor.textContent = "Testowy link do tego samego spotkania";
      document.querySelector("main")!.append(anchor);
    }, cycle.sessions[2].id);
    const thirdSummary = thirdDisclosure.locator(":scope > summary");
    await revealFor(thirdSummary);
    await thirdSummary.focus();
    await revealFor(thirdSummary);
    await thirdSummary.press("Enter");
    await expectCourseSectionOpen(thirdDisclosure, false);
    await revealFor(f.staff.locator("#course-same-hash-fixture-link"));
    await f.staff.locator("#course-same-hash-fixture-link").click();
    await expectCourseSectionOpen(thirdDisclosure, true);
    await f.staff
      .locator("#course-same-hash-fixture-link")
      .evaluate((link) => link.remove());

    const edit = await openCourseSettings(f.staff),
      settingsEditor = courseSection(settings, "Edytuj nazwę i liczbę miejsc");
    const draftTitle = "Niezapisana nazwa zachowana po odświeżeniu";
    await revealFor(edit.getByLabel("Nazwa cyklu"));
    await edit.getByLabel("Nazwa cyklu").fill(draftTitle);
    await revealFor(edit.getByLabel("Liczba psów z opiekunami"));
    await edit.getByLabel("Liczba psów z opiekunami").fill("4");
    await revealFor(edit.getByLabel("Powód zmiany ustawień"));
    await edit
      .getByLabel("Powód zmiany ustawień")
      .fill("Zachowaj powód i wersję szkicu");
    await expect(edit.locator('[name="expected_version"]')).toHaveValue("2");
    await revealFor(settingsEditor.locator(":scope > summary"));
    await settingsEditor.locator(":scope > summary").click();
    await revealFor(settings.locator(":scope > summary"));
    await settings.locator(":scope > summary").click();
    await expect(edit).toHaveCount(1);
    await expect(edit.getByLabel("Nazwa cyklu")).toBeHidden();

    await openCourseMeetingOptions(f.staff, 3);
    const editor = await openCourseSection(
        thirdMeeting,
        "Zmień termin lub miejsce",
      ),
      options = courseSection(thirdMeeting, "Opcje spotkania"),
      meetingForm = thirdMeeting.getByRole("form", {
        name: "Termin spotkania 3",
        exact: true,
        includeHidden: true,
      });
    await revealFor(
      meetingForm.getByLabel("Dokładne miejsce zbiórki po przyjęciu"),
    );
    await meetingForm
      .getByLabel("Dokładne miejsce zbiórki po przyjęciu")
      .fill("ZACHOWANA FIKCYJNA ZBIÓRKA");
    await revealFor(meetingForm.getByLabel("Powód zmiany dla opiekuna"));
    await meetingForm
      .getByLabel("Powód zmiany dla opiekuna")
      .fill("Zachowaj tekst przy zwijaniu spotkania");
    await revealFor(editor.locator(":scope > summary"));
    await editor.locator(":scope > summary").click();
    await revealFor(options.locator(":scope > summary"));
    await options.locator(":scope > summary").click();
    await revealFor(thirdSummary);
    await thirdSummary.click();
    await expect(meetingForm).toHaveCount(1);
    await expect(
      meetingForm.getByLabel("Powód zmiany dla opiekuna"),
    ).toBeHidden();
    await openCourseMeeting(f.staff, 1);
    await openCourseMeetingOptions(f.staff, 3);
    await openCourseSection(thirdMeeting, "Zmień termin lub miejsce");
    await expect(
      meetingForm.getByLabel("Dokładne miejsce zbiórki po przyjęciu"),
    ).toHaveValue("ZACHOWANA FIKCYJNA ZBIÓRKA");
    await expect(meetingForm.locator('[name="expected_version"]')).toHaveValue(
      "1",
    );

    // Another form refreshes the same server page while the settings editor
    // keeps its unsaved text and its original expected version.
    const command = await openCourseCommand(f.staff),
      commandSection = courseSection(settings, "Zmień status cyklu");
    await revealFor(command.getByRole("combobox", { includeHidden: true }));
    await command
      .getByRole("combobox", { includeHidden: true })
      .selectOption("close");
    await submitThenCollapse(
      f.staff,
      command.getByRole("button", {
        includeHidden: true,
        name: "Zapisz zmianę",
        exact: true,
      }),
      [commandSection, settings],
      async (remaining) => {
        await expect(command.locator('[name="expected_version"]')).toHaveValue(
          "3",
          { timeout: remaining() },
        );
      },
    );
    await expectCourseSectionOpen(settings, true);
    await expectCourseSectionOpen(commandSection, true);
    await expect(command.getByRole("status")).toBeVisible();
    await expect(
      f.staff.getByText("Zapisy zamknięte", { exact: true }),
    ).toBeVisible();
    await expect(edit.getByLabel("Nazwa cyklu")).toHaveValue(draftTitle);
    await expect(edit.getByLabel("Liczba psów z opiekunami")).toHaveValue("4");
    await expect(edit.locator('[name="expected_version"]')).toHaveValue("2");
    await revealFor(settings.locator(":scope > summary"));
    await settings.locator(":scope > summary").click();

    await submitThenCollapse(
      f.staff,
      meetingForm.getByRole("button", {
        includeHidden: true,
        name: "Zapisz termin i zbiórkę",
        exact: true,
      }),
      [editor, options, thirdDisclosure],
      async (remaining) => {
        await expect(
          meetingForm.locator('[name="expected_version"]'),
        ).toHaveValue("2", { timeout: remaining() });
      },
    );
    for (const details of [thirdDisclosure, options, editor])
      await expectCourseSectionOpen(details, true);
    await expect(meetingForm.getByRole("status")).toBeVisible();
    await expect(
      thirdMeeting
        .locator("p")
        .filter({ hasText: "ZACHOWANA FIKCYJNA ZBIÓRKA" }),
    ).toBeVisible();
    await expectCourseSectionOpen(settings, false);
    await expect(edit.getByLabel("Nazwa cyklu")).toHaveValue(draftTitle);
    await expect(edit.locator('[name="expected_version"]')).toHaveValue("2");
    await revealFor(thirdSummary);
    await thirdSummary.click();

    await openCourseSettings(f.staff);
    await submitThenCollapse(
      f.staff,
      edit.getByRole("button", {
        includeHidden: true,
        name: "Zapisz ustawienia cyklu",
        exact: true,
      }),
      [settingsEditor, settings],
      async (remaining) => {
        await expect(edit.getByRole("alert")).toContainText(
          "Kurs zmienił się",
          { timeout: remaining() },
        );
      },
    );
    for (const details of [settings, settingsEditor])
      await expectCourseSectionOpen(details, true);
    await expect(edit.getByRole("alert")).toBeFocused();
    await expect(edit.getByLabel("Nazwa cyklu")).toHaveValue(draftTitle);
    await expect(edit.getByLabel("Liczba psów z opiekunami")).toHaveValue("4");
    await expect(edit.getByLabel("Powód zmiany ustawień")).toHaveValue(
      "Zachowaj powód i wersję szkicu",
    );
    await expect(edit.locator('[name="expected_version"]')).toHaveValue("2");
    await expectCourseSectionOpen(thirdDisclosure, false);

    await openCourseSection(f.staff, "Historia kursu");
    await expect(history.locator("ol > li").first()).toBeVisible();
    expect(
      await checked(
        f.db
          .from("courses")
          .select("title,version")
          .eq("id", cycle.id)
          .single(),
      ),
    ).toMatchObject({ title: "Kurs zaleceń — próba lokalna", version: 4 });
    await f.guardian.goto(
      `/app/courses/${cycle.id}?enrollment=${cycle.enrollment}`,
    );
    await expect(f.guardian.locator("[data-course-admin]")).toHaveCount(0);
    await expect(f.guardian.locator("[data-course-meeting]")).toHaveCount(5);
    await expect(f.guardian.locator("[data-course-meeting][open]")).toHaveCount(
      1,
    );
    for (const name of [
      "Ustawienia cyklu",
      "Zmiana kursu",
      "Termin spotkania 3",
    ])
      await expect(
        f.guardian.getByRole("form", {
          includeHidden: true,
          name,
          exact: true,
        }),
      ).toHaveCount(0);
    await openCourseMeeting(f.guardian, 3);
    await expect(f.guardian.locator("[data-course-meeting][open]")).toHaveCount(
      1,
    );
    await expect(
      f.guardian.locator("p").filter({ hasText: "ZACHOWANA FIKCYJNA ZBIÓRKA" }),
    ).toBeVisible();
    await expect(f.guardian.locator("#zgloszenia")).toContainText(f.dogName);
    // The guardian calendar resolves the exact meeting through guardian RLS,
    // rather than borrowing staff metadata or inferring it from a title.
    const selected = await checked(
      f.ownerDb
        .from("course_sessions")
        .select("id,starts_at")
        .eq("id", cycle.sessions[2].id)
        .single(),
    );
    if (!selected?.starts_at) throw new Error("Missing calendar meeting");
    const date = new Intl.DateTimeFormat("sv-SE", {
      timeZone: "Europe/Warsaw",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date(selected.starts_at));
    await f.guardian.goto(`/app/calendar?date=${date}&view=week`);
    const calendarLink = f.guardian.locator(
      `a[href="/app/courses/${cycle.id}#spotkanie-${selected.id}"]`,
    );
    await expect(calendarLink).toBeVisible();
    await calendarLink.click();
    await expectCourseSectionOpen(
      f.guardian.locator("#spotkanie-3 > details"),
      true,
    );
    await expect(f.guardian.locator("[data-course-meeting][open]")).toHaveCount(
      1,
    );
  } finally {
    await sql.close();
    try {
      await removeCourseCare(f.db, [f.dog], courses);
    } finally {
      await f.dispose();
    }
  }
});
