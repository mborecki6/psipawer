import { expect, test } from "@playwright/test";
import assert from "node:assert/strict";
import { checked } from "./local-fixtures";
import { walkJourney, mobileEvidence } from "./walk-journey";

test("walk cash: partial receipts → guardian cancellation → refunds, attendance corrections preserve the ledger", async ({
  browser,
  baseURL,
}, info) => {
  const j = await walkJourney(browser, baseURL);
  try {
    const id = await j.createWalk("Spacer rozliczenie"),
      reg = await j.register(id);
    await j.isolated(reg);
    await j.receipt("registration", reg, "40,00");
    await expect.poll(() => j.payments("registration", reg)).toHaveLength(1);
    await j.guardian.goto(`/app/finance?charge=registration-${reg}`);
    await expect(
      j.guardian.locator(`#charge-registration-${reg}`),
    ).toContainText("Pozostało 60,00");
    await expect(
      j.guardian.getByRole("button", { name: "Zapisz wpłatę", exact: true }),
    ).toHaveCount(0);
    await j.receipt("registration", reg, "60,00");
    await expect
      .poll(() => j.registration(reg))
      .toMatchObject({ payment_status: "paid" });
    const receipts = await j.payments("registration", reg);
    expect(receipts.map((p) => p.amount_cents)).toEqual([4000, 6000]);
    await j.cancel(id, reg);
    await j.guardian.goto("/app/finance");
    await expect(j.guardian.locator(`#charge-registration-${reg}`)).toHaveCount(
      0,
    );
    for (const payment of receipts) {
      await expect(j.guardian.locator(`#payment-${payment.id}`)).toContainText(
        "Do sprawdzenia: zwrot wpłaty.",
      );
      expect(
        (
          await j.ownerDb.rpc("void_payment", {
            p_payment: payment.id,
            p_note: "Odmowa korekty",
          })
        ).error?.message,
      ).toContain("Brak uprawnień");
      await j.refund(payment.id, `Uzgodniony zwrot po rezygnacji ${j.suffix}`);
    }
    expect(await j.registration(reg)).toMatchObject({
      status: "cancelled_on_time",
      payment_status: "refunded",
    });
    expect(
      (await j.payments("registration", reg)).map((p) => p.status),
    ).toEqual(["refunded", "refunded"]);
    await j.guardian.goto("/app/finance");
    await mobileEvidence(
      j.guardian,
      info.outputPath("guardian-refunds-320.png"),
    );

    const completed = await j.createWalk("Spacer obecność"),
      attended = await j.register(completed);
    await j.receipt("registration", attended, "100,00");
    await expect
      .poll(() => j.registration(attended))
      .toMatchObject({ payment_status: "paid" });
    await j.setPhase(completed, "past");
    await j.attendance(completed, attended, "absent");
    const [original] = await j.payments("registration", attended);
    await j.guardian.goto("/app/finance");
    await expect(j.guardian.locator(`#payment-${original.id}`)).toContainText(
      "Do sprawdzenia: zwrot wpłaty.",
    );
    expect(
      (
        await j.staffDb.rpc("record_payment", {
          p_registration: attended,
          p_package: null,
          p_amount_cents: 100,
          p_method: "transfer",
          p_note: "Brak należności",
          p_request_id: crypto.randomUUID(),
        })
      ).error?.message,
    ).toContain("nie wymaga wpłaty");
    await j.attendance(completed, attended, "present");
    await j.guardian.goto("/app/finance");
    await expect(
      j.guardian.locator(`#payment-${original.id}`),
    ).not.toContainText("Do sprawdzenia");
    await j.attendance(completed, attended, "no_show");
    expect(await j.registration(attended)).toMatchObject({
      status: "accepted",
      payment_status: "paid",
    });
    await j.attendance(completed, attended, "absent");
    await j.refund(original.id, `Korekta po usprawiedliwieniu ${j.suffix}`);
    await j.attendance(completed, attended, "present");
    expect(await j.registration(attended)).toMatchObject({
      payment_status: "due",
    });
    await j.guardian.goto(`/app/finance?charge=registration-${attended}`);
    await expect(
      j.guardian.locator(`#charge-registration-${attended}`),
    ).toContainText("100,00");
    const before = await checked(
      j.db
        .from("audit_events")
        .select("id")
        .eq("entity_id", attended)
        .eq("event", "attendance_changed"),
    );
    await checked(
      j.staffDb.rpc("mark_attendance", {
        p_registration: attended,
        p_attendance: "present",
      }),
    );
    const after = await checked(
      j.db
        .from("audit_events")
        .select("id")
        .eq("entity_id", attended)
        .eq("event", "attendance_changed"),
    );
    expect(after).toHaveLength(before!.length);
    await j.receipt("registration", attended, "100,00");
    await expect
      .poll(() => j.registration(attended))
      .toMatchObject({ payment_status: "paid" });
    expect(
      (await j.payments("registration", attended)).map((p) => p.status),
    ).toEqual(["refunded", "paid"]);
    const secondReceipt = (await j.payments("registration", attended))[1];
    await j.refund(
      secondReceipt.id,
      `Zwrot przed korektą obecności ${j.suffix}`,
    );
    await j.attendance(completed, attended, "absent");
    expect(await j.registration(attended)).toMatchObject({
      payment_status: "refunded",
    });
    await j.staff.goto(`/admin/walks/${completed}`);
    await expect(j.staff.locator(`#registration-${attended}`)).toContainText(
      "Obecność: Nieobecność usprawiedliwiona",
    );
    await expect(j.staff.locator(`#registration-${attended}`)).toContainText(
      "Płatność: Zwrot / korekta",
    );
    await mobileEvidence(j.staff, info.outputPath("staff-attendance-390.png"));
    await j.guardian.goto(`/app/walks/${completed}`);
    await expect(j.guardian.locator(`#registration-${attended}`)).toContainText(
      "Obecność: Nieobecność usprawiedliwiona",
    );
    await expect(
      j.guardian.getByRole("button", { name: "Zapisz obecność" }),
    ).toHaveCount(0);
  } finally {
    await j.dispose();
  }
});

test("returned package entry allocated elsewhere blocks attendance correction without losing the form or ledger, then allows recovery", async ({
  browser,
  baseURL,
}, info) => {
  const j = await walkJourney(browser, baseURL);
  try {
    const pkg = await j.createPackage(1);
    await j.receipt("package", pkg, "100,00");
    const past = await j.createWalk("Spacer korekta pakietu"),
      pastReg = await j.register(past);
    await j.usePackage(pastReg, pkg);
    await j.setPhase(past, "past");
    await j.attendance(past, pastReg, "absent");
    const future = await j.createWalk("Spacer nowe wejście"),
      futureReg = await j.register(future);
    await j.usePackage(futureReg, pkg);
    const ledger = () =>
      checked(
        j.ownerDb
          .from("package_transactions")
          .select("id,available_delta,reserved_delta,used_delta")
          .eq("package_id", pkg)
          .order("created_at")
          .order("id"),
      );
    const before = await ledger();
    await j.staff.goto(`/admin/walks/${past}`);
    const card = j.staff.locator(`#registration-${pastReg}`);
    await card.getByLabel("Obecność").selectOption("present");
    await card
      .getByRole("button", { name: "Zapisz obecność", exact: true })
      .click();
    await expect(card.getByRole("alert")).toContainText(
      "Brak dostępnych wejść w pakiecie",
    );
    await expect(card.getByRole("alert")).toBeFocused();
    await expect(card.getByLabel("Obecność")).toHaveValue("present");
    expect(await j.registration(pastReg)).toMatchObject({
      attendance: "absent",
      package_id: pkg,
      payment_status: "none",
    });
    expect(await ledger()).toEqual(before);
    await j.staff.setViewportSize({ width: 320, height: 900 });
    await mobileEvidence(
      j.staff,
      info.outputPath("attendance-package-conflict-320.png"),
    );
    await j.staff.goto(`/admin/finance?package=${pkg}`);
    const pack = j.staff.locator(`#package-${pkg}`);
    await pack
      .locator("summary")
      .getByText("Przypisane spacery", { exact: true })
      .click();
    await pack
      .getByText("Odłącz wejście od tego spaceru", { exact: true })
      .click();
    await pack
      .getByLabel("Powód odłączenia wejścia")
      .fill(`Korekta przypisania po uzgodnieniu ${j.suffix}`);
    j.staff.once("dialog", (dialog) => dialog.accept());
    await pack
      .getByRole("button", { name: "Odłącz wejście", exact: true })
      .click();
    await expect
      .poll(() => j.registration(futureReg))
      .toMatchObject({
        package_id: null,
        status: "accepted",
        payment_status: "due",
      });
    await j.attendance(past, pastReg, "present");
    const rows = (await ledger())!;
    expect(
      rows.reduce(
        (sum, r) => ({
          available: sum.available + r.available_delta,
          reserved: sum.reserved + r.reserved_delta,
          used: sum.used + r.used_delta,
        }),
        { available: 0, reserved: 0, used: 0 },
      ),
    ).toEqual({ available: 0, reserved: 0, used: 1 });
    expect((await j.payments("package", pkg)).map((p) => p.status)).toEqual([
      "paid",
    ]);
    expect(await j.payments("registration", pastReg)).toEqual([]);
    await j.guardian.goto(`/app/finance?charge=registration-${futureReg}`);
    await expect(
      j.guardian.locator(`#charge-registration-${futureReg}`),
    ).toContainText("100,00");
    await mobileEvidence(
      j.guardian,
      info.outputPath("package-correction-recovered-320.png"),
    );
  } finally {
    await j.dispose();
  }
});

test("walk package: reservation → timely cancellation/reopen → late cancellation → organizer cancellation → attendance corrections", async ({
  browser,
  baseURL,
}, info) => {
  const j = await walkJourney(browser, baseURL);
  try {
    await j.staff.goto("/admin/finance");
    await j.staff
      .locator("summary")
      .getByText("Dodaj pakiet dla psa", { exact: true })
      .click();
    await j.staff.getByLabel("Pies i opiekun").selectOption(j.dogs[0]);
    await j.staff
      .getByLabel("Nazwa pakietu", { exact: true })
      .fill(`Cztery spacery ${j.suffix}`);
    await j.staff.getByLabel("Liczba wejść", { exact: true }).fill("4");
    await j.staff
      .getByLabel("Cena całego pakietu (zł)", { exact: true })
      .fill("100,00");
    await j.staff
      .getByRole("button", { name: "Utwórz pakiet", exact: true })
      .click();
    await expect(j.staff.getByRole("status")).toContainText("Pakiet dodany");
    const record = await checked(
      j.ownerDb
        .from("packages")
        .select("id,price_cents")
        .eq("dog_id", j.dogs[0])
        .single(),
    );
    assert(record);
    const pkg = record.id;
    expect(record.price_cents).toBe(10000);
    async function balance() {
      const rows = (await checked(
        j.ownerDb
          .from("package_transactions")
          .select("available_delta,reserved_delta,used_delta")
          .eq("package_id", pkg),
      ))!;
      return rows.reduce(
        (sum, row) => ({
          available: sum.available + row.available_delta,
          reserved: sum.reserved + row.reserved_delta,
          used: sum.used + row.used_delta,
        }),
        { available: 0, reserved: 0, used: 0 },
      );
    }
    for (const table of ["packages", "package_transactions"] as const)
      expect(
        await checked(
          j.otherDb
            .from(table)
            .select("id")
            .eq(table === "packages" ? "id" : "package_id", pkg),
        ),
      ).toEqual([]);
    await j.receipt("package", pkg, "100,00");
    await expect.poll(() => j.payments("package", pkg)).toHaveLength(1);
    expect(await balance()).toEqual({ available: 4, reserved: 0, used: 0 });
    const id = await j.createWalk("Spacer pakiet"),
      reg = await j.register(id);
    await j.usePackage(reg, pkg);
    expect(await balance()).toEqual({ available: 3, reserved: 1, used: 0 });
    await j.cancel(id, reg);
    expect(await balance()).toEqual({ available: 4, reserved: 0, used: 0 });
    await j.staff.goto(`/admin/walks/${id}`);
    const card = j.staff.locator(`#registration-${reg}`);
    await card
      .getByText("Przywróć zgłoszenie do decyzji", { exact: true })
      .click();
    await card
      .getByLabel("Powód przywrócenia")
      .fill(`Uzgodniony powrót ${j.suffix}`);
    await card
      .getByRole("button", { name: "Przywróć do decyzji", exact: true })
      .click();
    await expect(card.getByText("Do decyzji", { exact: true })).toBeVisible();
    expect(await j.registration(reg)).toMatchObject({ package_id: null });
    await j.accept(id, reg);
    await j.usePackage(reg, pkg);
    expect(await balance()).toEqual({ available: 3, reserved: 1, used: 0 });
    await j.setPhase(id, "late");
    await j.cancel(id, reg, true);
    expect(await balance()).toEqual({ available: 3, reserved: 0, used: 1 });
    await j.staff.goto(`/admin/walks/${id}`);
    await j.staff.getByText("Odwołaj cały spacer", { exact: true }).click();
    await j.staff
      .getByLabel("Powód odwołania dla uczestników")
      .fill(`Odwołanie organizatora ${j.suffix}`);
    await j.staff
      .getByLabel("Potwierdzam odwołanie wszystkich aktywnych zgłoszeń.")
      .check();
    await j.staff
      .getByRole("button", { name: "Potwierdź odwołanie spaceru", exact: true })
      .click();
    await expect(
      j.staff.getByText("Spacer został odwołany przez organizatora.", {
        exact: true,
      }),
    ).toBeVisible();
    expect(await balance()).toEqual({ available: 4, reserved: 0, used: 0 });
    expect(await j.registration(reg)).toMatchObject({
      status: "cancelled_on_time",
    });
    expect(
      await checked(
        j.ownerDb
          .from("notifications")
          .select("id")
          .eq("entity_id", id)
          .eq("kind", "walk_cancelled"),
      ),
    ).toHaveLength(1);
    expect(
      (await checked(
        j.db
          .from("reminder_jobs")
          .select("status")
          .eq("source_id", reg)
          .eq("kind", "walk"),
      ))!.every((r) => r.status === "cancelled"),
    ).toBe(true);

    const completed = await j.createWalk("Spacer pakiet obecność"),
      attended = await j.register(completed);
    await j.usePackage(attended, pkg);
    await j.setPhase(completed, "past");
    await j.attendance(completed, attended, "present");
    expect(await balance()).toEqual({ available: 3, reserved: 0, used: 1 });
    await j.attendance(completed, attended, "absent");
    expect(await balance()).toEqual({ available: 4, reserved: 0, used: 0 });
    await j.attendance(completed, attended, "no_show");
    expect(await balance()).toEqual({ available: 3, reserved: 0, used: 1 });
    await j.attendance(completed, attended, "pending");
    expect(await balance()).toEqual({ available: 3, reserved: 1, used: 0 });
    await j.attendance(completed, attended, "present");
    expect(await balance()).toEqual({ available: 3, reserved: 0, used: 1 });
    expect(await j.registration(attended)).toMatchObject({
      payment_status: "none",
    });
    expect(await j.payments("registration", attended)).toEqual([]);
    const before = await checked(
      j.ownerDb.from("package_transactions").select("id").eq("package_id", pkg),
    );
    await checked(
      j.staffDb.rpc("mark_attendance", {
        p_registration: attended,
        p_attendance: "present",
      }),
    );
    expect(
      await checked(
        j.ownerDb
          .from("package_transactions")
          .select("id")
          .eq("package_id", pkg),
      ),
    ).toHaveLength(before!.length);
    await j.guardian.goto(`/app/finance?package=${pkg}`);
    const packageCard = j.guardian.locator(`#package-${pkg}`);
    await expect(packageCard).toContainText("opłacony");
    await packageCard
      .locator("summary")
      .getByText("Historia wejść", { exact: true })
      .click();
    await expect(packageCard).toContainText(
      "Zwrot wejścia: usprawiedliwiona nieobecność",
    );
    await mobileEvidence(
      j.guardian,
      info.outputPath("guardian-package-320.png"),
    );
    await j.staff.goto(`/admin/finance?package=${pkg}`);
    await mobileEvidence(j.staff, info.outputPath("staff-package-390.png"));
  } finally {
    await j.dispose();
  }
});
