import {
  test,
  expect,
  type Page,
  type APIRequestContext,
} from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
const url = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const secret = process.env.SUPABASE_SECRET_KEY || "";
const mail = process.env.TEST_INBUCKET_URL || "http://localhost:54324";
const enabled = Boolean(
  url && secret && ["localhost", "127.0.0.1"].includes(new URL(url).hostname),
);
test.skip(
  !enabled,
  "Requires disposable local Supabase, migrations, Inbucket, and matching app environment.",
);
async function magicLogin(
  page: Page,
  request: APIRequestContext,
  email: string,
) {
  await page.goto("/login");
  await page.getByLabel("Twój e-mail").fill(email);
  await page.getByRole("button", { name: "Wyślij link do logowania" }).click();
  await expect(page.getByRole("status")).toContainText("Sprawdź skrzynkę");
  const mailbox = email.split("@")[0];
  let messageId = "";
  await expect
    .poll(async () => {
      const response = await request.get(`${mail}/api/v1/mailbox/${mailbox}`);
      const messages = await response.json();
      messageId = messages.at(-1)?.id || "";
      return Boolean(messageId);
    })
    .toBe(true);
  const response = await request.get(
    `${mail}/api/v1/mailbox/${mailbox}/${messageId}`,
  );
  const message = await response.json();
  const content = String(message.body.html || message.body.text);
  const link = content
    .match(/https?:\/\/[^\s"<>]*\/auth\/v1\/verify[^\s"<>]*/)?.[0]
    ?.replaceAll("&amp;", "&");
  if (!link) throw new Error("Magic link missing from local test mailbox.");
  if (new URL(link).origin !== new URL(url).origin)
    throw new Error("Unexpected magic-link origin.");
  await page.goto(link);
  await expect(page).toHaveURL(/\/(admin|app)$/);
}
test("magic link → dog → registration → admin approval → private location", async ({
  browser,
  request,
}) => {
  const db = createClient(url, secret, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const ids: string[] = [];
  const suffix = crypto.randomUUID().slice(0, 8);
  let walkId = "";
  const guardianContext = await browser.newContext();
  const adminContext = await browser.newContext();
  const guardian = await guardianContext.newPage();
  const admin = await adminContext.newPage();
  try {
    for (const [i, role] of ["admin", "client"].entries()) {
      const email = `psi-e2e-${role}-${suffix}@example.test`;
      const { data, error } = await db.auth.admin.createUser({
        email,
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
      await magicLogin(i === 0 ? admin : guardian, request, email);
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
