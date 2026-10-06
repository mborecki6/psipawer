import { test, expect } from "@playwright/test";
import { consultationJourney } from "./consultation-journey";
import {
  localClients,
  checked,
  account,
  login,
  disposeCareFixtures,
} from "./local-fixtures";

import {
  mailRequest,
  findMessages,
  emailedLink,
  savePassword,
  openPrivateLink,
  expectSecurityStage,
  inspectLinkWithoutConsuming,
} from "./local-mail";

// Email links and passwords are one-time fixture credentials, not trace data.
test.use({ trace: "off" });

test("invitation → phone onboarding → consultation → care → recovery → new login", async ({
  browser,
  baseURL,
}, testInfo) => {
  test.setTimeout(180000);
  const { db, client } = localClients(baseURL);
  const users: string[] = [];
  const dogs: string[] = [];
  const outsiderDb = client();
  const contexts = [];
  const email = `psi-e2e-invited-${crypto.randomUUID()}@example.test`;
  const name = `Opiekun testowy ${crypto.randomUUID().slice(0, 8)}`;
  let invitationId = "";
  let invitedId = "";
  const started = Date.now();
  // Static phase names only: authentication URLs and fixture credentials must
  // never enter the diagnostic log, even when the browser stops responding.
  const stage = (phase: string) =>
    console.info(
      JSON.stringify({
        event: "local_invitation_phase",
        phase,
        elapsedMs: Date.now() - started,
      }),
    );
  try {
    stage("fixture-accounts");
    const staffAccount = await account(db, users, "admin");
    const outsider = await account(db, users, "client");
    await checked(
      outsiderDb.auth.signInWithPassword({
        email: outsider.email,
        password: outsider.password,
      }),
    );
    const staffContext = await browser.newContext({ baseURL });
    contexts.push(staffContext);
    const staff = await staffContext.newPage();
    await login(staff, staffAccount, "admin");
    stage("invitation-create-and-deliver");
    await staff.goto("/admin/invitations");
    await staff.getByLabel("Imię i nazwisko opiekuna").fill(name);
    await staff.getByLabel("E-mail opiekuna").fill(email);
    await staff
      .getByRole("button", { name: "Przygotuj zaproszenie", exact: true })
      .click();
    await expect(staff).toHaveURL(/\/admin\/invitations\?saved=/);
    invitationId = new URL(staff.url()).searchParams.get("saved")!;
    const card = staff
      .getByRole("listitem")
      .filter({ has: staff.getByRole("heading", { name, exact: true }) });
    expect(await findMessages(email)).toHaveLength(0);
    await card
      .getByRole("button", { name: "Wyślij do skrzynki testowej", exact: true })
      .click();
    await expect(card).toContainText("Wysyłka przyjęta");
    const invite = await emailedLink(email, "/auth/invitation", baseURL!);
    const lookup = await checked(
      db.auth.admin.listUsers({ page: 1, perPage: 1000 }),
    );
    invitedId = lookup.users.find((u) => u.email === email)?.id || "";
    expect(Boolean(invitedId)).toBe(true);
    await inspectLinkWithoutConsuming(invite);
    stage("invitation-accept");

    const guardianContext = await browser.newContext({
      baseURL,
      viewport: { width: 390, height: 844 },
    });
    contexts.push(guardianContext);
    const guardian = await guardianContext.newPage();
    await openPrivateLink(guardian, invite);
    await guardian
      .getByRole("button", { name: "Przyjmij zaproszenie", exact: true })
      .click();
    await expectSecurityStage(guardian, "activated");
    const password = `Psi-E2E!${crypto.randomUUID()}`;
    await savePassword(guardian, password);
    stage("password-capture");
    await guardian.screenshot({
      path: testInfo.outputPath("password-saved-phone.png"),
      fullPage: true,
      animations: "disabled",
    });
    await guardian.getByRole("link", { name: "Uzupełnij moje dane" }).click();
    stage("profile-onboarding");
    await expect(
      guardian.getByLabel("Imię i nazwisko", { exact: true }),
    ).toHaveValue(name);
    await guardian.getByLabel("Telefon", { exact: true }).fill("000 000 000");
    await guardian
      .getByLabel("Okolica (np. Wrocław, Krzyki)")
      .fill("Okolica demonstracyjna");
    await guardian
      .getByRole("button", { name: "Zapisz i przejdź dalej" })
      .click();
    await expect(guardian).toHaveURL(/\/app$/);
    const role = await checked(
      db.from("user_roles").select("role").eq("user_id", invitedId).single(),
    );
    expect(role?.role).toBe("client");
    await staff.reload();
    stage("staff-invitation-and-menu");
    await expect(card).toContainText("Gotowe do korzystania");
    await expect(card.getByRole("button", { name: /Wyślij/ })).toHaveCount(0);
    await staff.screenshot({
      path: testInfo.outputPath("invitations-desktop.png"),
      fullPage: true,
      animations: "disabled",
    });
    await staff.setViewportSize({ width: 390, height: 844 });
    const menu = staff.locator("#app-navigation");
    await expect(menu).toBeHidden();
    const openMenu = staff.getByRole("button", { name: "Otwórz menu" });
    await openMenu.click();
    const dialog = staff.getByRole("dialog", { name: "Menu główne" });
    await expect(dialog).toBeVisible();
    const closeMenu = dialog.getByRole("button", { name: "Zamknij menu" });
    await expect(closeMenu).toBeFocused();
    await staff.keyboard.press("Shift+Tab");
    await expect(
      dialog.getByRole("button", { name: "Wyloguj się" }),
    ).toBeFocused();
    await staff.keyboard.press("Tab");
    await expect(closeMenu).toBeFocused();
    await expect(staff.locator("#content")).toHaveAttribute("inert", "");
    await staff.keyboard.press("Escape");
    await expect(menu).toBeHidden();
    await expect(openMenu).toBeFocused();
    await expect(staff.locator("#content")).not.toHaveAttribute("inert", "");
    expect(
      await staff.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    ).toBe(true);
    await staff.screenshot({
      path: testInfo.outputPath("invitations-phone.png"),
      fullPage: true,
      animations: "disabled",
    });

    // Continue on the same newly invited phone session and identity. This
    // catches differences between invitations and directly-created fixtures.
    await staff.setViewportSize({ width: 1440, height: 1000 });
    stage("consultation-and-care");
    const journey = await consultationJourney({
      db,
      outsiderDb,
      staff,
      guardian,
      ownerId: invitedId,
      staffId: staffAccount.id,
      dogs,
      stage,
    });
    // Full-page capture at a scrolled position displaces sticky/fixed controls
    // in the artifact; inspect the actual top-of-page layout instead.
    await guardian.evaluate(() => window.scrollTo(0, 0));
    await expect.poll(() => guardian.evaluate(() => window.scrollY)).toBe(0);
    stage("guardian-progress-capture");
    await guardian.screenshot({
      path: testInfo.outputPath("guardian-progress-phone.png"),
      fullPage: true,
      animations: "disabled",
    });

    // New browser sessions prove that saved credentials work independently of
    // the one-time invitation session, and that a used link cannot be replayed.
    const freshContext = await browser.newContext({ baseURL });
    stage("used-invitation-and-password-login");
    contexts.push(freshContext);
    const fresh = await freshContext.newPage();
    await openPrivateLink(fresh, invite);
    await fresh
      .getByRole("button", { name: "Przyjmij zaproszenie", exact: true })
      .click();
    await expect(
      fresh
        .getByRole("alert")
        .filter({ hasText: "Zaproszenie jest nieprawidłowe" }),
    ).toContainText("zostało już wykorzystane");
    await login(fresh, { email, password }, "client");
    await fresh
      .getByRole("button", { name: "Wyloguj się", exact: true })
      .click();
    await expect(fresh).toHaveURL(/\/login$/);
    stage("password-recovery-request");
    await fresh.getByRole("link", { name: "Nie pamiętam hasła" }).click();
    // Both pages contain "Twój e-mail". Do not fill the outgoing login form.
    await fresh.waitForURL("**/forgot-password");
    await fresh.getByLabel("Twój e-mail").fill(email);
    await fresh
      .getByRole("button", { name: "Wyślij link do zmiany hasła" })
      .click();
    await expect(fresh.getByRole("status")).toContainText(
      "Jeśli dla tego adresu istnieje konto",
    );
    const recovery = await emailedLink(email, "/auth/recovery", baseURL!);
    await inspectLinkWithoutConsuming(recovery);
    stage("password-recovery-save");
    await openPrivateLink(fresh, recovery);
    await fresh
      .getByRole("button", { name: "Przejdź do zmiany hasła", exact: true })
      .click();
    await expectSecurityStage(fresh, "recovered");
    const newPassword = `Psi-E2E!${crypto.randomUUID()}`;
    await savePassword(fresh, newPassword);
    const oldLogin = client();
    const old = await oldLogin.auth.signInWithPassword({ email, password });
    expect(old.error?.code).toBe("invalid_credentials");
    stage("used-recovery-and-new-password-login");
    const finalContext = await browser.newContext({
      baseURL,
      viewport: { width: 390, height: 844 },
    });
    contexts.push(finalContext);
    const final = await finalContext.newPage();
    await openPrivateLink(final, recovery);
    await final
      .getByRole("button", { name: "Przejdź do zmiany hasła", exact: true })
      .click();
    await expect(
      final.getByRole("alert").filter({ hasText: "Link jest nieprawidłowy" }),
    ).toContainText("został już wykorzystany");
    await login(final, { email, password: newPassword }, "client");
    await final.goto(`/app/care/plans/${journey.planId}`);
    await expect(
      final.getByText(journey.published, { exact: true }),
    ).toBeVisible();
    await final.goto("/admin");
    await expect(final).toHaveURL(/\/app$/);
    stage("journey-complete");
  } finally {
    stage("cleanup-contexts");
    for (let i = 0; i < contexts.length; i++) {
      stage(`cleanup-context-${i + 1}`);
      await contexts[i].close();
    }
    stage("cleanup-invitation");
    // Include a partly-created invited user if a later delivery/assertion failed.
    if (!invitedId) {
      const lookup = await checked(
        db.auth.admin.listUsers({ page: 1, perPage: 1000 }),
      );
      invitedId = lookup.users.find((u) => u.email === email)?.id || "";
    }
    if (invitedId) users.push(invitedId);
    if (invitationId) {
      await checked(
        db
          .from("invitation_attempts")
          .delete()
          .eq("invitation_id", invitationId),
      );
      await checked(
        db.from("client_invitations").delete().eq("id", invitationId),
      );
    }
    await outsiderDb.auth.signOut();
    stage("cleanup-fixtures");
    await disposeCareFixtures(db, users, dogs);
    stage("cleanup-mail");
    const ownMail = await findMessages(email);
    if (ownMail.length)
      await mailRequest("/api/v1/messages", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ IDs: ownMail.map((m) => m.ID) }),
      });
    stage("cleanup-complete");
  }
});
