// Real course views and controlled forms, with deterministic actions and data.
// This check never connects to a database or creates accounts.
import { createRequire } from "node:module";
import { resolve, dirname } from "node:path";
import { mkdir } from "node:fs/promises";
import { realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { chromium, expect } from "@playwright/test";

const cwd = process.cwd();
const fixture = resolve(cwd, "tests/fixtures/courses-browser");
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
      name: "courses-browser-fixtures",
      enforce: "pre",
      resolveId(source, importer) {
        if (source === "next/link") return resolve(fixture, "link.tsx");
        if (
          source === "node:crypto" ||
          source === "@/lib/data/finance-actions" ||
          source === resolve(cwd, "src/lib/data/finance-actions") ||
          ((source === "./actions" || source === "./finance-actions") &&
            importer?.includes("/src/modules/courses/"))
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
    port: 4184,
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
  const base = "http://127.0.0.1:4184";
  const output = resolve(cwd, "test-results/courses-ui");
  await mkdir(output, { recursive: true });
  await page.goto(base);
  await server.waitForRequestsIdle();
  const create = page.getByRole("form", {
    name: "Nowy cykl kursu",
    exact: true,
  });
  const publicPlace = create.getByLabel("Miejsce — okolica przed przyjęciem", {
    exact: true,
  });
  const privatePlace = create.getByLabel(
    "Dokładne miejsce zbiórki po przyjęciu",
    { exact: true },
  );
  const save = create.getByRole("button", {
    name: "Zapisz szkic cyklu",
    exact: true,
  });
  await expect(save).toBeEnabled();
  await expect(
    page.getByText("Zapisz miejsce i wszystkie terminy", { exact: false }),
  ).toBeVisible();
  await expect(
    create.getByRole("region", { name: "Miejsce spotkań", exact: true }),
  ).toBeVisible();
  await expect(
    create.getByLabel("Sala do rezerwacji (opcjonalnie)"),
  ).toHaveCount(0);
  await expect(create).not.toContainText("rezerwacja sali");
  await expect(create.locator('input[name="starts"]')).toHaveCount(5);

  // Native validation must lead to each missing location before dispatching.
  await save.click();
  await expect(publicPlace).toBeFocused();
  await publicPlace.fill("Okolica parku testowego");
  await publicPlace.press("Tab");
  await expect(privatePlace).toBeFocused();
  await save.click();
  await expect(privatePlace).toBeFocused();
  expect(await page.evaluate(() => window.courseCalls?.length || 0)).toBe(0);
  await privatePlace.fill("Prywatna brama testowa");
  await create
    .getByLabel("Spotkanie 1", { exact: true })
    .fill("2028-01-15T14:00");
  await create
    .getByRole("button", { name: "Uzupełnij co tydzień", exact: true })
    .click();
  await expect(create.getByLabel("Spotkanie 5", { exact: true })).toHaveValue(
    "2028-02-12T14:00",
  );
  await page.evaluate(() => {
    window.courseFailure = "Nie udało się zapisać zmiany kursu.";
  });
  await save.click();
  await expect(create.getByRole("alert")).toBeFocused();
  await expect(publicPlace).toHaveValue("Okolica parku testowego");
  await expect(privatePlace).toHaveValue("Prywatna brama testowa");
  expect(await page.evaluate(() => window.courseCalls.at(-1))).toMatchObject({
    operation: "create",
    values: {
      id: "81000000-0000-4000-8000-000000000009",
      service_version: "1",
      public_location: "Okolica parku testowego",
      exact_location: "Prywatna brama testowa",
      calendar_resource_id: "",
      starts: [
        "2028-01-15T14:00",
        "2028-01-22T14:00",
        "2028-01-29T14:00",
        "2028-02-05T14:00",
        "2028-02-12T14:00",
      ],
    },
  });

  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    await create
      .getByRole("heading", { name: "Miejsce spotkań", exact: true })
      .scrollIntoViewIfNeeded();
    await expect(publicPlace).toBeVisible();
    await expect(privatePlace).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    const order = await create.evaluate((form) => {
      const area = form.querySelector('textarea[name="public_location"]');
      const date = form.querySelector('input[name="starts"]');
      return Boolean(
        area.compareDocumentPosition(date) & Node.DOCUMENT_POSITION_FOLLOWING,
      );
    });
    expect(order).toBe(true);
    await page.screenshot({
      path: resolve(output, `create-${width}.png`),
      fullPage: true,
    });
  }

  await page.goto(`${base}/?resource=inactive`);
  await expect(page.getByLabel("Sala do rezerwacji (opcjonalnie)")).toHaveCount(
    0,
  );
  await expect(create).not.toContainText("rezerwacja sali");
  await page.goto(`${base}/?resource=active`);
  await expect(
    page.getByLabel("Sala do rezerwacji (opcjonalnie)"),
  ).toBeVisible();
  await page
    .getByLabel("Sala do rezerwacji (opcjonalnie)")
    .selectOption("84000000-0000-4000-8000-000000000001");
  await publicPlace.fill("Okolica niezależna od sali");
  await privatePlace.fill("Adres niezależny od sali");
  expect(
    await create.evaluate((form) => Object.fromEntries(new FormData(form))),
  ).toMatchObject({
    calendar_resource_id: "84000000-0000-4000-8000-000000000001",
    public_location: "Okolica niezależna od sali",
    exact_location: "Adres niezależny od sali",
  });

  await page.goto(`${base}/?view=detail`);
  const summary = page
    .getByText("Zmień termin lub miejsce", { exact: true })
    .first();
  await summary.focus();
  await summary.press("Enter");
  const edit = page.getByRole("form", {
    name: "Termin spotkania 1",
    exact: true,
  });
  await expect(edit).toBeVisible();
  await edit
    .getByLabel("Miejsce — okolica przed przyjęciem")
    .fill("Zmieniona okolica");
  await edit
    .getByLabel("Dokładne miejsce zbiórki po przyjęciu")
    .fill("Zmiana prywatnej zbiórki");
  await edit
    .getByLabel("Powód zmiany dla opiekuna")
    .fill("Uzgodnione nowe miejsce");
  await page.evaluate(() => {
    window.refreshCourse();
    window.courseFailure =
      "Spotkanie zmieniło się. Odśwież widok przed zapisem.";
  });
  await edit
    .getByRole("button", { name: "Zapisz termin i zbiórkę", exact: true })
    .click();
  await expect(edit.getByRole("alert")).toBeFocused();
  await expect(
    edit.getByLabel("Dokładne miejsce zbiórki po przyjęciu"),
  ).toHaveValue("Zmiana prywatnej zbiórki");
  expect(await page.evaluate(() => window.courseCalls.at(-1))).toMatchObject({
    operation: "reschedule",
    values: {
      id: "82000000-0000-4000-8000-000000000001",
      expected_version: "1",
      starts_at: "2028-01-03T14:00",
      public_location: "Zmieniona okolica",
      exact_location: "Zmiana prywatnej zbiórki",
      note: "Uzgodnione nowe miejsce",
    },
  });
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    await edit.scrollIntoViewIfNeeded();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.locator("#spotkanie-1").screenshot({
      path: resolve(output, `edit-${width}.png`),
    });
  }
  await page.goto(`${base}/?empty`);
  await expect(
    page.getByText("Brak aktywnej oferty kursu. Uzupełnij katalog usług."),
  ).toBeVisible();
  expect(errors).toEqual([]);
  console.log(
    "PASS: course location forms, privacy copy, five dates, separate room, preserved drafts and versions, keyboard, 320/390/768/1440, empty catalogue.",
  );
} finally {
  await browser?.close();
  await server.close();
}
