import { expect, test, type Page } from "@playwright/test";
import { checked } from "./local-fixtures";
import {
  careFixture,
  careEditor,
  careDay,
  careScreenshot,
} from "./care-journey";

async function materialForm(page: Page, id: string) {
  const disclosure = page
    .locator("details")
    .filter({ has: page.locator(`input[name="id"][value="${id}"]`) });
  if (
    !(await disclosure.evaluate(
      (element) => (element as HTMLDetailsElement).open,
    ))
  )
    await disclosure.locator("summary").click();
  return disclosure.locator("form");
}

test("library material → personal plan → later material edits and stale cards preserve published advice", async ({
  browser,
  baseURL,
}, testInfo) => {
  const f = await careFixture(browser, baseURL);
  const { db, staff, guardian, dog, staffDb, ownerDb, outsiderDb } = f;
  const suffix = dog.slice(0, 8);
  const title = `Materiał E2E ${suffix}`;
  const initialBody =
    "Fikcyjny materiał do sprawdzenia biblioteki.\nNie stanowi zaleceń specjalistycznych.";
  try {
    await staff
      .getByRole("link", { name: "Biblioteka materiałów", exact: true })
      .click();
    const add = staff.locator("details").filter({
      has: staff.getByText("Dodaj własny materiał", { exact: true }),
    });
    if (
      !(await add.evaluate((element) => (element as HTMLDetailsElement).open))
    )
      await add.locator("summary").click();
    const newForm = add.locator("form");
    const templateId = await newForm.locator('input[name="id"]').inputValue();
    f.templates.push(templateId);
    await newForm.getByLabel("Tytuł materiału", { exact: true }).fill(title);
    await newForm
      .getByLabel("Treść materiału", { exact: true })
      .fill(initialBody);
    await newForm.getByRole("button", { name: "Dodaj do biblioteki" }).click();
    await expect(newForm.getByRole("status")).toContainText(
      "Materiał zapisany w bibliotece",
    );
    await expect(
      newForm.getByLabel("Tytuł materiału", { exact: true }),
    ).toHaveValue("");
    await expect(
      newForm.getByLabel("Treść materiału", { exact: true }),
    ).toHaveValue("");
    await expect(newForm.locator('input[name="id"]')).not.toHaveValue(
      templateId,
    );
    expect(
      await checked(
        db
          .from("care_templates")
          .select("title,body,version,updated_by")
          .eq("id", templateId)
          .single(),
      ),
    ).toEqual({ title, body: initialBody, version: 1, updated_by: f.admin.id });
    // A lost confirmation may cause an exact retry: it must return success
    // without another version, material or audit entry.
    const retry = (version: number, name: string, body: string) =>
      checked(
        staffDb.rpc("save_care_template", {
          p_id: templateId,
          p_expected_version: version,
          p_title: name,
          p_body: body,
        }),
      );
    await retry(0, title, initialBody);
    expect(
      (await checked(
        db
          .from("audit_events")
          .select("id")
          .eq("event", "care_template_saved")
          .eq("entity_id", templateId),
      ))!.length,
    ).toBe(1);
    const staleLibrary = await f.staffContext.newPage();
    await staleLibrary.goto("/admin/care/library");
    const staleTemplate = await materialForm(staleLibrary, templateId);
    const staleBody =
      "Prywatna treść ze starej karty materiału, która nie powinna zastąpić nowej.";
    await staleTemplate
      .getByLabel("Treść materiału", { exact: true })
      .fill(staleBody);
    await staff.goto(`/admin/dogs/${dog}/care`);
    const planForm = await careEditor(staff);
    const followUp = careDay(14);
    await planForm
      .getByLabel("Termin kontaktu kontrolnego (opcjonalnie)")
      .fill(followUp);
    await planForm
      .getByLabel("Zacznij od materiału z biblioteki")
      .selectOption(templateId);
    await planForm.getByRole("button", { name: "Użyj materiału" }).click();
    await expect(
      planForm.getByLabel("Tytuł planu", { exact: true }),
    ).toHaveValue(title);
    await expect(
      planForm.getByLabel("Zalecenia dla opiekuna", { exact: true }),
    ).toHaveValue(initialBody);
    await expect(
      planForm.getByLabel("Termin kontaktu kontrolnego (opcjonalnie)"),
    ).toHaveValue(followUp);
    const personalTitle = `${title} — plan dla Figi`;
    const personalBody = `${initialBody}\n\nFikcyjne dopasowanie wyłącznie do tego psa.`;
    await planForm
      .getByLabel("Tytuł planu", { exact: true })
      .fill(personalTitle);
    await planForm
      .getByLabel("Zalecenia dla opiekuna", { exact: true })
      .fill(personalBody);
    await planForm
      .getByRole("button", { name: "Zapisz szkic", exact: true })
      .click();
    await expect(planForm.getByRole("status")).toContainText("Szkic zapisany");
    await guardian.goto(`/app/dogs/${dog}/care`);
    await expect(guardian.getByText(personalBody, { exact: true })).toHaveCount(
      0,
    );
    expect(
      await checked(
        ownerDb.from("care_drafts").select("body").eq("dog_id", dog),
      ),
    ).toEqual([]);
    await planForm
      .getByRole("button", { name: "Opublikuj dla opiekuna" })
      .click();
    await expect(planForm.getByRole("status")).toContainText(
      "Plan opublikowany",
    );
    const first = await checked(
      db
        .from("care_plan_versions")
        .select("id,title,body,revision,follow_up_on")
        .eq("dog_id", dog)
        .single(),
    );
    expect(first).toMatchObject({
      title: personalTitle,
      body: personalBody,
      revision: 1,
      follow_up_on: followUp,
    });
    const stalePlanPage = await f.staffContext.newPage();
    await stalePlanPage.goto(`/admin/dogs/${dog}/care`);
    const stalePlan = await careEditor(stalePlanPage);
    const abandonedBody =
      "Fikcyjna edycja poprzedniego szkicu, która ma zostać zachowana po konflikcie.";
    await stalePlan
      .getByLabel("Zalecenia dla opiekuna", { exact: true })
      .fill(abandonedBody);
    await guardian.reload();
    await expect(
      guardian.getByText(personalBody, { exact: true }),
    ).toBeVisible();
    await staff
      .getByRole("link", { name: "Biblioteka materiałów", exact: true })
      .click();
    const current = await materialForm(staff, templateId);
    const changedTitle = `${title} — poprawiony`;
    const changedBody =
      "Zmieniony fikcyjny materiał w bibliotece. Poprzednie plany zachowują własną treść.";
    await current
      .getByLabel("Tytuł materiału", { exact: true })
      .fill(changedTitle);
    await current
      .getByLabel("Treść materiału", { exact: true })
      .fill(changedBody);
    await current
      .getByRole("button", { name: "Zapisz materiał", exact: true })
      .click();
    await expect(current.getByRole("status")).toContainText(
      "Materiał zapisany w bibliotece",
    );
    await expect(current.locator('input[name="expected_version"]')).toHaveValue(
      "2",
    );
    await retry(1, changedTitle, changedBody);
    await staleTemplate
      .getByRole("button", { name: "Zapisz materiał", exact: true })
      .click();
    await expect(staleTemplate.getByRole("alert")).toHaveText(
      "Materiał zmienił się. Odśwież widok przed edycją.",
    );
    await expect(staleTemplate.getByRole("alert")).toBeFocused();
    await expect(
      staleTemplate.getByLabel("Treść materiału", { exact: true }),
    ).toHaveValue(staleBody);
    await expect(
      staleTemplate.locator('input[name="expected_version"]'),
    ).toHaveValue("1");
    await careScreenshot(
      staleLibrary,
      testInfo.outputPath("stale-library-320.png"),
      320,
    );
    const finalBody = `${changedBody}\n\nKolejna fikcyjna aktualizacja tego samego materiału.`;
    await current
      .getByLabel("Treść materiału", { exact: true })
      .fill(finalBody);
    await current
      .getByRole("button", { name: "Zapisz materiał", exact: true })
      .click();
    await expect(current.locator('input[name="expected_version"]')).toHaveValue(
      "3",
    );
    expect(
      (await checked(
        db
          .from("audit_events")
          .select("id")
          .eq("event", "care_template_saved")
          .eq("entity_id", templateId),
      ))!.length,
    ).toBe(3);
    await careScreenshot(
      staff,
      testInfo.outputPath("library-after-edit-1440.png"),
      1440,
    );
    expect(
      await checked(
        db
          .from("care_plan_versions")
          .select("id,title,body,revision,follow_up_on")
          .eq("id", first!.id)
          .single(),
      ),
    ).toEqual(first);
    await guardian.reload();
    await expect(
      guardian.getByText(personalBody, { exact: true }),
    ).toBeVisible();
    await expect(guardian.getByText(finalBody, { exact: true })).toHaveCount(0);
    for (const api of [ownerDb, outsiderDb]) {
      expect(
        await checked(
          api.from("care_templates").select("id,body").eq("id", templateId),
        ),
      ).toEqual([]);
      expect(
        (
          await api.rpc("save_care_template", {
            p_id: templateId,
            p_expected_version: 3,
            p_title: "Niedozwolona zmiana",
            p_body: "Niedozwolona treść klienta.",
          })
        ).error,
      ).not.toBeNull();
      expect(
        (
          await api
            .from("care_templates")
            .update({ body: "Bezpośrednia niedozwolona zmiana." })
            .eq("id", templateId)
        ).error,
      ).not.toBeNull();
    }
    const ownerLibrary = await f.guardianContext.newPage();
    await ownerLibrary.goto("/admin/care/library");
    await expect(ownerLibrary).toHaveURL(/\/app$/);
    await expect(
      ownerLibrary.getByLabel("Treść materiału", { exact: true }),
    ).toHaveCount(0);
    await staff.goto(`/admin/dogs/${dog}/care`);
    const updatedPlan = await careEditor(staff);
    await updatedPlan
      .getByLabel("Zacznij od materiału z biblioteki")
      .selectOption(templateId);
    staff.once("dialog", (dialog) => dialog.dismiss());
    await updatedPlan.getByRole("button", { name: "Użyj materiału" }).click();
    await expect(
      updatedPlan.getByLabel("Zalecenia dla opiekuna", { exact: true }),
    ).toHaveValue(personalBody);
    staff.once("dialog", (dialog) => dialog.accept());
    await updatedPlan.getByRole("button", { name: "Użyj materiału" }).click();
    await expect(
      updatedPlan.getByLabel("Zalecenia dla opiekuna", { exact: true }),
    ).toHaveValue(finalBody);
    await expect(
      updatedPlan.getByLabel("Termin kontaktu kontrolnego (opcjonalnie)"),
    ).toHaveValue(followUp);
    await updatedPlan
      .getByRole("button", { name: "Zapisz szkic", exact: true })
      .click();
    await expect(updatedPlan.getByRole("status")).toContainText(
      "Szkic zapisany",
    );
    await stalePlan
      .getByRole("button", { name: "Opublikuj dla opiekuna" })
      .click();
    await expect(stalePlan.getByRole("alert")).toHaveText(
      "Plan zmienił się. Skopiuj swoje zmiany i odśwież widok.",
    );
    await expect(
      stalePlan.getByLabel("Zalecenia dla opiekuna", { exact: true }),
    ).toHaveValue(abandonedBody);
    await expect(
      stalePlan.locator('input[name="expected_version"]'),
    ).toHaveValue("2");
    await careScreenshot(
      stalePlanPage,
      testInfo.outputPath("stale-personal-plan-390.png"),
      390,
    );
    expect(
      (await checked(
        db.from("care_plan_versions").select("id").eq("dog_id", dog),
      ))!.length,
    ).toBe(1);
    const secondBody = `${finalBody}\n\nDruga fikcyjna wersja dopasowana do Figi — opublikowana bez zapisu szkicu.`;
    await updatedPlan
      .getByLabel("Zalecenia dla opiekuna", { exact: true })
      .fill(secondBody);
    await updatedPlan
      .getByRole("button", { name: "Opublikuj dla opiekuna" })
      .click();
    await expect(updatedPlan.getByRole("status")).toContainText(
      "Plan opublikowany",
    );
    const publications = await checked(
      db
        .from("care_plan_versions")
        .select("id,title,body,revision")
        .eq("dog_id", dog)
        .order("revision"),
    );
    expect(publications).toHaveLength(2);
    expect(publications![0]).toMatchObject({
      id: first!.id,
      body: personalBody,
      revision: 1,
    });
    expect(publications![1]).toMatchObject({
      title: changedTitle,
      body: secondBody,
      revision: 2,
    });
    expect(
      (await checked(
        db.from("care_templates").select("body").eq("id", templateId).single(),
      ))!.body,
    ).toBe(finalBody);
    await guardian.reload();
    await expect(guardian.getByText(secondBody, { exact: true })).toBeVisible();
    await guardian
      .getByText("Wcześniejsze wersje planu", { exact: true })
      .click();
    await expect(
      guardian.getByText(personalBody, { exact: true }),
    ).toBeVisible();
    await careScreenshot(
      guardian,
      testInfo.outputPath("guardian-plan-history-390.png"),
      390,
    );
  } finally {
    await f.dispose();
  }
});
