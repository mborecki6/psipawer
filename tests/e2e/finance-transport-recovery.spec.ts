import { expect } from "@playwright/test";
import {
  test,
  account,
  checked,
  cleanupSteps,
  disposeCareFixtures,
  localClients,
  login,
  setupLocalPractitioner,
} from "./local-fixtures";
import { loseCommittedReply, noticesAndAudit } from "./transport-journey";

test("an unrelated payment refresh preserves an uncertain partial payment's key and fields until exact retry", async ({
  browser,
  baseURL,
}) => {
  const { db, client } = localClients(baseURL);
  const users: string[] = [],
    dogs: string[] = [],
    packages: string[] = [];
  const context = await browser.newContext({
    baseURL,
    viewport: { width: 390, height: 844 },
  });
  const page = await context.newPage(),
    staff = client();
  try {
    const practitioner = await account(db, users, "admin");
    const owner = await account(db, users, "client");
    await setupLocalPractitioner(db, users, practitioner.id);
    expect(practitioner.email).toMatch(/^psi-e2e-admin-.+@example\.test$/);
    await checked(staff.auth.signInWithPassword(practitioner));
    const dog = crypto.randomUUID();
    dogs.push(dog);
    await checked(
      db.from("dogs").insert({
        id: dog,
        guardian_id: owner.id,
        name: "Fikcyjny pies próby wpłat",
      }),
    );
    // Three consecutive own charges guarantee that at least two share a page,
    // even when the local ledger happens to end at its twenty-row boundary.
    // No dates or records belonging to another guardian are changed.
    for (const label of ["A", "B", "C"])
      packages.push(
        await checked(
          staff.rpc("purchase_package", {
            p_dog: dog,
            p_name: `Fikcyjny pakiet utraty odpowiedzi ${label}`,
            p_entries: 3,
            p_price_cents: 10000,
            p_expires_at: null,
            p_note: "Lokalna próba dwóch należności.",
          }),
        ),
      );
    await login(page, practitioner, "admin");
    const targetA = packages[1];
    await page.goto(`/admin/finance?charge=package-${targetA}`);
    const chargeA = page.locator(`#charge-package-${targetA}`);
    await expect(chargeA).toBeVisible();
    let targetB: string | undefined;
    for (const candidate of [packages[0], packages[2]])
      if (await page.locator(`#charge-package-${candidate}`).count()) {
        targetB = candidate;
        break;
      }
    if (!targetB)
      throw new Error("Two owned charges must share this finance page.");
    const chargeB = page.locator(`#charge-package-${targetB}`);
    for (const charge of [chargeA, chargeB])
      await charge
        .locator("summary")
        .getByText("Rozlicz należność", { exact: true })
        .click();
    const formA = chargeA.locator("form"),
      formB = chargeB.locator("form");
    const noteA = `Fikcyjna wpłata A ${crypto.randomUUID()}`;
    await formA
      .getByLabel("Otrzymana kwota (zł)", { exact: true })
      .fill("20,00");
    await formA.locator('select[name="method"]').selectOption("other");
    await formA.locator('textarea[name="note"]').fill(noteA);
    const requestA = await formA.locator('[name="request_id"]').inputValue();
    const saved = (target: string) =>
      checked(
        db
          .from("payments")
          .select("id,request_id,amount_cents,method,note,status")
          .eq("package_id", target)
          .order("id"),
      );
    let paymentA: NonNullable<Awaited<ReturnType<typeof saved>>> | undefined;
    let effectsA: Awaited<ReturnType<typeof noticesAndAudit>> | undefined;
    await loseCommittedReply(page, formA, requestA, async () => {
      paymentA = (await saved(targetA))!;
      expect(paymentA).toHaveLength(1);
      expect(paymentA[0]).toMatchObject({
        request_id: requestA,
        amount_cents: 2000,
        method: "other",
        note: noteA,
        status: "paid",
      });
      effectsA = await noticesAndAudit(
        db,
        paymentA[0].id,
        "payment_recorded",
        "payment_recorded",
      );
    });

    // Stay on the same finance list. The acknowledged action B revalidates
    // A's server props, including its now smaller outstanding amount.
    const noteB = `Osobna fikcyjna wpłata B ${crypto.randomUUID()}`;
    await formB
      .getByLabel("Otrzymana kwota (zł)", { exact: true })
      .fill("10,00");
    await formB.locator('select[name="method"]').selectOption("cash");
    await formB.locator('textarea[name="note"]').fill(noteB);
    const requestB = await formB.locator('[name="request_id"]').inputValue();
    await formB
      .getByRole("button", { name: "Zapisz wpłatę", exact: true })
      .click();
    await expect(formB.getByRole("status")).toContainText("Wpłata zapisana");
    const paymentB = (await saved(targetB))!;
    expect(paymentB).toHaveLength(1);
    expect(paymentB[0]).toMatchObject({
      request_id: requestB,
      amount_cents: 1000,
      method: "cash",
      note: noteB,
      status: "paid",
    });
    await expect(chargeA).toContainText(
      /Wpłacono\s+20,00\s*zł\s+z\s+100,00\s*zł/,
    );
    await expect(chargeA).toContainText(/Pozostało\s+80,00\s*zł/);
    await expect(formA.locator('[name="request_id"]')).toHaveValue(requestA);
    await expect(formA.locator('[name="target_id"]')).toHaveValue(targetA);
    await expect(
      formA.getByLabel("Otrzymana kwota (zł)", { exact: true }),
    ).toHaveValue("20,00");
    await expect(formA.locator('select[name="method"]')).toHaveValue("other");
    await expect(formA.locator('textarea[name="note"]')).toHaveValue(noteA);
    await expect(formA.getByRole("alert")).toContainText(
      "Nie udało się potwierdzić zapisu",
    );
    expect(await saved(targetA)).toEqual(paymentA);

    await formA
      .getByRole("button", { name: "Zapisz wpłatę", exact: true })
      .click();
    await expect(formA.getByRole("status")).toContainText("Wpłata zapisana");
    await expect.poll(() => saved(targetA)).toEqual(paymentA);
    expect(
      await noticesAndAudit(
        db,
        paymentA![0].id,
        "payment_recorded",
        "payment_recorded",
      ),
    ).toEqual(effectsA);
    expect(await saved(targetB)).toEqual(paymentB);
    await expect(chargeA).toContainText(/Pozostało\s+80,00\s*zł/);
    // Once confirmation arrives the form may prepare another intentional
    // payment. It must not retain an apparently unconfirmed amount.
    await expect(
      formA.getByLabel("Otrzymana kwota (zł)", { exact: true }),
    ).toHaveValue("");
  } finally {
    await cleanupSteps(
      () => context.close(),
      () => staff.auth.signOut(),
      () =>
        disposeCareFixtures(db, users, dogs, async () => {
          // Also discover an own RPC commit if setup lost its confirmation
          // before purchase_package's returned UUID reached the array above.
          if (dogs.length) {
            const created = await checked(
              db.from("packages").select("id").in("dog_id", dogs),
            );
            for (const row of created || [])
              if (!packages.includes(row.id)) packages.push(row.id);
          }
          if (packages.length) {
            await checked(
              db.from("payments").delete().in("package_id", packages),
            );
            await checked(
              db
                .from("package_transactions")
                .delete()
                .in("package_id", packages),
            );
            await checked(db.from("packages").delete().in("id", packages));
          }
        }),
      async () => {
        if (users.length)
          expect(
            await checked(db.from("profiles").select("id").in("id", users)),
          ).toEqual([]);
        if (packages.length)
          expect(
            await checked(
              db.from("payments").select("id").in("package_id", packages),
            ),
          ).toEqual([]);
      },
    );
  }
});
