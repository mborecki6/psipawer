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
  let allowNavigation = true;
  page.on("dialog", (dialog) =>
    allowNavigation ? dialog.accept() : dialog.dismiss(),
  );
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
  allowNavigation = false;
  await page.getByRole("button", { name: "Użyj materiału" }).click();
  allowNavigation = true;
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

  // Exact contexts load their own text and version. Changing source navigates;
  // a saved general or consultation draft is never relabelled as a meeting.
  const body = page.getByLabel("Zalecenia dla opiekuna");
  const binding = (name) => page.locator(`input[type=hidden][name="${name}"]`);
  const context = page.getByRole("region", { name: "Powiązanie planu" });
  for (const [query, name, id, text, sessionName, sessionId, publishable] of [
    [
      "meeting=scheduled",
      "consultation_id",
      "80000000-0000-4000-8000-000000000002",
      "Kolejna konsultacja",
      "course_session_id",
      "",
      false,
    ],
    [
      "fitness=whole",
      "fitness_package_id",
      "82000000-0000-4000-8000-000000000001",
      "Plan całego pakietu",
      "fitness_session_id",
      "",
      true,
    ],
    [
      "fitness=scheduled",
      "fitness_package_id",
      "82000000-0000-4000-8000-000000000001",
      "Spotkanie 2",
      "fitness_session_id",
      "82000000-0000-4000-8000-000000000003",
      false,
    ],
    [
      "fitness=completed",
      "fitness_package_id",
      "82000000-0000-4000-8000-000000000001",
      "Spotkanie 1",
      "fitness_session_id",
      "82000000-0000-4000-8000-000000000002",
      true,
    ],
    [
      "course=whole",
      "course_enrollment_id",
      "81000000-0000-4000-8000-000000000001",
      "Plan całego kursu",
      "course_session_id",
      "",
      true,
    ],
    [
      "course=scheduled",
      "course_enrollment_id",
      "81000000-0000-4000-8000-000000000001",
      "Spotkanie 2",
      "course_session_id",
      "81000000-0000-4000-8000-000000000004",
      false,
    ],
  ]) {
    await page.goto(`${base}/?${query}&empty=1`);
    await expect(context).toContainText(text);
    await expect(binding(name)).toHaveValue(id);
    await expect(binding(sessionName)).toHaveValue(sessionId);
    await expect(body).toHaveValue("");
    await expect(binding("expected_version")).toHaveValue("0");
    const publish = page.getByRole("button", {
      name: "Opublikuj dla opiekuna",
    });
    if (publishable) await expect(publish).toBeEnabled();
    else await expect(publish).toBeDisabled();
  }
  await page.goto(`${base}/?fitness=scheduled&saved=consultation`);
  await expect(context).toContainText("Spotkanie 2");
  await expect(binding("consultation_id")).toHaveValue("");
  await expect(body).toHaveValue("");
  await page.getByLabel("Tytuł planu").fill("Osobny szkic fitness");
  await body.fill("Treść wyłącznie tego spotkania fitness.");
  await page.evaluate(() => {
    window.careFail = true;
  });
  await page.getByRole("button", { name: "Zapisz szkic", exact: true }).click();
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(body).toHaveValue("Treść wyłącznie tego spotkania fitness.");
  await expect(binding("expected_version")).toHaveValue("0");
  await page.evaluate(() => {
    window.careFail = false;
  });
  await page.getByRole("button", { name: "Zapisz szkic", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Zapisano");
  expect(await page.evaluate(() => window.careCalls.at(-1))).toMatchObject({
    consultation_id: "",
    course_enrollment_id: "",
    course_session_id: "",
    fitness_package_id: "82000000-0000-4000-8000-000000000001",
    fitness_session_id: "82000000-0000-4000-8000-000000000003",
    expected_version: "0",
    intent: "draft",
  });
  await body.fill("Niezapisana zmiana przed przejściem.");
  await page.getByText("Przygotuj plan innej usługi", { exact: true }).click();
  const anotherContext = page.getByRole("link", {
    name: /PSI FITNESS.*cały pakiet/,
  });
  allowNavigation = false;
  await anotherContext.click();
  await expect(body).toHaveValue("Niezapisana zmiana przed przejściem.");
  allowNavigation = true;
  await anotherContext.click();
  await expect(context).toContainText("Plan całego pakietu");
  await expect(body).toHaveValue("");
  await expect(binding("expected_version")).toHaveValue("0");
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
      ["fitness-context", "fitness=scheduled&empty=1&long=1"],
      ["fitness-independent", "fitness=scheduled&saved=consultation"],
      ["course-independent", "course=scheduled&saved=course"],
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
      if (name === "fitness-independent" || name === "course-independent") {
        const isFitness = name === "fitness-independent";
        await expect(context).toContainText("Spotkanie 2");
        await expect(body).toHaveValue("");
        await expect(binding("expected_version")).toHaveValue("0");
        await expect(binding("consultation_id")).toHaveValue("");
        await expect(
          binding(isFitness ? "fitness_session_id" : "course_session_id"),
        ).toHaveValue(
          isFitness
            ? "82000000-0000-4000-8000-000000000003"
            : "81000000-0000-4000-8000-000000000004",
        );
        await expect(
          page
            .getByRole("navigation", { name: "Wybierz plan psa" })
            .getByRole("link", { name: /Nasz plan na najbliższe dni/ }),
        ).toHaveAttribute(
          "href",
          `/admin/dogs/20000000-0000-4000-8000-000000000001/care?${
            isFitness
              ? "consultation=80000000-0000-4000-8000-000000000001"
              : "enrollment=81000000-0000-4000-8000-000000000001"
          }`,
        );
        await expect(page.locator("#historia")).toHaveCount(0);
        await expect(page.locator("#postepy article")).toHaveCount(0);
        await expect(
          page.getByRole("button", { name: "Opublikuj dla opiekuna" }),
        ).toBeDisabled();
      }
      if (
        [
          "fitness-context",
          "fitness-independent",
          "course-independent",
        ].includes(name) &&
        (width === 390 || width === 1440)
      )
        await page.screenshot({
          path: resolve(output, `${name}-collapsed-${width}.png`),
          fullPage: true,
        });
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
    "Care UI: error recovery, publication versions, library, guardian response, independent consultation/course/fitness drafts, guarded context navigation and 44 responsive scenarios passed.",
  );
  console.log(`Screenshots: ${output}`);
} finally {
  await browser?.close();
  await server.close();
}
