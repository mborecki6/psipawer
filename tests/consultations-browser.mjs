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
const fixture = resolve(cwd, "tests/fixtures/consultations-browser");
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
      name: "consultations-browser-fixtures",
      enforce: "pre",
      resolveId(source, importer) {
        if (source === "next/link") return resolve(fixture, "link.tsx");
        if (
          (source === "./actions" &&
            importer?.includes("/src/modules/consultations/")) ||
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
    port: 4179,
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
  const base = "http://127.0.0.1:4179";
  const output = resolve(cwd, "test-results/consultations-ui");
  await mkdir(output, { recursive: true });
  await page.goto(base);
  await server.waitForRequestsIdle();
  await page.waitForLoadState("networkidle");
  await page.goto(`${base}/?view=detail&status=requested`);
  await page.getByLabel("Termin (czas polski)").fill("2026-10-06T15:00");
  await page
    .getByLabel("Miejsce lub instrukcja połączenia")
    .fill("Miejsce testowe — do zachowania po błędzie.");
  await page.evaluate(() => {
    window.consultationFail = true;
  });
  await page
    .getByRole("button", { name: "Potwierdź uzgodniony termin" })
    .click();
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(
    page.getByLabel("Miejsce lub instrukcja połączenia"),
  ).toHaveValue("Miejsce testowe — do zachowania po błędzie.");
  await page.evaluate(() => {
    window.consultationFail = false;
  });
  await page
    .getByRole("button", { name: "Potwierdź uzgodniony termin" })
    .click();
  await expect(page.getByRole("status")).toContainText("Zapisano");
  await page
    .getByLabel("Powód zmiany dla opiekuna")
    .fill("Uzgodniona zmiana godziny.");
  await page.getByLabel("Termin (czas polski)").fill("2026-10-06T16:00");
  await page.getByRole("button", { name: "Zapisz zmianę terminu" }).click();
  await expect
    .poll(() => page.evaluate(() => window.consultationCalls.length))
    .toBe(3);
  expect(
    await page.evaluate(() => window.consultationCalls.at(-1).expected_version),
  ).toBe("2");
  // Refresh server props while the draft is edited: do not attach a new
  // optimistic version to the old local contents.
  await page.evaluate(() => window.refreshConsultation());
  await page
    .getByLabel("Powód zmiany dla opiekuna")
    .fill("Dalsza edycja widocznego szkicu.");
  await page.getByRole("button", { name: "Zapisz zmianę terminu" }).click();
  await expect
    .poll(() => page.evaluate(() => window.consultationCalls.length))
    .toBe(4);
  expect(
    await page.evaluate(() => window.consultationCalls.at(-1).expected_version),
  ).toBe("3");

  await page.goto(`${base}/?view=request&role=client`);
  await page
    .getByLabel("Wybierz usługę")
    .selectOption("60000000-0000-4000-8000-000000000011");
  await page.getByLabel("Co chcesz omówić?").fill("Opis potrzeby konsultacji.");
  await page.getByLabel("Kiedy masz czas? (opcjonalnie)").fill("Popołudnia");
  await page.evaluate(() => {
    window.consultationFail = true;
  });
  await page.getByRole("button", { name: "Przekaż zgłoszenie" }).click();
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(page.getByLabel("Co chcesz omówić?")).toHaveValue(
    "Opis potrzeby konsultacji.",
  );
  await page.evaluate(() => {
    window.consultationFail = false;
  });
  await page.getByRole("button", { name: "Przekaż zgłoszenie" }).click();
  await expect(page.getByRole("status")).toContainText("Zapisano");
  const calls = await page.evaluate(() => window.consultationCalls);
  expect(calls[0].id).toBe(calls[1].id);
  expect(calls[1]).toMatchObject({
    service_id: "60000000-0000-4000-8000-000000000011",
    service_version: "1",
  });
  expect(calls[1].agreed_price_cents).toBeUndefined();

  await page.goto(`${base}/?view=detail&role=client`);
  await expect(page.getByLabel("Termin (czas polski)")).toHaveCount(0);
  await page.getByText("Potrzebujesz odwołać?", { exact: true }).click();
  await page.getByLabel("Powód odwołania").fill("Nie możemy przyjść.");
  await page.evaluate(() => {
    window.consultationFail = true;
  });
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Odwołaj konsultację" }).click();
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(page.getByLabel("Powód odwołania")).toHaveValue(
    "Nie możemy przyjść.",
  );

  await page.goto(`${base}/?view=detail&status=requested`);
  await page
    .getByLabel("Prowadzący", { exact: true })
    .selectOption("10000000-0000-4000-8000-000000000002");
  await page
    .getByLabel("Sala do rezerwacji (opcjonalnie)")
    .selectOption("40000000-0000-4000-8000-000000000001");
  await page.getByLabel("Termin (czas polski)").fill("2026-10-06T15:00");
  await page
    .getByLabel("Miejsce lub instrukcja połączenia")
    .fill("Miejsce zachowane przy ostrzeżeniu");
  await page.evaluate(() => {
    window.consultationWarn = true;
  });
  await page
    .getByRole("button", { name: "Potwierdź uzgodniony termin" })
    .click();
  await expect(page.getByRole("alert")).toBeFocused();
  await expect(page.getByLabel("Prowadzący", { exact: true })).toHaveValue(
    "10000000-0000-4000-8000-000000000002",
  );
  await expect(
    page.getByLabel("Miejsce lub instrukcja połączenia"),
  ).toHaveValue("Miejsce zachowane przy ostrzeżeniu");
  await page
    .getByRole("button", { name: "Potwierdź uzgodniony termin" })
    .click();
  expect(await page.evaluate(() => window.consultationCalls.length)).toBe(1);
  await page
    .getByRole("checkbox", {
      name: "Sprawdziłem przerwę i chcę zapisać ten termin.",
    })
    .check();
  await page
    .getByRole("button", { name: "Potwierdź uzgodniony termin" })
    .click();
  await expect(page.getByRole("status")).toContainText("Zapisano");
  expect(
    await page.evaluate(() => window.consultationCalls.at(-1)),
  ).toMatchObject({
    calendar_staff_id: "10000000-0000-4000-8000-000000000002",
    calendar_resource_id: "40000000-0000-4000-8000-000000000001",
    calendar_assignment_version: "4",
    confirm_short_break: "true",
    calendar_confirmation: "calendar-fixture-signature",
  });
  await expect(page.getByLabel("Prowadzący", { exact: true })).toBeDisabled();
  await page
    .getByLabel("Powód zmiany dla opiekuna")
    .fill("Kolejna uzgodniona zmiana daty");
  await page.getByRole("button", { name: "Zapisz zmianę terminu" }).click();
  await expect(page.getByRole("alert")).toBeVisible();
  // The updated assignment remains intact on later scheduling attempts.
  expect(
    await page.evaluate(
      () => window.consultationCalls.at(-1).calendar_staff_id,
    ),
  ).toBeUndefined();
  await expect(page.getByLabel("Prowadzący", { exact: true })).toBeDisabled();

  await page.goto(`${base}/?view=detail&status=requested&inactive=1`);
  await expect(page.getByLabel("Sala do rezerwacji (opcjonalnie)")).toHaveValue(
    "40000000-0000-4000-8000-000000000001",
  );
  await page.getByLabel("Termin (czas polski)").fill("2026-10-06T15:00");
  await page
    .getByLabel("Miejsce lub instrukcja połączenia")
    .fill("Dotychczasowe miejsce spotkania");
  await page
    .getByRole("button", { name: "Potwierdź uzgodniony termin" })
    .click();
  await expect(page.getByRole("status")).toContainText("Zapisano");
  expect(
    await page.evaluate(
      () => window.consultationCalls.at(-1).calendar_resource_id,
    ),
  ).toBe("40000000-0000-4000-8000-000000000001");
  for (const role of ["admin", "client"]) {
    await page.goto(
      `${base}/?view=detail&status=completed&care=1&role=${role}`,
    );
    await expect(
      page.getByRole("link", { name: "Zalecenia po konsultacji · wersja 7" }),
    ).toHaveAttribute(
      "href",
      `/${role === "admin" ? "admin" : "app"}/care/plans/90000000-0000-4000-8000-000000000001`,
    );
    if (role === "admin") {
      await expect(
        page.getByRole("link", { name: "Otwórz szkic zaleceń" }),
      ).toHaveAttribute(
        "href",
        "/admin/dogs/20000000-0000-4000-8000-000000000001/care?consultation=30000000-0000-4000-8000-000000000001#szkic",
      );
      await expect(
        page.getByText("Jest zapisany szkic", { exact: false }),
      ).toBeVisible();
    } else {
      await expect(
        page.getByRole("link", { name: "Otwórz szkic zaleceń" }),
      ).toHaveCount(0);
      await expect(
        page.getByText("Jest zapisany szkic", { exact: false }),
      ).toHaveCount(0);
    }
  }

  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    for (const [name, query] of [
      ["list", "view=list"],
      ["request", "view=request&role=client"],
      ["admin-detail", "view=detail"],
      ["guardian-detail", "view=detail&role=client"],
      ["empty", "view=request&empty=1&role=client"],
      ["long", "view=detail&long=1"],
      ["completed", "view=detail&status=completed&role=client"],
    ]) {
      await page.goto(`${base}/?${query}`);
      await page
        .getByRole("heading", { name: "Konsultacje", exact: true })
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
            .map((n) => n.outerHTML.slice(0, 130)),
        );
      expect(clipped, `${name} clipped controls at ${width}`).toEqual([]);
      if (width === 390 || width === 1440)
        await page.screenshot({
          path: resolve(output, `${name}-${width}.png`),
          fullPage: true,
        });
    }
  }
  expect(errors).toEqual([]);
  console.log(
    "Consultation UI: recovery, versioned scheduling, staff and room assignments, short-break confirmation, inactive room preservation, role controls, request retries and 28 responsive scenarios passed.",
  );
} finally {
  await browser?.close();
  await server.close();
}
