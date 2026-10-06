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
const fixture = resolve(cwd, "tests/fixtures/calendar-browser");
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
      name: "calendar-browser-fixtures",
      enforce: "pre",
      resolveId(source, importer) {
        if (source === "next/link") return resolve(fixture, "link.tsx");
        if (
          (source === "./actions" &&
            importer?.includes("/src/modules/calendar/")) ||
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
    port: 4181,
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
  page.on("pageerror", (e) => errors.push(e.message));
  const base = "http://127.0.0.1:4181",
    output = resolve(cwd, "test-results/calendar-ui");
  await mkdir(output, { recursive: true });
  await page.goto(base);
  await server.waitForRequestsIdle();
  const create = page.locator("#calendar-block-editor");
  await create.getByLabel("Nazwa blokady").fill("Przerwa testowa");
  await create.getByLabel("Od (czas polski)").fill("2026-09-22T12:00");
  await create.getByLabel("Do (czas polski)").fill("2026-09-22T12:30");
  await page.evaluate(() => {
    window.calendarFail = true;
  });
  await create
    .getByRole("button", { name: "Zablokuj czas", exact: true })
    .click();
  await expect(create.getByRole("alert")).toBeFocused();
  await expect(create.getByLabel("Nazwa blokady")).toHaveValue(
    "Przerwa testowa",
  );
  await page.evaluate(() => {
    window.calendarFail = false;
  });
  await create
    .getByRole("button", { name: "Zablokuj czas", exact: true })
    .click();
  await expect(create.getByRole("status")).toContainText("Zapisano");
  await page.evaluate(() => window.refreshCalendar());
  await create.getByLabel("Nazwa blokady").fill("Przerwa po edycji");
  await create.getByRole("button", { name: "Zapisz blokadę" }).click();
  await expect
    .poll(() => page.evaluate(() => window.calendarCalls.length))
    .toBe(3);
  expect(await page.evaluate(() => window.calendarCalls.at(-1))).toMatchObject({
    expected_version: "1",
    title: "Przerwa po edycji",
  });
  page.once("dialog", (dialog) => dialog.accept());
  await create.getByRole("button", { name: "Usuń blokadę" }).click();
  await expect
    .poll(() => page.evaluate(() => window.calendarCalls.at(-1)?.intent))
    .toBe("cancel");
  await expect(create.getByRole("status")).toContainText("usunięta");
  await create.getByRole("button", { name: "Dodaj kolejną blokadę" }).click();
  await expect(create.getByLabel("Nazwa blokady")).toHaveValue("");
  await expect(create.locator("input[name=expected_version]")).toHaveValue("0");
  expect(await create.locator("input[name=id]").inputValue()).not.toBe(
    "90000000-0000-4000-8000-000000000009",
  );
  await page.goto(`${base}/?role=client`);
  await expect(page.getByLabel("Nazwa blokady")).toHaveCount(0);
  await expect(page.getByText("Dojazd i przerwa", { exact: true })).toHaveCount(
    0,
  );
  await expect(
    page.getByRole("link", { name: "Otwórz szczegóły" }),
  ).toHaveCount(2);
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    for (const [name, query] of [
      ["admin", ""],
      ["guardian", "role=client"],
      ["long", "long=1"],
      ["empty", "empty=1"],
      ["home", "view=home"],
      ["home-empty", "view=home&empty=1"],
    ]) {
      await page.goto(`${base}/?${query}`);
      await page
        .getByRole("heading", { name: "Kalendarz", exact: true })
        .waitFor();
      await page.locator("details").evaluateAll((nodes) =>
        nodes.forEach((node) => {
          node.open = true;
        }),
      );
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth > innerWidth + 1,
        ),
        `${name} overflow at ${width}`,
      ).toBe(false);
      const clipped = await page
        .locator("input:not([type=hidden]),textarea,select,button")
        .evaluateAll((nodes) =>
          nodes
            .filter((n) => {
              const r = n.getBoundingClientRect();
              return r.width > 0 && (r.left < -1 || r.right > innerWidth + 1);
            })
            .map((n) => n.outerHTML.slice(0, 100)),
        );
      expect(clipped, `${name} clipped at ${width}`).toEqual([]);
      if (
        ["admin", "guardian", "home"].includes(name) &&
        [390, 1440].includes(width)
      ) {
        await page.locator("details").evaluateAll((nodes) =>
          nodes.forEach((node) => {
            node.open = false;
          }),
        );
        await page.screenshot({
          path: resolve(output, `${name}-${width}.png`),
          fullPage: true,
        });
      }
    }
  }
  expect(errors).toEqual([]);
  console.log(
    "Calendar UI: block recovery, saved versions, fresh block creation, client role and 24 responsive scenarios passed.",
  );
} finally {
  await browser?.close();
  await server.close();
}
