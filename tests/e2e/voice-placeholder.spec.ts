import { expect, type Page } from "@playwright/test";
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
import { revealFor } from "./details-ui";
import { dateInput, mobileEvidence, walkJourney } from "./walk-journey";

async function voiceDisclosure(staff: Page, guardian: Page) {
  const button = staff.getByRole("button", {
    name: "Notatka głosowa Wkrótce",
    exact: true,
  });
  await expect(button).toHaveCount(1);
  await expect(button).toHaveAttribute("aria-expanded", "false");
  const messageId = await button.getAttribute("aria-controls");
  expect(messageId).toBeTruthy();
  const message = staff.locator(`[id="${messageId}"]`);
  await expect(message).toBeHidden();
  const writes: string[] = [];
  const observe = (request: import("@playwright/test").Request) => {
    if (!["GET", "HEAD", "OPTIONS"].includes(request.method()))
      writes.push(request.method());
  };
  staff.on("request", observe);
  try {
    await button.focus();
    await expect(button).toBeFocused();
    await button.press("Enter");
    await expect(button).toHaveAttribute("aria-expanded", "true");
    await expect(message).toBeVisible();
    await expect(message).toContainText("Teraz nic się nie nagrywa.");
    await button.press("Enter");
    await expect(button).toHaveAttribute("aria-expanded", "false");
    await expect(message).toBeHidden();
    expect(writes).toEqual([]);
  } finally {
    staff.off("request", observe);
  }
  await expect(
    guardian.getByRole("button", { name: /Notatka głosowa/ }),
  ).toHaveCount(0);
}

test("mobile consultation details: staff can open the honest voice placeholder by keyboard; guardian cannot", async ({
  browser,
  baseURL,
}, info) => {
  const { db } = localClients(baseURL);
  const users: string[] = [],
    dogs: string[] = [];
  const contexts = await Promise.all([
    browser.newContext({ baseURL, viewport: { width: 390, height: 844 } }),
    browser.newContext({ baseURL, viewport: { width: 390, height: 844 } }),
  ]);
  try {
    const leader = await account(db, users, "admin"),
      owner = await account(db, users, "client");
    await setupLocalPractitioner(db, users, leader.id);
    const dog = crypto.randomUUID(),
      consultation = crypto.randomUUID();
    dogs.push(dog);
    const dogName = `Figa głos ${dog.slice(0, 8)}`;
    await checked(
      db.from("dogs").insert({
        id: dog,
        guardian_id: owner.id,
        name: dogName,
      }),
    );
    // Local owned request; the real staff form confirms the exact meeting.
    await checked(
      db.from("consultations").insert({
        id: consultation,
        dog_id: dog,
        requested_by: owner.id,
        practice_id: "00000000-0000-4000-8000-000000000001",
        topic: "Fikcyjne spotkanie do próby przycisku głosu.",
      }),
    );
    await checked(
      db.from("consultation_history").insert({
        consultation_id: consultation,
        version: 1,
        action: "requested",
        author_id: owner.id,
      }),
    );
    const staff = await contexts[0].newPage(),
      guardian = await contexts[1].newPage();
    await login(staff, leader, "admin");
    await login(guardian, owner, "client");
    await staff.goto(`/admin/consultations/${consultation}`);
    await revealFor(staff.getByLabel("Prowadzący", { exact: true }));
    await staff
      .getByLabel("Prowadzący", { exact: true })
      .selectOption(leader.id);
    const startsAt = await freeCalendarStart(db, {
      durationMinutes: 90,
      afterLast: true,
    });
    await revealFor(staff.getByLabel("Termin (czas polski)"));
    await staff.getByLabel("Termin (czas polski)").fill(dateInput(startsAt));
    await staff.getByLabel("Czas trwania (minuty)").fill("90");
    await staff.getByLabel("Forma spotkania").selectOption("online");
    await revealFor(staff.getByLabel("Miejsce lub instrukcja połączenia"));
    await staff
      .getByLabel("Miejsce lub instrukcja połączenia")
      .fill("Testowa konsultacja — prywatna instrukcja spotkania.");
    const confirm = staff.getByRole("button", {
      name: "Potwierdź uzgodniony termin",
      exact: true,
      includeHidden: true,
    });
    await revealFor(confirm);
    await confirm.click();
    await expect(staff.getByRole("status")).toContainText("Termin zapisany");
    await expect(staff).toHaveURL(`/admin/consultations/${consultation}`);
    await guardian.goto(`/app/consultations/${consultation}`);
    for (const page of [staff, guardian])
      await expect(
        page.getByRole("heading", { name: `${dogName} — czas dla Was.` }),
      ).toBeVisible();
    await voiceDisclosure(staff, guardian);
    await mobileEvidence(staff, info.outputPath("consultation-staff-390.png"));
    await mobileEvidence(
      guardian,
      info.outputPath("consultation-guardian-390.png"),
    );
  } finally {
    await cleanupSteps(
      ...contexts.map((context) => () => context.close()),
      () => disposeCareFixtures(db, users, dogs),
    );
  }
});

test("mobile walk details: voice placeholder stays with the exact walk and is absent for the guardian", async ({
  browser,
  baseURL,
}, info) => {
  const j = await walkJourney(browser, baseURL);
  try {
    const walk = await j.createWalk("Spacer notatka głosowa");
    await j.register(walk);
    await j.staff.goto(`/admin/walks/${walk}`);
    await j.guardian.setViewportSize({ width: 390, height: 844 });
    await j.guardian.goto(`/app/walks/${walk}`);
    await expect(j.staff).toHaveURL(`/admin/walks/${walk}`);
    await expect(j.guardian).toHaveURL(`/app/walks/${walk}`);
    await voiceDisclosure(j.staff, j.guardian);
    await mobileEvidence(j.staff, info.outputPath("walk-staff-390.png"));
    await mobileEvidence(j.guardian, info.outputPath("walk-guardian-390.png"));
  } finally {
    await j.dispose();
  }
});
