import { expect, test, type Page } from "@playwright/test";
import assert from "node:assert/strict";
import {
  localClients,
  checked,
  account,
  login,
  disposeCareFixtures,
} from "./local-fixtures";

test("consultation price → partial payments → reschedule/conflict → guardian cancellation → refunds", async ({
  browser,
  baseURL,
}, info) => {
  const { db, client } = localClients(baseURL),
    users: string[] = [],
    dogs: string[] = [];
  const service = crypto.randomUUID(),
    suffix = service.slice(0, 8);
  const staffContext = await browser.newContext({
    baseURL,
    viewport: { width: 1440, height: 1000 },
  });
  const guardianContext = await browser.newContext({
    baseURL,
    viewport: { width: 390, height: 844 },
  });
  const staff = await staffContext.newPage(),
    guardian = await guardianContext.newPage();
  const ownDb = client(),
    otherDb = client(),
    anonymous = client();
  const billing = (page: Page) =>
    page.locator("article").filter({
      has: page.getByRole("heading", {
        name: "Rozliczenie spotkania",
        exact: true,
      }),
    });
  try {
    const leader = await account(db, users, "admin"),
      owner = await account(db, users, "client"),
      other = await account(db, users, "client");
    for (const [api, user] of [
      [ownDb, owner],
      [otherDb, other],
    ] as const)
      await checked(
        api.auth.signInWithPassword({
          email: user.email,
          password: user.password,
        }),
      );
    // An isolated catalogue entry lets the UI exercise a price change without
    // changing any of the 17 imported services or their revision history.
    await checked(
      db.from("services").insert({
        id: service,
        practice_id: "00000000-0000-4000-8000-000000000001",
        name: `Konsultacja próbna ${suffix}`,
        description: "Fikcyjna oferta do lokalnego testu rozliczeń.",
        kind: "individual",
        booking_flow: "consultation",
        meeting_mode: "online",
        price_cents: 10000,
        price_unit: "za spotkanie",
        duration_minutes: 90,
        sessions_count: 1,
        source_url: "https://www.psipawer.pl/konsultacja-behawioralna",
        is_test_price: true,
      }),
    );
    await checked(
      db.from("service_revisions").insert({
        service_id: service,
        version: 1,
        name: `Konsultacja próbna ${suffix}`,
        price_cents: 10000,
        price_unit: "za spotkanie",
        active: true,
        is_test_price: true,
      }),
    );
    await login(staff, leader, "admin");
    await login(guardian, owner, "client");
    async function request(name: string) {
      await guardian.goto("/app/dogs/new");
      await guardian.getByLabel("Imię psa").fill(name);
      await guardian
        .getByRole("button", { name: "Dodaj psa", exact: true })
        .click();
      await expect(guardian).toHaveURL(/\/app\/dogs\/[a-f0-9-]+(?:\?.*)?$/);
      const dog = new URL(guardian.url()).pathname.split("/").at(-1)!;
      dogs.push(dog);
      await guardian
        .getByRole("link", { name: "Otwórz konsultacje →" })
        .click();
      await guardian
        .getByRole("link", { name: "Poproś o konsultację" })
        .click();
      await guardian.getByLabel("Wybierz usługę").selectOption(service);
      await guardian
        .getByLabel("Co chcesz omówić?")
        .fill(`Fikcyjne rozliczenie ${name}`);
      await guardian
        .getByRole("button", { name: "Przekaż zgłoszenie", exact: true })
        .click();
      await expect(guardian).toHaveURL(/\/app\/consultations\/[a-f0-9-]+$/);
      return new URL(guardian.url()).pathname.split("/").at(-1)!;
    }
    const id = await request(`Figa finanse ${suffix}`);
    await expect(billing(guardian)).toContainText(
      "Samo zgłoszenie nie wymaga wpłaty",
    );
    const latest = await checked(
      db
        .from("calendar_slots")
        .select("occupied")
        .order("occupied", { ascending: false })
        .limit(1),
    );
    const end = latest?.length
      ? Date.parse(
          String(latest[0].occupied)
            .split(",")[1]
            .replace(/[)\]"]/g, ""),
        )
      : 0;
    const date = new Date(
      Math.max(Date.now() + 30 * 86400000, Number.isFinite(end) ? end : 0) +
        86400000,
    );
    date.setUTCMinutes(0, 0, 0);
    const start = date.toISOString(),
      changed = new Date(date.getTime() + 86400000).toISOString();
    const dateInput = (value: string) =>
      new Intl.DateTimeFormat("sv-SE", {
        timeZone: "Europe/Warsaw",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23",
      })
        .format(new Date(value))
        .replace(" ", "T");
    await staff.goto(`/admin/consultations/${id}`);
    await staff.getByLabel("Termin (czas polski)").fill(dateInput(start));
    await staff
      .getByLabel("Miejsce lub instrukcja połączenia")
      .fill("Fikcyjna wideorozmowa do testów.");
    await staff
      .getByRole("button", { name: "Potwierdź uzgodniony termin" })
      .click();
    await expect(staff.getByRole("status")).toContainText("Termin zapisany");
    async function balance() {
      return checked(
        ownDb
          .from("consultation_balances")
          .select("agreed_price_cents,paid_cents,due_cents,needs_review,status")
          .eq("id", id)
          .single(),
      );
    }
    await expect.poll(balance).toMatchObject({
      agreed_price_cents: 10000,
      paid_cents: 0,
      due_cents: 10000,
      status: "scheduled",
    });
    await guardian.reload();
    await expect(billing(guardian)).toContainText("100,00");
    expect(
      await checked(
        otherDb.from("consultation_balances").select("id").eq("id", id),
      ),
    ).toEqual([]);
    expect(
      await checked(
        otherDb
          .from("consultation_history")
          .select("id")
          .eq("consultation_id", id),
      ),
    ).toEqual([]);
    expect(
      (await anonymous.from("consultation_balances").select("id").eq("id", id))
        .error,
    ).toBeTruthy();
    const denied = await ownDb.rpc("record_payment", {
      p_registration: null,
      p_package: null,
      p_consultation: id,
      p_amount_cents: 10000,
      p_method: "transfer",
      p_note: "Odmowa roli opiekuna",
      p_request_id: crypto.randomUUID(),
    });
    expect(denied.error?.message).toContain("Brak uprawnień");
    async function receipt(amount: string) {
      await staff.goto(`/admin/consultations/${id}`);
      await billing(staff)
        .getByRole("link", { name: "Zapisz wpłatę w finansach →" })
        .click();
      const charge = staff.locator(`#charge-consultation-${id}`);
      await expect(charge).toBeVisible();
      await charge.locator("summary").getByText("Rozlicz należność").click();
      await charge
        .getByLabel("Otrzymana kwota (zł)", { exact: true })
        .fill(amount);
      await charge
        .getByLabel(/^Notatka \(opcjonalnie\)/)
        .fill(`Fikcyjna wpłata ${amount} zł ${suffix}`);
      await charge
        .getByRole("button", { name: "Zapisz wpłatę", exact: true })
        .click();
    }
    await receipt("40,00");
    await expect
      .poll(balance)
      .toMatchObject({ paid_cents: 4000, due_cents: 6000 });
    await guardian.reload();
    await expect(billing(guardian)).toContainText("60,00");
    await guardian.goto(`/app/finance?charge=consultation-${id}`);
    await expect(guardian.locator(`#charge-consultation-${id}`)).toContainText(
      "Wpłacono 40,00",
    );
    await expect(
      guardian.getByRole("button", { name: "Zapisz wpłatę", exact: true }),
    ).toHaveCount(0);
    await staff.goto(`/admin/services/${service}`);
    await staff.getByLabel("Cena (zł)", { exact: true }).fill("150,00");
    await staff.getByRole("button", { name: "Zapisz usługę i cenę" }).click();
    await expect(staff.getByRole("status")).toContainText("Usługa zapisana");
    expect(await balance()).toMatchObject({
      agreed_price_cents: 10000,
      paid_cents: 4000,
      due_cents: 6000,
    });
    const next = await request(`Luna nowa cena ${suffix}`);
    expect(
      await checked(
        ownDb
          .from("consultations")
          .select("agreed_price_cents,status")
          .eq("id", next)
          .single(),
      ),
    ).toMatchObject({ agreed_price_cents: 15000, status: "requested" });
    const stale = await staffContext.newPage();
    await stale.goto(`/admin/consultations/${id}`);
    await stale
      .getByLabel("Powód zmiany dla opiekuna")
      .fill("Zachowana treść ze starego formularza");
    await staff.goto(`/admin/consultations/${id}`);
    await staff.getByLabel("Termin (czas polski)").fill(dateInput(changed));
    await staff
      .getByLabel("Powód zmiany dla opiekuna")
      .fill(`Fikcyjna zmiana ${suffix}`);
    await staff.getByRole("button", { name: "Zapisz zmianę terminu" }).click();
    await expect(staff.getByRole("status")).toContainText("Termin zapisany");
    await stale.getByRole("button", { name: "Zapisz zmianę terminu" }).click();
    await expect(
      stale
        .locator("form")
        .filter({ has: stale.getByLabel("Termin (czas polski)") })
        .getByRole("alert"),
    ).toContainText("Konsultacja zmieniła się");
    await expect(stale.getByLabel("Powód zmiany dla opiekuna")).toHaveValue(
      "Zachowana treść ze starego formularza",
    );
    await stale.close();
    const appointment = await checked(
      ownDb
        .from("consultations")
        .select("version,starts_at,agreed_price_cents")
        .eq("id", id)
        .single(),
    );
    expect(appointment).toMatchObject({
      version: 3,
      agreed_price_cents: 10000,
    });
    expect(Date.parse(appointment!.starts_at)).toBe(Date.parse(changed));
    const reminders = await checked(
      db
        .from("reminder_jobs")
        .select("generation,status,target_at")
        .eq("source_id", id)
        .eq("kind", "consultation")
        .order("generation"),
    );
    assert(reminders);
    expect(reminders.map((r) => r.status)).toEqual(["cancelled", "pending"]);
    expect(Date.parse(reminders[1].target_at)).toBe(Date.parse(changed));
    expect((await balance())?.due_cents).toBe(6000);
    await staff.setViewportSize({ width: 320, height: 900 });
    await receipt("60,00");
    await expect
      .poll(balance)
      .toMatchObject({ paid_cents: 10000, due_cents: 0 });
    await expect(staff.locator(`#charge-consultation-${id}`)).toHaveCount(0);
    expect(
      await staff.evaluate(
        () => document.documentElement.scrollWidth > innerWidth + 1,
      ),
    ).toBe(false);
    await guardian.goto(`/app/consultations/${id}`);
    await expect(
      billing(guardian).getByText("Opłacone", { exact: true }),
    ).toBeVisible();
    await guardian.getByText("Potrzebujesz odwołać?", { exact: true }).click();
    await guardian
      .getByLabel("Powód odwołania", { exact: true })
      .fill(`Fikcyjna rezygnacja ${suffix}`);
    guardian.once("dialog", (dialog) => dialog.accept());
    await guardian
      .getByRole("button", { name: "Odwołaj konsultację", exact: true })
      .click();
    await expect(guardian.getByText("Odwołana", { exact: true })).toBeVisible();
    await expect.poll(balance).toMatchObject({
      status: "cancelled",
      paid_cents: 10000,
      due_cents: 0,
      needs_review: true,
    });
    await expect(billing(guardian)).toContainText(
      "Wpłata do rozliczenia po odwołaniu",
    );
    expect(
      await checked(
        db
          .from("calendar_slots")
          .select("consultation_id")
          .eq("consultation_id", id),
      ),
    ).toEqual([]);
    expect(
      (await checked(
        db
          .from("reminder_jobs")
          .select("status")
          .eq("source_id", id)
          .eq("kind", "consultation"),
      ))!.map((r) => r.status),
    ).toEqual(["cancelled", "cancelled"]);
    const payments = await checked(
      db
        .from("payments")
        .select("id,amount_cents,status")
        .eq("consultation_id", id)
        .order("created_at"),
    );
    assert(payments);
    expect(payments.map((p) => p.amount_cents)).toEqual([4000, 6000]);
    expect(
      await checked(
        otherDb.from("payments").select("id").eq("consultation_id", id),
      ),
    ).toEqual([]);
    for (const api of [ownDb, otherDb]) {
      const result = await api.rpc("void_payment", {
        p_payment: payments[0].id,
        p_note: "Odmowa korekty bez roli prowadzącej",
      });
      expect(result.error?.message).toContain("Brak uprawnień");
    }
    await expect
      .poll(balance)
      .toMatchObject({ paid_cents: 10000, needs_review: true });
    for (const [index, payment] of payments.entries()) {
      await staff.goto("/admin/finance");
      const row = staff.locator(`#payment-${payment.id}`);
      await expect(row).toContainText("Do sprawdzenia: zwrot wpłaty");
      await row
        .locator("summary")
        .getByText("Zapisz zwrot lub popraw błędną wpłatę")
        .click();
      await row
        .getByLabel(/^Powód zwrotu lub korekty/)
        .fill(`Fikcyjne rozliczenie zwrotu ${index + 1} ${suffix}`);
      staff.once("dialog", (dialog) => dialog.accept());
      await row
        .getByRole("button", { name: "Zapisz zwrot / korektę", exact: true })
        .click();
      await expect(row).toContainText("Zwrot / korekta");
      await expect(
        row.getByRole("button", {
          name: "Zapisz zwrot / korektę",
          exact: true,
        }),
      ).toHaveCount(0);
      await expect.poll(balance).toMatchObject({
        paid_cents: index === 0 ? 6000 : 0,
        due_cents: 0,
        needs_review: index === 0,
      });
    }
    const corrected = await checked(
      db
        .from("payments")
        .select("id,status,refunded_by,refund_note")
        .eq("consultation_id", id)
        .order("created_at"),
    );
    assert(corrected);
    expect(corrected.map((p) => p.id)).toEqual(payments.map((p) => p.id));
    expect(
      corrected.every(
        (p) => p.status === "refunded" && p.refunded_by === leader.id,
      ),
    ).toBe(true);
    await guardian.goto(`/app/consultations/${id}`);
    await expect(billing(guardian)).toContainText(
      "Spotkanie odwołane — brak należności",
    );
    await billing(guardian)
      .getByRole("link", { name: "Historia i rozliczenia →" })
      .click();
    for (const payment of payments)
      await expect(guardian.locator(`#payment-${payment.id}`)).toContainText(
        "Zwrot / korekta",
      );
    await expect(
      guardian.getByRole("button", {
        name: "Zapisz zwrot / korektę",
        exact: true,
      }),
    ).toHaveCount(0);
    expect(
      await guardian.evaluate(
        () => document.documentElement.scrollWidth > innerWidth + 1,
      ),
    ).toBe(false);
    // Full-page capture must start at the top; otherwise fixed elements outside
    // the current viewport can appear in the middle of Chromium's tall image.
    await guardian.evaluate(() => window.scrollTo(0, 0));
    await staff.evaluate(() => window.scrollTo(0, 0));
    await guardian.screenshot({
      path: info.outputPath("consultation-refunds-390.png"),
      fullPage: true,
    });
    await staff.screenshot({
      path: info.outputPath("consultation-refunds-320.png"),
      fullPage: true,
    });
    const notices = await checked(
      ownDb.from("notifications").select("kind").eq("dog_id", dogs[0]),
    );
    assert(notices);
    for (const [kind, count] of [
      ["payment_recorded", 2],
      ["payment_refunded", 2],
      ["consultation_rescheduled", 1],
    ] as const)
      expect(notices.filter((n) => n.kind === kind)).toHaveLength(count);
  } finally {
    await staffContext.close();
    await guardianContext.close();
    await ownDb.auth.signOut();
    await otherDb.auth.signOut();
    await checked(
      db.from("service_revisions").delete().eq("service_id", service),
    );
    await checked(
      db.from("services").update({ updated_by: null }).eq("id", service),
    );
    await disposeCareFixtures(db, users, dogs);
    await checked(db.from("services").delete().eq("id", service));
  }
});
