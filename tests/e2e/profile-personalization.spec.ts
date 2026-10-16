import { expect } from "@playwright/test";
import {
  test,
  account,
  checked,
  disposeCareFixtures,
  localClients,
  login,
} from "./local-fixtures";

test.use({ trace: "off" });
test("brand entry and own profile editing work for guardian and staff", async ({
  page,
  baseURL,
}, testInfo) => {
  const { db, client } = localClients(baseURL);
  const users: string[] = [];
  try {
    await page.goto("/profile");
    await expect(page).toHaveURL(/\/login$/);
    for (const width of [320, 390, 1440]) {
      await page.setViewportSize({ width, height: width < 800 ? 844 : 1000 });
      await expect(
        page.getByRole("img", { name: "Psi Pawer", exact: true }),
      ).toBeVisible();
      await expect(
        page.getByRole("heading", {
          name: "Problemy to wyzwania, którym stawiaMY czoła!",
          exact: true,
        }),
      ).toBeVisible();
      await expect(page.getByLabel("Twój e-mail")).toBeVisible();
      if (width < 800) {
        const email = await page.getByLabel("Twój e-mail").boundingBox();
        expect(email!.y + email!.height).toBeLessThan(844);
      }
      await expect
        .poll(() =>
          page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
        )
        .toBe(true);
      await page.screenshot({
        path: testInfo.outputPath(`login-${width}.png`),
        fullPage: true,
      });
    }

    const guardian = await account(db, users, "client");
    const staff = await account(db, users, "admin");
    for (const [role, user] of [
      ["client", guardian],
      ["admin", staff],
    ] as const) {
      await page.context().clearCookies();
      await page.setViewportSize({ width: 1440, height: 1000 });
      await login(page, user, role);
      const contact = page.getByRole("link", {
        name: /Napisz do Psi Pawer na WhatsApp/,
      });
      if (role === "client") {
        await expect(contact).toHaveAttribute(
          "href",
          "https://wa.me/48695351796",
        );
        await expect(contact).toHaveAttribute("target", "_blank");
        await expect(contact).toBeVisible();
      } else {
        await expect(contact).toHaveCount(0);
      }
      if (role === "client") {
        await page.goto("/app/services");
        await expect(
          page.getByRole("heading", {
            name: "Wybierz formę pracy",
            exact: true,
          }),
        ).toBeVisible();
        await expect(page.locator("main article")).toHaveCount(0);
        const choice = page.locator(
          'main nav[aria-label="Forma usług"] a[href="/app/services?category=individual"]',
        );
        await choice.focus();
        await page.keyboard.press("Enter");
        await expect(page).toHaveURL(/category=individual$/);
        await expect(page.locator("main article").first()).toBeVisible();
        await page
          .locator(
            'main nav[aria-label="Forma usług"] a[href="/app/services?category=group"]',
          )
          .click();
        await expect(page).toHaveURL(/category=group$/);
        await expect(page.locator("main article").first()).toBeVisible();
        await page
          .getByRole("link", { name: "← Zmień formę pracy", exact: true })
          .click();
        await expect(page).toHaveURL(/\/app\/services$/);
        await page.screenshot({
          path: testInfo.outputPath("offer-client-1440.png"),
          fullPage: true,
        });
        await page.setViewportSize({ width: 320, height: 844 });
        await expect
          .poll(() =>
            page.evaluate(
              () => document.documentElement.scrollWidth <= innerWidth,
            ),
          )
          .toBe(true);
        await page.screenshot({
          path: testInfo.outputPath("offer-client-320.png"),
          fullPage: true,
        });
        await page.goto("/app/services?category=voucher");
        await expect(page).toHaveURL(/\/app\/gifts$/);
        await page.goto("/app/dogs/new");
        await expect(contact).toBeVisible();
        await page.locator('main input:not([type="hidden"])').first().focus();
        await expect(contact).toBeHidden();
        await page.evaluate(() =>
          (document.activeElement as HTMLElement).blur(),
        );
        await expect(contact).toBeVisible();
        await page.goto("/app");
        await page.setViewportSize({ width: 1440, height: 1000 });
      }
      await page.screenshot({
        path: testInfo.outputPath(`panel-${role}-1440.png`),
        fullPage: true,
      });
      await page.setViewportSize({ width: 320, height: 844 });
      await page
        .getByRole("button", { name: "Otwórz menu", exact: true })
        .click();
      const edit = page.getByRole("link", {
        name: `Edytuj profil: Test ${role}`,
        exact: true,
      });
      await edit.focus();
      await page.keyboard.press("Enter");
      await expect(page).toHaveURL(/\/profile$/);
      await expect(page.getByLabel("E-mail do logowania")).toHaveValue(
        user.email,
      );
      await expect(page.getByLabel("E-mail do logowania")).toHaveAttribute(
        "readonly",
        "",
      );
      const name = `Test ${role} po edycji`;
      await page.getByLabel("Imię i nazwisko", { exact: true }).fill(name);
      await page.getByLabel("Telefon", { exact: true }).fill("+48 000 000 000");
      await page
        .getByLabel("Okolica", { exact: false })
        .fill("Wrocław, Krzyki test");
      await page
        .getByRole("button", { name: "Zapisz zmiany", exact: true })
        .click();
      await expect(page.getByRole("status")).toContainText(
        "Zmiany w profilu zostały zapisane",
      );
      await expect
        .poll(
          async () =>
            await checked(
              db
                .from("profiles")
                .select("full_name,phone,area")
                .eq("id", user.id)
                .single(),
            ),
        )
        .toEqual({
          full_name: name,
          phone: "+48 000 000 000",
          area: "Wrocław, Krzyki test",
        });
      await expect
        .poll(() =>
          page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
        )
        .toBe(true);
      await page.screenshot({
        path: testInfo.outputPath(`profile-${role}-320.png`),
        fullPage: true,
      });
      await page
        .getByRole("link", { name: "Wróć do panelu", exact: true })
        .click();
      await expect(page).toHaveURL(role === "client" ? /\/app$/ : /\/admin$/);
      await page
        .getByRole("button", { name: "Otwórz menu", exact: true })
        .click();
      await expect(
        page.getByRole("link", { name: `Edytuj profil: ${name}`, exact: true }),
      ).toBeVisible();
      await page
        .getByRole("dialog", { name: "Menu główne", exact: true })
        .getByRole("button", { name: "Zamknij menu", exact: true })
        .click();
      await expect
        .poll(() =>
          page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
        )
        .toBe(true);
    }

    // Simulate an expired cached session without forging the signed JWT.
    // Supabase must refresh it and the profile route must persist new cookies.
    const authCookies = (await page.context().cookies()).filter((cookie) =>
      /-auth-token(?:\.\d+)?$/.test(cookie.name),
    );
    authCookies.sort(
      (a, b) =>
        Number(a.name.split(".").at(-1)) - Number(b.name.split(".").at(-1)),
    );
    const encoded = authCookies.map((cookie) => cookie.value).join("");
    expect(encoded.startsWith("base64-")).toBe(true);
    const session = JSON.parse(
      Buffer.from(encoded.slice(7), "base64url").toString("utf8"),
    );
    session.expires_at = 1;
    session.expires_in = 0;
    const root = authCookies[0].name.replace(/\.\d+$/, "");
    const expired = `base64-${Buffer.from(JSON.stringify(session)).toString("base64url")}`;
    for (const cookie of authCookies)
      await page.context().clearCookies({ name: cookie.name });
    await page
      .context()
      .addCookies([{ ...authCookies[0], name: root, value: expired }]);
    const refreshed = await page.goto("/profile");
    await expect(page).toHaveURL(/\/profile$/);
    expect(refreshed?.headers()["cache-control"]).toContain("no-store");
    const refreshedHeaders = await refreshed?.allHeaders();
    expect(Boolean(refreshedHeaders?.["set-cookie"]?.includes(root))).toBe(
      true,
    );
    const refreshedCookies = (await page.context().cookies())
      .filter((cookie) => /-auth-token(?:\.\d+)?$/.test(cookie.name))
      .sort(
        (a, b) =>
          Number(a.name.split(".").at(-1)) - Number(b.name.split(".").at(-1)),
      );
    const nextSession = JSON.parse(
      Buffer.from(
        refreshedCookies
          .map((cookie) => cookie.value)
          .join("")
          .slice(7),
        "base64url",
      ).toString("utf8"),
    );
    expect(nextSession.expires_at > Date.now() / 1000).toBe(true);

    const outsider = client();
    await checked(
      outsider.auth.signInWithPassword({
        email: guardian.email,
        password: guardian.password,
      }),
    );
    const attempted = await outsider
      .from("profiles")
      .update({ full_name: "Nieuprawniona zmiana" })
      .eq("id", staff.id)
      .select("id");
    expect(attempted.error || attempted.data?.length === 0).toBeTruthy();
    expect(
      (
        await checked(
          db.from("profiles").select("full_name").eq("id", staff.id).single(),
        )
      )?.full_name,
    ).toBe("Test admin po edycji");
  } finally {
    await disposeCareFixtures(db, users, []);
  }
});
