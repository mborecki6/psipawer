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
const { build } = await import(pathToFileURL(require.resolve("vite")).href);
const built = await build({
  configFile: false,
  root: fixture,
  logLevel: "error",
  plugins: [
    {
      name: "consultations-browser-fixtures",
      enforce: "pre",
      resolveId(source, importer) {
        if (source === "next/link") return resolve(fixture, "link.tsx");
        if (source === "next/navigation") return "\0navigation-fixture";
        if (source === "node:crypto") return resolve(fixture, "crypto.ts");
        if (
          (["./actions", "./finance-actions"].includes(source) &&
            (importer?.includes("/src/modules/consultations/") ||
              importer?.includes("/src/modules/fitness/"))) ||
          source === "@/lib/data/finance-actions" ||
          source === resolve(cwd, "src/lib/data/finance-actions") ||
          source === "@/lib/auth/actions"
        )
          return resolve(fixture, "actions.ts");
      },
      load(id) {
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
  define: { "process.env.NODE_ENV": JSON.stringify("development") },
  build: {
    write: false,
    minify: false,
    cssCodeSplit: false,
    lib: {
      entry: resolve(fixture, "main.tsx"),
      formats: ["iife"],
      name: "ConsultationFitnessFixture",
    },
  },
});

let browser;
try {
  browser = await chromium.launch({
    channel: process.env.CARE_BROWSER_CHANNEL || "chrome",
    headless: true,
  });
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const base = "http://127.0.0.1:4179";
  const assets = (Array.isArray(built) ? built[0] : built).output;
  const javascript = assets.find(
    (asset) => asset.type === "chunk" && asset.isEntry,
  ).code;
  const css = assets
    .filter(
      (asset) => asset.type === "asset" && asset.fileName.endsWith(".css"),
    )
    .map((asset) => asset.source)
    .join("\n");
  // Serve the compiled fixture from Playwright: no socket, HMR or dev-server
  // reload can reset a pending action or the in-memory fixture call history.
  await page.route("**/*", (route) =>
    route.request().url().startsWith(base)
      ? route.fulfill({
          contentType: "text/html; charset=utf-8",
          body: `<html lang="pl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><style>${css}</style></head><body><div id="root"></div><script>${javascript.replace(/<\/script/gi, "<\\/script")}</script></body></html>`,
        })
      : route.abort(),
  );
  const output = resolve(cwd, "test-results/consultations-ui");
  await mkdir(output, { recursive: true });
  await page.goto(base);
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

  const consultationEditor = page.locator(
    "#termin-30000000-0000-4000-8000-000000000001",
  );
  for (const result of ["error", "success", "warning"]) {
    await page.goto(`${base}/?view=detail`);
    await expect(consultationEditor).not.toHaveAttribute("open", "");
    await consultationEditor.locator(":scope > summary").focus();
    await page.keyboard.press("Enter");
    await page
      .getByLabel("Powód zmiany dla opiekuna")
      .fill("Zachowany szkic zmiany");
    await consultationEditor.locator(":scope > summary").click();
    await consultationEditor.locator(":scope > summary").click();
    await expect(page.getByLabel("Powód zmiany dla opiekuna")).toHaveValue(
      "Zachowany szkic zmiany",
    );
    await page.evaluate((result) => {
      window.consultationDelay = 700;
      window.consultationFail = result === "error";
      window.consultationWarn = result === "warning";
    }, result);
    await page.getByRole("button", { name: "Zapisz zmianę terminu" }).click();
    await consultationEditor.locator(":scope > summary").click();
    await expect(consultationEditor).not.toHaveAttribute("open", "");
    await expect(
      page.getByRole(result === "success" ? "status" : "alert"),
    ).toBeVisible();
    await expect(consultationEditor).toHaveAttribute("open", "");
    if (result !== "success")
      await expect(page.getByRole("alert")).toBeFocused();
    await expect(page.getByLabel("Powód zmiany dla opiekuna")).toHaveValue(
      "Zachowany szkic zmiany",
    );
  }
  await page.goto(`${base}/?view=detail&status=requested&legacy=1`);
  await expect(
    page.getByRole("heading", { name: "Uzgodniona kwota" }),
  ).toBeVisible();
  await expect(consultationEditor).toHaveAttribute("open", "");
  await page.goto(`${base}/?view=detail&past=1`);
  expect(
    await page
      .getByRole("button", { name: "Oznacz jako zakończoną" })
      .evaluate((element) =>
        Boolean(
          element.compareDocumentPosition(
            document.getElementById("historia-konsultacji"),
          ) & Node.DOCUMENT_POSITION_FOLLOWING,
        ),
      ),
  ).toBe(true);
  await expect(page.locator("#historia-konsultacji")).not.toHaveAttribute(
    "open",
    "",
  );

  for (const role of ["admin", "client"]) {
    await page.goto(`${base}/?view=fitness&role=${role}`);
    await expect(
      page.locator('details[name^="fitness-sessions-"][open]'),
    ).toHaveCount(1);
    await expect(
      page.locator("#spotkanie-71000000-0000-4000-8000-000000000002"),
    ).toHaveAttribute("open", "");
    await expect(page.getByText("Oczekują na zakończenie: 1")).toBeVisible();
    await expect(
      page.getByText("Do umówienia: 1", { exact: true }),
    ).toBeVisible();
    await expect(page.getByText("Odwołane: 1", { exact: true })).toBeVisible();
    for (const [name, id] of [
      [
        "Spotkanie po numerze",
        "#spotkanie-71000000-0000-4000-8000-000000000004",
      ],
      [
        "Spotkanie po identyfikatorze",
        "#spotkanie-71000000-0000-4000-8000-000000000005",
      ],
      ["Saldo po identyfikatorze", "#rozliczenie-pakietu"],
    ]) {
      const target = page.locator(id);
      await page.getByRole("link", { name, exact: true }).click();
      await expect(target).toHaveAttribute("open", "");
      await target.locator(":scope > summary").click();
      await expect(target).not.toHaveAttribute("open", "");
      await page.getByRole("link", { name, exact: true }).click();
      await expect(target).toHaveAttribute("open", "");
    }
    if (role === "client")
      await expect(
        page.getByLabel("Termin spotkania (czas polski)"),
      ).toHaveCount(0);
  }
  await page.goto(`${base}/?view=fitness`);
  await page.getByRole("link", { name: "Spotkanie po numerze" }).click();
  const pendingSession = page.locator(
    "#spotkanie-71000000-0000-4000-8000-000000000004",
  );
  await pendingSession
    .getByLabel("Termin spotkania (czas polski)")
    .fill("2026-11-02T15:00");
  await pendingSession
    .getByLabel("Dokładne miejsce spotkania")
    .fill("Zachowana sala fitness");
  await page.evaluate(() => {
    window.consultationDelay = 700;
    window.consultationFail = true;
  });
  await pendingSession
    .getByRole("button", { name: "Zapisz termin fitness" })
    .click();
  await expect
    .poll(() => page.evaluate(() => window.consultationCalls?.length || 0))
    .toBe(1);
  expect(
    await page.evaluate(() => window.consultationCalls.at(-1)),
  ).toMatchObject({
    id: "71000000-0000-4000-8000-000000000004",
    starts_at: "2026-11-02T15:00",
    location: "Zachowana sala fitness",
  });
  await expect(
    pendingSession.getByRole("button", { name: "Zapisuję…", exact: true }),
  ).toBeDisabled();
  await pendingSession.locator(":scope > summary").click();
  await expect(pendingSession).not.toHaveAttribute("open", "");
  await expect(pendingSession.getByRole("alert")).toBeVisible();
  await expect(pendingSession).toHaveAttribute("open", "");
  await expect(
    pendingSession.getByLabel("Dokładne miejsce spotkania"),
  ).toHaveValue("Zachowana sala fitness");

  await page.goto(`${base}/?view=fitness`);
  const fitnessBilling = page.locator("#rozliczenie-pakietu");
  await fitnessBilling.locator(":scope > summary").click();
  await page.getByText("Odnotuj otrzymaną wpłatę", { exact: true }).click();
  await page.getByLabel("Otrzymana kwota (zł)").fill("50,00");
  await page
    .getByRole("checkbox", {
      name: "Potwierdzam, że wpłata została otrzymana.",
    })
    .check();
  await page.evaluate(() => {
    window.consultationDelay = 700;
    window.consultationFail = true;
  });
  await page
    .getByRole("button", { name: "Zapisz wpłatę", exact: true })
    .click();
  await fitnessBilling.locator(":scope > summary").click();
  await expect(fitnessBilling).not.toHaveAttribute("open", "");
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(fitnessBilling).toHaveAttribute("open", "");
  await expect(page.getByLabel("Otrzymana kwota (zł)")).toHaveValue("50,00");

  await page.goto(
    `${base}/?view=fitness-request&service=60000000-0000-4000-8000-000000000099`,
  );
  await expect(page.locator('select[name="service_id"]')).toHaveCount(1);
  await expect(page.locator('select[name="service_id"]')).toBeHidden();
  await expect(page.locator('select[name="dog_id"]')).toHaveCount(1);
  await expect(page.locator('select[name="dog_id"]')).toBeHidden();
  await page.getByLabel("Cel spotkań").fill("Potrzeby podczas ćwiczeń");
  await page
    .getByRole("checkbox", {
      name: "Zapoznałem/am się z ceną i zakresem całego pakietu.",
    })
    .check();
  await page.getByRole("button", { name: "Wyślij zgłoszenie fitness" }).click();
  await expect(page.getByRole("status")).toBeVisible();
  expect(
    await page.evaluate(() => window.consultationCalls.at(-1)),
  ).toMatchObject({
    service_id: "60000000-0000-4000-8000-000000000099",
    service_version: "4",
    dog_id: "20000000-0000-4000-8000-000000000001",
  });
  await page.goto(`${base}/?view=fitness-request&service=invalid`);
  await expect(
    page.getByRole("combobox", { name: "Pakiet", exact: true }),
  ).toBeVisible();

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
      ["fitness-admin", "view=fitness"],
      ["fitness-client", "view=fitness&role=client"],
      ["fitness-empty", "view=fitness&empty=1"],
      ["fitness-long", "view=fitness&long=1"],
      ["fitness-settlement", "view=fitness&fitnessStatus=cancelled"],
      [
        "fitness-refund",
        "view=fitness&fitnessStatus=cancelled&refund=1&role=client",
      ],
    ]) {
      await page.goto(`${base}/?${query}`);
      await page
        .getByRole("heading", { name: "Konsultacje", exact: true })
        .waitFor();
      await page.locator("details").evaluateAll((nodes) => {
        const selectedMeeting = nodes.find(
          (node) => node.name?.startsWith("fitness-sessions-") && node.open,
        );
        nodes.forEach((node) => {
          node.open = true;
        });
        // Named meetings are exclusive: return to the initially selected one
        // so long locations and its real controls are included in layout QA.
        if (selectedMeeting) selectedMeeting.open = true;
      });
      const overflowing = await page.locator("main *").evaluateAll((nodes) =>
        nodes
          .filter((node) => {
            const bounds = node.getBoundingClientRect();
            return (
              bounds.width > 0 &&
              (bounds.left < -1 || bounds.right > innerWidth + 1)
            );
          })
          .map((node) => node.outerHTML.slice(0, 180))
          .slice(-12),
      );
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth > innerWidth + 1,
        ),
        `${name} overflow at ${width}: ${JSON.stringify(overflowing)}`,
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
    "Consultation and fitness UI: recovery, preserved drafts and revealed feedback, versioned scheduling, assignments, warnings, legacy prices, roles, exact and repeated anchors, selected request payloads and 52 responsive scenarios passed.",
  );
} finally {
  await browser?.close();
}
