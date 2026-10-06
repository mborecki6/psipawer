import { test, expect } from "@playwright/test";
import {
  account,
  checked,
  disposeCareFixtures,
  localClients,
  login,
} from "./local-fixtures";

test.use({ trace: "off" });
test("session verification rejects tampered tokens and honors role changes between requests", async ({
  page,
  browser,
  baseURL,
}) => {
  const { db } = localClients(baseURL);
  const users: string[] = [];
  const forgedContext = await browser.newContext({ baseURL });
  try {
    const user = await account(db, users, "client");
    await login(page, user, "client");
    const response = await page.goto("/app/finance");
    expect(response?.headers()["cache-control"]).toContain("no-store");

    const cookies = (await page.context().cookies()).filter((cookie) =>
      /-auth-token(?:\.\d+)?$/.test(cookie.name),
    );
    expect(cookies.length > 0).toBe(true);
    const root = cookies[0].name.replace(/\.\d+$/, "");
    cookies.sort(
      (a, b) =>
        Number(a.name.split(".").at(-1)) - Number(b.name.split(".").at(-1)),
    );
    const value = cookies.map((cookie) => cookie.value).join("");
    expect(value.startsWith("base64-")).toBe(true);
    const session = JSON.parse(
      Buffer.from(value.slice(7), "base64url").toString("utf8"),
    );
    const parts = session.access_token.split(".");
    const payload = JSON.parse(
      Buffer.from(parts[1], "base64url").toString("utf8"),
    );
    const forgedId = crypto.randomUUID();
    payload.sub = forgedId;
    payload.role = "service_role";
    parts[1] = Buffer.from(JSON.stringify(payload)).toString("base64url");
    session.access_token = parts.join(".");
    session.user.id = forgedId;
    session.user.role = "service_role";
    await forgedContext.addCookies([
      {
        ...cookies[0],
        name: root,
        value: `base64-${Buffer.from(JSON.stringify(session)).toString("base64url")}`,
      },
    ]);
    const forgedPage = await forgedContext.newPage();
    await forgedPage.goto("/admin/finance");
    await expect(forgedPage).toHaveURL(/\/login$/);
    await expect(
      forgedPage.getByRole("heading", { name: "Pakiety i płatności", exact: true }),
    ).toHaveCount(0);

    await checked(
      db.from("user_roles").update({ role: "admin" }).eq("user_id", user.id),
    );
    await page.goto("/admin/finance");
    await expect(page).toHaveURL(/\/admin\/finance$/);
    await expect(
      page.getByRole("heading", { name: "Pakiety i płatności", exact: true }),
    ).toBeVisible();
    await checked(
      db.from("user_roles").update({ role: "client" }).eq("user_id", user.id),
    );
    await page.goto("/admin/finance");
    await expect(page).toHaveURL(/\/app$/);
  } finally {
    await forgedContext.close();
    await disposeCareFixtures(db, users, []);
  }
});
