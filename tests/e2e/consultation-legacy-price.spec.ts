import { expect, test, type Page } from "@playwright/test";
import {
  account,
  checked,
  disposeCareFixtures,
  localClients,
  login,
} from "./local-fixtures";

test("historical agreement → retained invalid draft/conflict → confirmed appointment → receipt → completion", async ({
  browser,
  baseURL,
}, info) => {
  const { db, client } = localClients(baseURL),
    users: string[] = [],
    dogs: string[] = [];
  const contexts = await Promise.all([
    browser.newContext({ baseURL, viewport: { width: 320, height: 900 } }),
    browser.newContext({ baseURL, viewport: { width: 390, height: 844 } }),
  ]);
  const staff = await contexts[0].newPage(),
    guardian = await contexts[1].newPage();
  const ownDb = client(),
    otherDb = client(),
    staffDb = client(),
    anonymous = client();
  const billing = (page: Page) => page.locator("article#rozliczenie");
  const editor = (page: Page) =>
    page.locator("article").filter({
      has: page.getByRole("heading", {
        name: "Uzgodniona kwota",
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
      [staffDb, leader],
    ] as const)
      await checked(
        api.auth.signInWithPassword({
          email: user.email,
          password: user.password,
        }),
      );
    const dog = crypto.randomUUID(),
      id = crypto.randomUUID();
    dogs.push(dog);
    await checked(
      db.from("dogs").insert({
        id: dog,
        guardian_id: owner.id,
        name: `Figa dawna kwota ${id.slice(0, 8)}`,
      }),
    );
    // A pre-catalogue meeting has no invented service or price. This fixture
    // reproduces stored historical data; all later business actions use the UI.
    await checked(
      db.from("consultations").insert({
        id,
        dog_id: dog,
        requested_by: owner.id,
        practice_id: "00000000-0000-4000-8000-000000000001",
        topic: "Fikcyjne starsze zgłoszenie bez ceny",
      }),
    );
    await checked(
      db.from("consultation_history").insert({
        consultation_id: id,
        version: 1,
        action: "requested",
        author_id: owner.id,
      }),
    );
    await login(staff, leader, "admin");
    await login(guardian, owner, "client");
    await guardian.goto(`/app/consultations/${id}`);
    await expect(billing(guardian)).toContainText(
      "Starsze zgłoszenie bez ustalonej ceny",
    );
    await expect(
      guardian.getByRole("button", { name: "Zapisz uzgodnioną kwotę" }),
    ).toHaveCount(0);

    // Actual SSR and delayed scripts verify that the form cannot submit before
    // hydration. Prices start empty; the current catalogue is never a default.
    let release!: () => void;
    const scripts = new Promise<void>((done) => {
      release = done;
    });
    await staff.route("**/_next/static/**/*.js*", async (route) => {
      await scripts;
      await route.continue();
    });
    try {
      await staff.goto(`/admin/consultations/${id}`, { waitUntil: "commit" });
      await expect(
        staff.getByLabel("Uzgodniona kwota (zł)", { exact: true }),
      ).toBeVisible();
      await expect(
        staff.getByLabel("Uzgodniona kwota (zł)", { exact: true }),
      ).toBeDisabled();
      await expect(
        editor(staff).getByRole("button", { name: "Przygotowuję formularz…" }),
      ).toBeDisabled();
    } finally {
      release();
      await staff.unrouteAll({ behavior: "wait" });
    }
    await expect(
      staff.getByLabel("Uzgodniona kwota (zł)", { exact: true }),
    ).toHaveValue("");
    // Fill the appointment before its price. Saving the amount must preserve
    // this draft and acknowledge its own version without accepting other edits.
    const occupied = await checked(
      db
        .from("calendar_slots")
        .select("occupied")
        .order("occupied", { ascending: false })
        .limit(1),
    );
    const last = occupied?.length
      ? Date.parse(
          String(occupied[0].occupied)
            .split(",")[1]
            .replace(/[)\]"]/g, ""),
        )
      : 0;
    const start = new Date(
      Math.max(Date.now() + 30 * 86400000, Number.isFinite(last) ? last : 0) +
        86400000,
    );
    start.setUTCMinutes(0, 0, 0);
    const input = new Intl.DateTimeFormat("sv-SE", {
      timeZone: "Europe/Warsaw",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .format(start)
      .replace(" ", "T");
    const location = "Fikcyjna rozmowa do próby historycznej kwoty";
    const scheduleNote = "Termin uzgodniony przed zapisaniem kwoty";
    await staff.getByLabel("Termin (czas polski)").fill(input);
    await staff.getByLabel("Forma spotkania").selectOption("online");
    await staff.getByLabel("Miejsce lub instrukcja połączenia").fill(location);
    await staff
      .getByLabel("Wiadomość dla opiekuna (opcjonalnie)")
      .fill(scheduleNote);
    await staff
      .getByLabel("Uzgodniona kwota (zł)", { exact: true })
      .fill("175,555");
    await staff
      .getByLabel("Rodzaj uzgodnionej ceny", { exact: true })
      .selectOption("true");
    const note = "Kwota próbna ustalona telefonicznie z opiekunem";
    await staff
      .getByLabel("Uzasadnienie dla opiekuna", { exact: true })
      .fill(note);
    await staff
      .getByRole("button", { name: "Zapisz uzgodnioną kwotę" })
      .click();
    await expect(editor(staff).getByRole("alert")).toContainText(
      "Podaj uzgodnioną kwotę",
    );
    await expect(
      staff.getByLabel("Uzgodniona kwota (zł)", { exact: true }),
    ).toHaveValue("175,555");
    await expect(
      staff.getByLabel("Uzasadnienie dla opiekuna", { exact: true }),
    ).toHaveValue(note);
    await expect(
      staff.getByLabel("Rodzaj uzgodnionej ceny", { exact: true }),
    ).toHaveValue("true");
    await staff.evaluate(() => window.scrollTo(0, 0));
    await staff.screenshot({
      path: info.outputPath("historical-price-form-320.png"),
      fullPage: true,
    });
    const stale = await contexts[0].newPage();
    await stale.goto(`/admin/consultations/${id}`);
    await stale
      .getByLabel("Uzgodniona kwota (zł)", { exact: true })
      .fill("200");
    await stale
      .getByLabel("Uzasadnienie dla opiekuna", { exact: true })
      .fill("Starsza karta z inną kwotą");
    await staff
      .getByLabel("Uzgodniona kwota (zł)", { exact: true })
      .fill("175,50");
    await staff
      .getByRole("button", { name: "Zapisz uzgodnioną kwotę" })
      .click();
    await expect(staff).toHaveURL(
      `${baseURL}/admin/consultations/${id}?price_saved=2#rozliczenie`,
    );
    await expect(staff.getByRole("status")).toContainText(
      "Uzgodniona kwota zapisana",
    );
    await expect(editor(staff)).toHaveCount(0);
    await expect(billing(staff)).toContainText(
      "Samo zgłoszenie nie wymaga wpłaty",
    );
    await stale
      .getByRole("button", { name: "Zapisz uzgodnioną kwotę" })
      .click();
    await expect(editor(stale).getByRole("alert")).toContainText(
      "Konsultacja zmieniła się",
    );
    await expect(
      stale.getByLabel("Uzgodniona kwota (zł)", { exact: true }),
    ).toHaveValue("200");
    await expect(
      stale.getByLabel("Uzasadnienie dla opiekuna", { exact: true }),
    ).toHaveValue("Starsza karta z inną kwotą");
    await stale.close();
    const agreement = await checked(
      db
        .from("consultation_history")
        .select("version,agreed_price_cents,is_test_price,price_request_id")
        .eq("consultation_id", id)
        .eq("action", "price_agreed")
        .single(),
    );
    expect(agreement).toMatchObject({
      version: 2,
      agreed_price_cents: 17550,
      is_test_price: true,
    });
    const args = {
      p_id: id,
      p_expected_version: 1,
      p_amount_cents: 17550,
      p_is_test_price: true,
      p_note: note,
      p_request_id: agreement!.price_request_id,
    };
    expect(await checked(staffDb.rpc("agree_consultation_price", args))).toBe(
      2,
    );
    for (const api of [ownDb, otherDb])
      expect(
        (await api.rpc("agree_consultation_price", args)).error?.message,
      ).toContain("Brak uprawnień");
    expect(
      (await anonymous.rpc("agree_consultation_price", args)).error,
    ).toBeTruthy();
    expect(
      await checked(
        otherDb
          .from("consultation_history")
          .select("id")
          .eq("consultation_id", id),
      ),
    ).toEqual([]);
    expect(
      (
        await ownDb
          .from("consultations")
          .update({ agreed_price_cents: 1 })
          .eq("id", id)
      ).error,
    ).toBeTruthy();
    await guardian.reload();
    await expect(
      guardian.getByText("Uzgodniono kwotę spotkania", { exact: true }),
    ).toBeVisible();
    await expect(guardian.getByText(note, { exact: true })).toBeVisible();
    expect(
      await checked(
        ownDb.from("notifications").select("kind").eq("entity_id", id),
      ),
    ).toEqual([{ kind: "consultation_price_agreed" }]);
    await guardian.goto("/app/notifications");
    const notice = guardian.locator("li.card").filter({
      has: guardian.getByRole("heading", {
        name: "Uzgodniono kwotę konsultacji",
        exact: true,
      }),
    });
    await expect(notice).toBeVisible();
    await notice
      .getByRole("button", { name: "Otwórz sprawę", exact: true })
      .click();
    await expect(guardian).toHaveURL(new RegExp(`/app/consultations/${id}$`));
    expect(
      await checked(db.from("payments").select("id").eq("consultation_id", id)),
    ).toEqual([]);

    await expect(staff.getByLabel("Termin (czas polski)")).toHaveValue(input);
    await expect(staff.getByLabel("Forma spotkania")).toHaveValue("online");
    await expect(
      staff.getByLabel("Miejsce lub instrukcja połączenia"),
    ).toHaveValue(location);
    await expect(
      staff.getByLabel("Wiadomość dla opiekuna (opcjonalnie)"),
    ).toHaveValue(scheduleNote);
    await staff
      .getByRole("button", { name: "Potwierdź uzgodniony termin" })
      .click();
    await expect(
      staff.getByRole("status").filter({ hasText: "Termin zapisany" }),
    ).toBeVisible();
    const balance = () =>
      checked(
        ownDb
          .from("consultation_balances")
          .select("status,agreed_price_cents,paid_cents,due_cents")
          .eq("id", id)
          .single(),
      );
    await expect.poll(balance).toMatchObject({
      status: "scheduled",
      agreed_price_cents: 17550,
      paid_cents: 0,
      due_cents: 17550,
    });
    await billing(staff)
      .getByRole("link", { name: "Zapisz wpłatę w finansach →" })
      .click();
    const charge = staff.locator(`#charge-consultation-${id}`);
    await charge.locator("summary").getByText("Rozlicz należność").click();
    await charge
      .getByLabel("Otrzymana kwota (zł)", { exact: true })
      .fill("175,50");
    await charge
      .getByRole("button", { name: "Zapisz wpłatę", exact: true })
      .click();
    await expect
      .poll(balance)
      .toMatchObject({ paid_cents: 17550, due_cents: 0 });
    // Only this fixture's elapsed time is simulated. Completion itself goes
    // through the actual staff form and must preserve the agreed price/receipt.
    await checked(
      db
        .from("consultations")
        .update({ starts_at: new Date(Date.now() - 86400000).toISOString() })
        .eq("id", id),
    );
    await staff.goto(`/admin/consultations/${id}`);
    await staff.getByRole("button", { name: "Oznacz jako zakończoną" }).click();
    await expect(staff.getByText("Zakończona", { exact: true })).toBeVisible();
    await expect.poll(balance).toMatchObject({
      status: "completed",
      agreed_price_cents: 17550,
      paid_cents: 17550,
      due_cents: 0,
    });
    expect(
      (
        await staffDb.rpc("agree_consultation_price", {
          ...args,
          p_expected_version: 4,
          p_request_id: crypto.randomUUID(),
          p_amount_cents: 10000,
        })
      ).error?.message,
    ).toContain("już ustaloną cenę");
    expect(await checked(staffDb.rpc("agree_consultation_price", args))).toBe(
      2,
    );
    expect(
      await checked(
        db
          .from("consultation_history")
          .select("action")
          .eq("consultation_id", id)
          .order("version"),
      ),
    ).toEqual([
      { action: "requested" },
      { action: "price_agreed" },
      { action: "scheduled" },
      { action: "completed" },
    ]);
    expect(
      await checked(
        db
          .from("audit_events")
          .select("event")
          .eq("entity_id", id)
          .eq("event", "consultation_price_agreed"),
      ),
    ).toHaveLength(1);
    expect(
      await checked(
        db.from("reminder_jobs").select("status").eq("source_id", id),
      ),
    ).toEqual([{ status: "cancelled" }]);
    expect(
      await checked(
        db
          .from("calendar_slots")
          .select("consultation_id")
          .eq("consultation_id", id),
      ),
    ).toEqual([]);
    await guardian.reload();
    await expect(billing(guardian)).toContainText("Opłacone");
    await expect(
      guardian.getByText("Zakończona", { exact: true }),
    ).toBeVisible();
    await expect(
      guardian.getByText("Wczytuję Twoje psie sprawy.", { exact: true }),
    ).toHaveCount(0);
    for (const page of [staff, guardian])
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
      ).toBe(true);
    await guardian.evaluate(() => window.scrollTo(0, 0));
    await guardian.evaluate(async () => {
      await document.fonts.ready;
      await new Promise(requestAnimationFrame);
    });
    await guardian.screenshot({
      path: info.outputPath("historical-price-completed-390.png"),
      fullPage: true,
    });
  } finally {
    for (const context of contexts) await context.close();
    for (const api of [ownDb, otherDb, staffDb]) await api.auth.signOut();
    await disposeCareFixtures(db, users, dogs);
  }
});
