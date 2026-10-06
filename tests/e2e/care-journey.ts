import { expect, type Browser, type Page } from "@playwright/test";
import {
  account,
  checked,
  disposeCareFixtures,
  localClients,
  login,
} from "./local-fixtures";

export const careDay = (offset: number) =>
  new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Europe/Warsaw",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(Date.now() + offset * 86400000));

export async function careFixture(
  browser: Browser,
  baseURL: string | undefined,
) {
  const { db, client } = localClients(baseURL);
  const users: string[] = [],
    dogs: string[] = [],
    templates: string[] = [];
  const staffContext = await browser.newContext({
    baseURL,
    viewport: { width: 1440, height: 1000 },
  });
  const guardianContext = await browser.newContext({
    baseURL,
    viewport: { width: 390, height: 844 },
  });
  const staff = await staffContext.newPage(),
    guardian = await guardianContext.newPage();
  let disposing = false;
  const lifecycle = (kind: string, role: "admin" | "client" | "browser") => {
    if (!disposing)
      console.warn(
        JSON.stringify({ event: "local_browser_lifecycle", kind, role }),
      );
  };
  const disconnected = () => lifecycle("disconnected", "browser");
  browser.on("disconnected", disconnected);
  for (const [page, role] of [
    [staff, "admin"],
    [guardian, "client"],
  ] as const) {
    page.on("crash", () => lifecycle("crash", role));
    page.on("close", () => lifecycle("page_closed", role));
  }
  staffContext.on("close", () => lifecycle("context_closed", "admin"));
  guardianContext.on("close", () => lifecycle("context_closed", "client"));
  const staffDb = client(),
    ownerDb = client(),
    outsiderDb = client();
  async function dispose() {
    disposing = true;
    browser.off("disconnected", disconnected);
    await staffContext.close();
    await guardianContext.close();
    await Promise.all([
      staffDb.auth.signOut(),
      ownerDb.auth.signOut(),
      outsiderDb.auth.signOut(),
    ]);
    if (templates.length)
      await checked(db.from("care_templates").delete().in("id", templates));
    await disposeCareFixtures(db, users, dogs);
  }
  try {
    const admin = await account(db, users, "admin");
    const owner = await account(db, users, "client");
    const outsider = await account(db, users, "client");
    for (const [api, user] of [
      [staffDb, admin],
      [ownerDb, owner],
      [outsiderDb, outsider],
    ] as const)
      await checked(
        api.auth.signInWithPassword({
          email: user.email,
          password: user.password,
        }),
      );
    await login(staff, admin, "admin");
    await login(guardian, owner, "client");
    const dogName = `Figa kontakt ${crypto.randomUUID().slice(0, 8)}`;
    await guardian
      .getByRole("link", { name: "Dodaj psa +", exact: true })
      .click();
    await guardian.getByLabel("Imię psa").fill(dogName);
    await guardian
      .getByRole("button", { name: "Dodaj psa", exact: true })
      .click();
    await expect(guardian).toHaveURL(/\/app\/dogs\/[a-f0-9-]+(?:\?saved=1)?$/);
    const dog = new URL(guardian.url()).pathname.split("/").at(-1)!;
    dogs.push(dog);
    await staff.goto(`/admin/dogs/${dog}/care`);
    return {
      db,
      staffDb,
      ownerDb,
      outsiderDb,
      admin,
      owner,
      outsider,
      dog,
      dogName,
      templates,
      staff,
      guardian,
      staffContext,
      guardianContext,
      dispose,
    };
  } catch (error) {
    await dispose();
    throw error;
  }
}

export async function careEditor(page: Page) {
  const disclosure = page.locator("#szkic details");
  if (
    !(await disclosure.evaluate(
      (element) => (element as HTMLDetailsElement).open,
    ))
  )
    await disclosure.locator("summary").click();
  return page.locator("#szkic form");
}

export async function publishCarePlan(
  page: Page,
  title: string,
  body: string,
  due = "",
) {
  const form = await careEditor(page);
  await form.getByLabel("Tytuł planu", { exact: true }).fill(title);
  await form.getByLabel("Zalecenia dla opiekuna", { exact: true }).fill(body);
  await form.getByLabel("Termin kontaktu kontrolnego (opcjonalnie)").fill(due);
  await form.getByRole("button", { name: "Opublikuj dla opiekuna" }).click();
  await expect(form.getByRole("status")).toContainText("Plan opublikowany");
}

export async function careScreenshot(page: Page, path: string, width: number) {
  await page.setViewportSize({ width, height: 900 });
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(
    page.getByText("Wczytuję Twoje psie sprawy.", { exact: true }),
  ).toHaveCount(0);
  await expect(page.locator('form[aria-busy="true"]')).toHaveCount(0);
  await page.evaluate(async () => {
    await document.fonts.ready;
    window.scrollTo({ top: 0, behavior: "instant" });
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => resolve()),
    );
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  ).toBe(true);
  await page.screenshot({ path, fullPage: true, animations: "disabled" });
}
