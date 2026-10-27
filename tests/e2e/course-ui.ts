import { expect, type Locator, type Page } from "@playwright/test";

export function courseSection(container: Page | Locator, name: string) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return container
    .locator("summary")
    .filter({ hasText: new RegExp(`^${escaped}$`) })
    .locator("..");
}

export async function expectCourseSectionOpen(details: Locator, open: boolean) {
  await expect
    .poll(() =>
      details.evaluate((element) => (element as HTMLDetailsElement).open),
    )
    .toBe(open);
}

// Deliberately open only the section needed by the current user action. Tests
// of the initial page must assert its collapsed state before using this helper.
export async function openCourseSection(
  container: Page | Locator,
  name: string,
) {
  const details = courseSection(container, name);
  await expect(details).toHaveCount(1);
  if (
    !(await details.evaluate((element) => (element as HTMLDetailsElement).open))
  )
    await details.locator(":scope > summary").click();
  return details;
}

export async function openCourseMeeting(page: Page, ordinal: number) {
  const meeting = page.locator(`#spotkanie-${ordinal}`);
  const details = meeting.locator(":scope > details");
  await expect(details).toHaveCount(1);
  if (
    !(await details.evaluate((element) => (element as HTMLDetailsElement).open))
  )
    await details.locator(":scope > summary").click();
  return meeting;
}

export async function openCourseMeetingOptions(page: Page, ordinal: number) {
  const meeting = await openCourseMeeting(page, ordinal);
  await openCourseSection(meeting, "Opcje spotkania");
  return meeting;
}

export async function openCourseSettings(page: Page) {
  const settings = await openCourseSection(page, "Warunki i ustawienia cyklu");
  await openCourseSection(settings, "Edytuj nazwę i liczbę miejsc");
  return settings.getByRole("form", {
    name: "Ustawienia cyklu",
    exact: true,
    includeHidden: true,
  });
}

export async function openCourseCommand(page: Page) {
  const settings = await openCourseSection(page, "Warunki i ustawienia cyklu");
  await openCourseSection(settings, "Zmień status cyklu");
  return settings.getByRole("form", {
    name: "Zmiana kursu",
    exact: true,
    includeHidden: true,
  });
}
