import { test, expect } from "@playwright/test";
import {
  account,
  checked,
  disposeCareFixtures,
  localClients,
  login,
} from "./local-fixtures";

test.use({ trace: "off" });
test("finance pages preserve complete balances, direct package links and guardian isolation", async ({
  page,
  browser,
  baseURL,
}, testInfo) => {
  const { db, client } = localClients(baseURL);
  const users: string[] = [],
    dogs: string[] = [],
    walks: string[] = [],
    packages: string[] = [];
  const staffContext = await browser.newContext({ baseURL });
  const staffPage = await staffContext.newPage();
  try {
    const staff = await account(db, users, "admin"),
      owner = await account(db, users, "client"),
      other = await account(db, users, "client");
    dogs.push(crypto.randomUUID(), crypto.randomUUID());
    await checked(
      db.from("dogs").insert([
        {
          id: dogs[0],
          guardian_id: owner.id,
          name: "Pies paginacji",
          status: "approved",
        },
        {
          id: dogs[1],
          guardian_id: other.id,
          name: "Prywatny obcy pies",
          status: "approved",
        },
      ]),
    );
    const past = Date.now() - 700 * 86400000;
    const packageRows = Array.from({ length: 31 }, (_, i) => ({
      id: crypto.randomUUID(),
      dog_id: dogs[0],
      name: `Pakiet testowy N${i}End`,
      price_cents: 10000,
      purchased_at: new Date(past - i * 86400000).toISOString(),
    }));
    const foreign = {
      id: crypto.randomUUID(),
      dog_id: dogs[1],
      name: "Prywatny obcy pakiet",
      price_cents: 10000,
      purchased_at: new Date(past).toISOString(),
    };
    packages.push(...packageRows.map((item) => item.id), foreign.id);
    await checked(db.from("packages").insert([...packageRows, foreign]));
    await checked(
      db.from("package_transactions").insert(
        packageRows.map((item) => ({
          package_id: item.id,
          available_delta: 4,
          reason: "Wejścia próbne",
          author_id: staff.id,
        })),
      ),
    );
    const walkRows = Array.from({ length: 31 }, (_, i) => ({
      id: crypto.randomUUID(),
      starts_at: new Date(past + i * 86400000).toISOString(),
      public_location: `Park testowy N${i}End`,
      type: "Spacer próbny",
      price_cents: 10000,
      capacity: 4,
      status: "completed",
      leader_id: staff.id,
    }));
    walks.push(...walkRows.map((item) => item.id));
    await checked(db.from("walks").insert(walkRows));
    const registrations = walkRows.map((item) => ({
      id: crypto.randomUUID(),
      walk_id: item.id,
      dog_id: dogs[0],
      status: "accepted",
      payment_status: "paid",
      attendance: "present",
    }));
    await checked(db.from("walk_registrations").insert(registrations));
    await checked(
      db.from("payments").insert(
        registrations.map((item, i) => ({
          guardian_id: owner.id,
          dog_id: dogs[0],
          registration_id: item.id,
          amount_cents: 10000,
          method: "transfer",
          status: "paid",
          paid_at: walkRows[i].starts_at,
          author_id: staff.id,
          request_id: crypto.randomUUID(),
        })),
      ),
    );
    await page.setViewportSize({ width: 320, height: 900 });
    await login(page, owner, "client");
    await page.goto("/app/finance");
    const summary = page.locator('[aria-label="Podsumowanie rozliczeń"]');
    await expect(summary).toContainText(/3\s*100,00\s*zł/);
    await expect(summary).toContainText("124");
    await expect(page.locator("#finance-due article")).toHaveCount(20);
    await expect(page.locator("#payments article")).toHaveCount(20);
    await expect(page.locator('[id^="package-"]')).toHaveCount(20);
    await expect(
      page.getByText("Prywatny obcy pakiet", { exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Zapisz wpłatę" }),
    ).toHaveCount(0);
    await page
      .getByRole("navigation", { name: "Strony wpłat" })
      .getByRole("link", { name: "Następne" })
      .click();
    await expect(
      page.getByRole("navigation", { name: "Strony wpłat" }),
    ).toContainText("Pozycje 21–31 z 31");
    await expect(page.locator("#payments article")).toHaveCount(11);
    await expect(summary).toContainText(/3\s*100,00\s*zł/);
    await page
      .getByRole("navigation", { name: "Strony należności" })
      .getByRole("link", { name: "Następne" })
      .click();
    await expect(page).toHaveURL(/charges_page=2.*payments_page=2/);
    await expect(page.locator("#finance-due article")).toHaveCount(11);
    await page.goto(
      `/app/finance?package=${packageRows[30].id}#package-${packageRows[30].id}`,
    );
    await expect(
      page.getByRole("heading", { name: "Pakiet testowy N30End", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("navigation", { name: "Strony pakietów" }),
    ).toContainText("strona 2 z 2");
    for (const width of [320, 390, 768, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth > innerWidth + 1,
        ),
      ).toBe(false);
      await page.screenshot({
        path: testInfo.outputPath(`finance-${width}.png`),
        fullPage: true,
      });
      if (width === 320)
        await page
          .getByRole("navigation", { name: "Strony pakietów" })
          .screenshot({
            path: testInfo.outputPath("finance-pager-320.png"),
          });
    }
    await page.goto(`/app/finance?package=${foreign.id}`);
    await expect(page.getByRole("status")).toContainText(
      "Ten pakiet nie jest dostępny",
    );
    await expect(
      page.getByText("Prywatny obcy pakiet", { exact: true }),
    ).toHaveCount(0);
    const ownClient = client();
    await checked(
      ownClient.auth.signInWithPassword({
        email: owner.email,
        password: owner.password,
      }),
    );
    expect(
      await checked(
        ownClient.from("packages").select("id").eq("id", foreign.id),
      ),
    ).toEqual([]);

    await staffPage.setViewportSize({ width: 320, height: 900 });
    await login(staffPage, staff, "admin");
    await staffPage.goto(
      `/admin/finance?filter=due&charge=package-${packageRows[0].id}#charge-package-${packageRows[0].id}`,
    );
    const charge = staffPage.locator(`#charge-package-${packageRows[0].id}`);
    await charge.locator("summary").getByText("Rozlicz należność").click();
    expect(
      await staffPage.evaluate(
        () => document.documentElement.scrollWidth > innerWidth + 1,
      ),
    ).toBe(false);
    await charge.getByRole("button", { name: "Zapisz wpłatę" }).click();
    await expect(charge).toHaveCount(0);
    await expect(staffPage.getByRole("status")).toContainText(
      "Ta należność jest już rozliczona",
    );
    const receipts = await checked(
      db
        .from("payments")
        .select("amount_cents,status")
        .eq("package_id", packageRows[0].id),
    );
    expect(receipts).toEqual([{ amount_cents: 10000, status: "paid" }]);
    await page.goto(`/app/finance?package=${packageRows[0].id}`);
    await expect(page.locator(`#package-${packageRows[0].id}`)).toContainText(
      "opłacony",
    );
  } finally {
    await staffContext.close();
    if (dogs.length)
      await checked(db.from("payments").delete().in("dog_id", dogs));
    if (packages.length) {
      await checked(
        db.from("package_transactions").delete().in("package_id", packages),
      );
      await checked(db.from("packages").delete().in("id", packages));
    }
    if (walks.length) await checked(db.from("walks").delete().in("id", walks));
    await disposeCareFixtures(db, users, dogs);
  }
});
