import { expect, test } from "@playwright/test";
import {
  careDay,
  careEditor,
  careFixture,
  careScreenshot,
} from "./care-journey";
import { checked } from "./local-fixtures";

async function ownService(f: Awaited<ReturnType<typeof careFixture>>) {
  const id = crypto.randomUUID();
  await checked(
    f.db
      .from("services")
      .insert({
        id,
        practice_id: "00000000-0000-4000-8000-000000000001",
        name: `Kontrola lokalna ${id.slice(0, 8)}`,
        kind: "individual",
        booking_flow: "consultation",
        meeting_mode: "in_person",
        price_cents: 10000,
        price_unit: "za spotkanie",
        duration_minutes: 60,
        sessions_count: 1,
        source_url: "https://www.psipawer.pl/test",
      }),
  );
  return id;
}

test("control invitation opens an ordinary request and two tabs create only one consultation", async ({
  browser,
  baseURL,
}, info) => {
  const f = await careFixture(browser, baseURL);
  let service: string | undefined;
  try {
    service = await ownService(f);
    const form = await careEditor(f.staff);
    await form
      .getByLabel("Tytuł planu", { exact: true })
      .fill("Plan z zaproszeniem do kontroli");
    await form
      .getByLabel("Zalecenia dla opiekuna")
      .fill("Fikcyjne zalecenia do próby zgłoszenia kontroli.");
    await form
      .getByLabel("Termin kontaktu kontrolnego (opcjonalnie)")
      .fill(careDay(8));
    await form
      .getByLabel("Zaproś opiekuna do zgłoszenia kontroli (opcjonalnie)")
      .fill(careDay(5));
    await form.getByRole("button", { name: "Opublikuj dla opiekuna" }).click();
    await expect(form.getByRole("status")).toContainText("Plan opublikowany");
    const invitation = await checked(
      f.db
        .from("care_control_invitations")
        .select("id,plan_id,version")
        .eq("dog_id", f.dog)
        .single(),
    );
    const jobs = await checked(
      f.db
        .from("reminder_jobs")
        .select("kind,status")
        .eq("source_id", invitation!.id),
    );
    expect(jobs).toEqual([{ kind: "control_invitation", status: "pending" }]);
    await f.guardian.goto(`/app/dogs/${f.dog}/care?context=general`);
    await f.guardian
      .getByRole("link", { name: "Zgłoś konsultację kontrolną →" })
      .click();
    await expect(f.guardian).toHaveURL(new RegExp(`control=${invitation!.id}`));
    await expect(f.guardian.getByLabel("Twój pies")).toHaveValue(f.dog);
    await f.guardian.getByLabel("Wybierz usługę").selectOption(service);
    const second = await f.guardianContext.newPage();
    await second.goto(`/app/consultations/new?control=${invitation!.id}`);
    await second.getByLabel("Wybierz usługę").selectOption(service);
    await second
      .getByLabel("Co chcesz omówić?")
      .fill("Kontrola z drugiej otwartej karty.");
    await f.guardian
      .getByLabel("Co chcesz omówić?")
      .fill("Chcę omówić postępy na kontroli.");
    await f.guardian
      .getByRole("button", { name: "Przekaż zgłoszenie" })
      .click();
    await expect(f.guardian).toHaveURL(/\/app\/consultations\/[a-f0-9-]+$/);
    const destination = f.guardian.url();
    await second.getByRole("button", { name: "Przekaż zgłoszenie" }).click();
    await expect(second).toHaveURL(destination);
    const requests = await checked(
      f.db
        .from("consultations")
        .select("id,status,starts_at")
        .eq("dog_id", f.dog),
    );
    expect(requests).toHaveLength(1);
    expect(requests![0]).toMatchObject({
      status: "requested",
      starts_at: null,
    });
    expect(
      await checked(
        f.db.from("care_follow_ups").select("status").eq("dog_id", f.dog),
      ),
    ).toEqual([{ status: "open" }]);
    await f.staff.goto(`/admin/dogs/${f.dog}/care?context=general`);
    await expect(
      f.staff.getByRole("region", { name: "Zaproszenie do kontroli" }),
    ).toContainText("Opiekun przekazał zgłoszenie");
    await careScreenshot(
      f.guardian,
      info.outputPath("control-request-390.png"),
      390,
    );
    await second.close();
  } finally {
    if (service)
      await checked(
        f.db.from("service_revisions").delete().eq("service_id", service),
      );
    await f.dispose();
    if (service)
      await checked(f.db.from("services").delete().eq("id", service));
  }
});

test("service reporting snapshot survives offer changes and expiry rejects a stale guardian form", async ({
  browser,
  baseURL,
}, info) => {
  const f = await careFixture(browser, baseURL);
  let service: string | undefined;
  try {
    service = await ownService(f);
    await f.staff.goto(`/admin/services/${service}/reporting`);
    await f.staff.getByLabel("Okres w dniach (puste = bez limitu)").fill("14");
    await f.staff
      .getByLabel("Uzasadnienie zmiany")
      .fill("Okres nowej usługi testowej.");
    await f.staff
      .getByRole("button", { name: "Zapisz zasady dla nowych zgłoszeń" })
      .click();
    await expect(f.staff.getByRole("status")).toContainText("Zasady zapisane");
    const meeting = crypto.randomUUID();
    await checked(
      f.ownerDb.rpc("request_consultation", {
        p_id: meeting,
        p_dog: f.dog,
        p_topic: "Fikcyjna konsultacja",
        p_availability: "",
        p_service: service,
        p_expected_service_version: 2,
      }),
    );
    await checked(
      f.db
        .from("consultations")
        .update({
          status: "completed",
          starts_at: new Date(Date.now() - 86400000).toISOString(),
          duration_minutes: 60,
          meeting_mode: "in_person",
          location: "Fikcyjne miejsce testowe",
        })
        .eq("id", meeting),
    );
    await f.staff.reload();
    await f.staff.getByLabel("Raportowanie w usłudze").selectOption("false");
    await f.staff.getByLabel("Okres w dniach (puste = bez limitu)").fill("");
    await f.staff
      .getByLabel("Uzasadnienie zmiany")
      .fill("Zmiana tylko przyszłych przypisań.");
    await f.staff
      .getByRole("button", { name: "Zapisz zasady dla nowych zgłoszeń" })
      .click();
    await expect(f.staff.getByRole("status")).toContainText("Zasady zapisane");
    await f.staff.goto(`/admin/dogs/${f.dog}/care?consultation=${meeting}`);
    const editor = await careEditor(f.staff);
    await editor
      .getByLabel("Tytuł planu", { exact: true })
      .fill("Plan z okresem raportowania");
    await editor
      .getByLabel("Zalecenia dla opiekuna")
      .fill("Zalecenia pozostają czytelne po zakończeniu raportowania.");
    await editor
      .getByRole("button", { name: "Opublikuj dla opiekuna" })
      .click();
    await expect(editor.getByRole("status")).toContainText("Plan opublikowany");
    const entitlement = await checked(
      f.db
        .from("care_reporting_entitlements")
        .select("id,included,snapshot_days,starts_at,expires_at")
        .eq("consultation_id", meeting)
        .single(),
    );
    expect(entitlement).toMatchObject({ included: true, snapshot_days: 14 });
    expect(entitlement!.starts_at).not.toBeNull();
    expect(entitlement!.expires_at).not.toBeNull();
    await f.guardian.goto(`/app/dogs/${f.dog}/care?consultation=${meeting}`);
    await f.guardian
      .getByLabel("Co udało się zrobić?", { exact: true })
      .fill("Odpowiedź przed końcem dostępu.");
    await f.guardian
      .getByRole("button", { name: "Przekaż odpowiedź prowadzącej" })
      .click();
    await expect(f.guardian.getByRole("status")).toContainText(
      "Odpowiedź zapisana",
    );
    await f.guardian.reload();
    await f.guardian
      .getByLabel("Co udało się zrobić?", { exact: true })
      .fill("Stara karta próbuje zapisać nową odpowiedź.");
    const panel = f.staff.getByRole("region", {
      name: "Dostęp do raportowania",
    });
    await panel
      .getByText("Zmień dostęp dla tej usługi psa", { exact: true })
      .click();
    await panel
      .getByLabel("Ostatni dzień dostępu (puste = bez limitu)")
      .fill(careDay(-1));
    await panel
      .getByLabel("Uzasadnienie wyjątku")
      .fill("Świadome zakończenie dostępu w próbie.");
    await panel.getByRole("button", { name: "Zapisz uprawnienie" }).click();
    await expect(panel.getByRole("status")).toContainText(
      "Uprawnienie do raportowania zmienione",
    );
    await f.guardian
      .getByRole("button", { name: "Przekaż odpowiedź prowadzącej" })
      .click();
    await expect(f.guardian.getByRole("main").getByRole("alert")).toContainText(
      "Raportowanie dla tej usługi jest wyłączone lub zakończone",
    );
    await f.guardian.reload();
    await expect(
      f.guardian.getByRole("button", { name: "Przekaż odpowiedź prowadzącej" }),
    ).toHaveCount(0);
    await expect(
      f.guardian.getByText("Odpowiedź przed końcem dostępu.", { exact: true }),
    ).toBeVisible();
    await expect(
      f.guardian.getByText(
        "Zalecenia pozostają czytelne po zakończeniu raportowania.",
        { exact: true },
      ),
    ).toBeVisible();
    await careScreenshot(
      f.guardian,
      info.outputPath("expired-reporting-320.png"),
      320,
    );
    await careScreenshot(
      f.staff,
      info.outputPath("reporting-override-1440.png"),
      1440,
    );
    const quote = await checked(
      f.db
        .from("consultations")
        .select("agreed_price_cents,service_version")
        .eq("id", meeting)
        .single(),
    );
    expect(quote).toEqual({ agreed_price_cents: 10000, service_version: 2 });
  } finally {
    if (service)
      await checked(
        f.db.from("service_revisions").delete().eq("service_id", service),
      );
    await f.dispose();
    if (service)
      await checked(f.db.from("services").delete().eq("id", service));
  }
});
