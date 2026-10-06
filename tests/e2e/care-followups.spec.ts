import { expect, test } from "@playwright/test";
import { careDate } from "../../src/modules/care/types";
import { checked } from "./local-fixtures";
import {
  careFixture as fixture,
  careEditor as editor,
  publishCarePlan as publish,
  careDay as day,
  careScreenshot as screenshot,
} from "./care-journey";
test("follow-up lifecycle preserves private notes, original plan and stale edits", async ({
  browser,
  baseURL,
}, testInfo) => {
  const f = await fixture(browser, baseURL);
  const { db, staff, guardian, dog, owner, staffDb, ownerDb, outsiderDb } = f;
  const firstDay = day(6),
    movedDay = day(9),
    reopenedDay = day(11);
  const title = `Plan kontrolny ${dog.slice(0, 8)}`;
  const body =
    "Fikcyjne zalecenia do sprawdzenia kontaktu, bez porad specjalistycznych.";
  try {
    const planForm = await editor(staff);
    await planForm.getByLabel("Tytuł planu", { exact: true }).fill(title);
    await planForm
      .getByLabel("Zalecenia dla opiekuna", { exact: true })
      .fill(body);
    await planForm
      .getByLabel("Termin kontaktu kontrolnego (opcjonalnie)")
      .fill(firstDay);
    await planForm
      .getByRole("button", { name: "Zapisz szkic", exact: true })
      .click();
    await expect(planForm.getByRole("status")).toContainText("Szkic zapisany");
    expect(
      await checked(db.from("care_follow_ups").select("id").eq("dog_id", dog)),
    ).toEqual([]);
    await guardian.goto(`/app/dogs/${dog}/care`);
    await expect(guardian.getByText(body, { exact: true })).toHaveCount(0);
    await planForm
      .getByRole("button", { name: "Opublikuj dla opiekuna" })
      .click();
    await expect(planForm.getByRole("status")).toContainText(
      "Plan opublikowany",
    );
    const task = await checked(
      db
        .from("care_follow_ups")
        .select("id,plan_id,version,status,due_on")
        .eq("dog_id", dog)
        .single(),
    );
    expect(task).toMatchObject({
      version: 1,
      status: "open",
      due_on: firstDay,
    });
    const taskPath = `/admin/work/follow-ups/${task!.id}`;
    const history = () =>
      checked(
        db
          .from("care_follow_up_history")
          .select("version,action,due_on,note")
          .eq("follow_up_id", task!.id)
          .order("version"),
      );
    const jobs = () =>
      checked(
        db
          .from("reminder_jobs")
          .select("status,source_token,target_at")
          .eq("kind", "follow_up")
          .eq("source_id", task!.id)
          .order("generation"),
      );
    const initialJobs = await jobs();
    expect(initialJobs).toHaveLength(1);
    expect(initialJobs![0]).toMatchObject({
      status: "pending",
      source_token: "1",
    });
    const target = new Date(initialJobs![0].target_at);
    expect(
      new Intl.DateTimeFormat("sv-SE", {
        timeZone: "Europe/Warsaw",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(target),
    ).toBe(firstDay);
    expect(
      new Intl.DateTimeFormat("en-GB", {
        timeZone: "Europe/Warsaw",
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23",
      }).format(target),
    ).toBe("09:00");
    await staff.goto("/admin/work?filter=followups");
    await staff.locator(`a[href="${taskPath}"]`).click();
    expect(
      (await checked(
        db.from("care_follow_ups").select("status").eq("id", task!.id).single(),
      ))!.status,
    ).toBe("open");
    const stale = await f.staffContext.newPage();
    let releaseScripts!: () => void;
    const scriptsReady = new Promise<void>((resolve) => {
      releaseScripts = resolve;
    });
    await stale.route("**/_next/static/**/*.js*", async (route) => {
      await scriptsReady;
      await route.continue();
    });
    try {
      await stale.goto(taskPath, { waitUntil: "commit" });
      await expect(stale.getByLabel("Co chcesz zrobić?")).toBeDisabled();
      await expect(
        stale.getByLabel("Co ustalono? (notatka prywatna)"),
      ).toBeDisabled();
      await expect(
        stale.getByRole("button", { name: "Przygotowuję formularz…" }),
      ).toBeDisabled();
    } finally {
      releaseScripts();
      await stale.unrouteAll({ behavior: "wait" });
    }
    const staleForm = stale.locator("form").filter({
      has: stale.getByRole("button", { name: "Zapisz obsługę kontaktu" }),
    });
    const staleNote =
      "Prywatna notatka z nieaktualnej karty nie może nadpisać terminu.";
    await staleForm
      .getByLabel("Co ustalono? (notatka prywatna)")
      .fill(staleNote);
    const form = staff.locator("form").filter({
      has: staff.getByRole("button", { name: "Zapisz obsługę kontaktu" }),
    });
    const privateNote =
      "Prywatnie: fikcyjny powód przełożenia, widoczny wyłącznie zespołowi.";
    await form.getByLabel("Co chcesz zrobić?").selectOption("rescheduled");
    await form.getByLabel("Powód zmiany (notatka prywatna)").fill(privateNote);
    await form.getByRole("button", { name: "Zapisz obsługę kontaktu" }).click();
    await expect(form.getByRole("alert")).toHaveText(
      "Wybierz inną datę kontaktu.",
    );
    await expect(form.getByRole("alert")).toBeFocused();
    await expect(form.getByLabel("Co chcesz zrobić?")).toHaveValue(
      "rescheduled",
    );
    await expect(
      form.getByLabel("Powód zmiany (notatka prywatna)"),
    ).toHaveValue(privateNote);
    await expect(form.locator('[name="expected_version"]')).toHaveValue("1");
    await screenshot(
      staff,
      testInfo.outputPath("same-date-error-320.png"),
      320,
    );
    await form.getByLabel("Nowa data kontaktu").fill(movedDay);
    await form.getByRole("button", { name: "Zapisz obsługę kontaktu" }).click();
    await expect(form.getByRole("status")).toContainText("Kontakt zapisany");
    await expect(
      form.getByLabel("Co ustalono? (notatka prywatna)"),
    ).toHaveValue("");
    await expect(form.locator('[name="expected_version"]')).toHaveValue("2");
    await staleForm
      .getByRole("button", { name: "Zapisz obsługę kontaktu" })
      .click();
    await expect(staleForm.getByRole("alert")).toHaveText(
      "Kontakt zmienił się. Odśwież widok przed zapisem.",
    );
    await expect(staleForm.getByRole("alert")).toBeFocused();
    await expect(
      staleForm.getByLabel("Co ustalono? (notatka prywatna)"),
    ).toHaveValue(staleNote);
    await expect(staleForm.locator('[name="expected_version"]')).toHaveValue(
      "1",
    );
    await screenshot(
      stale,
      testInfo.outputPath("stale-follow-up-390.png"),
      390,
    );
    expect(await history()).toEqual([
      { version: 1, action: "scheduled", due_on: firstDay, note: "" },
      {
        version: 2,
        action: "rescheduled",
        due_on: movedDay,
        note: privateNote,
      },
    ]);
    expect((await jobs())!.map((job) => job.status)).toEqual([
      "cancelled",
      "pending",
    ]);
    expect(
      await checked(
        staffDb.rpc("change_care_follow_up", {
          p_id: task!.id,
          p_expected_version: 1,
          p_action: "rescheduled",
          p_due_on: movedDay,
          p_note: privateNote,
        }),
      ),
    ).toBe(2);
    expect((await history())!.length).toBe(2);
    for (const api of [ownerDb, outsiderDb]) {
      expect(
        await checked(
          api
            .from("care_follow_up_history")
            .select("note")
            .eq("follow_up_id", task!.id),
        ),
      ).toEqual([]);
      expect(
        await checked(api.from("care_drafts").select("body").eq("dog_id", dog)),
      ).toEqual([]);
      expect(
        await checked(api.from("reminder_jobs").select("id").eq("dog_id", dog)),
      ).toEqual([]);
      expect(
        (
          await api.rpc("staff_work_queue", {
            p_filter: "followups",
            p_offset: 0,
          })
        ).error,
      ).not.toBeNull();
      expect(
        (
          await api.rpc("change_care_follow_up", {
            p_id: task!.id,
            p_expected_version: 2,
            p_action: "completed",
            p_due_on: null,
            p_note: "Niedozwolona próba opiekuna",
          })
        ).error,
      ).not.toBeNull();
      expect(
        (
          await api
            .from("care_follow_ups")
            .update({ status: "done" })
            .eq("id", task!.id)
        ).error,
      ).not.toBeNull();
    }
    expect(
      await checked(
        outsiderDb.from("care_follow_ups").select("id").eq("dog_id", dog),
      ),
    ).toEqual([]);
    await guardian.goto("/app/notifications");
    await expect(guardian.getByText(privateNote, { exact: true })).toHaveCount(
      0,
    );
    const notice = guardian.locator("li").filter({
      has: guardian.getByRole("heading", {
        name: "Zmieniono kontakt kontrolny",
        exact: true,
      }),
    });
    await notice
      .getByRole("button", { name: "Otwórz sprawę", exact: true })
      .click();
    await expect(guardian).toHaveURL(`/app/dogs/${dog}/care`);
    const contact = guardian.locator("article").filter({
      has: guardian.getByRole("heading", {
        name: "Kontakt kontrolny",
        exact: true,
      }),
    });
    await expect(contact).toContainText(careDate(movedDay));
    await expect(
      guardian.getByText("Termin kontaktu zapisany przy publikacji:"),
    ).toContainText(careDate(firstDay));
    await expect(guardian.getByText(privateNote, { exact: true })).toHaveCount(
      0,
    );
    await screenshot(
      guardian,
      testInfo.outputPath("guardian-moved-contact-320.png"),
      320,
    );
    const completeNote =
      "Fikcyjny kontakt zakończony; ustalenia pozostają prywatne.";
    await form.getByLabel("Co ustalono? (notatka prywatna)").fill(completeNote);
    await form.getByRole("button", { name: "Zapisz obsługę kontaktu" }).click();
    await expect(form.getByRole("status")).toContainText("Kontakt zapisany");
    await expect(form.getByLabel("Co chcesz zrobić?")).toHaveValue("reopened");
    await guardian.reload();
    await expect(contact).toContainText("Kontakt zakończony");
    await expect(contact).not.toContainText(careDate(movedDay));
    await staff.goto("/admin/work?filter=followups");
    await expect(staff.locator(`a[href="${taskPath}"]`)).toHaveCount(0);
    await staff.goto(taskPath);
    await form.getByLabel("Nowa data kontaktu").fill(reopenedDay);
    await form
      .getByLabel("Powód zmiany (notatka prywatna)")
      .fill("Prywatny powód ponownego kontaktu.");
    await form.getByRole("button", { name: "Zapisz obsługę kontaktu" }).click();
    await expect(form.getByRole("status")).toContainText("Kontakt zapisany");
    await form.getByLabel("Co chcesz zrobić?").selectOption("cancelled");
    await form
      .getByLabel("Powód zmiany (notatka prywatna)")
      .fill("Prywatny powód odwołania kontaktu.");
    await form.getByRole("button", { name: "Zapisz obsługę kontaktu" }).click();
    await expect(form.locator('[name="expected_version"]')).toHaveValue("5");
    await guardian.reload();
    await expect(contact).toContainText("Kontakt odwołany");
    await form.getByLabel("Nowa data kontaktu").fill(reopenedDay);
    await form
      .getByLabel("Powód zmiany (notatka prywatna)")
      .fill("Prywatny powód wznowienia odwołanego kontaktu.");
    await form.getByRole("button", { name: "Zapisz obsługę kontaktu" }).click();
    await expect(form.locator('[name="expected_version"]')).toHaveValue("6");
    await screenshot(
      staff,
      testInfo.outputPath("follow-up-history-390.png"),
      390,
    );
    await screenshot(
      staff,
      testInfo.outputPath("follow-up-history-1440.png"),
      1440,
    );
    await staff
      .getByRole("link", { name: "Plan i odpowiedzi opiekuna →" })
      .click();
    await publish(
      staff,
      `${title} — następny`,
      "Nowsza fikcyjna treść, bez zaplanowanego kontaktu.",
    );
    const old = await checked(
      db
        .from("care_follow_ups")
        .select("status,version")
        .eq("id", task!.id)
        .single(),
    );
    expect(old).toEqual({ status: "superseded", version: 7 });
    expect((await jobs())!.every((job) => job.status === "cancelled")).toBe(
      true,
    );
    expect((await history())!.map((h) => h.action)).toEqual([
      "scheduled",
      "rescheduled",
      "completed",
      "reopened",
      "cancelled",
      "reopened",
      "superseded",
    ]);
    expect(
      (await checked(
        db
          .from("notifications")
          .select("id")
          .eq("recipient_id", owner.id)
          .eq("dog_id", dog)
          .eq("kind", "follow_up_changed"),
      ))!.length,
    ).toBe(4);
    await guardian.reload();
    await expect(contact).toHaveCount(0);
    await guardian.goto(`/app/care/plans/${task!.plan_id}`);
    await expect(guardian.getByText(body, { exact: true })).toBeVisible();
    await expect(
      guardian.getByText("Termin kontaktu zapisany przy publikacji:"),
    ).toContainText(careDate(firstDay));
    await staff.goto(taskPath);
    await expect(
      staff.getByText("Ten kontakt należy do wcześniejszego planu.", {
        exact: false,
      }),
    ).toBeVisible();
    await expect(form).toHaveCount(0);
    await staff
      .getByRole("link", { name: "Wszystkie kontakty tego psa →" })
      .click();
    await expect(staff.locator(`a[href="${taskPath}"]`)).toContainText(
      "Zastąpiony nowym planem",
    );
  } finally {
    await f.dispose();
  }
});

test("an older guardian response keeps its plan and explicit review clears only that work item", async ({
  browser,
  baseURL,
}, testInfo) => {
  const f = await fixture(browser, baseURL);
  const { db, staff, guardian, dog, staffDb, ownerDb, outsiderDb } = f;
  try {
    const title = `Pierwszy plan ${dog.slice(0, 8)}`;
    await publish(
      staff,
      title,
      "Pierwsze fikcyjne zalecenia, bez treści specjalistycznej.",
    );
    await guardian.goto(`/app/dogs/${dog}/care`);
    const responseForm = guardian.locator("#odpowiedz form");
    const planId = await responseForm.locator('[name="plan_id"]').inputValue();
    const responseId = await responseForm.locator('[name="id"]').inputValue();
    const response =
      "Fikcyjna odpowiedź przygotowana do pierwszej wersji planu.";
    const well = "Fikcyjny opis tego, co poszło dobrze.";
    const difficult = "Fikcyjne pytanie dotyczące wcześniejszych zaleceń.";
    await responseForm
      .getByLabel("Co udało się zrobić?", { exact: true })
      .fill(response);
    await responseForm.getByLabel("Co poszło dobrze? (opcjonalnie)").fill(well);
    await responseForm
      .getByLabel("Co było trudne lub wymaga wyjaśnienia? (opcjonalnie)")
      .fill(difficult);
    await publish(
      staff,
      `${title} — druga wersja`,
      "Druga fikcyjna treść, zachowująca pierwszą publikację.",
    );
    await expect(responseForm.locator('[name="plan_id"]')).toHaveValue(planId);
    await responseForm
      .getByRole("button", { name: "Przekaż odpowiedź prowadzącej" })
      .click();
    await expect(responseForm.getByRole("status")).toContainText(
      "Odpowiedź zapisana",
    );
    const entry = await checked(
      db
        .from("care_progress")
        .select("plan_id,author_id,attempted,went_well,difficult,reviewed_at")
        .eq("id", responseId)
        .single(),
    );
    expect(entry).toEqual({
      plan_id: planId,
      author_id: f.owner.id,
      attempted: response,
      went_well: well,
      difficult,
      reviewed_at: null,
    });
    await expect(
      responseForm.getByLabel("Co udało się zrobić?", { exact: true }),
    ).toHaveValue("");
    await expect(responseForm.locator('[name="plan_id"]')).not.toHaveValue(
      planId,
    );
    const secondId = await responseForm.locator('[name="id"]').inputValue();
    expect(secondId).not.toBe(responseId);
    await responseForm
      .getByLabel("Co udało się zrobić?", { exact: true })
      .fill("Kolejna fikcyjna odpowiedź do aktualnej wersji.");
    await responseForm
      .getByRole("button", { name: "Przekaż odpowiedź prowadzącej" })
      .click();
    await expect(guardian.locator(`#progress-${secondId}`)).toBeVisible();
    await staff.goto("/admin/work?filter=progress");
    const path = `/admin/work/progress/${responseId}`,
      secondPath = `/admin/work/progress/${secondId}`;
    await expect(staff.locator(`a[href="${path}"]`)).toBeVisible();
    await expect(staff.locator(`a[href="${secondPath}"]`)).toBeVisible();
    await staff.locator(`a[href="${path}"]`).click();
    await expect(staff.getByText(response, { exact: true })).toBeVisible();
    await expect(
      staff.getByText("Odpowiedź do wersji 1 planu", { exact: true }),
    ).toBeVisible();
    expect(
      (await checked(
        db
          .from("care_progress")
          .select("reviewed_at")
          .eq("id", responseId)
          .single(),
      ))!.reviewed_at,
    ).toBeNull();
    // Even opening its notification is just navigation; review remains explicit.
    await staff.goto("/admin/notifications");
    const notification = await checked(
      db
        .from("notifications")
        .select("id")
        .eq("entity_id", responseId)
        .eq("recipient_id", f.admin.id)
        .eq("kind", "progress_submitted")
        .single(),
    );
    const notice = staff.locator("li").filter({
      has: staff.locator(`input[name="id"][value="${notification!.id}"]`),
    });
    await notice
      .getByRole("button", { name: "Otwórz sprawę", exact: true })
      .click();
    await expect(staff).toHaveURL(path);
    expect(
      (await checked(
        db
          .from("care_progress")
          .select("reviewed_at")
          .eq("id", responseId)
          .single(),
      ))!.reviewed_at,
    ).toBeNull();
    await staff
      .getByRole("button", { name: "Oznacz jako przeczytaną" })
      .click();
    await expect(staff.getByText("Przeczytana", { exact: true })).toBeVisible();
    await screenshot(
      staff,
      testInfo.outputPath("reviewed-old-response-320.png"),
      320,
    );
    await staff
      .getByRole("link", { name: "Otwórz plan i historię psa →" })
      .click();
    await expect(staff).toHaveURL(`/admin/dogs/${dog}/care`);
    await expect(staff.locator(`#progress-${responseId}`)).toContainText(
      "Przeczytana",
    );
    await expect(staff.locator(`#progress-${secondId}`)).toContainText(
      "Nowa odpowiedź",
    );
    await checked(staffDb.rpc("review_care_progress", { p_id: responseId }));
    expect(
      (await checked(
        db
          .from("audit_events")
          .select("id")
          .eq("event", "care_progress_reviewed")
          .eq("entity_id", responseId),
      ))!.length,
    ).toBe(1);
    expect(
      (await checked(
        db
          .from("notifications")
          .select("id")
          .eq("kind", "progress_reviewed")
          .eq("entity_id", responseId)
          .eq("recipient_id", f.owner.id),
      ))!.length,
    ).toBe(1);
    await staff.goto("/admin/work?filter=progress");
    await expect(staff.locator(`a[href="${path}"]`)).toHaveCount(0);
    await expect(staff.locator(`a[href="${secondPath}"]`)).toBeVisible();
    await checked(
      ownerDb.rpc("submit_care_progress", {
        p_id: responseId,
        p_plan: planId,
        p_attempted: response,
        p_went_well: well,
        p_difficult: difficult,
      }),
    );
    expect(
      (
        await ownerDb.rpc("submit_care_progress", {
          p_id: responseId,
          p_plan: planId,
          p_attempted: "Sprzeczna powtórzona odpowiedź",
          p_went_well: well,
          p_difficult: difficult,
        })
      ).error?.message,
    ).toContain("Ta odpowiedź została już zapisana");
    expect(
      (await ownerDb.rpc("review_care_progress", { p_id: responseId })).error,
    ).not.toBeNull();
    expect(
      (
        await outsiderDb.rpc("submit_care_progress", {
          p_id: crypto.randomUUID(),
          p_plan: planId,
          p_attempted: "Niedozwolona odpowiedź",
          p_went_well: "",
          p_difficult: "",
        })
      ).error,
    ).not.toBeNull();
    expect(
      await checked(
        outsiderDb.from("care_progress").select("id").eq("dog_id", dog),
      ),
    ).toEqual([]);
    await guardian.goto(`/app/dogs/${dog}/care`);
    await expect(guardian.locator(`#progress-${responseId}`)).toContainText(
      "Przeczytana",
    );
    await expect(guardian.locator(`#progress-${secondId}`)).toContainText(
      "Przekazana prowadzącej",
    );
    await screenshot(
      guardian,
      testInfo.outputPath("guardian-two-plan-responses-390.png"),
      390,
    );
  } finally {
    await f.dispose();
  }
});
