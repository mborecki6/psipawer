import assert from "node:assert/strict";
import { expect, type Locator, type Page, type Route } from "@playwright/test";
import { literal as q } from "../helpers/local-postgres.mjs";
import { checked, test } from "./local-fixtures";
import {
  checkoutForm,
  openSummary,
  paymentFixtures,
  paymentKinds,
  simulate,
  simulationForm,
  start,
  type PaymentFixtures,
  type PaymentTarget,
} from "./tpay-fixtures";

// Requires the coordinator's exclusive local DB/calendar slot and compiled
// preview. The simulator is explicit; no Tpay request or real charge is made.

async function keyboardButton(page: Page, button: Locator) {
  // Default macOS WebKit tabs through editable fields only. Option+Tab is its
  // native gesture for all controls, including links/buttons. Use real keyboard
  // navigation in either mode; never focus the payment button programmatically.
  const nextControl =
    process.platform === "darwin" &&
    page.context().browser()?.browserType().name() === "webkit"
      ? "Alt+Tab"
      : "Tab";
  await page.evaluate(() => {
    if (document.activeElement instanceof HTMLElement)
      document.activeElement.blur();
    window.scrollTo(0, 0);
  });
  let reached = false;
  for (let n = 0; n < 80; n++) {
    await page.keyboard.press(nextControl);
    reached = await button.evaluate(
      (element) => element === document.activeElement,
    );
    if (reached) break;
  }
  expect(reached, `Payment submit must be reachable using ${nextControl}`).toBe(
    true,
  );
  await expect(button).toBeFocused();
  expect(
    await button.evaluate((element) => {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return {
        visibleFocus:
          (style.outlineStyle !== "none" &&
            parseFloat(style.outlineWidth) > 0) ||
          style.boxShadow !== "none",
        fits: rect.left >= 0 && rect.right <= innerWidth + 1,
      };
    }),
  ).toEqual({ visibleFocus: true, fits: true });
  await page.screenshot({
    path: test
      .info()
      .outputPath(`keyboard-focus-${page.viewportSize()?.width}.png`),
    animations: "disabled",
  });
}

async function layout(page: Page, width: number, name: string) {
  await page.setViewportSize({ width, height: 900 });
  await page.mouse.move(0, 0);
  await page.evaluate(async () => {
    if (document.activeElement instanceof HTMLElement)
      document.activeElement.blur();
    window.scrollTo({ top: 0, left: 0, behavior: "instant" });
    await document.fonts.ready;
    await new Promise<void>((done) =>
      requestAnimationFrame(() => requestAnimationFrame(() => done())),
    );
  });
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
  await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  ).toBe(true);
  if (width === 320)
    await page.screenshot({
      path: test.info().outputPath(`${name}-${width}-viewport.png`),
      animations: "disabled",
    });
  await page.screenshot({
    path: test.info().outputPath(`${name}-${width}.png`),
    fullPage: true,
    animations: "disabled",
  });
}

async function assertOneReceipt(
  f: PaymentFixtures,
  target: PaymentTarget,
  id: string,
  cents = 10000,
) {
  await expect
    .poll(() => f.attempt(id))
    .toMatchObject({
      status: "paid",
      amount_cents: cents,
      confirmed_amount_cents: cents,
      review_reason: null,
    });
  const attempt = await f.attempt(id),
    receipts = await f.payments(target);
  const online = receipts.filter((row) => row.online_attempt_id !== null);
  expect(online).toHaveLength(1);
  expect(await f.due(target)).toBe(0);
  expect(online[0]).toMatchObject({
    id: attempt.payment_id,
    guardian_id: f.owner.id,
    dog_id: f.dog,
    amount_cents: cents,
    method: "tpay_simulator",
    status: "paid",
    author_id: null,
    online_attempt_id: id,
  });
  expect(
    await f.sql.json(
      `select json_build_object('receipts',count(*),'allocated',coalesce(sum(amount_cents),0)) from public.payments where online_attempt_id=${q(id)};`,
    ),
  ).toEqual({ receipts: 1, allocated: cents });
  expect(
    await f.sql.json(
      `select to_json(count(*)) from public.audit_events where event='online_payment_confirmed' and entity_id=${q(id)};`,
    ),
  ).toBe(1);
  await f.guardian.goto(`/app/finance?payment=${online[0].id}`);
  await expect(f.guardian.locator(`#payment-${online[0].id}`)).toContainText(
    "BLIK · symulacja lokalna",
  );
  await expect(
    f.guardian.locator(`#charge-${target.kind}-${target.id}`),
  ).toHaveCount(0);
  await f.staff.goto(`/admin/finance?payment=${online[0].id}`);
  const staffReceipt = f.staff.locator(`#payment-${online[0].id}`);
  await expect(staffReceipt).toContainText(f.dogName);
  await expect(staffReceipt).toContainText("Test client");
  await expect(staffReceipt).toContainText(
    `${(cents / 100).toFixed(2).replace(".", ",")}`,
  );
  await expect(staffReceipt).toContainText("Wpłata zapisana");
  await expect(
    f.staff.locator(`#charge-${target.kind}-${target.id}`),
  ).toHaveCount(0);
  return online[0];
}

for (const kind of paymentKinds) {
  test(`BLIK ${kind}: accepted service → guardian summary → simulator → one receipt in both panels`, async ({
    browser,
    baseURL,
  }) => {
    const f = await paymentFixtures(browser, baseURL);
    try {
      const target = await f.create(kind),
        before = await f.state(target);
      assert(before);
      const form = await openSummary(f, target);
      // The mobile sidebar is intentionally closed; its current-page marker
      // remains in the DOM and becomes visible after opening the menu.
      const activeNavigation = f.guardian.locator('a[aria-current="page"]');
      await expect.poll(() => activeNavigation.count()).toBeGreaterThan(0);
      expect(
        await activeNavigation.evaluateAll((links) =>
          links.every((link) => link.getAttribute("href") === "/app/finance"),
        ),
      ).toBe(true);
      const term = f.guardian
        .getByRole("region", { name: "Podsumowanie płatności" })
        .locator("dl div")
        .filter({ has: f.guardian.locator("dt", { hasText: "Termin" }) });
      await expect(term.locator("dd")).not.toBeEmpty();
      for (const width of [320, 390, 768, 1440]) {
        await layout(f.guardian, width, `${kind}-summary`);
        await keyboardButton(
          f.guardian,
          form.getByRole("button", {
            name: "Rozpocznij lokalną symulację BLIK",
            exact: true,
          }),
        );
      }
      await f.guardian.keyboard.press("Enter");
      await expect(f.guardian).toHaveURL(/\/app\/payments\/[a-f0-9-]+$/);
      const id = new URL(f.guardian.url()).pathname.split("/").at(-1)!;
      expect(await f.attempt(id)).toMatchObject({
        environment: "simulator",
        status: "pending",
        amount_cents: 10000,
        guardian_id: f.owner.id,
        dog_id: f.dog,
      });
      // Merely returning to an attempt never records an incoming payment.
      await f.guardian.reload();
      expect(await f.payments(target)).toEqual([]);
      expect((await f.state(target))!.status).toBe(before.status);
      await simulate(f, id);
      await assertOneReceipt(f, target, id);
      expect((await f.state(target))!.status).toBe(before.status);
      const other = await f.stranger
        .from("online_payment_attempts")
        .select("id")
        .eq("id", id);
      expect(other.error).toBeNull();
      expect(other.data).toEqual([]);
      expect(
        await checked(
          f.stranger.from("payments").select("id").eq("online_attempt_id", id),
        ),
      ).toEqual([]);
      expect(
        (
          await f.anonymous
            .from("online_payment_attempts")
            .select("id")
            .eq("id", id)
        ).error,
      ).toBeTruthy();
      await layout(f.staff, 390, `${kind}-staff-receipt`);
    } finally {
      await f.dispose();
    }
  });
}

test("BLIK partial 40→60: summary identifies earlier receipt and collects only remaining debt", async ({
  browser,
  baseURL,
}) => {
  const f = await paymentFixtures(browser, baseURL);
  try {
    const target = await f.create("consultation");
    await f.manual(target, 4000);
    const [manual] = await f.payments(target);
    expect(manual).toMatchObject({
      amount_cents: 4000,
      author_id: f.admin.id,
      online_attempt_id: null,
    });
    await openSummary(f, target, 6000);
    await expect(
      f.guardian.getByRole("region", { name: "Podsumowanie płatności" }),
    ).toContainText(/Już wpłacono\s*40,00/);
    const attempt = await start(f, target);
    expect(attempt.amount_cents).toBe(6000);
    await simulate(f, attempt.id);
    await assertOneReceipt(f, target, attempt.id, 6000);
    expect(
      (await f.payments(target))
        .map((row) => row.amount_cents)
        .sort((a, b) => a - b),
    ).toEqual([4000, 6000]);
    expect(
      await f.sql.json(
        `select json_build_object('paid',paid_cents,'due',due_cents) from public.consultation_balances where id=${q(target.id)};`,
      ),
    ).toEqual({ paid: 10000, due: 0 });
    await expect(f.guardian.locator(`#payment-${manual.id}`)).toContainText(
      "40,00",
    );
  } finally {
    await f.dispose();
  }
});

test("BLIK stale summary rejects changed debt, retains operation, and requires fresh confirmation", async ({
  browser,
  baseURL,
}) => {
  const f = await paymentFixtures(browser, baseURL);
  try {
    const target = await f.create("registration");
    const form = await openSummary(f, target);
    const requestId = await form.locator('[name="request_id"]').inputValue();
    await f.manual(target, 4000);
    await form
      .getByRole("button", {
        name: "Rozpocznij lokalną symulację BLIK",
        exact: true,
      })
      .click();
    await expect(form.getByRole("alert")).toContainText(
      "Należność zmieniła się",
    );
    await expect(form.getByRole("alert")).toBeFocused();
    await expect(form.locator('[name="request_id"]')).toHaveValue(requestId);
    await expect(form.locator('[name="expected_due_cents"]')).toHaveValue(
      "10000",
    );
    expect(await f.attempts(target)).toEqual([]);
    expect((await f.payments(target)).map((row) => row.amount_cents)).toEqual([
      4000,
    ]);
    await layout(f.guardian, 320, "stale-summary-error");
    await openSummary(f, target, 6000);
    const attempt = await start(f, target);
    expect(attempt.amount_cents).toBe(6000);
    await simulate(f, attempt.id);
    await assertOneReceipt(f, target, attempt.id, 6000);
  } finally {
    await f.dispose();
  }
});

test("BLIK pending approval and direct guardian RPC cannot reserve or forge an environment", async ({
  browser,
  baseURL,
}) => {
  const f = await paymentFixtures(browser, baseURL);
  try {
    for (const kind of paymentKinds) {
      const target = await f.create(kind, false);
      await f.guardian.goto(
        `/app/payments/new?kind=${kind}&target=${target.id}`,
      );
      await expect(
        f.guardian.getByRole("heading", {
          name: "Ta należność nie jest dostępna do płatności BLIK",
          exact: true,
        }),
      ).toBeVisible();
      await expect(checkoutForm(f.guardian)).toHaveCount(0);
      const result = await f.db.rpc("begin_online_payment", {
        p_guardian: f.owner.id,
        p_kind: kind,
        p_target: target.id,
        p_request_id: crypto.randomUUID(),
        p_environment: "simulator",
        p_expected_due_cents: 10000,
        p_merchant_id: "LOCAL-SIMULATOR",
      });
      expect(result.error).toBeTruthy();
      for (const api of [f.own, f.stranger, f.anonymous]) {
        const denied = await api.rpc("begin_online_payment", {
          p_guardian: f.owner.id,
          p_kind: kind,
          p_target: target.id,
          p_request_id: crypto.randomUUID(),
          p_environment: "live",
          p_expected_due_cents: 1,
          p_merchant_id: "forged-merchant",
        });
        expect(denied.error).toBeTruthy();
      }
      expect(await f.attempts(target)).toEqual([]);
      expect(await f.payments(target)).toEqual([]);
    }
  } finally {
    await f.dispose();
  }
});

test("BLIK cancellation before confirmation preserves received money for review without allocating or restoring service", async ({
  browser,
  baseURL,
}) => {
  const f = await paymentFixtures(browser, baseURL);
  try {
    const target = await f.create("registration");
    await openSummary(f, target);
    const attempt = await start(f, target);
    await f.guardian.goto(`/app/walks/${target.parent}`);
    f.guardian.once("dialog", (dialog) => dialog.accept());
    await f.guardian
      .locator(`#registration-${target.id}`)
      .getByRole("button", { name: "Odwołaj zgłoszenie", exact: true })
      .click();
    await expect
      .poll(() => f.state(target))
      .toMatchObject({ status: "cancelled_on_time", payment_status: "none" });
    await f.guardian.goto(`/app/payments/${attempt.id}`);
    await simulationForm(f.guardian)
      .getByRole("button", {
        name: "Zapisz wynik lokalnej symulacji",
        exact: true,
      })
      .click();
    await expect
      .poll(() => f.attempt(attempt.id))
      .toMatchObject({
        status: "requires_review",
        confirmed_amount_cents: 10000,
        payment_id: null,
        review_reason: "no_longer_payable",
      });
    await expect(
      f.guardian
        .getByRole("status")
        .filter({ hasText: "Wpływ do sprawdzenia" }),
    ).toContainText("Nie został automatycznie przypisany");
    expect(await f.payments(target)).toEqual([]);
    expect(await f.state(target)).toMatchObject({
      status: "cancelled_on_time",
      payment_status: "none",
    });
    await f.settings({ enabled: false });
    for (const [page, path] of [
      [f.guardian, "/app"],
      [f.staff, "/admin"],
    ] as const) {
      await page.goto(`${path}/finance`);
      await page
        .locator(`#online-payments a[href="${path}/payments/${attempt.id}"]`)
        .click();
      await expect(
        page.getByRole("status").filter({ hasText: "Wpływ do sprawdzenia" }),
      ).toBeVisible();
      await expect(page.getByText(f.dogName, { exact: true })).toBeVisible();
    }
    await layout(f.staff, 320, "review-after-cancellation");
  } finally {
    await f.dispose();
  }
});

test("BLIK lost response and two tabs recover the same operation; simultaneous confirmations book once", async ({
  browser,
  baseURL,
}) => {
  const f = await paymentFixtures(browser, baseURL);
  try {
    const target = await f.create("registration"),
      form = await openSummary(f, target);
    const second = await f.ownerContext.newPage();
    await openSummary(f, target, 10000, second);
    const requestId = await form.locator('[name="request_id"]').inputValue();
    const url = new URL(f.guardian.url());
    const match = (value: URL) =>
      value.origin === url.origin && value.pathname === url.pathname;
    let intercepted = false;
    let resolve!: () => void, reject!: (error: unknown) => void;
    const committed = new Promise<void>((yes, no) => {
      resolve = yes;
      reject = no;
    });
    void committed.catch(() => {});
    const handler = async (route: Route) => {
      if (
        intercepted ||
        route.request().method() !== "POST" ||
        !route.request().headers()["next-action"] ||
        !route.request().postData()?.includes(requestId)
      )
        return route.continue();
      intercepted = true;
      try {
        const response = await route.fetch({ maxRedirects: 0 });
        expect([200, 303]).toContain(response.status());
        await expect.poll(() => f.attempts(target)).toHaveLength(1);
        expect((await f.attempts(target))[0]).toMatchObject({
          status: "pending",
          request_id: requestId,
        });
        resolve();
      } catch (error) {
        reject(error);
      } finally {
        await route.abort("failed");
      }
    };
    await f.guardian.route(match, handler);
    try {
      await form
        .getByRole("button", {
          name: "Rozpocznij lokalną symulację BLIK",
          exact: true,
        })
        .click();
      await committed;
      await expect(form.getByRole("alert")).toContainText(
        "Sprawdź próby w rozliczeniach",
      );
      await expect(form.getByRole("alert")).toBeFocused();
      await expect(form.locator('[name="request_id"]')).toHaveValue(requestId);
      expect(await f.payments(target)).toEqual([]);
      await layout(f.guardian, 390, "lost-start-response");
    } finally {
      await f.guardian.unroute(match, handler);
    }
    const recovered = await start(f, target, second);
    const retry = await start(f, target);
    expect(retry.id).toBe(recovered.id);
    expect(await f.attempts(target)).toHaveLength(1);
    for (const page of [f.guardian, second])
      await expect(
        simulationForm(page).getByLabel("Wynik lokalnego testu"),
      ).toHaveValue("success");
    await Promise.all(
      [f.guardian, second].map((page) =>
        simulationForm(page)
          .getByRole("button", {
            name: "Zapisz wynik lokalnej symulacji",
            exact: true,
          })
          .click(),
      ),
    );
    await assertOneReceipt(f, target, retry.id);
    expect(await f.attempts(target)).toHaveLength(1);
  } finally {
    await f.dispose();
  }
});

test("BLIK unresolved attempt beyond latest 20 remains discoverable with checkout off and can settle", async ({
  browser,
  baseURL,
}) => {
  const f = await paymentFixtures(browser, baseURL);
  try {
    const target = await f.create("registration");
    await openSummary(f, target);
    const old = await start(f, target);
    const filler = await f.create("registration");
    // Real failed operations make the older pending attempt fall outside the
    // latest-20 window; no rows belonging to another lifecycle are altered.
    for (let n = 0; n < 21; n++) {
      const begun = await checked(
        f.db.rpc("begin_online_payment", {
          p_guardian: f.owner.id,
          p_kind: filler.kind,
          p_target: filler.id,
          p_request_id: crypto.randomUUID(),
          p_environment: "simulator",
          p_expected_due_cents: 10000,
          p_merchant_id: "LOCAL-SIMULATOR",
        }),
      );
      const id = begun.attempt.id as string;
      await checked(
        f.db.rpc("bind_online_payment", {
          p_attempt: id,
          p_transaction_id: `SIM-${id}`,
          p_transaction_title: `SIM-${id}`,
          p_merchant_id: "LOCAL-SIMULATOR",
          p_checkout_url: `${baseURL}/app/payments/${id}`,
        }),
      );
      await checked(
        f.db.rpc("record_online_payment_outcome", {
          p_attempt: id,
          p_environment: "simulator",
          p_transaction_id: `SIM-${id}`,
          p_transaction_title: `SIM-${id}`,
          p_merchant_id: "LOCAL-SIMULATOR",
          p_status: "failed",
          p_amount_cents: 10000,
          p_paid_cents: 10000,
          p_currency: "PLN",
          p_reason: "synthetic_failure",
        }),
      );
    }
    expect(
      await f.sql.json(
        `select to_json(count(*)) from public.online_payment_attempts where guardian_id=${q(f.owner.id)} and created_at>${q(old.created_at)};`,
      ),
    ).toBe(21);
    await f.settings({ enabled: false });
    for (const [page, path] of [
      [f.guardian, "/app"],
      [f.staff, "/admin"],
    ] as const) {
      await page.goto(`${path}/finance`);
      await expect(
        page.locator(`#online-payments a[href="${path}/payments/${old.id}"]`),
      ).toBeVisible();
      await expect(page.locator('a[href^="/app/payments/new?"]')).toHaveCount(
        0,
      );
    }
    await f.guardian.goto(
      `/app/payments/new?kind=${filler.kind}&target=${filler.id}`,
    );
    await expect(
      f.guardian.getByRole("heading", {
        name: "Płatności BLIK są wyłączone",
        exact: true,
      }),
    ).toBeVisible();
    await simulate(f, old.id);
    await assertOneReceipt(f, target, old.id);
    // A resolved attempt older than the latest 20 may leave the unresolved
    // list. Its durable URL and the independently checked receipt remain.
    await f.guardian.goto(`/app/payments/${old.id}`);
    await expect(
      f.guardian.getByRole("status").filter({ hasText: "Opłacona" }),
    ).toBeVisible();
  } finally {
    await f.dispose();
  }
});
