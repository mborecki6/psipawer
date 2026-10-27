import { expect } from "@playwright/test";
import { LocalPostgres } from "../helpers/local-postgres.mjs";
import { test, checked, login } from "./local-fixtures";
import { careFixture } from "./care-journey";
import { courseFixture, removeCourseCare } from "./course-fixtures";

test("online payment preview is read-only at 100 minus 40, keeps navigation and denies another owner", async ({
  browser,
  baseURL,
}, info) => {
  expect(process.env.TPAY_ENABLED).toBe("false");
  const f = await careFixture(browser, baseURL);
  const sql = await new LocalPostgres().ready();
  const courses: string[] = [];
  const enrollments: string[] = [];
  const otherContext = await browser.newContext({ baseURL });
  const other = await otherContext.newPage();
  const unexpected: string[] = [],
    errors: string[] = [];
  try {
    const cycle = await courseFixture(
      f.db,
      f.staffDb,
      f.ownerDb,
      f.dog,
      courses,
      sql,
    );
    enrollments.push(cycle.enrollment);
    await checked(
      f.staffDb.rpc("record_payment", {
        p_registration: null,
        p_package: null,
        p_consultation: null,
        p_course_enrollment: cycle.enrollment,
        p_amount_cents: 4000,
        p_method: "cash",
        p_note: "Lokalna próba podglądu",
        p_request_id: crypto.randomUUID(),
      }),
    );
    await login(other, f.outsider, "client");
    const snapshot = async () => ({
      balance: await checked(
        f.ownerDb
          .from("course_balances")
          .select("agreed_price_cents,paid_cents,due_cents,status,version")
          .eq("id", cycle.enrollment)
          .single(),
      ),
      payments: await checked(
        f.db
          .from("payments")
          .select("id,amount_cents,status")
          .eq("course_enrollment_id", cycle.enrollment)
          .order("id"),
      ),
      attempts: await checked(
        f.db
          .from("online_payment_attempts")
          .select("id")
          .eq("target_id", cycle.enrollment),
      ),
    });
    const before = await snapshot();
    expect(before.balance).toMatchObject({
      agreed_price_cents: 10000,
      paid_cents: 4000,
      due_cents: 6000,
      status: "accepted",
    });
    for (const context of [f.guardianContext, otherContext]) {
      await context.route("**/*", async (route) => {
        const req = route.request(),
          url = new URL(req.url());
        if (
          !["localhost", "127.0.0.1"].includes(url.hostname) ||
          !["GET", "HEAD", "OPTIONS"].includes(req.method())
        ) {
          unexpected.push(req.method());
          await route.abort();
          return;
        }
        await route.continue();
      });
      context.on("page", (page) =>
        page.on("pageerror", () => errors.push("pageerror")),
      );
    }
    f.guardian.on("pageerror", () => errors.push("pageerror"));
    const path = `/app/payments/new?kind=course&target=${cycle.enrollment}`;
    await f.guardian.goto("/app/finance");
    const link = f.guardian.locator(`a[href="${path}"]`);
    await expect(link).toHaveText("Podgląd płatności online →");
    await link.focus();
    await expect(link).toBeFocused();
    await link.press("Enter");
    await expect(
      f.guardian.getByRole("heading", {
        name: "Podgląd płatności online",
        exact: true,
      }),
    ).toBeVisible();
    const facts = f.guardian.locator(
      'section[aria-labelledby="payment-summary-heading"]',
    );
    for (const [term, amount] of [
      ["Uzgodniona kwota", "100,00"],
      ["Już wpłacono", "40,00"],
      ["Pozostało do zapłaty", "60,00"],
    ]) {
      await expect(
        facts
          .locator("dl > div")
          .filter({ has: f.guardian.getByText(term, { exact: true }) }),
      ).toContainText(amount);
    }
    await expect(facts).toContainText(f.dogName);
    await expect(
      f.guardian.getByText("Płatności online jeszcze niedostępne", {
        exact: true,
      }),
    ).toBeVisible();
    await expect(f.guardian.locator("main form")).toHaveCount(0);
    await expect(
      f.guardian.getByRole("button", {
        name: /Zapłać|Rozpocznij|Przejdź do.*płatności/,
      }),
    ).toHaveCount(0);
    for (const width of [320, 390, 1440]) {
      await f.guardian.setViewportSize({ width, height: 900 });
      expect(
        await f.guardian.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1,
        ),
      ).toBe(true);
      await f.guardian.screenshot({
        path: info.outputPath(`payment-preview-${width}.png`),
        fullPage: true,
      });
    }
    await f.guardian.reload();
    await expect(facts).toContainText("60,00");
    await f.guardian
      .getByRole("link", { name: "Zobacz usługę →", exact: true })
      .click();
    await expect(f.guardian).toHaveURL(
      new RegExp(
        `/app/courses/${cycle.id}\\?enrollment=${cycle.enrollment}#rozliczenie-${cycle.enrollment}$`,
      ),
    );
    await f.guardian.goto(path);
    await f.guardian
      .getByRole("link", { name: "← Rozliczenia", exact: true })
      .click();
    await expect(f.guardian).toHaveURL("/app/finance");
    await other.goto(path);
    await expect(
      other.getByRole("heading", {
        name: "Ta należność nie jest dostępna w podglądzie płatności",
        exact: true,
      }),
    ).toBeVisible();
    await expect(other.locator("main")).not.toContainText(f.dogName);
    await expect(other.locator("main")).not.toContainText("60,00");
    await f.guardian.goto("/app/payments/new?kind=course&target=invalid");
    await expect(
      f.guardian.getByRole("heading", {
        name: "Ta należność nie jest dostępna w podglądzie płatności",
        exact: true,
      }),
    ).toBeVisible();
    expect(await snapshot()).toEqual(before);
    expect(before.attempts).toEqual([]);
    expect(unexpected).toEqual([]);
    expect(errors).toEqual([]);
  } finally {
    await otherContext.close();
    await sql.close();
    try {
      if (enrollments.length)
        await checked(
          f.db
            .from("payments")
            .delete()
            .in("course_enrollment_id", enrollments),
        );
      await removeCourseCare(f.db, [f.dog], courses);
    } finally {
      await f.dispose();
    }
  }
});
