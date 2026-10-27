import { expect, type Locator, type Page } from "@playwright/test";
import { careDate } from "../../src/modules/care/types";
import { completeServerAction } from "./action-completion";
import { careDay, careFixture, openCareSection } from "./care-journey";
import { checked, test } from "./local-fixtures";

function disclosure(container: Page | Locator, title: string) {
  return container
    .locator("summary")
    .filter({ hasText: new RegExp(`^${title}`) })
    .locator("..");
}

async function expectOpen(details: Locator, open: boolean) {
  await expect
    .poll(() =>
      details.evaluate((element) => (element as HTMLDetailsElement).open),
    )
    .toBe(open);
}

test("compact care keeps one plan visible, protects edits and retains direct draft entry after publication", async ({
  browser,
  baseURL,
}, info) => {
  const f = await careFixture(browser, baseURL);
  const path = `/admin/dogs/${f.dog}/care?context=general`;
  const title = `Spokojny plan ${f.dog.slice(0, 8)}`;
  const body =
    "Fikcyjne zalecenia do testu uproszczonego widoku. Bez porad specjalistycznych.";
  const otherBody =
    "Osobny prywatny szkic konsultacji — nie może zmienić się przy pracy nad ogólnym planem.";
  const due = careDay(8),
    invitation = careDay(5);
  try {
    const template = crypto.randomUUID();
    f.templates.push(template);
    await checked(
      f.staffDb.rpc("save_care_template", {
        p_id: template,
        p_expected_version: 0,
        p_title: `Materiał do zwijania ${f.dog.slice(0, 8)}`,
        p_body: "Fikcyjny materiał biblioteki do lokalnego odbioru.",
      }),
    );
    const consultation = crypto.randomUUID();
    await checked(
      f.db.from("consultations").insert({
        id: consultation,
        practice_id: "00000000-0000-4000-8000-000000000001",
        dog_id: f.dog,
        requested_by: f.owner.id,
        topic: "Fikcyjna konsultacja drugiego planu",
        status: "completed",
        starts_at: new Date(Date.now() - 86400000).toISOString(),
        duration_minutes: 60,
        meeting_mode: "in_person",
        location: "Wyłącznie lokalna sala testowa",
      }),
    );
    await checked(
      f.staffDb.rpc("save_care_plan", {
        p_dog: f.dog,
        p_expected_version: 0,
        p_title: "Prywatny plan po konsultacji",
        p_body: otherBody,
        p_follow_up_on: null,
        p_publish: false,
        p_consultation: consultation,
      }),
    );
    await f.staff.goto(path);
    await expect(
      f.staff.getByRole("heading", { name: f.dogName, exact: true }),
    ).toBeVisible();
    const form = f.staff.locator("#szkic form");
    const editor = f.staff.locator("#szkic > details");
    const picker = disclosure(f.staff, "Zmień plan");
    const materials = disclosure(form, "Wstaw materiał z biblioteki");
    const dates = disclosure(form, "Kontrola i przypomnienia");
    const settings = disclosure(f.staff, "Kontrola i ustawienia");
    await expect(form).toHaveAttribute("aria-busy", "false");
    await expectOpen(editor, true);
    for (const secondary of [picker, materials, dates, settings])
      await expectOpen(secondary, false);
    await expect(
      form.getByLabel("Tytuł planu", { exact: true }),
    ).toBeInViewport();
    await expect(
      form.getByLabel("Zalecenia dla opiekuna", { exact: true }),
    ).toBeInViewport({ ratio: 0.15 });
    await f.staff.screenshot({
      path: info.outputPath("compact-first-fold-1440.png"),
      animations: "disabled",
    });
    await form.getByLabel("Tytuł planu", { exact: true }).fill(title);
    await form.getByLabel("Zalecenia dla opiekuna", { exact: true }).fill(body);

    await openCareSection(form, "Kontrola i przypomnienia");
    await form
      .getByLabel("Termin kontaktu kontrolnego (opcjonalnie)")
      .fill(due);
    await form
      .getByLabel("Zaproś opiekuna do zgłoszenia kontroli (opcjonalnie)")
      .fill(invitation);
    await dates.locator(":scope > summary").click();
    await expectOpen(dates, false);
    await expect(dates.locator(":scope > summary")).toContainText(
      `Kontakt prowadzącej: ${careDate(due)}`,
    );
    await expect(dates.locator(":scope > summary")).toContainText(
      `Zaproszenie opiekuna: ${careDate(invitation)}`,
    );
    await editor.locator(":scope > summary").click();
    await expect(
      form.getByLabel("Zalecenia dla opiekuna", { exact: true }),
    ).toBeHidden();
    await expect(form).toHaveCount(1);
    await editor.locator(":scope > summary").click();
    await expect(
      form.getByLabel("Zalecenia dla opiekuna", { exact: true }),
    ).toHaveValue(body);
    await expect(
      form.getByLabel("Termin kontaktu kontrolnego (opcjonalnie)"),
    ).toHaveValue(due);
    await expect(
      form.getByLabel("Zaproś opiekuna do zgłoszenia kontroli (opcjonalnie)"),
    ).toHaveValue(invitation);

    await picker.locator(":scope > summary").click();
    const plans = f.staff.getByRole("navigation", {
      name: "Wybierz plan psa",
      exact: true,
    });
    await expect(plans.locator('[aria-current="page"]')).toHaveAttribute(
      "href",
      path,
    );
    const secondPlan = plans.locator(
      `a[href="/admin/dogs/${f.dog}/care?consultation=${consultation}"]`,
    );
    const dialogPromise = f.staff.waitForEvent("dialog");
    const attemptedNavigation = secondPlan.click();
    const dialog = await dialogPromise;
    expect(dialog.type()).toBe("confirm");
    expect(dialog.message()).toContain("niezapisane zmiany");
    await dialog.dismiss();
    await attemptedNavigation;
    await expect(f.staff).toHaveURL(path);
    await expect(
      form.getByLabel("Zalecenia dla opiekuna", { exact: true }),
    ).toHaveValue(body);
    await expect(form.locator('[name="consultation_id"]')).toHaveValue("");

    await completeServerAction(
      f.staff,
      form.getByRole("button", { name: "Zapisz szkic", exact: true }),
      async (remaining) => {
        await expect(form.locator('[name="expected_version"]')).toHaveValue(
          "1",
          { timeout: remaining() },
        );
      },
    );
    await expectOpen(editor, true);
    await expect(form.getByRole("status")).toBeVisible();
    await expect(form.getByRole("status")).toContainText("Szkic zapisany");
    await f.guardian.goto(`/app/dogs/${f.dog}/care?context=general`);
    await expect(f.guardian.getByText(body, { exact: true })).toHaveCount(0);
    await expect(f.guardian.getByText(otherBody, { exact: true })).toHaveCount(
      0,
    );
    await completeServerAction(
      f.staff,
      form.getByRole("button", { name: "Opublikuj dla opiekuna" }),
      async (remaining) => {
        await expect(form.locator('[name="expected_version"]')).toHaveValue(
          "2",
          { timeout: remaining() },
        );
      },
    );
    await expectOpen(editor, true);
    await expect(form.getByRole("status")).toBeVisible();
    await expect(form.getByRole("status")).toContainText("Plan opublikowany");
    const publication = await checked(
      f.db
        .from("care_plan_versions")
        .select("id,body,consultation_id")
        .eq("dog_id", f.dog)
        .single(),
    );
    expect(publication).toMatchObject({ body, consultation_id: null });
    const consultationDraft = await checked(
      f.db
        .from("care_drafts")
        .select("body,version")
        .eq("dog_id", f.dog)
        .eq("consultation_id", consultation)
        .single(),
    );
    expect(consultationDraft).toEqual({ body: otherBody, version: 1 });

    await f.staff.goto(path);
    await expectOpen(editor, false);
    await f.staff.goto(`${path}#szkic`);
    await expectOpen(editor, true);
    await expect(
      form.getByLabel("Zalecenia dla opiekuna", { exact: true }),
    ).toBeVisible();
    await expect(
      form.getByLabel("Zalecenia dla opiekuna", { exact: true }),
    ).toHaveValue(body);
    // The same URL/hash must reopen a manually collapsed editor as well.
    await editor.locator(":scope > summary").click();
    await picker.locator(":scope > summary").click();
    await picker
      .locator("summary")
      .filter({ hasText: /^Przygotuj plan innej usługi$/ })
      .click();
    await picker.locator(`a[href="${path}#szkic"]`).click();
    await expectOpen(editor, true);
    await expect(
      form.getByLabel("Zalecenia dla opiekuna", { exact: true }),
    ).toHaveValue(body);

    await f.guardian.reload();
    await expect(
      f.guardian
        .getByRole("heading", { name: title, exact: true })
        .locator("..")
        .getByText(body, { exact: true }),
    ).toBeVisible();
    await expect(f.guardian.locator("#szkic")).toHaveCount(0);
    await expect(
      f.guardian
        .locator("summary")
        .filter({ hasText: /^Kontrola i ustawienia/ }),
    ).toHaveCount(0);
    await f.staff.goto(`/admin/care/plans/${publication!.id}`);
    await expect(f.staff.getByText(body, { exact: true })).toBeVisible();
    await expect(f.staff.locator("#szkic")).toHaveCount(0);
  } finally {
    await f.dispose();
  }
});
