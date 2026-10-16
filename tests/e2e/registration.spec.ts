import { expect, type Page } from "@playwright/test";
import {
  test,
  checked,
  cleanupSteps,
  freeCalendarStart,
  localClients,
  restoreLocalPractitioner,
  setupLocalPractitioner,
} from "./local-fixtures";
import { dateInput } from "./walk-journey";
async function passwordLogin(page: Page, email: string, password: string) {
  await page.goto("/login");
  await page.getByLabel("Twój e-mail").fill(email);
  await page.getByLabel("Hasło", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Zaloguj się", exact: true }).click();
  await expect(page).toHaveURL(/\/(admin|app)$/, { timeout: 15000 });
}
test("password → dog → registration → admin approval → private location", async ({
  browser,
  baseURL,
}) => {
  const { db, client } = localClients(baseURL);
  const ids: string[] = [];
  const suffix = crypto.randomUUID().slice(0, 8);
  let walkId = "";
  const guardianContext = await browser.newContext({ baseURL });
  const adminContext = await browser.newContext({ baseURL });
  const guardian = await guardianContext.newPage();
  const admin = await adminContext.newPage();
  try {
    const publicDb = client();
    const signup = await publicDb.auth.signUp({
      email: `psi-e2e-blocked-${suffix}@example.test`,
      password: `Psi-E2E!${crypto.randomUUID()}`,
    });
    if (signup.data.user) ids.push(signup.data.user.id);
    expect(signup.error?.code).toBe("signup_disabled");
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
      if (role === "admin") await setupLocalPractitioner(db, ids, data.user.id);
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
    await admin.getByLabel("Status").selectOption("approved");
    await admin
      .getByLabel("Powód / zalecenia")
      .fill("Kwalifikacja do testu end-to-end.");
    await admin.getByRole("button", { name: "Zapisz kwalifikację" }).click();
    await expect(admin.getByRole("status")).toContainText("Status psa");
    await admin.goto("/admin/walks/new");
    const future = await freeCalendarStart(db);
    await admin.getByLabel("Termin (czas polski)").fill(dateInput(future));
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
    // With the last eligible dog submitted, the form unmounts. Assert the
    // durable registration card instead of its transient form feedback.
    await expect(
      guardian.getByText("Do decyzji", { exact: true }),
    ).toBeVisible();
    const registered = await db
      .from("walk_registrations")
      .select("id,status")
      .eq("walk_id", walkId)
      .eq("dog_id", dogId);
    expect(registered.error).toBeNull();
    expect(registered.data).toHaveLength(1);
    expect(registered.data?.[0].status).toBe("pending");
    await admin.goto("/admin");
    await admin
      .getByText("Podsumowanie spacerów i rozliczeń", { exact: true })
      .click();
    await admin
      .getByRole("link")
      .filter({ hasText: "Zgłoszenia do decyzji" })
      .click();
    // First development navigation also compiles this route. Use the navigation
    // deadline rather than the shorter assertion deadline for this transition.
    await admin.waitForURL(/filter=pending/);
    await admin
      .getByRole("link")
      .filter({ hasText: `Park testowy ${suffix}` })
      .click();
    await admin.getByLabel("Decyzja").selectOption("accepted");
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
    await cleanupSteps(
      () => guardianContext.close(),
      () => adminContext.close(),
      async () => {
        if (walkId) await checked(db.from("walks").delete().eq("id", walkId));
        if (ids.length) {
          await checked(db.from("walks").delete().in("leader_id", ids));
          await checked(db.from("audit_events").delete().in("actor_id", ids));
          await checked(db.from("dog_notes").delete().in("author_id", ids));
          await checked(db.from("dogs").delete().in("guardian_id", ids));
        }
      },
      () => restoreLocalPractitioner(db),
      async () => {
        await cleanupSteps(
          ...ids.map((id) => () => checked(db.auth.admin.deleteUser(id))),
        );
        if (ids.length) {
          expect(
            await checked(db.from("profiles").select("id").in("id", ids)),
          ).toEqual([]);
          expect(
            await checked(db.from("walks").select("id").in("leader_id", ids)),
          ).toEqual([]);
        }
      },
    );
  }
});
