import { expect, type Page } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { checked } from "./local-fixtures";
import { careEditor, careSourcePicker } from "./care-journey";

// The same journey runs for a provisioned fixture and a newly invited guardian.
// All business operations use the UI; only elapsed time is simulated on the
// disposable consultation, so publication can be checked in one test run.
export async function consultationJourney({
  db,
  outsiderDb,
  staff,
  guardian,
  ownerId,
  staffId,
  dogs,
  stage = () => {},
}: {
  db: SupabaseClient;
  outsiderDb: SupabaseClient;
  staff: Page;
  guardian: Page;
  ownerId: string;
  staffId: string;
  dogs: string[];
  stage?: (phase: string) => void;
}) {
  const suffix = crypto.randomUUID().slice(0, 8);
  stage("care-dog-and-consultation-request");
  await guardian
    .getByRole("link", { name: "Dodaj psa +", exact: true })
    .click();
  await guardian.waitForURL("**/app/dogs/new");
  await guardian.getByLabel("Imię psa").fill(`Figa ${suffix}`);
  await guardian
    .getByRole("button", { name: "Dodaj psa", exact: true })
    .click();
  await expect(guardian).toHaveURL(/\/app\/dogs\/[a-f0-9-]+/);
  const dog = new URL(guardian.url()).pathname.split("/").at(-1)!;
  dogs.push(dog);

  await guardian.getByRole("link", { name: "Otwórz konsultacje →" }).click();
  await guardian.getByRole("link", { name: "Poproś o konsultację" }).click();
  await expect(guardian.getByLabel("Twój pies")).toHaveValue(dog);
  await guardian
    .getByLabel("Wybierz usługę")
    .selectOption("60000000-0000-4000-8000-000000000011");
  await guardian
    .getByLabel("Co chcesz omówić?")
    .fill(`Fikcyjne zgłoszenie ${suffix}`);
  await guardian
    .getByRole("button", { name: "Przekaż zgłoszenie", exact: true })
    .click();
  await expect(guardian).toHaveURL(/\/app\/consultations\/[a-f0-9-]+$/);
  const consultation = new URL(guardian.url()).pathname.split("/").at(-1)!;
  const record = await checked(
    db
      .from("consultations")
      .select("agreed_price_cents,service_meeting_mode,status")
      .eq("id", consultation)
      .single(),
  );
  expect(record).toMatchObject({
    agreed_price_cents: 10000,
    service_meeting_mode: "online",
    status: "requested",
  });
  expect(
    await checked(
      outsiderDb.from("consultations").select("id").eq("id", consultation),
    ),
  ).toEqual([]);

  // Hold client scripts to reproduce a slow first page load deterministically.
  stage("care-slow-hydration-and-scheduling");
  // The server-rendered preview must not accept edits that hydration can lose.
  let releaseScripts!: () => void;
  const scriptsReady = new Promise<void>((resolve) => {
    releaseScripts = resolve;
  });
  const scripts = "**/_next/static/**/*.js*";
  await staff.route(scripts, async (route) => {
    await scriptsReady;
    await route.continue();
  });
  try {
    await staff.goto(`/admin/consultations/${consultation}`, {
      waitUntil: "commit",
    });
    await expect(staff.getByLabel("Termin (czas polski)")).toBeVisible();
    await expect(staff.getByLabel("Termin (czas polski)")).toBeDisabled();
    await expect(
      staff.getByLabel("Prowadzący", { exact: true }),
    ).toBeDisabled();
    await expect(
      staff.getByRole("button", { name: "Przygotowuję formularz…" }),
    ).toBeDisabled();
  } finally {
    releaseScripts();
    await staff.unrouteAll({ behavior: "wait" });
  }
  const day = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Europe/Warsaw",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(Date.now() + 8 * 86400000));
  // A guardian's request does not choose the lead. Assign this disposable
  // appointment explicitly after hydration; the required picker must never
  // cause the test to mistake browser validation for a scheduling failure.
  await staff.getByLabel("Prowadzący", { exact: true }).selectOption(staffId);
  await expect(staff.getByLabel("Prowadzący", { exact: true })).toHaveValue(
    staffId,
  );
  await staff.getByLabel("Termin (czas polski)").fill(`${day}T11:00`);
  await staff
    .getByLabel("Miejsce lub instrukcja połączenia")
    .fill("Testowa wideorozmowa — instrukcja dla opiekuna.");
  await expect(staff.getByLabel("Termin (czas polski)")).toHaveValue(
    `${day}T11:00`,
  );
  await staff
    .getByRole("button", { name: "Potwierdź uzgodniony termin" })
    .click();
  await expect(staff.getByRole("status")).toContainText("Termin zapisany");
  const assignment = await checked(
    db
      .from("calendar_assignments")
      .select("assigned_staff_id,resource_id")
      .eq("kind", "consultation")
      .eq("appointment_id", consultation)
      .single(),
  );
  expect(assignment).toEqual({ assigned_staff_id: staffId, resource_id: null });
  await expect(
    staff.getByRole("button", { name: "Oznacz jako zakończoną" }),
  ).toHaveCount(0);
  await guardian.reload();
  await expect(guardian.getByText("Umówiona", { exact: true })).toBeVisible();

  stage("care-private-draft");
  await staff.getByRole("link", { name: "Przygotuj zalecenia →" }).click();
  const careForm = await careEditor(staff);
  await expect(
    careForm.getByRole("region", { name: "Powiązanie planu", exact: true }),
  ).toContainText("Konsultacja");
  await expect(
    careForm.getByLabel("Konsultacja, której dotyczą zalecenia"),
  ).toBeHidden();
  await careSourcePicker(careForm);
  await expect(
    staff.getByLabel("Konsultacja, której dotyczą zalecenia"),
  ).toHaveValue(consultation);
  const title = `Plan testowy ${suffix}`;
  const draft = `Prywatny szkic ${suffix}, jeszcze niegotowy do przekazania.`;
  await staff.getByLabel("Tytuł planu", { exact: true }).fill(title);
  await staff.getByLabel("Zalecenia dla opiekuna", { exact: true }).fill(draft);
  await expect(
    staff.getByRole("button", { name: "Opublikuj dla opiekuna" }),
  ).toBeDisabled();
  await staff
    .getByRole("button", { name: "Zapisz szkic", exact: true })
    .click();
  await expect(staff.getByRole("status")).toContainText("Szkic zapisany");
  await guardian.goto(`/app/dogs/${dog}/care`);
  await expect(guardian.getByText(draft, { exact: true })).toHaveCount(0);
  await expect(
    guardian.getByLabel("Zalecenia dla opiekuna", { exact: true }),
  ).toHaveCount(0);
  expect(
    await checked(
      outsiderDb.from("care_drafts").select("dog_id").eq("dog_id", dog),
    ),
  ).toEqual([]);

  // Simulate elapsed appointment time only on this disposable test record.
  stage("care-complete-and-publish");
  // Scheduling itself went through the real UI and required a future slot.
  await checked(
    db
      .from("consultations")
      .update({ starts_at: new Date(Date.now() - 3 * 3600000).toISOString() })
      .eq("id", consultation)
      .eq("dog_id", dog),
  );
  await staff.goto(`/admin/consultations/${consultation}`);
  await staff.getByRole("button", { name: "Oznacz jako zakończoną" }).click();
  await expect(staff.getByText("Zakończona", { exact: true })).toBeVisible();
  await staff.getByRole("link", { name: "Otwórz szkic zaleceń →" }).click();
  await expect(
    staff.getByLabel("Zalecenia dla opiekuna", { exact: true }),
  ).toHaveValue(draft);
  const published = `Treść demonstracyjna ${suffix}. Tu pojawią się wskazówki przygotowane przez prowadzącą.`;
  await staff
    .getByLabel("Zalecenia dla opiekuna", { exact: true })
    .fill(published);
  await staff.getByRole("button", { name: "Opublikuj dla opiekuna" }).click();
  await expect(staff.getByRole("status")).toContainText("Plan opublikowany");
  const plan = await checked(
    db
      .from("care_plan_versions")
      .select("id,consultation_id,body")
      .eq("dog_id", dog)
      .single(),
  );
  expect(plan).toMatchObject({
    consultation_id: consultation,
    body: published,
  });
  const notifications = await checked(
    db
      .from("notifications")
      .select("entity_id")
      .eq("recipient_id", ownerId)
      .eq("kind", "plan_published")
      .eq("dog_id", dog),
  );
  expect(notifications).toEqual([{ entity_id: plan!.id }]);
  expect(
    await checked(
      outsiderDb.from("care_plan_versions").select("id").eq("dog_id", dog),
    ),
  ).toEqual([]);

  stage("care-read-and-respond");
  await guardian.goto(`/app/consultations/${consultation}`);
  await guardian.getByRole("link", { name: `${title} · wersja 1 →` }).click();
  await expect(guardian).toHaveURL(`/app/care/plans/${plan!.id}`);
  await expect(guardian.getByText(published, { exact: true })).toBeVisible();
  await guardian
    .getByRole("link", { name: "← Aktualny plan i postępy psa" })
    .click();
  const response = `Testowa odpowiedź opiekuna ${suffix}. Udało się otworzyć i przeczytać plan.`;
  await guardian
    .getByLabel("Co udało się zrobić?", { exact: true })
    .fill(response);
  await guardian
    .getByRole("button", { name: "Przekaż odpowiedź prowadzącej" })
    .click();
  await expect(guardian.getByRole("status")).toContainText(
    "Odpowiedź zapisana",
  );
  await staff.goto(`/admin/dogs/${dog}/care`);
  await expect(staff.getByText(response, { exact: true })).toBeVisible();
  await staff.getByRole("button", { name: "Oznacz jako przeczytaną" }).click();
  await expect(staff.getByText("Przeczytana", { exact: true })).toBeVisible();
  const progress = await checked(
    db
      .from("care_progress")
      .select("plan_id,author_id,reviewed_by")
      .eq("dog_id", dog)
      .single(),
  );
  expect(progress).toMatchObject({
    plan_id: plan!.id,
    author_id: ownerId,
    reviewed_by: staffId,
  });
  expect(
    await checked(
      outsiderDb.from("care_progress").select("id").eq("dog_id", dog),
    ),
  ).toEqual([]);
  expect(
    await guardian.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  ).toBe(true);
  stage("care-journey-complete");
  return { dog, planId: plan!.id, published };
}
