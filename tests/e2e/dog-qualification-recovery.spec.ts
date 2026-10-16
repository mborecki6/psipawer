import { expect, type Page } from "@playwright/test";
import {
  test,
  account,
  checked,
  cleanupSteps,
  disposeCareFixtures,
  localClients,
  login,
} from "./local-fixtures";
import { assertRetainedLayout } from "./transport-journey";

const qualification = (page: Page) =>
  page.locator("form").filter({
    has: page.locator('[name="expected_qualification_version"]'),
  });

test("another administrator's qualification cannot silently rebase an old draft after a note refresh", async ({
  browser,
  baseURL,
}) => {
  const { db } = localClients(baseURL);
  const users: string[] = [],
    dogs: string[] = [];
  const firstContext = await browser.newContext({
    baseURL,
    viewport: { width: 390, height: 844 },
  });
  const secondContext = await browser.newContext({
    baseURL,
    viewport: { width: 1440, height: 1000 },
  });
  const first = await firstContext.newPage(),
    second = await secondContext.newPage();
  try {
    const author = await account(db, users, "admin");
    const other = await account(db, users, "admin");
    const owner = await account(db, users, "client");
    const dog = crypto.randomUUID();
    dogs.push(dog);
    await checked(
      db.from("dogs").insert({
        id: dog,
        guardian_id: owner.id,
        name: "Fikcyjna kwalifikacja dwóch kart",
      }),
    );
    const current = () =>
      checked(
        db
          .from("dogs")
          .select("status,qualification_version")
          .eq("id", dog)
          .single(),
      );
    const initial = await current();
    if (!initial) throw new Error("Missing local qualification fixture");
    await login(first, author, "admin");
    await login(second, other, "admin");
    await first.goto(`/admin/dogs/${dog}`);
    await second.goto(`/admin/dogs/${dog}`);
    const old = qualification(first),
      fresh = qualification(second);
    const draft = `Nieaktualna decyzja A ${crypto.randomUUID()}`;
    await old.locator('select[name="status"]').selectOption("suspended");
    await old.locator('[name="note"]').fill(draft);
    const key = await old.locator('[name="request_id"]').inputValue();
    await expect(old.locator('[name="expected_status"]')).toHaveValue(
      initial.status,
    );
    await expect(
      old.locator('[name="expected_qualification_version"]'),
    ).toHaveValue(String(initial.qualification_version));

    const actualDecision = `Aktualna decyzja B ${crypto.randomUUID()}`;
    await fresh.locator('select[name="status"]').selectOption("approved");
    await fresh.locator('[name="note"]').fill(actualDecision);
    await fresh
      .getByRole("button", { name: "Zapisz kwalifikację", exact: true })
      .click();
    await expect(fresh.getByRole("status")).toContainText("Status psa");
    const decided = {
      status: "approved",
      qualification_version: initial.qualification_version + 1,
    };
    await expect.poll(current).toEqual(decided);

    // This other action refreshes the same route with newer dog props while
    // the first qualification draft is still open and has never been saved.
    const note = `Osobna notatka A ${crypto.randomUUID()}`;
    const notesForm = first
      .locator("form")
      .filter({ has: first.getByLabel("Treść notatki", { exact: true }) });
    await notesForm.getByLabel("Treść notatki", { exact: true }).fill(note);
    await notesForm
      .locator('select[name="visibility"]')
      .selectOption("admin_only");
    await notesForm
      .getByRole("button", { name: "Dodaj notatkę", exact: true })
      .click();
    await expect(notesForm.getByRole("status")).toContainText(
      "Notatka zapisana",
    );
    await expect(old.locator('select[name="status"]')).toHaveValue("suspended");
    await expect(old.locator('[name="note"]')).toHaveValue(draft);
    await expect(old.locator('[name="request_id"]')).toHaveValue(key);
    await expect(old.locator('[name="expected_status"]')).toHaveValue(
      initial.status,
    );
    await expect(
      old.locator('[name="expected_qualification_version"]'),
    ).toHaveValue(String(initial.qualification_version));

    await old
      .getByRole("button", { name: "Zapisz kwalifikację", exact: true })
      .click();
    await expect(old.getByRole("alert")).toContainText(
      "Kwalifikacja psa zmieniła się w międzyczasie",
    );
    await expect(old.getByRole("alert")).toBeFocused();
    await assertRetainedLayout(first, old);
    await expect(old.locator('[name="note"]')).toHaveValue(draft);
    await expect(old.locator('select[name="status"]')).toHaveValue("suspended");
    await expect(old.locator('[name="request_id"]')).toHaveValue(key);
    await expect(
      old.locator('[name="expected_qualification_version"]'),
    ).toHaveValue(String(initial.qualification_version));
    expect(await current()).toEqual(decided);
    const audit = () =>
      checked(
        db
          .from("audit_events")
          .select("id")
          .eq("entity_id", dog)
          .eq("event", "dog_status_changed"),
      );
    expect(await audit()).toHaveLength(1);
    const notes = await checked(
      db.from("dog_notes").select("body").eq("dog_id", dog),
    );
    expect(notes!.map((row) => row.body).sort()).toEqual(
      [actualDecision, note].sort(),
    );

    // An explicit refresh prepares a new decision against the real current
    // status/version. Merely saving the unrelated note above did not do this.
    await first.reload();
    const recovered = qualification(first);
    await expect(recovered.locator('[name="request_id"]')).not.toHaveValue(key);
    await expect(recovered.locator('[name="expected_status"]')).toHaveValue(
      decided.status,
    );
    await expect(
      recovered.locator('[name="expected_qualification_version"]'),
    ).toHaveValue(String(decided.qualification_version));
    await recovered.locator('select[name="status"]').selectOption("suspended");
    await recovered
      .locator('[name="note"]')
      .fill("Nowa świadoma decyzja po odświeżeniu profilu.");
    await recovered
      .getByRole("button", { name: "Zapisz kwalifikację", exact: true })
      .click();
    await expect(recovered.getByRole("status")).toContainText("Status psa");
    await expect.poll(current).toEqual({
      status: "suspended",
      qualification_version: decided.qualification_version + 1,
    });
    expect(await audit()).toHaveLength(2);
  } finally {
    await cleanupSteps(
      () => firstContext.close(),
      () => secondContext.close(),
      () => disposeCareFixtures(db, users, dogs),
    );
  }
});
