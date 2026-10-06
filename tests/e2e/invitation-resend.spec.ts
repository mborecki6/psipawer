import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { LocalPostgres, literal } from "../helpers/local-postgres.mjs";
import {
  localClients,
  checked,
  account,
  login,
  disposeCareFixtures,
} from "./local-fixtures";
import {
  findMessages,
  mailRequest,
  emailedLink,
  openPrivateLink,
  inspectLinkWithoutConsuming,
  expectSecurityStage,
  savePassword,
} from "./local-mail";

// Never retain invitation credentials in traces or print URLs in assertions.
test.use({ trace: "off" });

test("invitation archive → history → expired link → resends replace old links → activation", async ({
  browser,
  baseURL,
}, testInfo) => {
  test.setTimeout(120000);
  const { db, client } = localClients(baseURL);
  const sql = await new LocalPostgres().ready();
  const users: string[] = [];
  const contexts: BrowserContext[] = [];
  const staffDb = client();
  const outsiderDb = client();
  const anonymousDb = client();
  const email = `psi-e2e-resend-${crypto.randomUUID()}@example.test`;
  const name = `Opiekun — ponowienie ${crypto.randomUUID().slice(0, 8)}`;
  const invitationId = crypto.randomUUID();
  let invitedId = "";
  async function privatePage() {
    const context = await browser.newContext({ baseURL });
    contexts.push(context);
    return context.newPage();
  }
  async function rejectedLink(link: string) {
    const page = await privatePage();
    await openPrivateLink(page, link);
    await page
      .getByRole("button", { name: "Przyjmij zaproszenie", exact: true })
      .click();
    await expect(
      page
        .getByRole("alert")
        .filter({ hasText: "Zaproszenie jest nieprawidłowe" }),
    ).toContainText("wygasło");
    // A failed acceptance must not issue an authenticated session.
    await page.goto("/app");
    await expect(page).toHaveURL(/\/login/);
  }
  async function permitOwnResend() {
    // Fast-forward only the synthetic account's cooldown, not the VM clock.
    await sql.query(`update public.client_invitations set last_attempt_at=now()-interval '3 minutes' where id=${literal(invitationId)};
      update auth.users set confirmation_sent_at=now()-interval '3 minutes' where id=${literal(invitedId)} and email=${literal(email)};`);
  }
  async function resend(page: Page, attemptCount: number) {
    const previousMessages = (await findMessages(email)).map((m) => m.ID);
    await permitOwnResend();
    await page.reload();
    page.once("dialog", (dialog) => dialog.accept());
    await page
      .getByRole("button", { name: "Wyślij nowe zaproszenie", exact: true })
      .click();
    await expect(
      page.getByRole("status").filter({ hasText: "Wysyłka przyjęta" }),
    ).toBeVisible();
    await expect(
      page.getByRole("region", { name: "Próby wysyłki" }).getByRole("listitem"),
    ).toHaveCount(attemptCount);
    await expect(
      page.getByRole("button", {
        name: "Wyślij nowe zaproszenie",
        exact: true,
      }),
    ).toHaveCount(0);
    return emailedLink(email, "/auth/invitation", baseURL!, previousMessages);
  }
  try {
    const staffAccount = await account(db, users, "admin");
    const outsider = await account(db, users, "client");
    await checked(staffDb.auth.signInWithPassword(staffAccount));
    await checked(outsiderDb.auth.signInWithPassword(outsider));
    await checked(
      staffDb.rpc("prepare_client_invitation", {
        p_id: invitationId,
        p_email: email,
        p_name: name,
      }),
    );
    const staff = await privatePage();
    await login(staff, staffAccount, "admin");
    await staff.goto(`/admin/invitations/${invitationId}`);
    await expect(
      staff.getByRole("heading", { name: "Nie rozpoczęto wysyłki" }),
    ).toBeVisible();
    expect(await findMessages(email)).toHaveLength(0);
    staff.once("dialog", (dialog) => dialog.accept());
    await staff
      .getByRole("button", { name: "Przenieś do archiwum", exact: true })
      .click();
    await expect(
      staff.getByRole("status").filter({ hasText: "Szkic w archiwum" }),
    ).toBeVisible();
    await expect(
      staff.getByRole("button", {
        name: "Wyślij do skrzynki testowej",
        exact: true,
      }),
    ).toHaveCount(0);
    expect(
      (
        await staffDb.rpc("claim_client_invitation", {
          p_id: invitationId,
          p_expected_version: 2,
          p_attempt: crypto.randomUUID(),
        })
      ).error?.message,
    ).toContain("w archiwum");
    expect(
      (
        await staffDb.rpc("prepare_client_invitation", {
          p_id: crypto.randomUUID(),
          p_email: email,
          p_name: name,
        })
      ).error?.message,
    ).toContain("w archiwum");
    await staff.goto("/admin/invitations");
    await staff.getByLabel("Szukaj zaproszenia", { exact: true }).fill(email);
    await staff.getByRole("button", { name: "Szukaj", exact: true }).click();
    await expect(
      staff.getByRole("heading", {
        name: "Brak pasujących zaproszeń",
        exact: true,
      }),
    ).toBeVisible();
    await staff.getByRole("link", { name: "Archiwum", exact: true }).click();
    const archivedCard = staff
      .getByRole("listitem")
      .filter({ has: staff.getByRole("heading", { name, exact: true }) });
    await expect(archivedCard).toBeVisible();
    await expect(
      staff.getByLabel("Szukaj zaproszenia", { exact: true }),
    ).toHaveValue(email);
    await expect(
      staff.getByRole("button", { name: "Przygotuj zaproszenie", exact: true }),
    ).toHaveCount(0);
    await staff.setViewportSize({ width: 320, height: 900 });
    await staff.reload();
    await expect(archivedCard).toBeVisible();
    await expect(
      archivedCard.getByRole("button", {
        name: "Przywróć na listę",
        exact: true,
      }),
    ).toBeEnabled();
    expect(
      await staff.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    ).toBe(true);
    await staff.screenshot({
      path: testInfo.outputPath("archive-phone.png"),
      fullPage: true,
      animations: "disabled",
    });
    await archivedCard
      .getByRole("button", { name: "Przywróć na listę", exact: true })
      .click();
    await expect(staff).toHaveURL(
      new RegExp(`/admin/invitations/${invitationId}$`),
    );
    await expect(
      staff.getByRole("button", {
        name: "Wyślij do skrzynki testowej",
        exact: true,
      }),
    ).toBeVisible();
    expect(await findMessages(email)).toHaveLength(0);
    await staff
      .getByRole("button", { name: "Wyślij do skrzynki testowej", exact: true })
      .click();
    await expect(
      staff.getByRole("status").filter({ hasText: "Wysyłka przyjęta" }),
    ).toBeVisible();
    const first = await emailedLink(email, "/auth/invitation", baseURL!);
    invitedId = await sql.json(
      `select to_json(id) from auth.users where email=${literal(email)};`,
    );
    expect(typeof invitedId).toBe("string");
    const detail = (
      await checked(
        staffDb.rpc("client_invitation_detail", { p_id: invitationId }),
      )
    )[0];
    await expect(
      staff.getByRole("button", { name: "Przenieś do archiwum", exact: true }),
    ).toHaveCount(0);
    expect(
      (
        await staffDb.rpc("set_client_invitation_archived", {
          p_id: invitationId,
          p_expected_version: detail.version,
          p_archived: true,
        })
      ).error?.message,
    ).toContain("archiwizować tylko");
    expect(detail.account_stage).toBe("not_activated");
    expect(
      (
        await staffDb.rpc("claim_client_invitation", {
          p_id: invitationId,
          p_expected_version: detail.version,
          p_attempt: crypto.randomUUID(),
        })
      ).error?.message,
    ).toContain("dwie minuty");
    expect(await findMessages(email)).toHaveLength(1);

    for (const connection of [outsiderDb, anonymousDb]) {
      for (const rpc of [
        "client_invitation_detail",
        "client_invitation_attempt_feed",
      ]) {
        const result = await connection.rpc(rpc, { p_id: invitationId });
        expect(result.error).toBeTruthy();
        expect(result.data).toBeNull();
      }
    }
    expect(
      await checked(
        outsiderDb
          .from("invitation_attempts")
          .select("id")
          .eq("invitation_id", invitationId),
      ),
    ).toEqual([]);

    // Auth v2.196 checks confirmation_sent_at for invite expiration. Leave the
    // actual token unchanged and make just this account's timestamp expire.
    await sql.query(
      `update auth.users set confirmation_sent_at=now()-interval '7 days' where id=${literal(invitedId)} and email=${literal(email)};`,
    );
    await rejectedLink(first);
    expect(
      await sql.json(
        `select to_json(email_confirmed_at is null) from auth.users where id=${literal(invitedId)};`,
      ),
    ).toBe(true);
    const second = await resend(staff, 2);
    expect(second !== first).toBe(true);
    await inspectLinkWithoutConsuming(second);
    // This also checks replacement, with a fresh timestamp after the new send.
    await rejectedLink(first);
    const third = await resend(staff, 3);
    expect(third !== second).toBe(true);
    await rejectedLink(second);
    await inspectLinkWithoutConsuming(third);

    const history = await checked(
      staffDb.rpc("client_invitation_attempt_feed", { p_id: invitationId }),
    );
    expect(history).toHaveLength(3);
    expect(
      history.every(
        (a: { outcome: string; author_name: string }) =>
          a.outcome === "sent" && a.author_name === "Test admin",
      ),
    ).toBe(true);
    for (const width of [320, 390, 768, 1440]) {
      await staff.setViewportSize({ width, height: 1000 });
      if (width < 760) {
        expect(
          await staff
            .locator("#app-navigation .nav-item")
            .evaluateAll((nodes) =>
              nodes.every(
                (node) => getComputedStyle(node).visibility === "hidden",
              ),
            ),
        ).toBe(true);
      }
      // Give each responsive capture a fresh layout after crossing breakpoints.
      await staff.reload();
      await expect(
        staff.getByRole("heading", {
          name: "Historia zaproszenia",
          exact: true,
        }),
      ).toBeVisible();
      expect(
        await staff.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1,
        ),
      ).toBe(true);
      await staff.screenshot({
        path: testInfo.outputPath(`history-${width}.png`),
        fullPage: true,
        animations: "disabled",
      });
    }
    const recipient = await privatePage();
    await openPrivateLink(recipient, third);
    await recipient
      .getByRole("button", { name: "Przyjmij zaproszenie", exact: true })
      .click();
    await expectSecurityStage(recipient, "activated");
    await staff.reload();
    await expect(
      staff.getByText("Do ustawienia hasło", { exact: true }),
    ).toBeVisible();
    await expect(
      staff.getByRole("button", {
        name: "Wyślij nowe zaproszenie",
        exact: true,
      }),
    ).toHaveCount(0);
    const active = (
      await checked(
        staffDb.rpc("client_invitation_detail", { p_id: invitationId }),
      )
    )[0];
    await permitOwnResend();
    expect(
      (
        await staffDb.rpc("claim_client_invitation", {
          p_id: invitationId,
          p_expected_version: active.version,
          p_attempt: crypto.randomUUID(),
        })
      ).error?.message,
    ).toContain("już aktywowane");
    expect(await findMessages(email)).toHaveLength(3);
    await rejectedLink(third);
    await savePassword(recipient, `Psi-E2E!${crypto.randomUUID()}`);
    await staff.reload();
    await expect(
      staff.getByText("Do uzupełnienia profil", { exact: true }),
    ).toBeVisible();
  } finally {
    for (const context of contexts) await context.close();
    if (!invitedId)
      invitedId =
        (await sql.json(
          `select to_json((select id from auth.users where email=${literal(email)}));`,
        )) || "";
    if (invitedId) users.push(invitedId);
    await checked(
      db.from("invitation_attempts").delete().eq("invitation_id", invitationId),
    );
    await checked(
      db.from("client_invitations").delete().eq("id", invitationId),
    );
    await staffDb.auth.signOut();
    await outsiderDb.auth.signOut();
    await disposeCareFixtures(db, users, []);
    const messages = await findMessages(email);
    if (messages.length)
      await mailRequest("/api/v1/messages", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ IDs: messages.map((m) => m.ID) }),
      });
    await sql.close();
  }
});
