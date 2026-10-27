import { revealFor } from "./details-ui";
import { expect } from "@playwright/test";
import {
  test,
  account,
  checked,
  cleanupSteps,
  disposeCareFixtures,
  localClients,
  login,
} from "./local-fixtures";

for (const committed of [false, true]) {
  test(`dog form retains values and retries once after ${committed ? "lost confirmation" : "unsent request"}`, async ({
    browser,
    baseURL,
  }) => {
    const { db } = localClients(baseURL);
    const users: string[] = [],
      dogs: string[] = [];
    const context = await browser.newContext({
      baseURL,
      viewport: { width: 390, height: 844 },
    });
    const page = await context.newPage();
    const name = `Retry ${crypto.randomUUID()}`;
    const fields = {
      name,
      breed: "Typ próbny",
      approximate_age: "3 lata",
      sex: "female",
      weight_kg: "12",
      color: "rudy",
    };
    let owner: Awaited<ReturnType<typeof account>> | undefined;
    const saved = async () =>
      checked(
        db
          .from("dogs")
          .select("id,breed")
          .eq("guardian_id", owner!.id)
          .eq("name", name),
      );
    try {
      owner = await account(db, users, "client");
      await login(page, owner, "client");
      await page.goto("/app/dogs/new");
      for (const [key, value] of Object.entries(fields)) {
        const input = page.locator(`[name="${key}"]`);
        if (key === "sex") {
          await revealFor(input);
          await input.selectOption(value);
        } else {
          await revealFor(input);
          await input.fill(value);
        }
      }
      const requestId = await page
        .locator('[name="creation_request_id"]')
        .inputValue();
      const url = `${baseURL}/app/dogs/new`;
      await page.route(url, async (route) => {
        if (
          route.request().method() !== "POST" ||
          !route.request().headers()["next-action"]
        )
          return route.continue();
        if (committed) {
          const response = await route.fetch({ maxRedirects: 0 });
          expect(response.status()).toBe(200);
          const rows = await saved();
          expect(rows).toHaveLength(1);
          dogs.push(rows![0].id);
        }
        await route.abort("failed");
      });
      await revealFor(
        page.getByRole("button", {
          includeHidden: true,
          name: "Dodaj psa",
          exact: true,
        }),
      );
      await page
        .getByRole("button", {
          includeHidden: true,
          name: "Dodaj psa",
          exact: true,
        })
        .click();
      await expect(page.locator("form").getByRole("alert")).toContainText(
        "Nie udało się potwierdzić zapisu",
      );
      await page.unroute(url);
      expect(await saved()).toHaveLength(committed ? 1 : 0);
      for (const [key, value] of Object.entries(fields))
        await expect(page.locator(`[name="${key}"]`)).toHaveValue(value);
      await expect(page.locator('[name="creation_request_id"]')).toHaveValue(
        requestId,
      );
      await expect(page.locator("form").getByRole("alert")).toBeFocused();
      await page.screenshot({
        path: test.info().outputPath("retained-form.png"),
      });
      await expect(
        page.getByRole("button", {
          includeHidden: true,
          name: "Spróbuj ponownie",
          exact: true,
        }),
      ).toHaveCount(0);

      if (committed) {
        await revealFor(page.getByLabel("Rasa / typ", { exact: true }));
        await page
          .getByLabel("Rasa / typ", { exact: true })
          .fill("Zmienione po utracie odpowiedzi");
        await revealFor(
          page.getByRole("button", {
            includeHidden: true,
            name: "Dodaj psa",
            exact: true,
          }),
        );
        await page
          .getByRole("button", {
            includeHidden: true,
            name: "Dodaj psa",
            exact: true,
          })
          .click();
        await expect(page.locator("form").getByRole("alert")).toContainText(
          "już zapisany z innymi danymi",
        );
        expect(await saved()).toEqual([{ id: dogs[0], breed: fields.breed }]);
        await expect(page.locator('[name="creation_request_id"]')).toHaveValue(
          requestId,
        );
        await revealFor(page.getByLabel("Rasa / typ", { exact: true }));
        await page.getByLabel("Rasa / typ", { exact: true }).fill(fields.breed);
      }
      await revealFor(
        page.getByRole("button", {
          includeHidden: true,
          name: "Dodaj psa",
          exact: true,
        }),
      );
      await page
        .getByRole("button", {
          includeHidden: true,
          name: "Dodaj psa",
          exact: true,
        })
        .click();
      await expect(page).toHaveURL(/\/app\/dogs\/[a-f0-9-]+\?saved=1$/);
      const rows = await saved();
      expect(rows).toHaveLength(1);
      if (!dogs.includes(rows![0].id)) dogs.push(rows![0].id);
      if (committed) {
        await revealFor(page.getByLabel("Rasa / typ", { exact: true }));
        await page
          .getByLabel("Rasa / typ", { exact: true })
          .fill("Zapisana edycja");
        await revealFor(
          page.getByRole("button", {
            includeHidden: true,
            name: "Zapisz profil",
            exact: true,
          }),
        );
        await page
          .getByRole("button", {
            includeHidden: true,
            name: "Zapisz profil",
            exact: true,
          })
          .click();
        await expect(
          page.getByLabel("Rasa / typ", { exact: true }),
        ).toHaveValue("Zapisana edycja");
        await expect
          .poll(saved)
          .toEqual([{ id: dogs[0], breed: "Zapisana edycja" }]);
      }
    } finally {
      await cleanupSteps(
        () => context.close(),
        async () => {
          if (owner) {
            const rows = await checked(
              db.from("dogs").select("id").eq("guardian_id", owner.id),
            );
            for (const row of rows || [])
              if (!dogs.includes(row.id)) dogs.push(row.id);
          }
          await disposeCareFixtures(db, users, dogs);
        },
      );
    }
  });
}
