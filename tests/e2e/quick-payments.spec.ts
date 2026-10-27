import {
  expect,
  type Browser,
  type Locator,
  type Page,
} from "@playwright/test";
import {
  test,
  account,
  checked,
  cleanupSteps,
  disposeCareFixtures,
  freeCalendarStart,
  localClients,
  login,
  setupLocalPractitioner,
} from "./local-fixtures";
import { loseCommittedReply } from "./transport-journey";
import { revealFor } from "./details-ui";

test.use({ trace: "off" });

async function fixtures(browser: Browser, baseURL: string | undefined) {
  const { db, client } = localClients(baseURL);
  const users: string[] = [],
    dogs: string[] = [],
    services: string[] = [],
    courses: string[] = [],
    fitness: string[] = [];
  const staffApi = client(),
    ownerApi = client();
  const staffContext = await browser.newContext({
      baseURL,
      viewport: { width: 390, height: 844 },
    }),
    ownerContext = await browser.newContext({
      baseURL,
      viewport: { width: 390, height: 844 },
    });
  const staff = await staffContext.newPage(),
    guardian = await ownerContext.newPage();
  const dispose = () =>
    cleanupSteps(
      () => staffContext.close(),
      () => ownerContext.close(),
      () => staffApi.auth.signOut(),
      () => ownerApi.auth.signOut(),
      () =>
        disposeCareFixtures(db, users, dogs, async () => {
          // Every target and service below belongs to these isolated dogs.
          // IDs are tracked before RPCs, including an unconfirmed setup commit.
          await checked(db.from("payments").delete().in("dog_id", dogs));
          if (courses.length)
            await checked(db.from("courses").delete().in("id", courses));
          if (fitness.length)
            await checked(
              db.from("fitness_packages").delete().in("id", fitness),
            );
          const packages = await checked(
            db.from("packages").select("id").in("dog_id", dogs),
          );
          if (packages?.length) {
            const ids = packages.map((item) => item.id);
            await checked(
              db.from("package_transactions").delete().in("package_id", ids),
            );
            await checked(db.from("packages").delete().in("id", ids));
          }
          if (services.length) {
            await checked(
              db.from("service_revisions").delete().in("service_id", services),
            );
            await checked(db.from("services").delete().in("id", services));
          }
        }),
      async () => {
        for (const [table, ids] of [
          ["profiles", users],
          ["dogs", dogs],
          ["services", services],
          ["courses", courses],
          ["fitness_packages", fitness],
        ] as const)
          if (ids.length)
            expect(
              await checked(db.from(table).select("id").in("id", ids)),
            ).toEqual([]);
      },
    );
  try {
    const admin = await account(db, users, "admin"),
      owner = await account(db, users, "client");
    await setupLocalPractitioner(db, users, admin.id);
    for (const [api, user] of [
      [staffApi, admin],
      [ownerApi, owner],
    ] as const)
      await checked(api.auth.signInWithPassword(user));
    async function dog(label: string) {
      const id = crypto.randomUUID();
      dogs.push(id);
      await checked(
        db.from("dogs").insert({ id, guardian_id: owner.id, name: label }),
      );
      return id;
    }
    async function service(kind: "course" | "fitness") {
      if (!dogs.length)
        throw new Error("Create an owned dog before its service.");
      const id = crypto.randomUUID(),
        title = `${kind === "course" ? "Kurs" : "Fitness"} — lokalna próba szybkiej wpłaty ${id.slice(0, 8)}`;
      services.push(id);
      await checked(
        db.from("services").insert({
          id,
          practice_id: "00000000-0000-4000-8000-000000000001",
          name: title,
          description: "Fikcyjna oferta lokalnego testu wpłat.",
          kind: kind === "course" ? "course" : "package",
          booking_flow: kind === "course" ? "catalogue" : "fitness",
          meeting_mode: "in_person",
          course_format: kind === "course" ? "group" : null,
          price_cents: 40000,
          price_unit: "za całość",
          duration_minutes: kind === "course" ? 60 : 45,
          sessions_count: kind === "course" ? 2 : 4,
          active: true,
          is_test_price: true,
          source_url: "https://www.psipawer.pl/lokalny-test",
        }),
      );
      return { id, title };
    }
    const saved = (kind: "course" | "fitness", target: string) =>
      checked(
        db
          .from("payments")
          .select(
            "id,request_id,amount_cents,method,note,status,guardian_id,dog_id",
          )
          .eq(
            kind === "course" ? "course_enrollment_id" : "fitness_package_id",
            target,
          )
          .order("amount_cents")
          .order("id"),
      );
    await login(staff, admin, "admin");
    await login(guardian, owner, "client");
    return {
      db,
      staffApi,
      ownerApi,
      owner,
      staff,
      guardian,
      courses,
      fitness,
      dog,
      service,
      saved,
      dispose,
    };
  } catch (error) {
    await dispose();
    throw error;
  }
}

function fact(charge: Locator, label: string) {
  return charge
    .locator('dl[aria-label="Saldo należności"] > div')
    .filter({ hasText: label })
    .locator("dd");
}
async function balance(charge: Locator, paid: number, due: number) {
  for (const [label, cents] of [
    ["Aktualna należność", 40000],
    ["Wpłacono", paid],
    ["Pozostało", due],
  ] as const)
    await expect(fact(charge, label)).toHaveText(
      new RegExp(`^${(cents / 100).toFixed(2).replace(".", ",")}\\s*zł$`),
    );
}
async function openPayment(charge: Locator) {
  await charge
    .locator("summary")
    .getByText("Odnotuj wpłatę", { exact: true })
    .click();
  const form = charge.locator("form");
  await expect(
    form.getByLabel("Otrzymana kwota (zł)", { exact: true }),
  ).toBeEnabled();
  return form;
}
const receiptButton = (form: Locator) =>
  form.getByRole("button", { name: "Odnotuj otrzymaną wpłatę", exact: true });

async function voicePlaceholder(page: Page, meeting: Locator) {
  const button = meeting.getByRole("button", {
    name: /Notatka głosowa.*Wkrótce/,
    includeHidden: true,
  });
  await revealFor(button);
  await button.focus();
  await page.keyboard.press("Enter");
  await expect(button).toHaveAttribute("aria-expanded", "true");
  const message = page.locator(
    `[id="${await button.getAttribute("aria-controls")}"]`,
  );
  await expect(message).toContainText(/Teraz nic się nie\s*nagrywa/);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  ).toBe(true);
  await button.press("Enter");
  await expect(button).toHaveAttribute("aria-expanded", "false");
  await expect(message).toBeHidden();
}

test("quick course receipts stay in finance: 400 zł → 100 zł → 300 zł, rejected amounts preserve the command and guardian history matches", async ({
  browser,
  baseURL,
}, info) => {
  const f = await fixtures(browser, baseURL);
  const course = crypto.randomUUID(),
    enrollment = crypto.randomUUID();
  try {
    const dog = await f.dog("Figa — fikcyjna próba wpłat kursu"),
      service = await f.service("course");
    f.courses.push(course);
    const start = await freeCalendarStart(f.db, {
      after: Date.now() + 3 * 366 * 86400000,
      durationMinutes: 60,
      offsetsMinutes: [0, 7 * 1440],
      afterLast: true,
    });
    await checked(
      f.staffApi.rpc("create_course", {
        p_id: course,
        p_service: service.id,
        p_expected_service_version: 1,
        p_title: service.title,
        p_capacity: 2,
        p_public_location: "Fikcyjny park szybkich wpłat",
        p_exact_location: "FIKCYJNE MIEJSCE TESTOWE",
        p_starts: [
          start,
          new Date(Date.parse(start) + 7 * 86400000).toISOString(),
        ],
      }),
    );
    await checked(
      f.staffApi.rpc("change_course", {
        p_id: course,
        p_expected_version: 1,
        p_action: "publish",
        p_note: "Lokalna próba",
      }),
    );
    await checked(
      f.ownerApi.rpc("request_course_enrollment", {
        p_id: enrollment,
        p_course: course,
        p_dog: dog,
        p_expected_course_version: 2,
      }),
    );
    await checked(
      f.staffApi.rpc("change_course_enrollment", {
        p_id: enrollment,
        p_expected_version: 1,
        p_action: "accept",
        p_note: "Lokalna próba",
      }),
    );
    const courseMeeting = await checked(
      f.db
        .from("course_sessions")
        .select("id,ordinal")
        .eq("course_id", course)
        .order("ordinal")
        .limit(1)
        .single(),
    );
    await f.staff.goto(
      `/admin/courses/${course}#spotkanie-${courseMeeting!.id}`,
    );
    await voicePlaceholder(
      f.staff,
      f.staff.locator(`#spotkanie-${courseMeeting!.ordinal}`),
    );
    await f.guardian.goto(
      `/app/courses/${course}#spotkanie-${courseMeeting!.id}`,
    );
    await expect(
      f.guardian.getByRole("button", {
        name: /Notatka głosowa/,
        includeHidden: true,
      }),
    ).toHaveCount(0);
    const currentBalance = () =>
      checked(
        f.ownerApi
          .from("course_balances")
          .select("agreed_price_cents,charge_cents,paid_cents,due_cents")
          .eq("id", enrollment)
          .single(),
      );
    await f.staff.goto(`/admin/finance?charge=course-${enrollment}`);
    const charge = f.staff.locator(`#charge-course-${enrollment}`);
    await balance(charge, 0, 40000);
    await expect(charge).toContainText(service.title);
    await expect(charge).toContainText("Test client");
    const form = await openPayment(charge),
      amount = form.getByLabel("Otrzymana kwota (zł)", { exact: true }),
      firstKey = await form.locator('[name="request_id"]').inputValue();
    await form.getByLabel("Metoda płatności").selectOption("cash");
    await form
      .locator("summary")
      .getByText("Dodaj notatkę (opcjonalnie)", { exact: true })
      .click();
    const note = `Fikcyjna pierwsza wpłata kursu ${enrollment}`;
    await form.getByLabel("Notatka (opcjonalnie)", { exact: true }).fill(note);
    for (const width of [320, 390, 768, 1440]) {
      await f.staff.setViewportSize({ width, height: 900 });
      await expect(amount).toBeVisible();
      await expect(receiptButton(form)).toBeEnabled();
      expect(
        await f.staff.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1,
        ),
      ).toBe(true);
      if (width === 390 || width === 1440)
        await f.staff.screenshot({
          path: info.outputPath(`quick-course-receipt-${width}.png`),
          fullPage: true,
        });
    }
    for (const invalid of ["0", "-1", "400,01"]) {
      await amount.fill(invalid);
      await receiptButton(form).click();
      await expect(form.getByRole("alert")).toBeVisible();
      await expect(form.locator('[name="request_id"]')).toHaveValue(firstKey);
      await expect(amount).toHaveValue(invalid);
      await expect(form.getByLabel("Metoda płatności")).toHaveValue("cash");
      await expect(
        form.getByLabel("Notatka (opcjonalnie)", { exact: true }),
      ).toHaveValue(note);
      await expect(f.staff).toHaveURL(/\/admin\/finance(?:[?#]|$)/);
      expect(await f.saved("course", enrollment)).toEqual([]);
    }
    await amount.fill("100");
    await receiptButton(form).click();
    await expect(form.getByRole("status")).toContainText("Wpłata zapisana");
    await balance(charge, 10000, 30000);
    await expect(f.staff).toHaveURL(/\/admin\/finance(?:[?#]|$)/);
    await expect(amount).toHaveValue("");
    const secondKey = await form.locator('[name="request_id"]').inputValue();
    expect(secondKey).not.toBe(firstKey);
    await amount.fill("300,01");
    await receiptButton(form).click();
    await expect(form.getByRole("alert")).toContainText(
      "Wpłata przekracza pozostałą kwotę do zapłaty.",
    );
    await expect(form.locator('[name="request_id"]')).toHaveValue(secondKey);
    await expect(amount).toHaveValue("300,01");
    expect(await f.saved("course", enrollment)).toHaveLength(1);
    await amount.fill("300");
    await form.getByLabel("Metoda płatności").selectOption("cash");
    await receiptButton(form).click();
    await expect(charge).toHaveCount(0);
    const finalConfirmation = f.staff.locator(
      `[data-payment-request="${secondKey}"]`,
    );
    await expect(finalConfirmation.getByRole("status")).toContainText(
      "Wpłata zapisana",
    );
    await expect(finalConfirmation).toContainText(/300,00\s*zł/);
    await expect(finalConfirmation).toContainText(service.title);
    await finalConfirmation
      .getByRole("button", {
        name: "Zamknij potwierdzenie wpłaty",
        exact: true,
      })
      .click();
    await expect(finalConfirmation).toHaveCount(0);
    await expect(f.staff).toHaveURL(/\/admin\/finance(?:[?#]|$)/);
    const receipts = (await f.saved("course", enrollment))!;
    expect(receipts).toHaveLength(2);
    expect(receipts[0]).toMatchObject({
      request_id: firstKey,
      amount_cents: 10000,
      method: "cash",
      note,
      status: "paid",
      guardian_id: f.owner.id,
      dog_id: dog,
    });
    expect(receipts[1]).toMatchObject({
      request_id: secondKey,
      amount_cents: 30000,
      method: "cash",
      status: "paid",
    });
    expect(await currentBalance()).toMatchObject({
      agreed_price_cents: 40000,
      charge_cents: 40000,
      paid_cents: 40000,
      due_cents: 0,
    });
    expect(
      await checked(
        f.staffApi
          .from("courses")
          .select("price_cents")
          .eq("id", course)
          .single(),
      ),
    ).toMatchObject({ price_cents: 40000 });
    await f.guardian.goto("/app/finance");
    await expect(
      f.guardian.locator(`#charge-course-${enrollment}`),
    ).toHaveCount(0);
    await expect(
      f.guardian.getByText("Wszystko rozliczone", { exact: true }),
    ).toBeVisible();
    for (const [index, total] of ["100", "300"].entries()) {
      const row = f.guardian.locator(`#payment-${receipts[index].id}`);
      await expect(row).toBeVisible();
      await expect(row).toContainText(service.title);
      await expect(row).toContainText(new RegExp(`${total},00\\s*zł`));
      await expect(row).toContainText("Gotówka");
    }
    await expect(
      f.guardian.getByRole("button", {
        name: "Odnotuj otrzymaną wpłatę",
        exact: true,
      }),
    ).toHaveCount(0);
  } finally {
    await f.dispose();
  }
});

for (const full of [false, true])
  test(`quick fitness ${full ? "full" : "partial"} receipt survives a committed response loss and another row refresh; exact retry keeps one payment and one set of effects`, async ({
    browser,
    baseURL,
  }) => {
    test.setTimeout(180000);
    const f = await fixtures(browser, baseURL);
    try {
      const firstDog = await f.dog("Figa A — fikcyjna próba wpłat fitnessu"),
        service = await f.service("fitness");
      // Three consecutive owned charges ensure a neighbour shares the middle
      // charge's twenty-row finance page without changing any existing dates.
      for (let index = 0; index < 3; index++) {
        const dog =
            index === 0
              ? firstDog
              : await f.dog(`Figa ${index} — fikcyjna próba wpłat fitnessu`),
          id = crypto.randomUUID();
        f.fitness.push(id);
        await checked(
          f.ownerApi.rpc("request_fitness_package", {
            p_id: id,
            p_dog: dog,
            p_service: service.id,
            p_expected_service_version: 1,
            p_topic: "Fikcyjna próba częściowej wpłaty",
            p_availability: "Lokalny test",
          }),
        );
        await checked(
          f.staffApi.rpc("change_fitness_package", {
            p_id: id,
            p_expected_version: 1,
            p_action: "accept",
            p_note: "Lokalna próba",
            p_request_id: crypto.randomUUID(),
          }),
        );
      }
      const targetA = f.fitness[1];
      const fitnessMeeting = await checked(
        f.db
          .from("fitness_sessions")
          .select("id")
          .eq("package_id", f.fitness[0])
          .order("ordinal")
          .limit(1)
          .single(),
      );
      await f.staff.goto(
        `/admin/fitness/${f.fitness[0]}#spotkanie-${fitnessMeeting!.id}`,
      );
      await voicePlaceholder(
        f.staff,
        f.staff.locator(`#spotkanie-${fitnessMeeting!.id}`),
      );
      await f.guardian.goto(
        `/app/fitness/${f.fitness[0]}#spotkanie-${fitnessMeeting!.id}`,
      );
      await expect(
        f.guardian.getByRole("button", {
          name: /Notatka głosowa/,
          includeHidden: true,
        }),
      ).toHaveCount(0);
      if (!full) {
        // Eighteen cheap owned package charges plus the three fitness charges
        // guarantee two list pages even in an otherwise empty local database.
        for (let index = 0; index < 18; index++)
          await checked(
            f.staffApi.rpc("purchase_package", {
              p_dog: firstDog,
              p_name: `Fikcyjny pakiet paginacji ${index + 1}`,
              p_entries: 1,
              p_price_cents: 1000,
              p_expires_at: null,
              p_note: "Wyłącznie lokalna próba powrotu formularza.",
            }),
          );
      }
      await f.staff.goto(`/admin/finance?charge=fitness-${targetA}`);
      const chargeA = f.staff.locator(`#charge-fitness-${targetA}`);
      await balance(chargeA, 0, 40000);
      let targetB: string | undefined;
      for (const candidate of [f.fitness[0], f.fitness[2]])
        if (await f.staff.locator(`#charge-fitness-${candidate}`).count()) {
          targetB = candidate;
          break;
        }
      if (!targetB)
        throw new Error(
          "Two owned fitness charges must share this finance page.",
        );
      const chargeB = f.staff.locator(`#charge-fitness-${targetB}`),
        formA = await openPayment(chargeA),
        formB = await openPayment(chargeB);
      const received = full ? "400" : "100";
      await formA
        .getByLabel("Otrzymana kwota (zł)", { exact: true })
        .fill(received);
      await formA.getByLabel("Metoda płatności").selectOption("other");
      await formA
        .locator("summary")
        .getByText("Dodaj notatkę (opcjonalnie)", { exact: true })
        .click();
      const note = `Fikcyjna wpłata fitness z utratą odpowiedzi ${targetA}`;
      await formA
        .getByLabel("Notatka (opcjonalnie)", { exact: true })
        .fill(note);
      const requestA = await formA.locator('[name="request_id"]').inputValue();
      const effects = async (paymentId: string) => ({
        audit: await checked(
          f.db
            .from("audit_events")
            .select("id")
            .eq("entity_id", paymentId)
            .eq("event", "payment_recorded")
            .order("id"),
        ),
        history: await checked(
          f.db
            .from("fitness_history")
            .select("id,details")
            .eq("package_id", targetA)
            .eq("action", "payment_recorded")
            .order("id"),
        ),
        notices: await checked(
          f.db
            .from("notifications")
            .select("id,source_key")
            .eq("fitness_package_id", targetA)
            .eq("recipient_id", f.owner.id)
            .eq("kind", "fitness_payment_recorded")
            .order("id"),
        ),
      });
      let savedA: NonNullable<Awaited<ReturnType<typeof f.saved>>> | undefined,
        effectsA: Awaited<ReturnType<typeof effects>> | undefined;
      await loseCommittedReply(f.staff, formA, requestA, async () => {
        savedA = (await f.saved("fitness", targetA))!;
        expect(savedA).toHaveLength(1);
        expect(savedA[0]).toMatchObject({
          request_id: requestA,
          amount_cents: full ? 40000 : 10000,
          method: "other",
          note,
          status: "paid",
        });
        effectsA = await effects(savedA[0].id);
        expect(effectsA.audit).toHaveLength(1);
        expect(effectsA.history).toHaveLength(1);
        expect(effectsA.notices).toHaveLength(1);
      });
      if (!full) {
        const pager = f.staff.getByRole("navigation", {
          name: "Strony należności",
          exact: true,
        });
        const next = pager.getByRole("link", {
          name: "Następne →",
          exact: true,
        });
        const forward = (await next.count()) > 0;
        await (
          forward
            ? next
            : pager.getByRole("link", { name: "← Poprzednie", exact: true })
        ).click();
        await expect(chargeA).toHaveCount(0);
        const savedNotice = f.staff.locator(
          `[data-payment-request="${requestA}"]`,
        );
        await expect(savedNotice.getByRole("alert")).toContainText(
          "Nie udało się potwierdzić zapisu",
        );
        await pager
          .getByRole("link", {
            name: forward ? "← Poprzednie" : "Następne →",
            exact: true,
          })
          .click();
        await expect(formA.getByRole("alert")).toContainText(
          "Przywrócono wysłaną wpłatę i jej identyfikator",
        );
        await expect(formA.locator('[name="request_id"]')).toHaveValue(
          requestA,
        );
        await expect(formA.locator('[name="amount"]')).toHaveValue(received);
        await expect(formA.locator('[name="method"]')).toHaveValue("other");
        await expect(formA.locator('[name="note"]')).toHaveValue(note);
        await expect(savedNotice).toHaveCount(0);
        await openPayment(chargeB);
      }
      await formB
        .getByLabel("Otrzymana kwota (zł)", { exact: true })
        .fill("50");
      await formB.getByLabel("Metoda płatności").selectOption("cash");
      await receiptButton(formB).click();
      await expect(
        f.staff
          .getByRole("status")
          .filter({ hasText: "Wpłata zapisana" })
          .first(),
      ).toBeVisible();
      const savedB = await f.saved("fitness", targetB);
      expect(savedB).toHaveLength(1);
      const recovery = f.staff.locator(`[data-payment-request="${requestA}"]`);
      const retained = full ? recovery.locator("form") : formA;
      if (full) {
        await expect(chargeA).toHaveCount(0);
        await expect(recovery).toContainText(service.title);
        await expect(recovery).toContainText(/400,00\s*zł/);
        await expect(recovery).not.toContainText("Pozostało");
        await expect(
          recovery.getByRole("button", {
            name: "Zamknij potwierdzenie wpłaty",
            exact: true,
          }),
        ).toHaveCount(0);
      } else {
        await balance(chargeA, 10000, 30000);
        await expect(recovery).toHaveCount(0);
      }
      await expect(retained.locator('[name="request_id"]')).toHaveValue(
        requestA,
      );
      await expect(retained.locator('[name="target_id"]')).toHaveValue(targetA);
      await expect(retained.locator('[name="target_kind"]')).toHaveValue(
        "fitness",
      );
      await expect(retained.locator('[name="amount"]')).toHaveValue(received);
      await expect(retained.locator('[name="method"]')).toHaveValue("other");
      await expect(retained.locator('[name="note"]')).toHaveValue(note);
      await expect((full ? recovery : formA).getByRole("alert")).toContainText(
        "Nie udało się potwierdzić zapisu",
      );
      if (full)
        await recovery
          .getByRole("button", {
            name: "Ponów potwierdzenie tej wpłaty",
            exact: true,
          })
          .click();
      else await receiptButton(formA).click();
      await expect((full ? recovery : formA).getByRole("status")).toContainText(
        "Wpłata zapisana",
      );
      expect(await f.saved("fitness", targetA)).toEqual(savedA);
      expect(await f.saved("fitness", targetB)).toEqual(savedB);
      expect(await effects(savedA![0].id)).toEqual(effectsA);
      if (full) {
        await expect(
          recovery.getByRole("button", {
            name: "Ponów potwierdzenie tej wpłaty",
            exact: true,
          }),
        ).toHaveCount(0);
        await expect(
          recovery.getByRole("button", {
            name: "Zamknij potwierdzenie wpłaty",
            exact: true,
          }),
        ).toBeEnabled();
      } else {
        await expect(formA.locator('[name="request_id"]')).not.toHaveValue(
          requestA,
        );
        await expect(
          formA.getByLabel("Otrzymana kwota (zł)", { exact: true }),
        ).toHaveValue("");
      }
      await expect(f.staff).toHaveURL(/\/admin\/finance(?:[?#]|$)/);
      expect(
        await checked(
          f.ownerApi
            .from("fitness_balances")
            .select("agreed_price_cents,charge_cents,paid_cents,due_cents")
            .eq("id", targetA)
            .single(),
        ),
      ).toMatchObject({
        agreed_price_cents: 40000,
        charge_cents: 40000,
        paid_cents: full ? 40000 : 10000,
        due_cents: full ? 0 : 30000,
      });
      await f.guardian.goto(`/app/finance?charge=fitness-${targetA}`);
      if (full)
        await expect(
          f.guardian.locator(`#charge-fitness-${targetA}`),
        ).toHaveCount(0);
      else
        await balance(
          f.guardian.locator(`#charge-fitness-${targetA}`),
          10000,
          30000,
        );
      const ownReceipt = f.guardian.locator(`#payment-${savedA![0].id}`);
      await expect(ownReceipt).toContainText(note);
      await expect(ownReceipt).toContainText(
        full ? /400,00\s*zł/ : /100,00\s*zł/,
      );
      await expect(
        f.guardian.getByRole("button", {
          name: "Odnotuj otrzymaną wpłatę",
          exact: true,
        }),
      ).toHaveCount(0);
    } finally {
      await f.dispose();
    }
  });
