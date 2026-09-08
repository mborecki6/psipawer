import { test, expect, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
const url = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const secret = process.env.SUPABASE_SECRET_KEY || "";
const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
function isLocalUrl(value: string | undefined) {
  if (!value) return false;
  try {
    const parsed = new URL(value);
    return (
      ["http:", "https:"].includes(parsed.protocol) &&
      ["localhost", "127.0.0.1"].includes(parsed.hostname) &&
      !parsed.username &&
      !parsed.password
    );
  } catch {
    return false;
  }
}
const enabled = Boolean(secret && isLocalUrl(url) && isLocalUrl(appUrl));
test.skip(
  !enabled,
  "Requires disposable local Supabase with migrations, an admin key, and a local app using the same environment.",
);
async function passwordLogin(page: Page, email: string, password: string) {
  await page.goto("/login");
  await page.getByLabel("Twój e-mail").fill(email);
  await page.getByLabel("Hasło", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Zaloguj się", exact: true }).click();
  await expect(page).toHaveURL(/\/(admin|app)$/);
}
test("password → dog → registration → admin approval → private location", async ({
  browser,
  baseURL,
}) => {
  // Check the effective Playwright URL as well, before creating any fixtures.
  test.skip(!isLocalUrl(baseURL), "The app under test must also be local.");
  const db = createClient(url, secret, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const ids: string[] = [];
  const suffix = crypto.randomUUID().slice(0, 8);
  let walkId = "";
  const guardianContext = await browser.newContext({ baseURL });
  const adminContext = await browser.newContext({ baseURL });
  const guardian = await guardianContext.newPage();
  const admin = await adminContext.newPage();
  try {
    for (const [i, role] of ["admin", "client"].entries()) {
      const email = `psi-e2e-${role}-${suffix}@example.test`;
      const password = `Psi-E2E!${crypto.randomUUID()}`;
      const { data, error } = await db.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
      });
      if (error || !data.user) throw error || new Error("Missing test user");
      ids.push(data.user.id);
      const profile = await db
        .from("profiles")
        .update({
          full_name: `Test ${role}`,
          phone: "000 000 000",
          area: "Okolica testowa",
        })
        .eq("id", data.user.id);
      if (profile.error) throw profile.error;
      const roles = await db
        .from("user_roles")
        .update({ role })
        .eq("user_id", data.user.id);
      if (roles.error) throw roles.error;
      await passwordLogin(i === 0 ? admin : guardian, email, password);
    }
    await guardian.goto("/admin");
    await expect(guardian).toHaveURL("/app");
    await guardian.goto("/app/dogs/new");
    await guardian.getByLabel("Imię psa").fill(`Kluska ${suffix}`);
    await guardian
      .getByRole("button", { name: "Dodaj psa", exact: true })
      .click();
    await expect(guardian).toHaveURL(/\/app\/dogs\/[a-f0-9-]+/);
    const dogId = guardian.url().split("/").pop()!.split("?")[0];
    await admin.goto(`/admin/dogs/${dogId}`);
    await admin.getByLabel("Status", { exact: true }).selectOption("approved");
    await admin
      .getByLabel("Powód / zalecenia")
      .fill("Kwalifikacja do testu end-to-end.");
    await admin.getByRole("button", { name: "Zapisz kwalifikację" }).click();
    await expect(admin.getByRole("status")).toContainText("Status psa");
    await admin.goto("/admin/walks/new");
    const future = new Date(Date.now() + 7 * 86400000);
    const parts = new Intl.DateTimeFormat("sv-SE", {
      timeZone: "Europe/Warsaw",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(future);
    await admin.getByLabel("Termin (czas polski)").fill(`${parts}T10:00`);
    await admin.getByLabel("Ogólna lokalizacja").fill(`Park testowy ${suffix}`);
    await admin
      .getByLabel("Dokładne miejsce zbiórki")
      .fill(`Sekretna zbiórka ${suffix}`);
    await admin.getByRole("button", { name: "Utwórz spacer" }).click();
    await expect(admin).toHaveURL(/\/admin\/walks\/[a-f0-9-]+/);
    walkId = admin.url().split("/").pop()!.split("?")[0];
    await guardian.goto(`/app/walks/${walkId}`);
    await expect(guardian.getByText(`Sekretna zbiórka ${suffix}`)).toHaveCount(
      0,
    );
    await guardian.getByLabel("Wybierz swojego psa").selectOption(dogId);
    await guardian.getByRole("button", { name: "Zgłoś psa" }).click();
    await expect(guardian.getByRole("status")).toContainText(
      "Zgłoszenie zapisane",
    );
    await admin.goto("/admin");
    await admin
      .getByRole("link")
      .filter({ hasText: "Zgłoszenia do decyzji" })
      .click();
    await expect(admin).toHaveURL(/filter=pending/);
    await admin
      .getByRole("link")
      .filter({ hasText: `Park testowy ${suffix}` })
      .click();
    await admin.getByLabel("Decyzja", { exact: true }).selectOption("accepted");
    admin.once("dialog", (dialog) => dialog.accept());
    await admin.getByRole("button", { name: "Zapisz decyzję" }).click();
    await expect(admin.getByRole("status")).toContainText("Decyzja zapisana");
    await guardian.reload();
    await expect(
      guardian.getByText(`Sekretna zbiórka ${suffix}`),
    ).toBeVisible();
    await expect(
      guardian.getByText("Zaakceptowany", { exact: true }),
    ).toBeVisible();
  } finally {
    await guardianContext.close();
    await adminContext.close();
    if (walkId) await db.from("walks").delete().eq("id", walkId);
    if (ids.length) {
      await db.from("audit_events").delete().in("actor_id", ids);
      await db.from("dog_notes").delete().in("author_id", ids);
      await db.from("walks").delete().in("leader_id", ids);
      await db.from("dogs").delete().in("guardian_id", ids);
      for (const id of ids) await db.auth.admin.deleteUser(id);
    }
  }
});
