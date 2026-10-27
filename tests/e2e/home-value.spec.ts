import { expect } from "@playwright/test";
import {
  test,
  checked,
  cleanupSteps,
  freeCalendarStart,
} from "./local-fixtures";
import { careEditor, careFixture, publishCarePlan } from "./care-journey";

test.use({ trace: "off" });

test("home offers published guidance and a real new activity while money stays in finance", async ({
  browser,
  baseURL,
}, info) => {
  const f = await careFixture(browser, baseURL);
  const walks: string[] = [];
  const suffix = crypto.randomUUID().slice(0, 8);
  const ownTitle = `Już zapisany spacer ${suffix}`,
    offerTitle = `Nowy wspólny spacer ${suffix}`;
  const planTitle = `Nasz plan na spokojny krok ${suffix}`,
    privateTitle = `PRYWATNY SZKIC ${suffix}`;
  const unexpected: string[] = [],
    errors: string[] = [];
  try {
    await checked(
      f.db.from("dogs").update({ status: "approved" }).eq("id", f.dog),
    );
    await publishCarePlan(
      f.staff,
      planTitle,
      "Fikcyjne zalecenie z lokalnego testu: wróć do ustalonego planu.",
    );
    const published = await checked(
      f.ownerDb
        .from("care_plan_versions")
        .select("id")
        .eq("dog_id", f.dog)
        .single(),
    );
    const draft = await careEditor(f.staff);
    await draft.getByLabel("Tytuł planu", { exact: true }).fill(privateTitle);
    await draft
      .getByLabel("Zalecenia dla opiekuna", { exact: true })
      .fill("Prywatny szkic, który nie może pojawić się na starcie opiekuna.");
    await draft
      .getByRole("button", { name: "Zapisz szkic", exact: true })
      .click();
    await expect(draft.getByRole("status")).toContainText("Szkic zapisany");
    let after = Date.now() + 3600000;
    for (const title of [ownTitle, offerTitle]) {
      const start = await freeCalendarStart(f.db, {
        after,
        before: after + 2 * 86400000,
        durationMinutes: 60,
      });
      after = Date.parse(start) + 2 * 3600000;
      const id = crypto.randomUUID();
      walks.push(id);
      await checked(
        f.db.from("walks").insert({
          id,
          leader_id: f.admin.id,
          starts_at: start,
          duration_minutes: 60,
          public_location: "Fikcyjny park lokalnego testu",
          type: title,
          price_cents: 10000,
          capacity: 4,
          booking_mode: "approval",
          status: "open",
        }),
      );
      await checked(
        f.db.from("walk_private_details").insert({
          walk_id: id,
          exact_location: "Fikcyjna zbiórka",
        }),
      );
    }
    const registration = crypto.randomUUID();
    await checked(
      f.db.from("walk_registrations").insert({
        id: registration,
        walk_id: walks[0],
        dog_id: f.dog,
        status: "accepted",
        payment_status: "due",
        attendance: "pending",
      }),
    );
    f.guardian.on("pageerror", (error) =>
      errors.push(`${error.name}: ${error.message}`),
    );
    await f.guardianContext.route("**/*", async (route) => {
      const request = route.request(),
        url = new URL(request.url());
      if (
        !["localhost", "127.0.0.1"].includes(url.hostname) ||
        !["GET", "HEAD", "OPTIONS"].includes(request.method())
      ) {
        unexpected.push(request.method());
        await route.abort();
        return;
      }
      await route.continue();
    });
    for (const width of [320, 390, 768, 1440]) {
      await f.guardian.setViewportSize({ width, height: 900 });
      await f.guardian.goto("/app");
      await f.guardian.waitForLoadState("networkidle");
      const main = f.guardian.locator("main");
      await expect(
        main.getByRole("heading", { name: "Zalecenia od Asi", exact: true }),
      ).toBeVisible();
      await expect(main.getByText(planTitle, { exact: true })).toBeVisible();
      await expect(main.getByText(privateTitle, { exact: true })).toHaveCount(
        0,
      );
      expect(await main.innerText()).not.toMatch(
        /Do zapłaty:|Do zwrotu:|\bzł\b|Sprawdź rozliczenie|Wasze pakiety i rozliczenia/,
      );
      const suggestions = main
        .getByRole("heading", {
          name: "Pomysł na kolejne spotkanie",
          exact: true,
        })
        .locator("xpath=ancestor::article[1]");
      await expect(
        suggestions.getByRole("heading", { name: offerTitle, exact: true }),
      ).toBeVisible();
      await expect(
        suggestions.getByRole("heading", { name: ownTitle, exact: true }),
      ).toHaveCount(0);
      await expect(
        f.guardian.getByRole("button", { name: /Notatka głosowa/ }),
      ).toHaveCount(0);
      expect(
        await f.guardian.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1,
        ),
      ).toBe(true);
      if (width === 390 || width === 1440)
        await f.guardian.screenshot({
          path: info.outputPath(`home-value-${width}.png`),
          fullPage: true,
        });
    }
    const planLink = f.guardian.locator(
      `main a[href="/app/dogs/${f.dog}/care?plan=${published!.id}"]`,
    );
    await planLink.focus();
    await f.guardian.keyboard.press("Enter");
    await expect(f.guardian).toHaveURL(new RegExp(`plan=${published!.id}`));
    await f.guardian.waitForLoadState("networkidle");
    await expect(f.guardian.locator("main")).toContainText(planTitle);
    await expect(f.guardian.locator("main")).not.toContainText(privateTitle);
    await f.guardian.goto("/app");
    await f.guardian.waitForLoadState("networkidle");
    await f.guardian
      .getByRole("heading", { name: offerTitle, exact: true })
      .locator("..")
      .getByRole("link", { name: "Sprawdź zajęcia →", exact: true })
      .click();
    await expect(f.guardian).toHaveURL(new RegExp(`/app/walks/${walks[1]}$`));
    await f.guardian.waitForLoadState("networkidle");
    await f.guardian.goto(`/app/finance?charge=registration-${registration}`);
    await f.guardian.waitForLoadState("networkidle");
    const charge = f.guardian.locator(`#charge-registration-${registration}`);
    await expect(charge).toContainText(ownTitle);
    await expect(charge).toContainText("100,00");
    await expect(charge.getByRole("button", { name: /wpłatę/ })).toHaveCount(0);
    expect(
      await checked(f.db.from("payments").select("id").eq("dog_id", f.dog)),
    ).toEqual([]);
    expect(errors).toEqual([]);
    expect(unexpected).toEqual([]);
  } finally {
    await cleanupSteps(
      async () => {
        if (walks.length)
          await checked(f.db.from("walks").delete().in("id", walks));
      },
      () => f.dispose(),
    );
  }
});
