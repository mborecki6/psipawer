// Explicit component runner. Uses Chrome about:blank and fake action replies;
// no server, account, database, network request or production build is involved.
import { createRequire } from "node:module";
import { resolve, dirname } from "node:path";
import { realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { chromium, expect } from "@playwright/test";

const cwd = process.cwd();
const fixture = resolve(cwd, "tests/fixtures/draft-recovery/main.tsx");
const require = createRequire(
  realpathSync(resolve(cwd, "node_modules/vitest/package.json")),
);
const appRequire = createRequire(import.meta.url);
const { build } = await import(pathToFileURL(require.resolve("vite")).href);
const bundle = await build({
  configFile: false,
  root: cwd,
  logLevel: "error",
  define: { "process.env.NODE_ENV": '"production"' },
  plugins: [
    {
      name: "draft-action-fixtures",
      enforce: "pre",
      resolveId(source, importer) {
        if (
          source === "./actions" &&
          importer?.endsWith("/care/progress-form.tsx")
        )
          return "\0care-fixture";
        if (source.endsWith("/data/finance-actions"))
          return "\0payment-fixture";
        if (source === "next/navigation") return "\0navigation-fixture";
      },
      load(id) {
        if (id === "\0care-fixture")
          return 'export const submitProgress = (previous, data) => window.runDraftAction("care", data)';
        if (id === "\0payment-fixture")
          return 'export const recordPayment = (previous, data) => window.runDraftAction("payment", data)';
        if (id === "\0navigation-fixture")
          return 'export function unstable_rethrow(error) { if (error?.digest?.startsWith("NEXT_")) throw error }';
      },
    },
  ],
  resolve: {
    alias: [
      { find: "@", replacement: resolve(cwd, "src") },
      {
        find: "react",
        replacement: dirname(appRequire.resolve("react/package.json")),
      },
      {
        find: "react-dom",
        replacement: dirname(appRequire.resolve("react-dom/package.json")),
      },
      { find: "lucide-react", replacement: appRequire.resolve("lucide-react") },
    ],
  },
  build: {
    write: false,
    minify: false,
    lib: { entry: fixture, name: "DraftRecovery", formats: ["iife"] },
  },
});
const output = Array.isArray(bundle) ? bundle[0].output : bundle.output;
const code = output.find((chunk) => chunk.type === "chunk")?.code;
if (!code) throw new Error("Missing component bundle");

const browser = await chromium.launch({
  channel: process.env.DRAFT_BROWSER_CHANNEL || "chrome",
  headless: true,
});
let scenarios = 0;
try {
  const page = await browser.newPage();
  page.setDefaultTimeout(5000);
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/*", (route) => route.abort());
  await page.setContent('<div id="root"></div>');
  await page.addScriptTag({ content: code });
  expect(errors).toEqual([]);
  const render = (kind, props) =>
    page.evaluate(({ kind, props }) => window.renderDraft(kind, props), {
      kind,
      props,
    });
  const result = (next) =>
    page.evaluate((next) => window.draftResults.push(next), next);
  const calls = () => page.evaluate(() => window.draftCalls);
  const hidden = (name) => page.locator(`input[name="${name}"]`);
  const formData = () =>
    page
      .locator("form")
      .evaluate((form) => Object.fromEntries(new FormData(form)));
  const requestId = "71000000-0000-4000-8000-000000000001";
  const originalPlan = {
    id: "72000000-0000-4000-8000-000000000001",
    title: "Pierwszy plan",
    revision: 1,
    body: "Treść pierwszej publikacji",
    published_at: "2030-01-01T12:00:00Z",
  };
  const newerPlan = {
    ...originalPlan,
    id: "72000000-0000-4000-8000-000000000002",
    revision: 2,
    title: "Nowszy plan",
    body: "Treść nowszej publikacji",
  };
  const careProps = { plan: originalPlan, responseId: requestId };
  await render("care", careProps);
  const attempted = page.getByRole("textbox", {
    name: "Co udało się zrobić?",
    exact: true,
  });
  await expect(attempted).toBeEnabled();
  await expect(page.getByLabel("Co poszło dobrze? (opcjonalnie)")).toBeHidden();
  await page.getByText("Dodaj więcej szczegółów (opcjonalnie)", { exact: true }).click();
  await attempted.fill("Spacer i spokojna praca.");
  await page
    .getByLabel("Co poszło dobrze? (opcjonalnie)")
    .fill("Krótka trasa.");
  await page
    .getByLabel("Co było trudne lub wymaga wyjaśnienia? (opcjonalnie)")
    .fill("Hałas na ulicy.");
  const before = await formData();
  await page.getByText("Dodaj więcej szczegółów (opcjonalnie)", { exact: true }).click();
  await expect(page.getByLabel("Co poszło dobrze? (opcjonalnie)")).toBeHidden();
  expect(await formData()).toEqual(before);
  await page.getByText("Dodaj więcej szczegółów (opcjonalnie)", { exact: true }).click();
  await result("reject");
  await page.getByRole("button").click();
  await expect(page.getByRole("alert")).toBeFocused();
  await render("care", { plan: newerPlan, responseId: "pagination-token" });
  await expect(hidden("plan_id")).toHaveValue(originalPlan.id);
  await expect(hidden("id")).toHaveValue(requestId);
  expect(await formData()).toEqual(before);
  await expect(page.locator("form")).toContainText("Pierwszy plan");
  await expect(page.locator("form")).toContainText("wersja 1");
  await expect(page.locator('textarea[name="attempted"]')).toHaveAccessibleName(
    "Co udało się zrobić?",
  );
  await page.getByText("Zalecenia, których dotyczy odpowiedź").click();
  await expect(
    page.getByText(originalPlan.body, { exact: true }),
  ).toBeVisible();
  await expect(page.getByText(newerPlan.body, { exact: true })).toHaveCount(0);
  scenarios++;

  // Clearing all texts after an unknown outcome must not unlock its source.
  await attempted.fill("");
  await page.getByLabel("Co poszło dobrze? (opcjonalnie)").fill("");
  await page
    .getByLabel("Co było trudne lub wymaga wyjaśnienia? (opcjonalnie)")
    .fill("");
  await render("care", {
    plan: newerPlan,
    responseId: "another-pagination-token",
  });
  await expect(hidden("plan_id")).toHaveValue(originalPlan.id);
  await expect(hidden("id")).toHaveValue(requestId);
  await attempted.fill(before.attempted);
  await page
    .getByLabel("Co poszło dobrze? (opcjonalnie)")
    .fill(before.went_well);
  await page
    .getByLabel("Co było trudne lub wymaga wyjaśnienia? (opcjonalnie)")
    .fill(before.difficult);
  await result({ success: "Odpowiedź zapisana" });
  await page.getByRole("button").click();
  await expect(page.getByRole("status")).toContainText("Odpowiedź zapisana");
  const careCalls = (await calls()).filter((call) => call.kind === "care");
  expect(careCalls).toHaveLength(2);
  expect(careCalls[1].data).toEqual(careCalls[0].data);
  await expect(attempted).toHaveValue("");
  await expect(page.locator('[name="went_well"]')).toHaveValue("");
  await expect(page.locator('[name="difficult"]')).toHaveValue("");
  await expect(hidden("id")).not.toHaveValue(requestId);
  await expect(hidden("plan_id")).toHaveValue(newerPlan.id);
  await expect(page.locator("form")).toContainText("Nowszy plan");
  scenarios++;

  // Identical intentional text is valid as a later entry with its new UUID.
  const nextCareId = await hidden("id").inputValue();
  await attempted.fill(before.attempted);
  await result({ error: "Oczekiwany błąd walidacji" });
  await page.getByRole("button").click();
  await expect(page.getByRole("alert")).toContainText("Oczekiwany błąd");
  await render("care", {
    plan: originalPlan,
    responseId: "refresh-after-validation",
  });
  await expect(hidden("id")).toHaveValue(nextCareId);
  await expect(hidden("plan_id")).toHaveValue(newerPlan.id);
  await result({ success: "Kolejna odpowiedź zapisana" });
  await page.getByRole("button").click();
  await expect(page.getByRole("status")).toContainText("Kolejna odpowiedź");
  const intentional = (await calls())
    .filter((call) => call.kind === "care")
    .at(-1).data;
  expect(intentional.id).toBe(nextCareId);
  expect(intentional.attempted).toBe(before.attempted);
  scenarios++;

  // A result must reopen a form closed while awaiting the action, preserve its
  // draft after failure, and reveal fragment targets even on the same URL.
  await attempted.fill("Treść zachowana przy zamknięciu sekcji.");
  await result("defer");
  await page.getByRole("button").click();
  await expect(attempted).toBeDisabled();
  await page.locator("#draft-editor > summary").click();
  await expect(attempted).toBeHidden();
  await page.evaluate(() => window.resolveDraftAction({ error: "Oczekiwany błąd po zamknięciu" }));
  await expect(page.getByRole("alert")).toBeFocused();
  await expect(attempted).toHaveValue("Treść zachowana przy zamknięciu sekcji.");
  await page.evaluate(() => { location.hash = "draft-editor"; });
  await page.locator("#draft-editor > summary").click();
  await page.evaluate(() => {
    const link = document.createElement("a");
    link.href = "#draft-editor";
    link.textContent = "Ten sam formularz";
    document.body.append(link);
  });
  await page.getByRole("link", { name: "Ten sam formularz" }).click();
  await expect(attempted).toBeVisible();
  scenarios++;

  const paymentProps = {
    charge: {
      kind: "consultation",
      id: "73000000-0000-4000-8000-000000000001",
      dueCents: 10000,
    },
    requestId,
  };
  await render("payment", paymentProps);
  const amount = page.getByLabel("Otrzymana kwota (zł)", { exact: true });
  await expect(amount).toBeEnabled();
  await amount.fill("20,00");
  await page.getByLabel("Metoda płatności").selectOption("cash");
  await page.getByLabel("Notatka (opcjonalnie)").fill("Częściowa wpłata A");
  const paymentBefore = await formData();
  await page.locator("form").evaluate((form) => form.reset());
  expect(await formData()).toEqual(paymentBefore);
  await result("defer");
  await page.getByRole("button").click();
  await expect(amount).toBeDisabled();
  await expect(page.getByLabel("Metoda płatności")).toBeDisabled();
  await page.evaluate(() => window.resolveDraftAction("reject"));
  await expect(page.getByRole("alert")).toBeFocused();
  await render("payment", {
    charge: { ...paymentProps.charge, dueCents: 8000 },
    requestId: "token-from-other-payment",
  });
  await expect(hidden("request_id")).toHaveValue(requestId);
  expect(await formData()).toEqual(paymentBefore);
  await result({ success: "Wpłata zapisana" });
  await page.getByRole("button").click();
  await expect(page.getByRole("status")).toContainText("Wpłata zapisana");
  const paymentCalls = (await calls()).filter(
    (call) => call.kind === "payment",
  );
  expect(paymentCalls).toHaveLength(2);
  expect(paymentCalls[1].data).toEqual(paymentCalls[0].data);
  await expect(amount).toHaveValue("");
  await expect(page.getByLabel("Metoda płatności")).toHaveValue("transfer");
  await expect(page.locator('[name="note"]')).toHaveValue("");
  await expect(hidden("request_id")).not.toHaveValue(requestId);
  scenarios++;

  // A deliberately entered identical payment must use a fresh receipt key.
  const nextPaymentId = await hidden("request_id").inputValue();
  await amount.fill("20,00");
  await page.getByLabel("Metoda płatności").selectOption("cash");
  await page.getByLabel("Notatka (opcjonalnie)").fill("Częściowa wpłata A");
  await result({ error: "Oczekiwany błąd wpłaty" });
  await page.getByRole("button").click();
  await expect(page.getByRole("alert")).toContainText("Oczekiwany błąd wpłaty");
  await render("payment", {
    charge: {
      ...paymentProps.charge,
      id: "different-target",
      kind: "registration",
      dueCents: 6000,
    },
    requestId: "another-refresh-token",
  });
  await expect(hidden("request_id")).toHaveValue(nextPaymentId);
  await expect(hidden("target_id")).toHaveValue(paymentProps.charge.id);
  await expect(hidden("target_kind")).toHaveValue(paymentProps.charge.kind);
  await result({ success: "Kolejna wpłata zapisana" });
  await page.getByRole("button").click();
  await expect(page.getByRole("status")).toContainText("Kolejna wpłata");
  const nextPayment = (await calls())
    .filter((call) => call.kind === "payment")
    .at(-1).data;
  expect(nextPayment.request_id).toBe(nextPaymentId);
  expect(nextPayment.request_id).not.toBe(paymentBefore.request_id);
  expect(nextPayment.amount).toBe(paymentBefore.amount);
  expect(nextPayment.method).toBe(paymentBefore.method);
  expect(nextPayment.note).toBe(paymentBefore.note);
  scenarios++;

  expect(errors).toEqual([]);
  console.log(
    `PASS: ${scenarios} real ReactDOM/Chrome draft recovery scenarios; no server or database`,
  );
} finally {
  await browser.close();
}
