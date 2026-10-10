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
const fixture = resolve(cwd, "tests/fixtures/services-browser");
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
      name: "services-browser-fixtures",
      enforce: "pre",
      resolveId(source, importer) {
        if (source === "next/link") return resolve(fixture, "link.tsx");
        if (
          (source === "./actions" &&
            importer?.includes("/src/modules/services/")) ||
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
    port: 4180,
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
  const base = "http://127.0.0.1:4180";
  const output = resolve(cwd, "test-results/services-ui");
  await mkdir(output, { recursive: true });
  await page.goto(`${base}/?view=detail`);
  await server.waitForRequestsIdle();
  await page.getByLabel("Cena (zł)", { exact: true }).fill("175,50");
  await page.getByLabel("Rodzaj ceny").selectOption("false");
  await page.evaluate(() => {
    window.serviceFail = true;
  });
  await page.getByRole("button", { name: "Zapisz usługę i cenę" }).click();
  await expect(page.getByRole("alert")).toBeFocused();
  await expect(page.getByLabel("Rodzaj ceny")).toHaveValue("false");
  await expect(page.getByLabel("Cena (zł)", { exact: true })).toHaveValue(
    "175,50",
  );
  await page.evaluate(() => {
    window.serviceFail = false;
  });
  await page.getByRole("button", { name: "Zapisz usługę i cenę" }).click();
  await expect(page.getByRole("status")).toContainText("Zapisano");
  await expect(page.getByLabel("Rodzaj ceny")).toHaveValue("false");
  await page.evaluate(() => window.refreshService());
  await expect(page.getByLabel("Cena (zł)", { exact: true })).toHaveValue(
    "175,50",
  );
  await page.getByLabel("Cena (zł)", { exact: true }).fill("185,90");
  await page.getByLabel("Widoczność oferty").selectOption("false");
  await page.getByRole("button", { name: "Zapisz usługę i cenę" }).click();
  await expect
    .poll(() => page.evaluate(() => window.serviceCalls.length))
    .toBe(3);
  expect(await page.evaluate(() => window.serviceCalls.at(-1))).toMatchObject({
    expected_version: "2",
    price: "185,90",
    active: "false",
    is_test_price: "false",
  });
  await expect(page.getByLabel("Widoczność oferty")).toHaveValue("false");
  await expect(page.getByLabel("Rodzaj ceny")).toHaveValue("false");
  await page.goto(`${base}/?role=client`);
  await expect(page.getByText("Edytuj usługę i cenę")).toHaveCount(0);
  await expect(
    page.getByRole("link", { name: "Wybierz spotkanie →" }),
  ).toHaveCount(2);
  for (const role of ["admin", "client"]) {
    await page.goto(`${base}/?role=${role}`);
    const forms = page.getByRole("navigation", { name: "Forma usług" });
    await forms.getByRole("link", { name: /^Indywidualne/ }).click();
    await expect(page).toHaveURL(/category=individual/);
    await expect(
      forms.getByRole("link", { name: /^Indywidualne/ }),
    ).toHaveAttribute("aria-current", "page");
    await expect(
      page.getByRole("heading", {
        name: "Psie Przedszkole — indywidualne",
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", {
        name: "PSI FITNESS — pakiet 4 spotkań",
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", {
        name: "Psie Przedszkole — grupowe",
        exact: true,
      }),
    ).toHaveCount(0);
    await forms.getByRole("link", { name: /^Grupowe/ }).click();
    await expect(
      page.getByRole("heading", {
        name: "Psie Przedszkole — grupowe",
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", {
        name: "Psie Przedszkole — indywidualne",
        exact: true,
      }),
    ).toHaveCount(0);
    await page.goBack();
    await expect(
      forms.getByRole("link", { name: /^Indywidualne/ }),
    ).toHaveAttribute("aria-current", "page");
    await forms.getByRole("link", { name: /^Karty podarunkowe/ }).click();
    await expect(
      page.getByRole("heading", { name: "Karta podarunkowa", exact: true }),
    ).toBeVisible();
    await expect(page.locator("article.card")).toHaveCount(1);
    await forms.getByRole("link", { name: /^Pozostałe/ }).click();
    await expect(
      page.getByRole("heading", { name: "Pakiet do uzgodnienia", exact: true }),
    ).toBeVisible();
    await expect(page.locator("article.card")).toHaveCount(1);
    await forms.getByRole("link", { name: /^Wszystkie/ }).click();
    await expect(page.locator("article.card")).toHaveCount(8);
  }
  await page.goto(`${base}/?category=unexpected`);
  await expect(page.locator("article.card")).toHaveCount(8);
  await page.goto(`${base}/?category=individual&category=group`);
  await expect(page.locator("article.card")).toHaveCount(8);
  await page.goto(`${base}/?view=walk`);
  await expect(
    page.getByLabel("Cena za psa (zł)", { exact: true }),
  ).toHaveValue("100");
  await expect(page.getByLabel("Rodzaj spaceru")).toHaveValue(
    "Spacery socjalizacyjne — pojedynczy spacer",
  );
  await page.goto(`${base}/?view=walk&editing=1`);
  await expect(
    page.getByLabel("Cena za psa (zł)", { exact: true }),
  ).toHaveValue("75");
  await expect(
    page.getByLabel("Cena za psa (zł)", { exact: true }),
  ).not.toBeEditable();
  await expect(page.getByLabel("Uzupełnij z cennika")).toHaveCount(0);
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    for (const [name, query] of [
      ["catalogue", "view=list"],
      ["guardian", "role=client"],
      ["editor", "view=detail"],
      ["long", "view=list&long=1"],
      ["empty", "empty=1"],
      ["walk", "view=walk"],
    ]) {
      await page.goto(`${base}/?${query}`);
      await page
        .getByRole("heading", {
          name: name === "guardian" ? "Oferta" : "Usługi i cennik",
          exact: true,
        })
        .first()
        .waitFor();
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
        ["catalogue", "editor", "guardian"].includes(name) &&
        [390, 1440].includes(width)
      )
        await page.screenshot({
          path: resolve(output, `${name}-${width}.png`),
          fullPage: true,
        });
    }
  }
  expect(errors).toEqual([]);
  console.log(
    "Services UI: editor recovery, version acknowledgement, role controls, catalogue form filters with back navigation, walk price defaults and 24 responsive scenarios passed.",
  );
} finally {
  await browser?.close();
  await server.close();
}
