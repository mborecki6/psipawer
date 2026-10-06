import { expect, type Browser, type Page } from "@playwright/test";
import assert from "node:assert/strict";
import {
  account,
  checked,
  disposeCareFixtures,
  localClients,
  login,
} from "./local-fixtures";

export const dateInput = (value: string) =>
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

export async function walkJourney(
  browser: Browser,
  baseURL: string | undefined,
) {
  const { db, client } = localClients(baseURL),
    users: string[] = [],
    dogs: string[] = [],
    walks: string[] = [];
  const suffix = crypto.randomUUID().slice(0, 8);
  const staffContext = await browser.newContext({
    baseURL,
    viewport: { width: 390, height: 900 },
  });
  const ownerContext = await browser.newContext({
    baseURL,
    viewport: { width: 320, height: 900 },
  });
  const staff = await staffContext.newPage(),
    guardian = await ownerContext.newPage();
  const ownerDb = client(),
    otherDb = client(),
    staffDb = client(),
    anonymous = client();
  async function dispose() {
    await staffContext.close();
    await ownerContext.close();
    for (const api of [ownerDb, otherDb, staffDb]) await api.auth.signOut();
    // The create action may commit before a failed navigation assertion. Find
    // this run's walks by its newly created users as well as captured URLs.
    if (users.length) {
      const created = await checked(
        db.from("walks").select("id").in("leader_id", users),
      );
      for (const row of created || [])
        if (!walks.includes(row.id)) walks.push(row.id);
    }
    if (dogs.length) {
      const packages = await checked(
        db.from("packages").select("id").in("dog_id", dogs),
      );
      await checked(db.from("payments").delete().in("dog_id", dogs));
      if (packages?.length)
        await checked(
          db
            .from("package_transactions")
            .delete()
            .in(
              "package_id",
              packages.map((p) => p.id),
            ),
        );
      if (walks.length)
        await checked(db.from("walks").delete().in("id", walks));
      await checked(db.from("packages").delete().in("dog_id", dogs));
    }
    await disposeCareFixtures(db, users, dogs);
  }
  try {
    const leader = await account(db, users, "admin"),
      owner = await account(db, users, "client"),
      other = await account(db, users, "client");
    for (const [api, user] of [
      [ownerDb, owner],
      [otherDb, other],
      [staffDb, leader],
    ] as const)
      await checked(
        api.auth.signInWithPassword({
          email: user.email,
          password: user.password,
        }),
      );
    // Create an isolated dog fixture. Qualification, booking, attendance and
    // finance below use the actual staff/guardian panels and their permissions.
    dogs.push(crypto.randomUUID());
    await checked(
      db.from("dogs").insert({
        id: dogs[0],
        guardian_id: owner.id,
        name: `Figa spacer ${suffix}`,
      }),
    );
    await login(staff, leader, "admin");
    await login(guardian, owner, "client");
    await staff.goto(`/admin/dogs/${dogs[0]}`);
    await staff.getByLabel("Status").selectOption("approved");
    await staff
      .getByLabel("Powód / zalecenia")
      .fill("Fikcyjna kwalifikacja do lokalnej próby spaceru.");
    await staff.getByRole("button", { name: "Zapisz kwalifikację" }).click();
    await expect(staff.getByRole("status")).toContainText("Status psa");

    async function freeStart(phase: "future" | "late" | "past") {
      const slots = await checked(db.from("calendar_slots").select("occupied"));
      const intervals = (slots || []).map((slot) => {
        const parts = String(slot.occupied).slice(1, -1).split(",");
        const interval = parts.map((part) =>
          Date.parse(part.replaceAll('"', "")),
        );
        assert(
          interval.every(Number.isFinite),
          "Fixture needs finite calendar slots",
        );
        return interval;
      });
      const start =
        phase === "future"
          ? Math.max(
              Date.now() + 30 * 86400000,
              ...intervals.map((s) => s[1]),
            ) + 86400000
          : Date.now() + (phase === "late" ? 6 * 3600000 : -2 * 86400000);
      const rounded = Math.ceil(start / 3600000) * 3600000;
      for (let i = 0; i < 12; i++) {
        const candidate = rounded + i * 3600000;
        if (
          intervals.every(
            ([a, b]) => candidate >= b || candidate + 3600000 <= a,
          )
        )
          return new Date(candidate).toISOString();
      }
      throw new Error(
        "No unoccupied fixture time; preserve existing appointments",
      );
    }
    async function createWalk(
      label: string,
      options: {
        capacity?: number;
        bookingMode?: "approval" | "automatic" | "invite";
      } = {},
    ) {
      const start = await freeStart("future");
      await staff.goto("/admin/walks/new");
      await staff.getByLabel("Termin (czas polski)").fill(dateInput(start));
      await staff.getByLabel("Ogólna lokalizacja").fill(`${label} ${suffix}`);
      await staff
        .getByLabel("Dokładne miejsce zbiórki")
        .fill(`Prywatna zbiórka ${label} ${suffix}`);
      if (options.capacity !== undefined)
        await staff.getByLabel("Liczba miejsc").fill(String(options.capacity));
      if (options.bookingMode)
        await staff
          .getByLabel("Tryb zapisów")
          .selectOption(options.bookingMode);
      await staff
        .getByRole("button", { name: "Utwórz spacer", exact: true })
        .click();
      await expect(staff).toHaveURL(/\/admin\/walks\/[a-f0-9-]+\?saved=1$/);
      const id = new URL(staff.url()).pathname.split("/").at(-1)!;
      walks.push(id);
      return id;
    }
    async function submit(
      id: string,
      page = guardian,
      dog = dogs[0],
      api = ownerDb,
    ) {
      await page.goto(`/app/walks/${id}`);
      await page.getByLabel("Wybierz swojego psa").selectOption(dog);
      await page
        .getByRole("button", { name: "Zgłoś psa", exact: true })
        .click();
      await expect(page.locator(".registration-card")).toHaveCount(1);
      const registration = await checked(
        api
          .from("walk_registrations")
          .select("id")
          .eq("walk_id", id)
          .eq("dog_id", dog)
          .single(),
      );
      assert(registration);
      return registration.id;
    }
    async function register(id: string) {
      const registration = await submit(id);
      await expect(
        guardian.getByText("Do decyzji", { exact: true }),
      ).toBeVisible();
      await accept(id, registration);
      return registration;
    }
    async function accept(id: string, reg: string) {
      await staff.goto(`/admin/walks/${id}`);
      const card = staff.locator(`#registration-${reg}`);
      await card.getByLabel("Decyzja").selectOption("accepted");
      staff.once("dialog", (dialog) => dialog.accept());
      await card
        .getByRole("button", { name: "Zapisz decyzję", exact: true })
        .click();
      await expect(card.getByRole("status")).toContainText("Decyzja zapisana");
      await expect(
        card.getByText("Zaakceptowany", { exact: true }),
      ).toBeVisible();
    }
    async function registration(id: string) {
      return checked(
        ownerDb
          .from("walk_registrations")
          .select("status,attendance,payment_status,package_id")
          .eq("id", id)
          .single(),
      );
    }
    async function receipt(
      kind: "registration" | "package",
      id: string,
      amount: string,
    ) {
      await staff.goto(`/admin/finance?charge=${kind}-${id}`);
      const charge = staff.locator(`#charge-${kind}-${id}`);
      await expect(charge).toBeVisible();
      await charge
        .locator("summary")
        .getByText("Rozlicz należność", { exact: true })
        .click();
      await charge
        .getByLabel("Otrzymana kwota (zł)", { exact: true })
        .fill(amount);
      await charge
        .getByRole("button", { name: "Zapisz wpłatę", exact: true })
        .click();
      await expect
        .poll(async () => {
          const rows = await checked(
            db.from("payments").select("id").eq(`${kind}_id`, id),
          );
          return rows?.length;
        })
        .toBeGreaterThan(0);
    }
    async function createPackage(entries: number) {
      await staff.goto("/admin/finance");
      await staff
        .locator("summary")
        .getByText("Dodaj pakiet dla psa", { exact: true })
        .click();
      await staff.getByLabel("Pies i opiekun").selectOption(dogs[0]);
      await staff
        .getByLabel("Nazwa pakietu", { exact: true })
        .fill(`Pakiet próby ${suffix}`);
      await staff
        .getByLabel("Liczba wejść", { exact: true })
        .fill(String(entries));
      await staff
        .getByLabel("Cena całego pakietu (zł)", { exact: true })
        .fill("100,00");
      await staff
        .getByRole("button", { name: "Utwórz pakiet", exact: true })
        .click();
      await expect(staff.getByRole("status")).toContainText("Pakiet dodany");
      const row = await checked(
        ownerDb.from("packages").select("id").eq("dog_id", dogs[0]).single(),
      );
      assert(row);
      return row.id;
    }
    async function usePackage(reg: string, pkg: string) {
      await staff.goto(`/admin/finance?charge=registration-${reg}`);
      const charge = staff.locator(`#charge-registration-${reg}`);
      await charge
        .locator("summary")
        .getByText("Rozlicz należność", { exact: true })
        .click();
      await charge.getByLabel(/^Pakiet psa/).selectOption(pkg);
      await charge
        .getByRole("button", { name: "Użyj wejścia z pakietu", exact: true })
        .click();
      await expect
        .poll(() => registration(reg))
        .toMatchObject({ package_id: pkg, payment_status: "none" });
    }
    async function payments(kind: "registration" | "package", id: string) {
      return (await checked(
        ownerDb
          .from("payments")
          .select("id,amount_cents,status,refund_note")
          .eq(`${kind}_id`, id)
          .order("created_at"),
      ))!;
    }
    async function refund(payment: string, note: string) {
      await staff.goto("/admin/finance");
      const row = staff.locator(`#payment-${payment}`);
      await row
        .locator("summary")
        .getByText("Zapisz zwrot lub popraw błędną wpłatę", { exact: true })
        .click();
      await row.getByLabel("Powód zwrotu lub korekty").fill(note);
      staff.once("dialog", (dialog) => dialog.accept());
      await row
        .getByRole("button", { name: "Zapisz zwrot / korektę", exact: true })
        .click();
      await expect(
        row.getByText("Zwrot / korekta", { exact: true }).first(),
      ).toBeVisible();
    }
    async function cancel(id: string, reg: string, late = false) {
      await guardian.goto(`/app/walks/${id}`);
      const card = guardian.locator(`#registration-${reg}`);
      guardian.once("dialog", (dialog) => dialog.accept());
      await card
        .getByRole("button", { name: "Odwołaj zgłoszenie", exact: true })
        .click();
      await expect(
        card.getByText(late ? "Późne odwołanie" : "Odwołany w terminie", {
          exact: true,
        }),
      ).toBeVisible();
    }
    async function attendance(id: string, reg: string, value: string) {
      await staff.goto(`/admin/walks/${id}`);
      const card = staff.locator(`#registration-${reg}`);
      await card.getByLabel("Obecność").selectOption(value);
      await card
        .getByRole("button", { name: "Zapisz obecność", exact: true })
        .click();
      await expect(card.getByRole("status")).toContainText("Obecność zapisana");
      await expect
        .poll(() => registration(reg))
        .toMatchObject({ attendance: value });
    }
    async function setPhase(id: string, phase: "late" | "past") {
      assert(
        walks.includes(id),
        "Only this journey's fixture may move in time",
      );
      // Simulate the passage of time on this fixture instead of waiting days.
      // Existing calendar records, real users and cancellation rules stay intact.
      const start = await freeStart(phase);
      await checked(
        db
          .from("walks")
          .update({
            starts_at: start,
            status: phase === "past" ? "completed" : "open",
          })
          .eq("id", id),
      );
    }
    async function isolated(reg: string) {
      for (const table of ["walk_registrations", "payments"] as const)
        expect(
          await checked(
            otherDb
              .from(table)
              .select("id")
              .eq(table === "payments" ? "registration_id" : "id", reg),
          ),
        ).toEqual([]);
      expect(
        (await anonymous.from("walk_registrations").select("id").eq("id", reg))
          .error,
      ).toBeTruthy();
      for (const api of [ownerDb, otherDb]) {
        expect(
          (
            await api.rpc("mark_attendance", {
              p_registration: reg,
              p_attendance: "absent",
            })
          ).error?.message,
        ).toContain("Brak uprawnień");
        expect(
          (
            await api.rpc("record_payment", {
              p_registration: reg,
              p_package: null,
              p_amount_cents: 100,
              p_method: "transfer",
              p_note: "Niedozwolona próba",
              p_request_id: crypto.randomUUID(),
            })
          ).error?.message,
        ).toContain("Brak uprawnień");
      }
      expect(
        (await otherDb.rpc("cancel_registration", { p_registration: reg }))
          .error?.message,
      ).toContain("Brak uprawnień");
    }
    return {
      db,
      ownerDb,
      otherDb,
      staffDb,
      anonymous,
      staff,
      guardian,
      other,
      dogs,
      suffix,
      freeStart,
      createWalk,
      submit,
      register,
      accept,
      registration,
      receipt,
      createPackage,
      usePackage,
      payments,
      refund,
      cancel,
      attendance,
      setPhase,
      isolated,
      dispose,
    };
  } catch (error) {
    await dispose();
    throw error;
  }
}

export async function mobileEvidence(page: Page, path: string) {
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(
    page.getByText("Wczytuję Twoje psie sprawy.", { exact: true }),
  ).toHaveCount(0);
  await page.evaluate(async () => {
    window.scrollTo(0, 0);
    await document.fonts.ready;
    await new Promise(requestAnimationFrame);
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth + 1,
    ),
  ).toBe(false);
  await page.screenshot({ path, fullPage: true });
}
