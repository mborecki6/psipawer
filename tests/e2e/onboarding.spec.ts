import { expect, type Page } from "@playwright/test";
import {
  test,
  account,
  checked,
  disposeCareFixtures,
  localClients,
  login,
} from "./local-fixtures";

test.use({ trace: "off" });

async function signIn(page: Page, user: { email: string; password: string }) {
  await page.goto("/login");
  await page.getByLabel("Twój e-mail").fill(user.email);
  await page.getByLabel("Hasło", { exact: true }).fill(user.password);
  await page.getByRole("button", { name: "Zaloguj się", exact: true }).click();
}

async function fits(page: Page) {
  await expect
    .poll(() =>
      page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    )
    .toBe(true);
}

async function singleOnboarding(page: Page) {
  await expect(page.locator("[data-step]")).toHaveCount(1);
  await expect(page.locator("header")).toHaveCount(1);
  await expect(page.locator("main")).toHaveCount(1);
  await expect(page.locator("h1")).toHaveCount(1);
  await expect(
    page.getByRole("img", { name: "Psi Pawer", exact: true }),
  ).toHaveCount(1);
}

test("new guardian completes an accessible three-step start and can edit without losing access", async ({
  page,
  baseURL,
}, testInfo) => {
  test.setTimeout(180000);
  const { db } = localClients(baseURL);
  const users: string[] = [];
  try {
    const user = await account(db, users, "client", { onboarding: "required" });
    await checked(
      db.from("profiles").update({ phone: null }).eq("id", user.id),
    );
    await signIn(page, user);
    await expect(page).toHaveURL(/\/complete-profile$/);
    await page.getByLabel("Telefon", { exact: true }).fill("000 000 000");
    await page.getByRole("button", { name: "Zapisz i przejdź dalej" }).click();
    await expect(page).toHaveURL(/\/onboarding$/);
    await expect(
      page.getByRole("heading", { name: "Zacznijmy od Was." }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Hasło i konto", exact: true }),
    ).toHaveAttribute("href", "/account/security");

    async function screenshots(
      stage: string,
      photograph: string,
      height: number,
    ) {
      for (const width of [320, 390, 1440]) {
        await page.setViewportSize({ width, height: width < 800 ? 844 : 1000 });
        await page.evaluate(() => {
          window.scrollTo(0, 0);
          return new Promise<void>((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
          );
        });
        await fits(page);
        await singleOnboarding(page);
        const photo = page.locator("aside img");
        await expect(photo).toHaveAttribute("src", new RegExp(photograph));
        await expect
          .poll(() =>
            photo.evaluate(
              (image: HTMLImageElement) =>
                image.complete && image.naturalWidth > 0,
            ),
          )
          .toBe(true);
        if (width < 800)
          expect(
            Math.round((await page.locator("aside").boundingBox())!.height),
          ).toBe(height);
        await page.screenshot({
          path: testInfo.outputPath(`${stage}-${width}.png`),
          fullPage: true,
        });
        if (stage === "plan" && width === 1440)
          await page.screenshot({
            path: testInfo.outputPath("plan-viewport-1440.png"),
            fullPage: false,
          });
      }
    }
    await screenshots("welcome", "asia-outdoors-clean", 190);
    await page
      .getByRole("button", { name: "Poznajmy się", exact: true })
      .focus();
    await page.keyboard.press("Enter");
    await expect(
      page.getByRole("heading", {
        name: "Kto jest po drugiej stronie smyczy?",
      }),
    ).toBeFocused();
    await screenshots("dog", "training-reward-clean", 280);
    await page.getByRole("button", { name: "Dalej", exact: true }).click();
    await expect(page.locator("main").getByRole("alert")).toContainText(
      "Wybierz etap życia psa",
    );
    await expect(page.locator('input[name="age"]').first()).toBeFocused();
    await page.getByLabel("Jak ma na imię?", { exact: false }).fill("Kluska");
    await page
      .getByRole("radio", {
        name: "Jeszcze nie wiem Ustalimy później",
        exact: true,
      })
      .focus();
    await page.keyboard.press("Space");
    await page.getByRole("button", { name: "Dalej", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "Co chcesz teraz ułatwić?" }),
    ).toBeFocused();
    await screenshots("goal", "training-play-clean", 240);
    await page
      .getByRole("radio", { name: "Pomóżcie mi wybrać", exact: true })
      .check();
    await page
      .getByLabel("Co chcesz opowiedzieć Asi?", { exact: false })
      .fill("Prywatny temat do rozmowy.");
    await page.getByRole("button", { name: "Dalej", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "Jak chcecie zacząć?" }),
    ).toBeFocused();
    await screenshots("style", "training-walk-clean", 180);
    await page
      .getByRole("radio", {
        name: "Jeszcze nie wiem Chcę poznać możliwości",
        exact: true,
      })
      .check();
    await page
      .getByRole("button", { name: "Przygotuj mój start", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "Wasz start, Kluska." }),
    ).toBeVisible();
    await screenshots("plan", "asia-outdoors-clean", 190);
    await expect(
      page.getByRole("link", { name: "Zobacz ofertę", exact: true }),
    ).toHaveAttribute("href", "/app/services");
    await expect(
      page.getByText("Nie jest diagnozą", { exact: false }),
    ).toBeVisible();
    const completed = await checked(
      db
        .from("guardian_onboarding")
        .select("completed_at,answers")
        .eq("guardian_id", user.id)
        .single(),
    );
    expect(completed?.completed_at).toBeTruthy();
    expect(completed?.answers).toMatchObject({
      age: "unknown",
      goal: "unknown",
      format: "unknown",
    });
    expect(
      await checked(db.from("dogs").select("id").eq("guardian_id", user.id)),
    ).toEqual([]);

    await page
      .getByRole("link", { name: "Przejdź do mojego panelu", exact: true })
      .click();
    await expect(page).toHaveURL(/\/app$/);
    await expect(
      page.getByRole("region", { name: "Twój pierwszy krok" }),
    ).toBeVisible();
    await expect(
      page.getByText("Prywatny temat do rozmowy.", { exact: false }),
    ).toHaveCount(0);
    await page.goto("/onboarding?edit=1");
    await expect(
      page.getByLabel("Jak ma na imię?", { exact: false }),
    ).toHaveValue("Kluska");
    await page
      .getByRole("radio", { name: "Senior Własne tempo", exact: true })
      .check();
    await page
      .getByRole("button", { name: "Zapisz i dokończ później", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "Wasz początek poczeka." }),
    ).toBeVisible();
    await page.goto("/app/services");
    await expect(page).toHaveURL(/\/app\/services$/);
    const edited = await checked(
      db
        .from("guardian_onboarding")
        .select("completed_at,paused,answers")
        .eq("guardian_id", user.id)
        .single(),
    );
    expect(edited?.completed_at).toBe(completed?.completed_at);
    expect(edited?.paused).toBe(true);
    expect(edited?.answers).toMatchObject({ age: "senior" });
    await page.goto("/onboarding?edit=1");
    await page
      .getByRole("button", { name: "Wznów wprowadzenie", exact: true })
      .click();
    await page.getByRole("button", { name: "Dalej", exact: true }).click();
    await page
      .getByRole("radio", { name: "Spokojniejsze spacery", exact: true })
      .check();
    await page.getByRole("button", { name: "Dalej", exact: true }).click();
    await page
      .getByRole("radio", {
        name: "W grupie Wspólne zajęcia i nowe doświadczenia",
        exact: true,
      })
      .check();
    await page.getByLabel("Nasz rytm", { exact: false }).selectOption("short");
    await page
      .getByRole("button", { name: "Przygotuj mój start", exact: true })
      .click();
    await expect(
      page.getByRole("link", { name: "Zobacz grupowe", exact: true }),
    ).toHaveAttribute("href", "/app/services?category=group");
    await expect(
      page.getByText("Na teraz wystarczy jeden krok.", { exact: false }),
    ).toBeVisible();
    await expect(
      page.getByText("obecnym tempie", { exact: false }),
    ).toBeVisible();
    await page
      .getByRole("link", { name: "Zobacz grupowe", exact: true })
      .click();
    await expect(page).toHaveURL(/\/app\/services\?category=group$/);
  } finally {
    await disposeCareFixtures(db, users, []);
  }
});

test("pause survives a second device, failed save keeps answers and stale revision cannot overwrite", async ({
  page,
  browser,
  baseURL,
}) => {
  const { db } = localClients(baseURL);
  const users: string[] = [];
  const contexts = [];
  try {
    const user = await account(db, users, "client", { onboarding: "required" });
    await signIn(page, user);
    await expect(page).toHaveURL(/\/onboarding$/);
    await page
      .getByRole("button", { name: "Poznajmy się", exact: true })
      .click();
    await page.getByLabel("Jak ma na imię?", { exact: false }).fill("Kluska");
    await page
      .getByRole("radio", {
        name: "Dorosły pies Nasza codzienność",
        exact: true,
      })
      .check();

    let releaseFailure = () => {};
    let actionSeen = false;
    const failedRequest = new Promise<void>((resolve) => {
      releaseFailure = resolve;
    });
    await page.route("**/onboarding", async (route) => {
      if (
        route.request().method() === "POST" &&
        route.request().headers()["next-action"]
      ) {
        actionSeen = true;
        await failedRequest;
        await route.abort("failed");
      } else await route.continue();
    });
    await page.getByRole("button", { name: "Dalej", exact: true }).click();
    try {
      await expect.poll(() => actionSeen).toBe(true);
      await expect(
        page.getByRole("button", { name: "Zapisuję…", exact: true }),
      ).toBeDisabled();
      await expect(
        page.getByLabel("Jak ma na imię?", { exact: false }),
      ).toBeDisabled();
      await expect(
        page.getByRole("button", { name: "Wstecz", exact: true }),
      ).toBeDisabled();
    } finally {
      releaseFailure();
    }
    await expect(page.locator("main").getByRole("alert")).toContainText(
      "Nie udało się potwierdzić zapisu",
    );
    await expect(
      page.getByLabel("Jak ma na imię?", { exact: false }),
    ).toHaveValue("Kluska");
    await expect(
      page.getByRole("radio", {
        name: "Dorosły pies Nasza codzienność",
        exact: true,
      }),
    ).toBeChecked();
    expect(
      await checked(
        db
          .from("guardian_onboarding")
          .select("current_step,completed_at")
          .eq("guardian_id", user.id)
          .single(),
      ),
    ).toMatchObject({ current_step: "dog", completed_at: null });
    await page.unroute("**/onboarding");
    await page.getByRole("button", { name: "Dalej", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "Co chcesz teraz ułatwić?" }),
    ).toBeVisible();

    const otherContext = await browser.newContext({
      storageState: await page.context().storageState(),
    });
    contexts.push(otherContext);
    const other = await otherContext.newPage();
    await other.goto(`${baseURL}/onboarding`);
    await expect(
      other.getByRole("heading", { name: "Co chcesz teraz ułatwić?" }),
    ).toBeVisible();
    await page
      .getByRole("radio", { name: "Codzienność w domu", exact: true })
      .check();
    await page
      .getByLabel("Co chcesz opowiedzieć Asi?", { exact: false })
      .fill("Nowsza prywatna notatka.");
    await page
      .getByRole("button", { name: "Zapisz i dokończ później", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "Wasz początek poczeka." }),
    ).toBeVisible();
    await other
      .getByRole("radio", { name: "Spokojniejsze spacery", exact: true })
      .check();
    await other
      .getByLabel("Co chcesz opowiedzieć Asi?", { exact: false })
      .fill("Starsza notatka nie może nadpisać.");
    await other.getByRole("button", { name: "Dalej", exact: true }).click();
    await expect(other.locator("main").getByRole("alert")).toContainText(
      "innym oknie",
    );
    await expect(
      other.getByRole("button", { name: "Dalej", exact: true }),
    ).toBeDisabled();
    await expect(
      other.getByLabel("Co chcesz opowiedzieć Asi?", { exact: false }),
    ).toHaveValue("Starsza notatka nie może nadpisać.");
    await other
      .getByRole("button", { name: "Wczytaj aktualne odpowiedzi", exact: true })
      .click();
    await expect(
      other.getByRole("heading", { name: "Wasz początek poczeka." }),
    ).toBeVisible();
    await other
      .getByRole("button", { name: "Wznów wprowadzenie", exact: true })
      .click();
    await expect(
      other.getByRole("radio", { name: "Codzienność w domu", exact: true }),
    ).toBeChecked();
    await expect(
      other.getByLabel("Co chcesz opowiedzieć Asi?", { exact: false }),
    ).toHaveValue("Nowsza prywatna notatka.");
    await other.goto(`${baseURL}/app/finance`);
    await expect(other).toHaveURL(/\/onboarding$/);
    await other.goto(`${baseURL}/account/security`);
    await expect(other).toHaveURL(/\/account\/security$/);
    await other.goto(`${baseURL}/onboarding`);
    await other.getByRole("button", { name: "Wyloguj", exact: true }).click();
    await expect(other).toHaveURL(/\/login$/);
  } finally {
    for (const context of contexts) await context.close();
    await disposeCareFixtures(db, users, []);
  }
});

test("existing guardians and staff bypass the brief while a draft plan never counts as completion", async ({
  page,
  baseURL,
}) => {
  const { db } = localClients(baseURL);
  const users: string[] = [];
  try {
    const legacy = await account(db, users, "client", { onboarding: "legacy" });
    const admin = await account(db, users, "admin", { onboarding: "required" });
    for (const [user, role, destination] of [
      [legacy, "client", "/app"],
      [admin, "admin", "/admin"],
    ] as const) {
      await page.context().clearCookies();
      await login(page, user, role);
      await page.goto("/onboarding");
      await expect(page).toHaveURL(new RegExp(`${destination}$`));
      await expect(
        page.getByRole("heading", { name: "Zacznijmy od Was." }),
      ).toHaveCount(0);
    }
    const draft = await account(db, users, "client", {
      onboarding: "required",
    });
    await checked(
      db
        .from("guardian_onboarding")
        .update({ current_step: "plan" })
        .eq("guardian_id", draft.id),
    );
    await page.context().clearCookies();
    await signIn(page, draft);
    await expect(page).toHaveURL(/\/onboarding$/);
    await expect(
      page.getByRole("heading", {
        name: "Kto jest po drugiej stronie smyczy?",
      }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Przejdź do mojego panelu", exact: true }),
    ).toHaveCount(0);
    await page.goto("/app/dogs/new");
    await expect(page).toHaveURL(/\/onboarding$/);
  } finally {
    await disposeCareFixtures(db, users, []);
  }
});
