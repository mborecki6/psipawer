import { test, expect, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import {
  account,
  checked,
  disposeCareFixtures,
  localClients,
  login,
} from "./local-fixtures";
import { walkJourney } from "./walk-journey";
test.use({ trace: "off" });
const fitnessService = "60000000-0000-4000-8000-000000000006";
function moneyCents(value: string) {
  const match = /^(\d+),(\d{2})$/.exec(value.replace(/[^\d,]/g, ""));
  if (!match) throw new Error("Expected a Polish money display");
  return Number(match[1]) * 100 + Number(match[2]);
}
async function cashTotal(page: Page) {
  await page.goto("/admin/finance");
  const card = page
    .getByRole("link")
    .filter({ has: page.getByText("Otrzymane wpłaty", { exact: true }) });
  await expect(card).toBeVisible();
  return moneyCents(await card.locator("strong").innerText());
}
async function screenshot(page: Page, name: string, width: number) {
  await page.setViewportSize({ width, height: 900 });
  await expect(
    page.getByRole("heading", {
      name: "Karta dla: Odbiorca próby",
      exact: true,
    }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  mkdirSync("output/gifts", { recursive: true });
  await page.screenshot({
    path: `output/gifts/${name}-${width}.png`,
    fullPage: true,
  });
}
test("issues, claims, spends and returns a gift card through both real local panels without counting its value twice", async ({
  page,
  browser,
  baseURL,
}) => {
  const { db, client } = localClients(baseURL),
    users: string[] = [],
    dogs: string[] = [],
    cards: string[] = [],
    packages: string[] = [];
  const ownerContext = await browser.newContext({ baseURL }),
    otherContext = await browser.newContext({ baseURL });
  const ownerPage = await ownerContext.newPage(),
    otherPage = await otherContext.newPage();
  const staff = client(),
    own = client(),
    stranger = client();
  try {
    const admin = await account(db, users, "admin"),
      owner = await account(db, users, "client"),
      other = await account(db, users, "client");
    for (const [api, user] of [
      [staff, admin],
      [own, owner],
      [stranger, other],
    ] as const)
      await checked(
        api.auth.signInWithPassword({
          email: user.email,
          password: user.password,
        }),
      );
    const dog = await checked(
      db
        .from("dogs")
        .insert({ guardian_id: owner.id, name: "Figa — karta próbna" })
        .select("id")
        .single(),
    );
    dogs.push(dog!.id);
    const terms = await checked(
      staff
        .from("services")
        .select("version,price_cents")
        .eq("id", fitnessService)
        .single(),
    );
    expect(terms!.price_cents).toBe(10000);
    const packageId = crypto.randomUUID();
    packages.push(packageId);
    await checked(
      own.rpc("request_fitness_package", {
        p_id: packageId,
        p_dog: dog!.id,
        p_service: fitnessService,
        p_expected_service_version: terms!.version,
        p_topic: "Fikcyjny cel ruchowy",
        p_availability: "Popołudnia",
      }),
    );
    await checked(
      staff.rpc("change_fitness_package", {
        p_id: packageId,
        p_expected_version: 1,
        p_action: "accept",
        p_note: "Przyjęcie próby",
        p_request_id: crypto.randomUUID(),
      }),
    );
    await login(page, admin, "admin");
    const originalCash = await cashTotal(page);
    await page.goto("/admin/gifts/new");
    await expect(
      page.getByRole("heading", { name: "Podaruj dobry czas.", exact: true }),
    ).toBeVisible();
    const issue = page
      .locator("form")
      .filter({ has: page.getByLabel("Rodzaj karty") });
    const id = await issue.locator('input[name="id"]').inputValue();
    cards.push(id);
    await issue.getByLabel("Od kogo", { exact: true }).fill("Darczyńca próby");
    await issue.getByLabel("Dla kogo", { exact: true }).fill("Odbiorca próby");
    await issue
      .getByLabel("Życzenia (opcjonalnie)")
      .fill(
        "Dobrego wspólnego czasu i radości z odkrywania świata. "
          .repeat(10)
          .slice(0, 500),
      );
    await issue.getByRole("checkbox").check();
    await issue
      .getByRole("button", { name: "Potwierdź wpłatę i wystaw kartę" })
      .click();
    await expect(issue.getByRole("status")).toContainText("Karta wystawiona");
    await issue.getByRole("link", { name: "Otwórz kartę" }).click();
    await expect(page).toHaveURL(new RegExp(`/admin/gifts/${id}$`));
    const code = (await page.locator("code").innerText()).replaceAll("-", "");
    expect(code).toMatch(/^[A-F0-9]{40}$/);
    expect(await cashTotal(page)).toBe(originalCash + 10000);
    await login(ownerPage, owner, "client");
    await ownerPage.goto("/app/gifts");
    const claim = ownerPage
      .locator("form")
      .filter({ has: ownerPage.getByLabel("Kod karty podarunkowej") });
    await claim.getByLabel("Kod karty podarunkowej").fill(code.toLowerCase());
    await claim.getByRole("button", { name: "Aktywuj moją kartę" }).click();
    await expect(claim.getByRole("status")).toContainText(
      "przypisana do Twojego konta",
    );
    await claim.getByRole("link", { name: "Otwórz kartę" }).click();
    await expect(
      ownerPage.getByRole("heading", { name: "Karta dla: Odbiorca próby" }),
    ).toBeVisible();
    await expect(ownerPage.locator("code")).toHaveCount(0);
    await expect(
      ownerPage.getByRole("button", { name: "Drukuj / zapisz jako PDF" }),
    ).toHaveCount(0);
    await login(otherPage, other, "client");
    await otherPage.goto(`/app/gifts/${id}`);
    await expect(
      otherPage.getByText("Odbiorca próby", { exact: true }),
    ).toHaveCount(0);
    expect(
      await checked(
        stranger.from("gift_card_balances").select("id").eq("id", id),
      ),
    ).toEqual([]);
    expect(
      await checked(
        own.from("gift_card_codes").select("code").eq("card_id", id),
      ),
    ).toEqual([]);
    expect(
      await checked(own.from("gift_card_sales").select("*").eq("card_id", id)),
    ).toEqual([]);
    const rejected = await own.rpc("redeem_gift_card", {
      p_card: id,
      p_expected_version: 2,
      p_kind: "fitness",
      p_target: packageId,
      p_amount_cents: 10000,
      p_note: "Niedozwolona próba opiekuna",
      p_request_id: crypto.randomUUID(),
    });
    expect(rejected.error).toBeTruthy();
    await page.goto(`/admin/gifts/${id}`);
    const redeem = page
      .locator("form")
      .filter({ has: page.getByLabel("Należność tego opiekuna") });
    await redeem
      .getByLabel("Należność tego opiekuna")
      .selectOption(`fitness:${packageId}`);
    await redeem.getByLabel("Kwota z karty (zł)").fill("40,00");
    await redeem.getByRole("button", { name: "Rozlicz z salda karty" }).click();
    await expect(redeem.getByRole("status")).toContainText(
      "nie zapisano nowego wpływu",
    );
    // A receipt ID must never be presented as a gift-card destination.
    await expect(
      redeem.getByRole("link", { name: "Otwórz kartę" }),
    ).toHaveCount(0);
    expect(await cashTotal(page)).toBe(originalCash + 10000);
    expect(
      (await checked(
        own
          .from("fitness_balances")
          .select("due_cents")
          .eq("id", packageId)
          .single(),
      ))!.due_cents,
    ).toBe(6000);
    await page.goto(`/admin/fitness/${packageId}`);
    await page
      .getByText("Historia wpłat i zwrotów (1)", { exact: true })
      .click();
    await page.getByText("Odnotuj zwrot tej wpłaty", { exact: true }).click();
    const refund = page
      .locator("form")
      .filter({ has: page.getByLabel("Kwota przywracana na kartę (zł)") });
    await refund.getByLabel("Kwota przywracana na kartę (zł)").fill("20,00");
    await refund
      .getByLabel("Powód zwrotu")
      .fill("Część wartości wraca na kartę");
    await refund.getByRole("checkbox").check();
    await refund
      .getByRole("button", { name: "Odnotuj zwrot", exact: true })
      .click();
    await expect(refund.getByRole("status")).toContainText("Zwrot odnotowany");
    const balance = () =>
      checked(
        own
          .from("gift_card_balances")
          .select("balance_cents,status,version")
          .eq("id", id)
          .single(),
      );
    expect((await balance())!.balance_cents).toBe(8000);
    expect(await cashTotal(page)).toBe(originalCash + 10000);
    await page.goto(`/admin/gifts/${id}`);
    await screenshot(page, "karta-i-saldo", 390);
    await screenshot(page, "karta-i-saldo", 320);
    mkdirSync("output/pdf", { recursive: true });
    await page.pdf({
      path: "output/pdf/karta-podarunkowa-proba.pdf",
      format: "A4",
      printBackground: true,
      preferCSSPageSize: true,
    });
    // Next retains loaded styles across client navigation. Gift-only print
    // rules must not turn the following finance screen into a blank page.
    await page.setViewportSize({ width: 1440, height: 900 });
    await page
      .getByRole("link", { name: "Pakiety i płatności", exact: true })
      .click();
    await expect(page).toHaveURL(/\/admin\/finance$/);
    await page.emulateMedia({ media: "print" });
    await expect(
      page.getByText("Otrzymane wpłaty", { exact: true }),
    ).toBeVisible();
    await page.emulateMedia({ media: "screen" });
    await page.goto(`/admin/gifts/${id}`);
    const lastCredit = page.locator("form").filter({
      has: page.getByLabel("Należność tego opiekuna"),
    });
    await lastCredit
      .getByLabel("Należność tego opiekuna")
      .selectOption(`fitness:${packageId}`);
    await lastCredit.getByLabel("Kwota z karty (zł)").fill("80,00");
    await lastCredit
      .getByRole("button", { name: "Rozlicz z salda karty" })
      .click();
    await expect(lastCredit.getByRole("status")).toContainText(
      "nie zapisano nowego wpływu",
    );
    await expect(
      lastCredit.getByRole("button", { name: "Rozlicz z salda karty" }),
    ).toBeDisabled();
    expect((await balance())!.balance_cents).toBe(0);
    const lastPayment = await checked(
      staff
        .from("payments")
        .select("id")
        .eq("fitness_package_id", packageId)
        .eq("gift_card_id", id)
        .eq("amount_cents", 8000)
        .single(),
    );
    await checked(
      staff.rpc("refund_fitness_payment", {
        p_payment: lastPayment!.id,
        p_amount_cents: 8000,
        p_note: "Powrót całej ostatniej wpłaty na tę samą kartę",
        p_request_id: crypto.randomUUID(),
      }),
    );
    expect((await balance())!.balance_cents).toBe(8000);
    await page.goto(`/admin/gifts/${id}`);
    const decision = page.locator("form").filter({
      has: page.getByRole("combobox", { name: "Działanie", exact: true }),
    });
    await decision
      .getByRole("combobox", { name: "Działanie", exact: true })
      .selectOption("cancel");
    await decision
      .getByLabel("Powód operacji", { exact: true })
      .fill("Uzgodnione wycofanie karty");
    await decision
      .getByRole("button", { name: "Zapisz decyzję", exact: true })
      .click();
    await expect(decision.getByRole("status")).toContainText(
      "Zmiana karty zapisana",
    );
    await page.goto(`/admin/gifts/${id}`);
    const cashRefund = page
      .locator("form")
      .filter({ has: page.getByLabel("Zwrócona kwota (zł)") });
    await cashRefund.getByLabel("Zwrócona kwota (zł)").fill("80,00");
    await cashRefund
      .getByLabel("Powód operacji", { exact: true })
      .fill("Potwierdzony zwrot poza aplikacją");
    await cashRefund.getByRole("checkbox").check();
    await cashRefund
      .getByRole("button", { name: "Odnotuj potwierdzony zwrot pieniędzy" })
      .click();
    await expect(cashRefund.getByRole("status")).toContainText(
      "Potwierdzony zwrot pieniędzy odnotowany",
    );
    expect((await balance())!).toMatchObject({
      balance_cents: 0,
      status: "cancelled",
    });
    expect(await cashTotal(page)).toBe(originalCash + 2000);
    await ownerPage.goto(`/app/gifts/${id}`);
    await expect(
      ownerPage.getByText("Zwrot na saldo karty", { exact: true }),
    ).toHaveCount(2);
    await expect(
      ownerPage.getByText("Zwrot pieniędzy za kartę", { exact: true }),
    ).toBeVisible();
    await expect(
      ownerPage.getByText("Ta karta została wycofana.", { exact: true }),
    ).toBeVisible();
  } finally {
    await ownerContext.close();
    await otherContext.close();
    for (const api of [staff, own, stranger]) await api.auth.signOut();
    await disposeCareFixtures(db, users, dogs, async () => {
      if (packages.length)
        await checked(
          db.from("payments").delete().in("fitness_package_id", packages),
        );
      if (cards.length)
        await checked(db.from("gift_cards").delete().in("id", cards));
      if (packages.length)
        await checked(db.from("fitness_packages").delete().in("id", packages));
    });
  }
});

test("a service card requires an explicit walk-service correction, rejects a stale editor and preserves the binding after use", async ({
  browser,
  baseURL,
}) => {
  const j = await walkJourney(browser, baseURL),
    cards: string[] = [];
  const stale = await j.staff.context().newPage();
  try {
    const catalogue = await checked(
      j.staffDb
        .from("services")
        .select("id,name,price_cents")
        .eq("kind", "group")
        .eq("active", true)
        .order("id")
        .limit(2),
    );
    expect(catalogue).toHaveLength(2);
    const [target, wrong] = catalogue!;
    const walk = await j.createWalk("Spacer karty na usługę"),
      registration = await j.register(walk);
    const dog = await checked(
      j.staffDb.from("dogs").select("guardian_id").eq("id", j.dogs[0]).single(),
    );
    await checked(
      j.staffDb.rpc("bind_gift_card_service", {
        p_registration: registration,
        p_package: null,
        p_service: wrong.id,
        p_expected_version: 0,
        p_note: "Fikcyjna pomyłka przed pierwszym rozliczeniem",
      }),
    );
    await j.staff.goto("/admin/gifts/new");
    const issue = j.staff
      .locator("form")
      .filter({ has: j.staff.getByLabel("Rodzaj karty") });
    const id = await issue.locator('input[name="id"]').inputValue();
    cards.push(id);
    await issue.getByLabel("Rodzaj karty").selectOption(target.id);
    await expect(issue.getByLabel("Wartość karty (zł)")).toHaveValue("100,00");
    await expect(issue.getByLabel("Wartość karty (zł)")).toHaveAttribute(
      "readonly",
      "",
    );
    await issue
      .getByLabel("Od kogo", { exact: true })
      .fill("Darczyńca usługi próbnej");
    await issue
      .getByLabel("Dla kogo", { exact: true })
      .fill("Opiekun usługi próbnej");
    await issue.getByLabel("Konto opiekuna").selectOption(dog!.guardian_id);
    await issue.getByRole("checkbox").check();
    await issue
      .getByRole("button", { name: "Potwierdź wpłatę i wystaw kartę" })
      .click();
    await expect(issue.getByRole("status")).toContainText("Karta wystawiona");
    await issue.getByRole("link", { name: "Otwórz kartę" }).click();
    const choose = async (page: Page) => {
      const form = page
        .locator("form")
        .filter({ has: page.getByLabel("Należność tego opiekuna") });
      await form
        .getByLabel("Należność tego opiekuna")
        .selectOption(`registration:${registration}`);
      return form;
    };
    await choose(j.staff);
    await stale.goto(`/admin/gifts/${id}`);
    const staleCredit = await choose(stale);
    const correction = (page: Page) =>
      page.locator("form").filter({
        has: page.getByRole("button", {
          name: "Skoryguj powiązanie z usługą",
          exact: true,
        }),
      });
    const first = correction(j.staff),
      second = correction(stale);
    await expect(first.locator('input[name="expected_version"]')).toHaveValue(
      "1",
    );
    await expect(
      j.staff.getByText(
        new RegExp(wrong.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
      ),
    ).toBeVisible();
    await expect(
      staleCredit.getByRole("button", { name: "Rozlicz z salda karty" }),
    ).toBeDisabled();
    await second
      .getByLabel("Powód operacji", { exact: true })
      .fill("Treść starszego formularza do zachowania");
    await first
      .getByLabel("Powód operacji", { exact: true })
      .fill("Potwierdzona korekta zgodna z usługą zakupionej karty");
    await first
      .getByRole("button", { name: "Skoryguj powiązanie z usługą" })
      .click();
    await expect(first.getByRole("status")).toContainText(
      "Usługa została jawnie powiązana z rozliczeniem",
    );
    await second
      .getByRole("button", { name: "Skoryguj powiązanie z usługą" })
      .click();
    await expect(second.getByRole("alert")).toContainText(
      "Powiązanie usługi zmieniło się",
    );
    await expect(
      second.getByLabel("Powód operacji", { exact: true }),
    ).toHaveValue("Treść starszego formularza do zachowania");
    const current = await checked(
      j.staffDb
        .from("gift_card_service_links")
        .select("service_id,version")
        .eq("registration_id", registration)
        .single(),
    );
    expect(current).toMatchObject({ service_id: target.id, version: 2 });
    await first
      .getByRole("link", {
        name: "Wczytaj aktualne saldo i przygotuj kolejną operację",
      })
      .click();
    const credit = await choose(j.staff);
    await expect(correction(j.staff)).toHaveCount(0);
    await credit.getByRole("button", { name: "Rozlicz z salda karty" }).click();
    await expect(credit.getByRole("status")).toContainText(
      "nie zapisano nowego wpływu",
    );
    const payment = await checked(
      j.ownerDb
        .from("payments")
        .select("amount_cents,method,gift_card_id")
        .eq("registration_id", registration)
        .single(),
    );
    expect(payment).toMatchObject({
      amount_cents: 10000,
      method: "gift_card",
      gift_card_id: id,
    });
    await j.guardian.goto(`/app/gifts/${id}`);
    await expect(
      j.guardian.getByText("Saldo wykorzystane", { exact: true }),
    ).toBeVisible();
    await expect(
      j.guardian.getByText(`Do wykorzystania na: ${target.name}`, {
        exact: true,
      }),
    ).toBeVisible();
    const rejected = await j.staffDb.rpc("bind_gift_card_service", {
      p_registration: registration,
      p_package: null,
      p_service: wrong.id,
      p_expected_version: 2,
      p_note: "Niedozwolona zmiana po użyciu karty",
    });
    expect(rejected.error?.message).toContain(
      "zachowuje wcześniejsze powiązanie",
    );
  } finally {
    await stale.close();
    if (cards.length) {
      await checked(j.db.from("payments").delete().in("gift_card_id", cards));
      await checked(j.db.from("gift_cards").delete().in("id", cards));
    }
    await j.dispose();
  }
});
