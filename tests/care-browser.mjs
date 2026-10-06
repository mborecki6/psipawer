// Repeatable UI verification with the real views, editor and form components.
// Server actions are replaced with deterministic fixtures; no real user data,
// account creation, hosted database access or message delivery is involved.
import { createRequire } from "node:module";
import { resolve, dirname } from "node:path";
import { mkdir } from "node:fs/promises";
import { realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { chromium, expect } from "@playwright/test";

const cwd = process.cwd();
const fixture = resolve(cwd, "tests/fixtures/care-browser");
const require = createRequire(
  realpathSync(resolve(cwd, "node_modules/vitest/package.json")),
);
const { createServer } = await import(
  pathToFileURL(require.resolve("vite")).href
);
const server = await createServer({
  configFile: false,
  root: fixture,
  logLevel: "error",
  plugins: [
    {
      name: "care-browser-fixtures",
      enforce: "pre",
      resolveId(source, importer) {
        if (source === "next/link") return resolve(fixture, "link.tsx");
        if (
          (source === "./actions" &&
            importer?.includes("/src/modules/care/")) ||
          source === "@/lib/auth/actions"
        )
          return resolve(fixture, "actions.ts");
      },
    },
  ],
  resolve: {
    alias: [
      { find: "@", replacement: resolve(cwd, "src") },
      {
        find: "react",
        replacement: dirname(
          createRequire(import.meta.url).resolve("react/package.json"),
        ),
      },
      {
        find: "react-dom",
        replacement: dirname(
          createRequire(import.meta.url).resolve("react-dom/package.json"),
        ),
      },
      {
        find: "lucide-react",
        replacement: createRequire(import.meta.url).resolve("lucide-react"),
      },
    ],
  },
  esbuild: { jsx: "automatic" },
  optimizeDeps: {
    noDiscovery: true,
    include: [
      "react",
      "react/jsx-runtime",
      "react/jsx-dev-runtime",
      "react-dom/client",
      "lucide-react",
    ],
  },
  server: {
    host: "127.0.0.1",
    port: 4178,
    strictPort: true,
    fs: { allow: [cwd] },
  },
});
let browser;
try {
  await server.listen();
  browser = await chromium.launch({
    channel: process.env.CARE_BROWSER_CHANNEL || "chrome",
    headless: true,
  });
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const base = "http://127.0.0.1:4178";
  const output = resolve(cwd, "test-results/care-ui");
  await mkdir(output, { recursive: true });

  // Complete dependency optimization before interacting; a Vite reload in
  // the middle of a form test would erase the browser-only fixture state.
  await page.goto(base);
  await server.waitForRequestsIdle();
  await page.waitForLoadState("networkidle");

  await page.goto(`${base}/?role=admin&empty=1`);
  await page
    .getByLabel("Tytuł planu", { exact: true })
    .fill("Plan wpisany przez prowadzącą");
  await page
    .getByLabel("Zalecenia dla opiekuna")
    .fill("Tekst, który nie może zniknąć po błędzie zapisu.");
  await page.evaluate(() => {
    window.careFail = true;
  });
  await page.getByRole("button", { name: "Opublikuj dla opiekuna" }).click();
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(page.getByLabel("Zalecenia dla opiekuna")).toHaveValue(
    "Tekst, który nie może zniknąć po błędzie zapisu.",
  );
  await page.evaluate(() => {
    window.careFail = false;
  });
  await page.getByRole("button", { name: "Zapisz szkic", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Zapisano");
  await page
    .getByLabel("Zalecenia dla opiekuna")
    .fill("Nowa treść, opublikowana prosto z formularza.");
  await page.getByRole("button", { name: "Opublikuj dla opiekuna" }).click();
  await expect
    .poll(async () => page.evaluate(() => window.careCalls?.length))
    .toBe(3);
  const last = await page.evaluate(() => window.careCalls.at(-1));
  expect(last.intent).toBe("publish");
  expect(last.expected_version).toBe("1");
  expect(last.body).toBe("Nowa treść, opublikowana prosto z formularza.");
  await page
    .getByLabel("Zacznij od materiału z biblioteki")
    .selectOption("50000000-0000-4000-8000-000000000001");
  page.once("dialog", (dialog) => dialog.dismiss());
  await page.getByRole("button", { name: "Użyj materiału" }).click();
  await expect(page.getByLabel("Zalecenia dla opiekuna")).toHaveValue(
    "Nowa treść, opublikowana prosto z formularza.",
  );

  await page.goto(`${base}/?role=client`);
  await expect(
    page.getByRole("button", { name: "Opublikuj dla opiekuna" }),
  ).toHaveCount(0);
  await page
    .getByLabel("Co udało się zrobić?", { exact: true })
    .fill("Odpowiedź pozostaje po błędzie.");
  await page.evaluate(() => {
    window.careFail = true;
  });
  await page
    .getByRole("button", { name: "Przekaż odpowiedź prowadzącej" })
    .click();
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(
    page.getByLabel("Co udało się zrobić?", { exact: true }),
  ).toHaveValue("Odpowiedź pozostaje po błędzie.");
  await page.evaluate(() => {
    window.careFail = false;
  });
  await page
    .getByRole("button", { name: "Przekaż odpowiedź prowadzącej" })
    .click();
  await expect(page.getByRole("status")).toContainText("Zapisano");
  await expect(
    page.getByLabel("Co udało się zrobić?", { exact: true }),
  ).toHaveValue("");
  const progressCalls = await page.evaluate(() => window.careCalls);
  expect(progressCalls[0].id).toBe(progressCalls[1].id);
  expect(progressCalls[1].plan_id).toBe("30000000-0000-4000-8000-000000000001");

  await page.goto(`${base}/?view=library&empty=1`);
  await page
    .getByLabel("Tytuł materiału", { exact: true })
    .fill("Nowy materiał testowy");
  await page
    .getByLabel("Treść materiału", { exact: true })
    .fill("Treść do zachowania w bibliotece.");
  await page.evaluate(() => {
    window.careFail = true;
  });
  await page.getByRole("button", { name: "Dodaj do biblioteki" }).click();
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(page.getByLabel("Treść materiału", { exact: true })).toHaveValue(
    "Treść do zachowania w bibliotece.",
  );
  await page.evaluate(() => {
    window.careFail = false;
  });
  await page.getByRole("button", { name: "Dodaj do biblioteki" }).click();
  await expect(page.getByRole("status")).toContainText("Zapisano");
  await expect(page.getByLabel("Tytuł materiału", { exact: true })).toHaveValue(
    "",
  );
  await page
    .getByLabel("Tytuł materiału", { exact: true })
    .fill("Drugi materiał testowy");
  await page
    .getByLabel("Treść materiału", { exact: true })
    .fill("Treść drugiego materiału.");
  await page.getByRole("button", { name: "Dodaj do biblioteki" }).click();
  await expect
    .poll(async () => page.evaluate(() => window.careCalls?.length))
    .toBe(3);
  const templateCalls = await page.evaluate(() => window.careCalls);
  expect(templateCalls[0].id).toBe(templateCalls[1].id);
  expect(templateCalls[2].id).not.toBe(templateCalls[1].id);
  expect(templateCalls[2].expected_version).toBe("0");

  await page.goto(`${base}/?view=library`);
  await page
    .getByText("Materiał do wspólnego omówienia", { exact: true })
    .click();
  const templateForm = page.locator("article").filter({
    has: page.getByText("Materiał do wspólnego omówienia", { exact: true }),
  });
  await templateForm
    .getByLabel("Treść materiału", { exact: true })
    .fill("Zmieniony materiał.");
  await templateForm
    .getByRole("button", { name: "Zapisz materiał", exact: true })
    .click();
  await expect(templateForm.getByRole("status")).toContainText("Zapisano");
  await templateForm
    .getByLabel("Treść materiału", { exact: true })
    .fill("Kolejna zmiana materiału.");
  await templateForm
    .getByRole("button", { name: "Zapisz materiał", exact: true })
    .click();
  await expect
    .poll(async () => page.evaluate(() => window.careCalls?.length))
    .toBe(2);
  expect(
    await page.evaluate(() => window.careCalls.at(-1).expected_version),
  ).toBe("2");

  // Navigating from a different consultation cannot silently rebind a draft.
  await page.goto(`${base}/?meeting=scheduled`);
  const association = page.getByLabel("Konsultacja, której dotyczą zalecenia");
  const body = page.getByLabel("Zalecenia dla opiekuna");
  await expect(association).toHaveValue("80000000-0000-4000-8000-000000000001");
  const originalBody = await body.inputValue();
  await page
    .getByRole("button", { name: "Powiąż ten szkic z wybranym spotkaniem" })
    .click();
  await expect(body).toHaveValue(originalBody);
  await expect(association).toHaveValue("80000000-0000-4000-8000-000000000002");
  await expect(
    page.getByRole("button", { name: "Opublikuj dla opiekuna" }),
  ).toBeDisabled();
  await page.evaluate(() => {
    window.careFail = true;
  });
  await page.getByRole("button", { name: "Zapisz szkic", exact: true }).click();
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(association).toHaveValue("80000000-0000-4000-8000-000000000002");
  await expect(body).toHaveValue(originalBody);
  await page.evaluate(() => {
    window.careFail = false;
  });
  await association.selectOption("80000000-0000-4000-8000-000000000001");
  await page.getByRole("button", { name: "Opublikuj dla opiekuna" }).click();
  await expect(page.getByRole("status")).toContainText("Zapisano");
  expect(await page.evaluate(() => window.careCalls.at(-1))).toMatchObject({
    consultation_id: "80000000-0000-4000-8000-000000000001",
    expected_version: "3",
    intent: "publish",
  });
  await page.goto(`${base}/?meeting=scheduled&empty=1`);
  await expect(association).toHaveValue("80000000-0000-4000-8000-000000000002");
  for (const role of ["admin", "client"]) {
    await page.goto(`${base}/?view=publication&meeting=completed&role=${role}`);
    await expect(
      page.getByText("To wcześniejsza wersja.", { exact: false }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Otwórz konsultację" }),
    ).toHaveAttribute(
      "href",
      `/${role === "admin" ? "admin" : "app"}/consultations/80000000-0000-4000-8000-000000000001`,
    );
    await expect(
      page.getByRole("button", { name: "Opublikuj dla opiekuna" }),
    ).toHaveCount(0);
  }

  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    for (const [name, query] of [
      ["admin-plan", "role=admin"],
      ["meeting-draft", "meeting=scheduled"],
      ["publication", "view=publication&meeting=completed&role=client"],
      ["client-plan", "role=client"],
      ["admin-inbox", "role=admin&view=overview"],
      ["library", "view=library"],
      ["empty", "role=client&empty=1"],
      ["long", "role=admin&long=1"],
    ]) {
      await page.goto(`${base}/?${query}`);
      await page
        .getByRole("heading", { name: "Plany i postępy", exact: true })
        .waitFor();
      await page.locator("details").evaluateAll((nodes) =>
        nodes.forEach((node) => {
          node.open = true;
        }),
      );
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth + 1,
      );
      expect(overflow, `${name} overflows at ${width}px`).toBe(false);
      const clippedFields = await page
        .locator("input:not([type=hidden]), textarea, select, button")
        .evaluateAll((nodes) =>
          nodes
            .filter((node) => {
              const bounds = node.getBoundingClientRect();
              return (
                bounds.width > 0 &&
                (bounds.left < -1 || bounds.right > innerWidth + 1)
              );
            })
            .map((node) => node.outerHTML.slice(0, 150)),
        );
      expect(
        clippedFields,
        `${name} has clipped controls at ${width}px`,
      ).toEqual([]);
      if (width === 390 || width === 1440)
        await page.screenshot({
          path: resolve(output, `${name}-${width}.png`),
          fullPage: true,
        });
    }
  }
  expect(errors).toEqual([]);
  console.log(
    "Care UI: form error recovery, publication intent/version, template replacement, guardian response, consultation association and 32 responsive scenarios passed.",
  );
  console.log(`Screenshots: ${output}`);
} finally {
  await browser?.close();
  await server.close();
}
