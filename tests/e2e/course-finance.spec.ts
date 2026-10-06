import { test, expect, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import {
  LocalPostgres,
  literal as q,
  waitForLock,
} from "../helpers/local-postgres.mjs";
import {
  account,
  checked,
  disposeCareFixtures,
  localClients,
  login,
} from "./local-fixtures";
test.use({ trace: "off" });
const service = "60000000-0000-4000-8000-000000000001";
function dates(index: number) {
  return Array.from({ length: 5 }, (_, n) =>
    new Date(
      Date.UTC(new Date().getUTCFullYear() + 3, index * 2, 15 + n * 7, 12),
    ).toISOString(),
  );
}
async function makeCourse(
  api: ReturnType<typeof localClients>["db"],
  id: string,
  version: number,
  index: number,
) {
  await checked(
    api.rpc("create_course", {
      p_id: id,
      p_service: service,
      p_expected_service_version: version,
      p_title: "Kurs — rozliczenia próbne",
      p_capacity: 1,
      p_public_location: "Próbny park",
      p_exact_location: "PRYWATNE MIEJSCE FINANSÓW",
      p_starts: dates(index),
    }),
  );
  await checked(
    api.rpc("change_course", {
      p_id: id,
      p_expected_version: 1,
      p_action: "publish",
      p_note: "",
    }),
  );
}
test("course finance API: actual parent/key locks prevent overpayment, double refunds and stale settlements", async ({
  baseURL,
}) => {
  const { db, client } = localClients(baseURL),
    staff = client(),
    own = client(),
    stranger = client(),
    anonymous = client();
  const users: string[] = [],
    dogs: string[] = [],
    courses: string[] = [],
    enrollments: string[] = [];
  const observer = await new LocalPostgres().ready();
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
    const catalog = await checked(
      staff.from("services").select("version").eq("id", service).single(),
    );
    for (let i = 0; i < 2; i++) {
      const dog = await checked(
        db
          .from("dogs")
          .insert({ guardian_id: owner.id, name: `Finanse API ${i}` })
          .select("id")
          .single(),
      );
      dogs.push(dog!.id);
      const cycle = crypto.randomUUID(),
        enrollment = crypto.randomUUID();
      courses.push(cycle);
      enrollments.push(enrollment);
      await makeCourse(staff, cycle, catalog!.version, i);
      await checked(
        own.rpc("request_course_enrollment", {
          p_id: enrollment,
          p_course: cycle,
          p_dog: dog!.id,
          p_expected_course_version: 2,
        }),
      );
      await checked(
        staff.rpc("change_course_enrollment", {
          p_id: enrollment,
          p_expected_version: 1,
          p_action: "accept",
          p_note: "",
        }),
      );
    }
    const id = enrollments[0],
      second = enrollments[1];
    const pay = (target: string, amount: number, key = crypto.randomUUID()) =>
      `select public.record_payment(null,null,${amount},'transfer','Próba finansów',${q(key)},null,${q(target)});`;
    const refund = (
      payment: string,
      amount: number,
      key = crypto.randomUUID(),
    ) =>
      `select public.refund_course_payment(${q(payment)},${amount},'Próba zwrotu',${q(key)});`;
    const balance = async () =>
      checked(own.from("course_balances").select("*").eq("id", id).single());
    let locks = 0;
    const race = async (first: string, secondSql: string, pattern?: RegExp) => {
      const a = await new LocalPostgres().ready(),
        b = await new LocalPostgres().ready();
      let pending: Promise<{ value?: string[]; error?: Error }> | undefined;
      try {
        await a.asUser(admin.id);
        await b.asUser(admin.id);
        await a.query(first);
        pending = b.query(secondSql).then(
          (value) => ({ value }),
          (error) => ({ error }),
        );
        await waitForLock(observer, a, b);
        locks++;
        await a.query("commit;");
        const result = await pending;
        if (pattern) expect(result.error?.message).toMatch(pattern);
        else {
          expect(result.error).toBeUndefined();
          await b.query("commit;");
        }
      } finally {
        await Promise.all([a.close(), b.close()]);
        if (pending) await pending;
      }
    };
    await race(pay(id, 6000), pay(id, 5000), /Wpłata przekracza/);
    const rows = await checked(
      db
        .from("payments")
        .select("id,amount_cents")
        .eq("course_enrollment_id", id),
    );
    const firstPayment = rows![0].id;
    expect(rows).toHaveLength(1);
    await checked(
      staff.rpc("record_payment", {
        p_registration: null,
        p_package: null,
        p_consultation: null,
        p_course_enrollment: id,
        p_amount_cents: 4000,
        p_method: "cash",
        p_note: "Druga wpłata",
        p_request_id: crypto.randomUUID(),
      }),
    );
    const original = await checked(
      db
        .from("payments")
        .select("id,amount_cents")
        .eq("course_enrollment_id", id)
        .eq("method", "cash")
        .single(),
    );
    const key = crypto.randomUUID(),
      partialKey = crypto.randomUUID();
    await race(
      refund(firstPayment, 2000, partialKey) + pay(id, 2000, key),
      pay(second, 1000, key),
      /identyfikator wpłaty/,
    );
    expect(await balance()).toMatchObject({
      paid_cents: 10000,
      due_cents: 0,
      refunded_cents: 2000,
      version: 6,
    });
    const version = (await balance())!.version;
    await race(
      `select public.change_course_enrollment(${q(id)},${version},'cancel','Rezygnacja po wpłacie');`,
      pay(id, 1),
      /przyjętego/,
    );
    const cancelledVersion = (await balance())!.version,
      settleKey = crypto.randomUUID();
    const settle = (amount: number, request = crypto.randomUUID()) =>
      `select public.settle_course_enrollment(${q(id)},${cancelledVersion},${amount},'Uzgodniona kwota',${q(request)});`;
    await race(
      settle(3000, settleKey),
      settle(5000),
      /Zgłoszenie zmieniło się/,
    );
    expect(await balance()).toMatchObject({
      charge_cents: 3000,
      paid_cents: 10000,
      refund_due_cents: 7000,
      needs_settlement: false,
    });
    await race(
      refund(firstPayment, 2500),
      refund(firstPayment, 2000),
      /Zwrot przekracza/,
    );
    await checked(
      staff.rpc("refund_course_payment", {
        p_payment: firstPayment,
        p_amount_cents: 1500,
        p_note: "Zwrot pozostałej części",
        p_request_id: crypto.randomUUID(),
      }),
    );
    await checked(
      staff.rpc("refund_course_payment", {
        p_payment: original!.id,
        p_amount_cents: 3000,
        p_note: "Uzgodniony zwrot",
        p_request_id: crypto.randomUUID(),
      }),
    );
    expect(await balance()).toMatchObject({
      paid_cents: 3000,
      refunded_cents: 9000,
      refund_due_cents: 0,
      needs_review: false,
    });
    const retained = await checked(
      db.from("payments").select("id").eq("request_id", key).single(),
    );
    await race(
      `select public.settle_course_enrollment(${q(id)},${(await balance())!.version},0,'Zwolnienie z opłaty',${q(crypto.randomUUID())});`,
      refund(retained!.id, 2000),
    );
    expect(await balance()).toMatchObject({
      paid_cents: 1000,
      charge_cents: 0,
      refund_due_cents: 1000,
    });
    await checked(
      staff.rpc("void_payment", {
        p_payment: original!.id,
        p_note: "Zwrot ostatniej części",
      }),
    );
    expect(await balance()).toMatchObject({
      paid_cents: 0,
      due_cents: 0,
      refund_due_cents: 0,
      refunded_cents: 12000,
      needs_review: false,
    });
    // Exact lost-response retries survive full refunds and subsequent settlements.
    expect(
      await checked(
        staff.rpc("refund_course_payment", {
          p_payment: firstPayment,
          p_amount_cents: 2000,
          p_note: "Próba zwrotu",
          p_request_id: partialKey,
        }),
      ),
    ).toBe(partialKey);
    expect(
      await checked(
        staff.rpc("settle_course_enrollment", {
          p_id: id,
          p_expected_version: cancelledVersion,
          p_amount_cents: 3000,
          p_note: "Uzgodniona kwota",
          p_request_id: settleKey,
        }),
      ),
    ).toBe(cancelledVersion + 1);
    expect(
      await checked(stranger.from("course_balances").select("id").eq("id", id)),
    ).toEqual([]);
    expect(
      await checked(
        stranger
          .from("course_payment_refunds")
          .select("id")
          .eq("enrollment_id", id),
      ),
    ).toEqual([]);
    expect(
      (await anonymous.from("course_balances").select("id")).error,
    ).toBeTruthy();
    expect(
      (
        await own.rpc("refund_course_payment", {
          p_payment: firstPayment,
          p_amount_cents: 1,
          p_note: "Niedozwolony zwrot",
          p_request_id: crypto.randomUUID(),
        })
      ).error?.message,
    ).toContain("Brak uprawnień");
    expect(
      (await checked(
        db
          .from("payments")
          .select("amount_cents,status")
          .eq("course_enrollment_id", id),
      ))!
        .map((p) => p.amount_cents)
        .sort(),
    ).toEqual([2000, 4000, 6000]);
    expect(locks).toBe(6);
  } finally {
    await observer.close();
    if (enrollments.length)
      await checked(
        db.from("payments").delete().in("course_enrollment_id", enrollments),
      );
    if (courses.length)
      await checked(db.from("courses").delete().in("id", courses));
    await Promise.all([
      staff.auth.signOut(),
      own.auth.signOut(),
      stranger.auth.signOut(),
    ]);
    await disposeCareFixtures(db, users, dogs);
  }
});

test("course finance browser: partial receipts → cancellation → stale settlement/refund → exact partial refunds", async ({
  browser,
  baseURL,
}) => {
  const { db, client } = localClients(baseURL),
    staffApi = client(),
    ownerApi = client();
  const users: string[] = [],
    dogs: string[] = [],
    cycle = crypto.randomUUID(),
    enrollment = crypto.randomUUID();
  const adminContext = await browser.newContext({
      baseURL,
      viewport: { width: 1440, height: 1000 },
    }),
    ownerContext = await browser.newContext({
      baseURL,
      viewport: { width: 390, height: 844 },
    });
  const staff = await adminContext.newPage(),
    stale = await adminContext.newPage(),
    guardian = await ownerContext.newPage();
  const url = `/admin/courses/${cycle}?enrollment=${enrollment}`;
  const billing = (page: Page) => page.locator(`#rozliczenie-${enrollment}`);
  const receiptForm = (page: Page) =>
    billing(page)
      .locator("details")
      .filter({
        has: page
          .locator("summary")
          .getByText("Odnotuj otrzymaną wpłatę", { exact: true }),
      })
      .first();
  const settlement = (page: Page) =>
    billing(page)
      .locator("details")
      .filter({
        has: page.locator('input[name="enrollment_id"]'),
      })
      .first();
  async function screenshot(page: Page, name: string, width: number) {
    await page.setViewportSize({ width, height: 844 });
    await expect(billing(page)).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    const box = await billing(page).boundingBox();
    if (!box) throw new Error("Missing rendered billing panel");
    // A complete tall card must fit below the real sticky toolbar. This avoids
    // an element screenshot scrolling its title behind that toolbar.
    await page.setViewportSize({
      width,
      height: Math.max(844, Math.ceil(box.height) + 200),
    });
    await billing(page).evaluate((element) => {
      const toolbar = document
        .querySelector(".topbar")
        ?.getBoundingClientRect();
      window.scrollBy(
        0,
        element.getBoundingClientRect().top - (toolbar?.bottom || 0) - 16,
      );
    });
    expect(
      await billing(page).evaluate(
        (element) =>
          element.getBoundingClientRect().top >=
          (document.querySelector(".topbar")?.getBoundingClientRect().bottom ||
            0),
      ),
    ).toBe(true);
    mkdirSync("output/course-finance", { recursive: true });
    await billing(page).screenshot({
      path: `output/course-finance/${name}.png`,
    });
  }
  try {
    const admin = await account(db, users, "admin"),
      owner = await account(db, users, "client");
    for (const [api, user] of [
      [staffApi, admin],
      [ownerApi, owner],
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
        .insert({ guardian_id: owner.id, name: "Figa — rozliczenia" })
        .select("id")
        .single(),
    );
    dogs.push(dog!.id);
    const catalog = await checked(
      staffApi.from("services").select("version").eq("id", service).single(),
    );
    await makeCourse(staffApi, cycle, catalog!.version, 3);
    await checked(
      ownerApi.rpc("request_course_enrollment", {
        p_id: enrollment,
        p_course: cycle,
        p_dog: dog!.id,
        p_expected_course_version: 2,
      }),
    );
    await checked(
      staffApi.rpc("change_course_enrollment", {
        p_id: enrollment,
        p_expected_version: 1,
        p_action: "accept",
        p_note: "",
      }),
    );
    await login(staff, admin, "admin");
    await login(guardian, owner, "client");
    async function receipt(amount: string) {
      await staff.goto(url);
      const form = receiptForm(staff);
      await form.locator("summary").first().click();
      const requestKey = await form
        .locator('input[name="request_id"]')
        .inputValue();
      await form
        .getByLabel("Otrzymana kwota (zł)", { exact: true })
        .fill(amount);
      await form.getByRole("checkbox").check();
      await form
        .getByRole("button", { name: "Zapisz wpłatę", exact: true })
        .click();
      await expect(form.getByRole("status")).toContainText("Wpłata zapisana");
      await expect(
        form.getByRole("button", { name: "Zapisz wpłatę", exact: true }),
      ).toBeDisabled();
      if (amount === "40,00") {
        await form
          .getByRole("link", {
            name: "Odśwież saldo i przygotuj kolejny wpis →",
            exact: true,
          })
          .click();
        await expect(form.locator('input[name="request_id"]')).not.toHaveValue(
          requestKey,
        );
        await expect(
          form.getByLabel("Otrzymana kwota (zł)", { exact: true }),
        ).toHaveValue("60,00");
      }
    }
    await receipt("40,00");
    await receipt("60,00");
    await guardian.goto(`/app/courses/${cycle}`);
    const decision = guardian.locator("details").filter({
      has: guardian
        .locator("summary")
        .getByText("Rezygnacja z kursu", { exact: true }),
    });
    await decision.locator("summary").click();
    await decision
      .getByLabel("Powód dla opiekuna")
      .fill("Rezygnuję z dalszego udziału");
    await decision
      .getByRole("button", { name: "Zapisz zmianę", exact: true })
      .click();
    await expect(decision.getByRole("status")).toContainText(
      "Decyzja zapisana",
    );
    await expect(billing(guardian)).toContainText(
      "Kwota po rezygnacji do uzgodnienia",
    );
    await staff.goto(url);
    await stale.goto(url);
    for (const [page, amount, note] of [
      [staff, "30,00", "Uzgodniono 30 zł za udział"],
      [stale, "22,00", "Zachowaj wpisane uzgodnienie"],
    ] as const) {
      const form = settlement(page);
      await form.locator("summary").first().click();
      await form.getByLabel("Uzgodniona należność za kurs (zł)").fill(amount);
      await form.getByLabel("Powód uzgodnienia").fill(note);
      await form.getByRole("checkbox").check();
    }
    await settlement(staff)
      .getByRole("button", { name: "Zapisz uzgodnioną kwotę", exact: true })
      .click();
    await expect(settlement(staff).getByRole("status")).toContainText(
      "Uzgodniona kwota zapisana",
    );
    await settlement(stale)
      .getByRole("button", { name: "Zapisz uzgodnioną kwotę", exact: true })
      .click();
    await expect(settlement(stale).getByRole("alert")).toContainText(
      "Zgłoszenie zmieniło się",
    );
    await expect(
      settlement(stale).getByLabel("Uzgodniona należność za kurs (zł)"),
    ).toHaveValue("22,00");
    await expect(settlement(stale).getByLabel("Powód uzgodnienia")).toHaveValue(
      "Zachowaj wpisane uzgodnienie",
    );
    await screenshot(stale, "stale-settlement-390", 390);
    const receipts = await checked(
      db
        .from("payments")
        .select("id,amount_cents")
        .eq("course_enrollment_id", enrollment),
    );
    const first = receipts!.find((p) => p.amount_cents === 4000)!.id,
      second = receipts!.find((p) => p.amount_cents === 6000)!.id;
    const refundForm = async (
      page: Page,
      id: string,
      amount: string,
      note: string,
    ) => {
      await page.goto(url);
      await billing(page)
        .getByText("Historia wpłat i zwrotów (2)", { exact: true })
        .click();
      const row = page.locator(`#wplata-${id}`);
      await row.getByText("Odnotuj zwrot tej wpłaty", { exact: true }).click();
      await row.getByLabel("Zwrócona kwota (zł)").fill(amount);
      await row.getByLabel("Powód zwrotu").fill(note);
      await row.getByRole("checkbox").check();
      return row;
    };
    const ownRefund = await refundForm(
        staff,
        first,
        "20,00",
        "Pierwszy częściowy zwrot",
      ),
      staleRefund = await refundForm(
        stale,
        first,
        "40,00",
        "Nie utracimy tej notatki",
      );
    await ownRefund
      .getByRole("button", { name: "Odnotuj zwrot", exact: true })
      .click();
    await expect(ownRefund.getByRole("status")).toContainText(
      "Zwrot odnotowany",
    );
    await staleRefund
      .getByRole("button", { name: "Odnotuj zwrot", exact: true })
      .click();
    await expect(staleRefund.getByRole("alert")).toContainText(
      "Zwrot przekracza",
    );
    await expect(staleRefund.getByLabel("Zwrócona kwota (zł)")).toHaveValue(
      "40,00",
    );
    await expect(staleRefund.getByLabel("Powód zwrotu")).toHaveValue(
      "Nie utracimy tej notatki",
    );
    const rest = await refundForm(
      staff,
      second,
      "50,00",
      "Drugi częściowy zwrot",
    );
    await rest
      .getByRole("button", { name: "Odnotuj zwrot", exact: true })
      .click();
    await expect(rest.getByRole("status")).toContainText("Zwrot odnotowany");
    await guardian.reload();
    await expect(billing(guardian)).toContainText("Wpłaty po zwrotach");
    await expect(billing(guardian)).toContainText("30,00");
    await expect(billing(guardian)).not.toContainText("Pozostał zwrot");
    await billing(guardian)
      .getByText("Historia wpłat i zwrotów (2)", { exact: true })
      .click();
    await expect(billing(guardian)).toContainText("Pierwszy częściowy zwrot");
    await expect(billing(guardian)).toContainText("Drugi częściowy zwrot");
    await expect(billing(guardian).getByRole("button")).toHaveCount(0);
    await screenshot(guardian, "guardian-refunds-320", 320);
    await screenshot(staff, "staff-refunds-1440", 1440);
    await guardian.goto("/app/finance");
    await expect(guardian.getByLabel("Podsumowanie rozliczeń")).toContainText(
      "30,00",
    );
    await expect(guardian.locator('[id^="charge-course-"]')).toHaveCount(0);
    expect(
      await checked(
        ownerApi
          .from("course_balances")
          .select(
            "charge_cents,paid_cents,due_cents,refund_due_cents,refunded_cents,needs_review",
          )
          .eq("id", enrollment)
          .single(),
      ),
    ).toEqual({
      charge_cents: 3000,
      paid_cents: 3000,
      due_cents: 0,
      refund_due_cents: 0,
      refunded_cents: 7000,
      needs_review: false,
    });
  } finally {
    await Promise.all([
      adminContext.close(),
      ownerContext.close(),
      staffApi.auth.signOut(),
      ownerApi.auth.signOut(),
    ]);
    await checked(
      db.from("payments").delete().eq("course_enrollment_id", enrollment),
    );
    await checked(db.from("courses").delete().eq("id", cycle));
    await disposeCareFixtures(db, users, dogs);
  }
});
