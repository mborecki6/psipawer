import { expect, test, type Page } from "@playwright/test";
import assert from "node:assert/strict";
import { checked, login } from "./local-fixtures";
import { dateInput, mobileEvidence, walkJourney } from "./walk-journey";

type Journey = Awaited<ReturnType<typeof walkJourney>>;

async function otherDog(j: Journey) {
  const id = crypto.randomUUID();
  j.dogs.push(id);
  await checked(
    j.db
      .from("dogs")
      .insert({ id, guardian_id: j.other.id, name: `Luna spacer ${j.suffix}` }),
  );
  await j.staff.goto(`/admin/dogs/${id}`);
  await j.staff.getByLabel("Status").selectOption("approved");
  await j.staff
    .getByLabel("Powód / zalecenia")
    .fill("Fikcyjna kwalifikacja drugiego psa do próby decyzji.");
  await j.staff.getByRole("button", { name: "Zapisz kwalifikację" }).click();
  await expect(j.staff.getByRole("status")).toContainText("Status psa");
  return id;
}

async function decide(
  j: Journey,
  walk: string,
  registration: string,
  status: string,
  note: string,
) {
  await j.staff.goto(`/admin/walks/${walk}`);
  const card = j.staff.locator(`#registration-${registration}`);
  await card.getByLabel("Decyzja").selectOption(status);
  await card.getByLabel("Wiadomość dla opiekuna (opcjonalna)").fill(note);
  j.staff.once("dialog", (d) => d.accept());
  await card
    .getByRole("button", { name: "Zapisz decyzję", exact: true })
    .click();
  await expect(card.getByRole("status")).toContainText("Decyzja zapisana");
}

async function row(j: Journey, id: string) {
  return checked(
    j.db
      .from("walk_registrations")
      .select("status,payment_status,decision_note,cancellation_free_until")
      .eq("id", id)
      .single(),
  );
}

async function privateLocation(
  j: Journey,
  walk: string,
  visible: boolean,
  page = j.guardian,
  api = j.ownerDb,
) {
  await page.goto(`/app/walks/${walk}`);
  const data = await checked(
    api
      .from("walk_private_details")
      .select("exact_location")
      .eq("walk_id", walk),
  );
  if (visible) {
    expect(data).toHaveLength(1);
    await expect(
      page.getByText(data![0].exact_location, { exact: true }),
    ).toBeVisible();
  } else {
    expect(data).toEqual([]);
    await expect(
      page.getByText(
        "Dokładną lokalizację zobaczysz po zaakceptowaniu Twojego psa.",
      ),
    ).toBeVisible();
  }
}

async function edit(page: Page, start: string, location: string, note: string) {
  await page.getByLabel("Termin (czas polski)").fill(dateInput(start));
  await page.getByLabel("Ogólna lokalizacja").fill(location);
  await page.getByLabel("Co się zmienia? Informacja dla opiekunów").fill(note);
}

test("a qualification change preserves an existing paid booking and blocks new admissions until staff qualify the dog again", async ({
  browser,
  baseURL,
}) => {
  const j = await walkJourney(browser, baseURL);
  try {
    const existingWalk = await j.createWalk("Spacer przed zmianą kwalifikacji");
    const existing = await j.register(existingWalk);
    await j.receipt("registration", existing, "100,00");
    const paidBefore = await j.registration(existing);
    const paymentsBefore = await j.payments("registration", existing);
    const pendingWalk = await j.createWalk("Spacer czekający na ocenę");
    const pending = await j.submit(pendingWalk);
    const freshWalk = await j.createWalk("Spacer po zmianie kwalifikacji", {
      bookingMode: "automatic",
    });
    const privateNote =
      "Fikcyjny prywatny powód ponownej oceny przed kolejnymi zapisami.";
    await j.staff.goto(`/admin/dogs/${j.dogs[0]}`);
    await j.staff.getByLabel("Status").selectOption("needs_review");
    await j.staff.getByLabel("Powód / zalecenia").fill(privateNote);
    await j.staff.getByRole("button", { name: "Zapisz kwalifikację" }).click();
    await expect(j.staff.getByRole("status")).toContainText("Status psa");
    expect(await j.registration(existing)).toEqual(paidBefore);
    expect(await j.payments("registration", existing)).toEqual(paymentsBefore);
    await privateLocation(j, existingWalk, true);
    await expect(
      j.guardian.getByText(privateNote, { exact: true }),
    ).toHaveCount(0);
    await j.staff.goto(`/admin/walks/${pendingWalk}`);
    const card = j.staff.locator(`#registration-${pending}`);
    await card.getByLabel("Decyzja").selectOption("accepted");
    const message = "Wiadomość zachowana po odmowie akceptacji.";
    await card.getByLabel("Wiadomość dla opiekuna (opcjonalna)").fill(message);
    j.staff.once("dialog", (d) => d.accept());
    await card
      .getByRole("button", { name: "Zapisz decyzję", exact: true })
      .click();
    await expect(card.getByRole("alert")).toContainText(
      "Najpierw zakwalifikuj psa",
    );
    await expect(
      card.getByLabel("Wiadomość dla opiekuna (opcjonalna)"),
    ).toHaveValue(message);
    expect(await row(j, pending)).toMatchObject({
      status: "pending",
      payment_status: "none",
    });
    const rejected = await j.ownerDb.rpc("register_dog", {
      p_walk: freshWalk,
      p_dog: j.dogs[0],
    });
    expect(rejected.error?.message).toContain("wymaga akceptacji");
    expect(
      await checked(
        j.ownerDb
          .from("walk_registrations")
          .select("id")
          .eq("walk_id", freshWalk)
          .eq("dog_id", j.dogs[0]),
      ),
    ).toEqual([]);
    await j.staff.goto(`/admin/dogs/${j.dogs[0]}`);
    await j.staff.getByLabel("Status").selectOption("approved_conditional");
    await j.staff
      .getByLabel("Powód / zalecenia")
      .fill("Fikcyjna ponowna kwalifikacja z warunkami.");
    await j.staff.getByRole("button", { name: "Zapisz kwalifikację" }).click();
    await expect(j.staff.getByRole("status")).toContainText("Status psa");
    await j.accept(pendingWalk, pending);
    const automatic = await j.submit(freshWalk);
    expect(await row(j, automatic)).toMatchObject({
      status: "accepted",
      payment_status: "due",
    });
    expect(await j.registration(existing)).toEqual(paidBefore);
    expect(await j.payments("registration", existing)).toEqual(paymentsBefore);
  } finally {
    await j.dispose();
  }
});

test("waitlist → capacity refusal → released place → manual acceptance → rejection and new decision preserve privacy and history", async ({
  browser,
  baseURL,
}, info) => {
  const j = await walkJourney(browser, baseURL);
  const context = await browser.newContext({
    baseURL,
    viewport: { width: 320, height: 900 },
  });
  const second = await context.newPage();
  try {
    await login(second, j.other, "client");
    const dog = await otherDog(j);
    const walk = await j.createWalk("Spacer rezerwa", { capacity: 1 });
    const first = await j.submit(walk);
    const waiting = await j.submit(walk, second, dog, j.otherDb);
    await privateLocation(j, walk, false);
    await expect(
      j.guardian.getByText(
        "Zgłoszenie czeka na decyzję prowadzącej. Miejsce będzie potwierdzone po akceptacji.",
        { exact: true },
      ),
    ).toBeVisible();
    await j.accept(walk, first);
    await privateLocation(j, walk, true);
    await decide(
      j,
      walk,
      waiting,
      "waitlisted",
      `Czekamy na miejsce ${j.suffix}`,
    );
    expect(await row(j, waiting)).toMatchObject({
      status: "waitlisted",
      payment_status: "none",
    });
    await privateLocation(j, walk, false, second, j.otherDb);
    await expect(
      second.getByText(
        /Zwolnienie miejsca nie oznacza automatycznego przyjęcia/,
      ),
    ).toBeVisible();
    await mobileEvidence(
      second,
      info.outputPath("guardian-waitlisted-320.png"),
    );
    await expect(
      second.getByText(`Czekamy na miejsce ${j.suffix}`, { exact: true }),
    ).toBeVisible();
    expect(
      await checked(
        j.ownerDb.from("walk_registrations").select("id").eq("id", waiting),
      ),
    ).toEqual([]);
    expect(
      await checked(
        j.otherDb.from("walk_registrations").select("id").eq("id", first),
      ),
    ).toEqual([]);

    await j.staff.goto(`/admin/walks/${walk}`);
    const card = j.staff.locator(`#registration-${waiting}`);
    await card.getByLabel("Decyzja").selectOption("accepted");
    await card
      .getByLabel("Wiadomość dla opiekuna (opcjonalna)")
      .fill(`Gotowe przyjęcie ${j.suffix}`);
    j.staff.once("dialog", (d) => d.accept());
    await card
      .getByRole("button", { name: "Zapisz decyzję", exact: true })
      .click();
    await expect(card.getByRole("alert")).toContainText("Brak wolnych miejsc");
    await expect(card.getByRole("alert")).toBeFocused();
    await expect(card.getByLabel("Decyzja")).toHaveValue("accepted");
    await expect(
      card.getByLabel("Wiadomość dla opiekuna (opcjonalna)"),
    ).toHaveValue(`Gotowe przyjęcie ${j.suffix}`);
    expect(await row(j, waiting)).toMatchObject({
      status: "waitlisted",
      decision_note: `Czekamy na miejsce ${j.suffix}`,
    });
    await mobileEvidence(j.staff, info.outputPath("capacity-refusal-390.png"));

    await decide(
      j,
      walk,
      first,
      "waitlisted",
      `Uzgodniona zmiana składu ${j.suffix}`,
    );
    expect(await row(j, first)).toMatchObject({
      status: "waitlisted",
      payment_status: "none",
    });
    expect(await row(j, waiting)).toMatchObject({
      status: "waitlisted",
      payment_status: "none",
    });
    expect(
      await checked(
        j.db
          .from("walk_registrations")
          .select("id")
          .eq("walk_id", walk)
          .eq("status", "accepted"),
      ),
    ).toEqual([]);
    await privateLocation(j, walk, false);
    await j.accept(walk, waiting);
    await privateLocation(j, walk, true, second, j.otherDb);
    await decide(
      j,
      walk,
      waiting,
      "rejected",
      `Dobierzemy inny termin ${j.suffix}`,
    );
    expect(await row(j, waiting)).toMatchObject({
      status: "rejected",
      payment_status: "none",
    });
    await privateLocation(j, walk, false, second, j.otherDb);
    await expect(second.getByText("Odrzucony", { exact: true })).toBeVisible();
    await expect(
      second.getByText(/To zgłoszenie nie zostało przyjęte/),
    ).toBeVisible();
    await expect(
      second.getByText(`Dobierzemy inny termin ${j.suffix}`, { exact: true }),
    ).toBeVisible();
    await decide(j, walk, waiting, "pending", `Wracamy do decyzji ${j.suffix}`);
    await j.accept(walk, waiting);
    const before = await checked(
      j.db
        .from("audit_events")
        .select("id")
        .eq("entity_id", waiting)
        .eq("event", "registration_decided"),
    );
    await checked(
      j.staffDb.rpc("decide_registration", {
        p_registration: waiting,
        p_status: "accepted",
        p_note: "Powtórzenie bez nowej decyzji",
      }),
    );
    expect(
      await checked(
        j.db
          .from("audit_events")
          .select("id")
          .eq("entity_id", waiting)
          .eq("event", "registration_decided"),
      ),
    ).toEqual(before);
    for (const api of [j.ownerDb, j.otherDb])
      expect(
        (
          await api.rpc("decide_registration", {
            p_registration: first,
            p_status: "accepted",
            p_note: "Niedozwolona zmiana",
          })
        ).error?.message,
      ).toContain("Brak uprawnień");
    await second.reload();
    await expect(
      second.getByText("Zaakceptowany", { exact: true }),
    ).toBeVisible();
    await mobileEvidence(
      second,
      info.outputPath("accepted-after-waitlist-320.png"),
    );
    expect(
      await checked(
        j.ownerDb.from("notifications").select("id").eq("dog_id", dog),
      ),
    ).toEqual([]);
  } finally {
    await context.close();
    await j.dispose();
  }
});

test("walk editing rejects capacity, calendar and stale-card conflicts atomically, preserves free cancellation and copies settings only", async ({
  browser,
  baseURL,
}, info) => {
  const j = await walkJourney(browser, baseURL);
  const context = await browser.newContext({ baseURL });
  const second = await context.newPage();
  const stale = await j.staff.context().newPage();
  try {
    await login(second, j.other, "client");
    const dog = await otherDog(j);
    const walk = await j.createWalk("Spacer edycja", { capacity: 2 });
    const first = await j.register(walk);
    const other = await j.submit(walk, second, dog, j.otherDb);
    await j.accept(walk, other);
    const original = await checked(
      j.db.from("walks").select("*").eq("id", walk).single(),
    );
    assert(original);
    const blocking = await j.createWalk("Zajęty termin edycji");
    const blocked = await checked(
      j.db.from("walks").select("starts_at").eq("id", blocking).single(),
    );
    assert(blocked);
    const location = `Nowa ogólna okolica ${j.suffix}`;
    const exact = `Nowa prywatna zbiórka ${j.suffix}`;
    const note = `Zmieniamy termin i zbiórkę ${j.suffix}`;
    const moved = new Date(
      Date.parse(original.starts_at) - 6 * 3600000,
    ).toISOString();
    const updateCount = async () =>
      checked(
        j.db
          .from("audit_events")
          .select("id")
          .eq("event", "walk_updated")
          .eq("entity_id", walk),
      );
    const jobs = async () =>
      checked(
        j.db
          .from("reminder_jobs")
          .select("id,status,target_at")
          .eq("entity_id", walk)
          .order("id"),
      );
    const oldJobs = await jobs();
    expect(oldJobs).toHaveLength(2);
    const oldDetails = await checked(
      j.db
        .from("walk_private_details")
        .select("*")
        .eq("walk_id", walk)
        .single(),
    );

    await j.staff.goto(`/admin/walks/${walk}/edit`);
    await stale.goto(`/admin/walks/${walk}/edit`);
    await edit(
      stale,
      original.starts_at,
      `Stara karta ${j.suffix}`,
      `Nieaktualna próba ${j.suffix}`,
    );
    await stale.getByLabel("Czas trwania w minutach").fill("90");
    await stale
      .getByLabel("Dokładne miejsce zbiórki")
      .fill(`Stara prywatna zbiórka ${j.suffix}`);
    await expect(j.staff.getByLabel("Cena za psa (zł)")).toHaveAttribute(
      "readonly",
      "",
    );
    await expect(j.staff.getByLabel("Tryb zapisów")).toBeDisabled();
    await expect(
      j.staff.getByLabel("Termin odwołania — godzin przed spacerem"),
    ).toHaveAttribute("readonly", "");
    await edit(j.staff, original.starts_at, location, note);
    await j.staff.getByLabel("Liczba miejsc").fill("1");
    await j.staff.getByLabel("Dokładne miejsce zbiórki").fill(exact);
    await j.staff
      .getByRole("button", { name: "Zapisz zmiany spaceru", exact: true })
      .click();
    await expect(j.staff.locator("form").getByRole("alert")).toContainText(
      "Limit nie może być mniejszy od zaakceptowanego składu",
    );
    await expect(j.staff.getByLabel("Ogólna lokalizacja")).toHaveValue(
      location,
    );
    await expect(j.staff.getByLabel("Dokładne miejsce zbiórki")).toHaveValue(
      exact,
    );
    expect(
      await checked(j.db.from("walks").select("*").eq("id", walk).single()),
    ).toEqual(original);
    expect(await updateCount()).toEqual([]);

    await j.staff.getByLabel("Liczba miejsc").fill("2");
    await j.staff
      .getByLabel("Termin (czas polski)")
      .fill(dateInput(blocked.starts_at));
    await j.staff
      .getByRole("button", { name: "Zapisz zmiany spaceru", exact: true })
      .click();
    await expect(j.staff.locator("form").getByRole("alert")).toContainText(
      "Ten czas jest już zajęty",
    );
    await expect(j.staff.getByLabel("Termin (czas polski)")).toHaveValue(
      dateInput(blocked.starts_at),
    );
    await expect(
      j.staff.getByLabel("Co się zmienia? Informacja dla opiekunów"),
    ).toHaveValue(note);
    expect(
      await checked(j.db.from("walks").select("*").eq("id", walk).single()),
    ).toEqual(original);
    expect(
      await checked(
        j.db
          .from("walk_private_details")
          .select("*")
          .eq("walk_id", walk)
          .single(),
      ),
    ).toEqual(oldDetails);
    expect(await jobs()).toEqual(oldJobs);
    expect(await updateCount()).toEqual([]);
    expect(
      await checked(
        j.ownerDb
          .from("notifications")
          .select("id")
          .eq("kind", "walk_changed")
          .eq("entity_id", walk),
      ),
    ).toEqual([]);

    await j.staff.getByLabel("Termin (czas polski)").fill(dateInput(moved));
    await j.staff
      .getByRole("button", { name: "Zapisz zmiany spaceru", exact: true })
      .click();
    await expect(j.staff).toHaveURL(`/admin/walks/${walk}?saved=1`);
    await expect(j.staff.getByText(note, { exact: true })).toBeVisible();
    const changed = await checked(
      j.db.from("walks").select("*").eq("id", walk).single(),
    );
    expect(changed).toMatchObject({
      public_location: location,
      capacity: 2,
      price_cents: 10000,
      booking_mode: "approval",
      cancellation_deadline_hours: 24,
    });
    expect(Date.parse(changed!.starts_at)).toBe(Date.parse(moved));
    expect(await updateCount()).toHaveLength(1);
    const freeUntil = Date.parse(original.starts_at) - 24 * 3600000;
    for (const reg of [first, other]) {
      const value = await row(j, reg);
      expect(value).toMatchObject({
        status: "accepted",
        payment_status: "due",
      });
      expect(Date.parse(value!.cancellation_free_until)).toBe(freeUntil);
    }
    const newJobs = await jobs();
    expect(newJobs?.filter((r) => r.status === "cancelled")).toHaveLength(2);
    expect(newJobs?.filter((r) => r.status === "pending")).toHaveLength(2);
    for (const job of newJobs?.filter((r) => r.status === "pending") || [])
      expect(Date.parse(job.target_at)).toBe(Date.parse(moved));

    await stale
      .getByRole("button", { name: "Zapisz zmiany spaceru", exact: true })
      .click();
    await expect(stale.locator("form").getByRole("alert")).toContainText(
      "Spacer zmienił się w międzyczasie",
    );
    await expect(stale.locator("form").getByRole("alert")).toBeFocused();
    await expect(stale.getByLabel("Ogólna lokalizacja")).toHaveValue(
      `Stara karta ${j.suffix}`,
    );
    await expect(stale.getByLabel("Czas trwania w minutach")).toHaveValue("90");
    await expect(stale.getByLabel("Dokładne miejsce zbiórki")).toHaveValue(
      `Stara prywatna zbiórka ${j.suffix}`,
    );
    expect(
      await checked(j.db.from("walks").select("*").eq("id", walk).single()),
    ).toEqual(changed);
    expect(await updateCount()).toHaveLength(1);
    await stale.setViewportSize({ width: 320, height: 900 });
    await mobileEvidence(stale, info.outputPath("stale-walk-edit-320.png"));

    for (const api of [j.ownerDb, j.otherDb]) {
      const notification = await checked(
        api
          .from("notifications")
          .select("id")
          .eq("kind", "walk_changed")
          .eq("entity_id", walk),
      );
      expect(notification).toHaveLength(1);
      expect(
        (
          await api.rpc("update_walk", {
            p_walk: walk,
            p_expected_updated_at: changed!.updated_at,
            payload: {},
            p_note: "Niedozwolona próba",
          })
        ).error?.message,
      ).toContain("Brak uprawnień");
    }
    await j.guardian.goto("/app/notifications");
    const notification = j.guardian.getByRole("listitem").filter({
      has: j.guardian.getByRole("heading", {
        name: "Zmieniono szczegóły spaceru",
        exact: true,
      }),
    });
    await notification
      .getByRole("button", { name: "Otwórz sprawę", exact: true })
      .click();
    await expect(j.guardian).toHaveURL(`/app/walks/${walk}`);
    await expect(j.guardian.getByText(note, { exact: true })).toBeVisible();
    await expect(j.guardian.getByText(exact, { exact: true })).toBeVisible();
    await expect(
      j.guardian.getByText(/Termin bezpłatnego odwołania po zmianie spaceru:/),
    ).toBeVisible();
    await mobileEvidence(
      j.guardian,
      info.outputPath("guardian-changed-walk-320.png"),
    );

    await j.staff.goto(`/admin/walks/new?copy=${walk}`);
    await expect(j.staff.getByLabel("Termin (czas polski)")).toHaveValue("");
    await expect(j.staff.getByLabel("Ogólna lokalizacja")).toHaveValue(
      location,
    );
    await expect(j.staff.getByLabel("Dokładne miejsce zbiórki")).toHaveValue(
      exact,
    );
    await expect(j.staff.getByLabel("Cena za psa (zł)")).not.toHaveAttribute(
      "readonly",
      "",
    );
    await expect(j.staff.getByLabel("Tryb zapisów")).toBeEnabled();
    await j.staff
      .getByLabel("Termin (czas polski)")
      .fill(dateInput(await j.freeStart("future")));
    await j.staff
      .getByRole("button", { name: "Utwórz spacer", exact: true })
      .click();
    await expect(j.staff).toHaveURL(/\/admin\/walks\/[a-f0-9-]+\?saved=1$/);
    const copy = new URL(j.staff.url()).pathname.split("/").at(-1)!;
    expect(copy).not.toBe(walk);
    expect(
      await checked(
        j.db.from("walk_registrations").select("id").eq("walk_id", copy),
      ),
    ).toEqual([]);
    expect(
      await checked(
        j.db.from("reminder_jobs").select("id").eq("entity_id", copy),
      ),
    ).toEqual([]);
    expect(
      await checked(
        j.ownerDb
          .from("walk_private_details")
          .select("walk_id")
          .eq("walk_id", copy),
      ),
    ).toEqual([]);
    expect(
      await checked(
        j.db
          .from("payments")
          .select("id")
          .in("registration_id", [first, other]),
      ),
    ).toEqual([]);
  } finally {
    await stale.close();
    await context.close();
    await j.dispose();
  }
});

test("invitation-only walks remain hidden until staff invites, and automatic booking accepts only the available place", async ({
  browser,
  baseURL,
}, info) => {
  const j = await walkJourney(browser, baseURL);
  const context = await browser.newContext({
    baseURL,
    viewport: { width: 320, height: 900 },
  });
  const second = await context.newPage();
  try {
    await login(second, j.other, "client");
    const dog = await otherDog(j);
    const walk = await j.createWalk("Spacer na zaproszenie", {
      capacity: 1,
      bookingMode: "invite",
    });
    expect(
      await checked(j.ownerDb.from("walks").select("id").eq("id", walk)),
    ).toEqual([]);
    await j.guardian.goto(`/app/walks/${walk}`);
    await expect(
      j.guardian.getByRole("heading", { name: "Ten trop się urwał." }),
    ).toBeVisible();
    expect(
      (await j.ownerDb.rpc("register_dog", { p_walk: walk, p_dog: j.dogs[0] }))
        .error?.message,
    ).toContain("Spacer tylko na zaproszenie");
    expect(
      (await j.ownerDb.rpc("invite_dog", { p_walk: walk, p_dog: j.dogs[0] }))
        .error?.message,
    ).toContain("Brak uprawnień");
    await j.staff.goto(`/admin/walks/${walk}`);
    await j.staff
      .getByLabel("Zaproś psa / dodaj zgłoszenie")
      .selectOption(j.dogs[0]);
    await j.staff
      .getByRole("button", { name: "Dodaj zgłoszenie", exact: true })
      .click();
    await expect(j.staff.getByRole("status")).toContainText(
      "Pies dodany do zgłoszeń",
    );
    const reg = await checked(
      j.ownerDb
        .from("walk_registrations")
        .select("id,status,payment_status")
        .eq("walk_id", walk)
        .single(),
    );
    assert(reg);
    expect(reg).toMatchObject({ status: "pending", payment_status: "none" });
    expect(
      await checked(
        j.ownerDb
          .from("notifications")
          .select("id")
          .eq("kind", "walk_invitation")
          .eq("entity_id", walk),
      ),
    ).toHaveLength(1);
    expect(
      await checked(j.otherDb.from("walks").select("id").eq("id", walk)),
    ).toEqual([]);
    expect(
      await checked(
        j.otherDb.from("notifications").select("id").eq("entity_id", walk),
      ),
    ).toEqual([]);
    await privateLocation(j, walk, false);
    await expect(
      j.guardian.getByRole("button", { name: "Zgłoś psa", exact: true }),
    ).toHaveCount(0);
    await j.accept(walk, reg.id);
    await privateLocation(j, walk, true);
    await mobileEvidence(
      j.guardian,
      info.outputPath("guardian-invited-walk-320.png"),
    );

    const automatic = await j.createWalk("Spacer automatyczny", {
      capacity: 1,
      bookingMode: "automatic",
    });
    const autoReg = await j.submit(automatic);
    expect(await row(j, autoReg)).toMatchObject({
      status: "accepted",
      payment_status: "due",
    });
    await privateLocation(j, automatic, true);
    await second.goto(`/app/walks/${automatic}`);
    await second.getByLabel("Wybierz swojego psa").selectOption(dog);
    await second
      .getByRole("button", { name: "Zgłoś psa", exact: true })
      .click();
    await expect(second.locator("form").getByRole("alert")).toContainText(
      "Brak wolnych miejsc",
    );
    expect(
      await checked(
        j.otherDb
          .from("walk_registrations")
          .select("id")
          .eq("walk_id", automatic),
      ),
    ).toEqual([]);
    expect(
      await checked(
        j.otherDb
          .from("walk_private_details")
          .select("walk_id")
          .eq("walk_id", automatic),
      ),
    ).toEqual([]);
    expect(
      await checked(
        j.db
          .from("walk_registrations")
          .select("id")
          .eq("walk_id", automatic)
          .eq("status", "accepted"),
      ),
    ).toHaveLength(1);
  } finally {
    await context.close();
    await j.dispose();
  }
});
