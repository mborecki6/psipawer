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
const { build } = await import(pathToFileURL(require.resolve("vite")).href);
const built = await build({
  configFile: false,
  root: fixture,
  logLevel: "error",
  plugins: [
    {
      name: "courses-browser-fixtures",
      enforce: "pre",
      resolveId(source, importer) {
        if (source === "next/link") return resolve(fixture, "link.tsx");
        if (source === "next/navigation") return "\0navigation-fixture";
        if (
          source === "node:crypto" ||
          source === "@/lib/data/finance-actions" ||
          source === resolve(cwd, "src/lib/data/finance-actions") ||
          ((source === "./actions" || source === "./finance-actions") &&
            importer?.includes("/src/modules/courses/"))
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
  define: { "process.env.NODE_ENV": JSON.stringify("development") },
  build: {
    write: false,
    minify: false,
    cssCodeSplit: false,
    lib: {
      entry: resolve(fixture, "main.tsx"),
      formats: ["iife"],
      name: "CourseFixture",
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
  const base = "http://127.0.0.1:4184";
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
  // Route fulfillment supplies the compiled fixture directly. No port is bound,
  // no application/HTTP server starts, and all other traffic is blocked.
  await page.route("**/*", (route) =>
    route.request().url().startsWith(base)
      ? route.fulfill({
          contentType: "text/html; charset=utf-8",
          body: `<html><head><meta charset="utf-8"><style>${css}</style></head><body><div id="root"></div><script>${javascript.replace(/<\/script/gi, "<\\/script")}</script></body></html>`,
        })
      : route.abort(),
  );
  const output = resolve(cwd, ".local/course-simplify-20261026/screenshots");
  await mkdir(output, { recursive: true });
  async function openSection(container, name) {
    const summary = container
      .locator("summary")
      .filter({ hasText: new RegExp(`^${name}$`) });
    const details = summary.locator("..");
    if (!(await details.evaluate((node) => node.open))) await summary.click();
    return details;
  }
  await page.goto(base);
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
  await openSection(page.locator("#spotkanie-1"), "Opcje spotkania");
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

  // The everyday admin view starts with one meeting and no settings form.
  await page.setViewportSize({ width: 1440, height: 1000 });
  const detail = `${base}/?view=detail&scenario=mixed&participants=1`;
  await page.goto(detail);
  const meetings = page.locator("details[data-course-meeting]");
  await expect(meetings).toHaveCount(5);
  await expect(page.locator("details[data-course-meeting][open]")).toHaveCount(
    1,
  );
  await expect(
    page.locator("#spotkanie-2 details[data-course-meeting]"),
  ).toHaveAttribute("open", "");
  const settings = page.locator("details").filter({
    has: page.locator(":scope > summary", {
      hasText: /^Warunki i ustawienia cyklu$/,
    }),
  });
  const history = page.locator("#historia");
  await expect(settings).not.toHaveAttribute("open", "");
  await expect(history).not.toHaveAttribute("open", "");
  await expect(
    page.locator("[data-course-enrollment] > details > summary"),
  ).toContainText("Do zapłaty:");
  await expect(
    page.locator("[data-course-enrollment] > details"),
  ).not.toHaveAttribute("open", "");
  await page.screenshot({
    path: resolve(output, "admin-course-1440.png"),
    fullPage: true,
  });

  // Direct UUID and ordinal destinations reveal the correct meeting. An
  // already-current fragment also works after a manual collapse.
  for (const hash of [
    "spotkanie-1",
    "spotkanie-82000000-0000-4000-8000-000000000003",
  ]) {
    await page.goto(`${detail}#${hash}`);
    const row = page.locator(
      hash === "spotkanie-1" ? "#spotkanie-1" : "#spotkanie-3",
    );
    const disclosure = row.locator("details[data-course-meeting]");
    await expect(disclosure).toHaveAttribute("open", "");
    await expect(
      page.locator("details[data-course-meeting][open]"),
    ).toHaveCount(1);
    await disclosure.locator(":scope > summary").click();
    // Controlled fixture link exercises repeated same-URL navigation.
    await page.evaluate((id) => {
      const link = document.createElement("a");
      link.href = `#${id}`;
      link.textContent = "Wróć do tego spotkania — test";
      link.id = "repeat-fragment";
      document.body.append(link);
    }, hash);
    await page.locator("#repeat-fragment").click();
    await expect(disclosure).toHaveAttribute("open", "");
    await page.locator("#repeat-fragment").evaluate((link) => link.remove());
  }

  await page.goto(`${detail}#historia`);
  await expect(history).toHaveAttribute("open", "");
  await expect(page.getByText("Fikcyjna historia kursu.")).toBeVisible();
  await page.goto(`${detail}&history=2`);
  await expect(history).toHaveAttribute("open", "");
  await page.goto(`${detail}#wplata-89000000-0000-4000-8000-000000000001`);
  await expect(
    page.getByText("Fikcyjna wpłata do sprawdzenia widoku."),
  ).toBeVisible();
  await page.goto(`${detail}#rozliczenie-86000000-0000-4000-8000-000000000001`);
  await expect(
    page.getByRole("heading", { name: "Rozliczenie kursu", exact: true }),
  ).toBeVisible();

  // Collapse while an action is pending: its acknowledgement must reopen
  // the right meeting and its options without losing the original version.
  await page.goto(`${base}/?view=detail`);
  const firstRow = page.locator("#spotkanie-1");
  await openSection(firstRow, "Opcje spotkania");
  await openSection(firstRow, "Zmień termin lub miejsce");
  const firstForm = page.getByRole("form", {
    name: "Termin spotkania 1",
    exact: true,
  });
  await firstForm
    .getByLabel("Powód zmiany dla opiekuna")
    .fill("Podtrzymana notatka testowa");
  for (const failed of [true, false]) {
    await page.evaluate((failure) => {
      window.courseDelay = 500;
      window.courseFailure = failure ? "Błąd lokalnej próby" : undefined;
    }, failed);
    await firstForm
      .getByRole("button", { name: "Zapisz termin i zbiórkę", exact: true })
      .click();
    await firstRow.locator("details[data-course-meeting] > summary").click();
    await expect(
      firstForm.getByRole(failed ? "alert" : "status"),
    ).toBeVisible();
    await expect(firstForm.getByLabel("Powód zmiany dla opiekuna")).toHaveValue(
      "Podtrzymana notatka testowa",
    );
  }

  // Participant disclosure is mounted even when closed. Each role can follow
  // the UUID/ordinal meeting links and deep finance anchors, including repeats.
  const enrollmentId = "86000000-0000-4000-8000-000000000001";
  for (const role of ["admin", "client"]) {
    const roleDetail = `${base}/?view=detail&scenario=mixed&participants=1&role=${role}`;
    await page.goto(roleDetail);
    const participant = page.locator(`[data-course-enrollment]`);
    const participantDetails = participant.locator(
      "details[data-course-enrollment-detail]",
    );
    await expect(participantDetails).not.toHaveAttribute("open", "");
    await expect(participantDetails.locator(":scope > summary")).toContainText(
      "Przyjęte",
    );
    await expect(participantDetails.locator(":scope > summary")).toContainText(
      "Do zapłaty:",
    );
    if (role === "admin")
      await expect(
        participantDetails.locator(":scope > summary"),
      ).toContainText("Szkic zaleceń");
    else {
      expect(
        await page
          .locator("#zgloszenia")
          .evaluate((element) =>
            Boolean(
              element.compareDocumentPosition(
                document.querySelector('[aria-label="Spotkania kursu"]'),
              ) & Node.DOCUMENT_POSITION_FOLLOWING,
            ),
          ),
      ).toBe(true);
      await expect(page.locator("#historia")).not.toHaveAttribute("open", "");
    }
    for (const hash of [
      "spotkanie-1",
      "spotkanie-82000000-0000-4000-8000-000000000003",
    ]) {
      await page.goto(`${roleDetail}#${hash}`);
      const target = page
        .locator(hash === "spotkanie-1" ? "#spotkanie-1" : "#spotkanie-3")
        .locator("details[data-course-meeting]");
      await expect(target).toHaveAttribute("open", "");
      await expect(
        page.locator("details[data-course-meeting][open]"),
      ).toHaveCount(1);
      await target.locator(":scope > summary").click();
      await page.evaluate((id) => {
        document.getElementById("repeat-course-anchor")?.remove();
        const a = document.createElement("a");
        a.id = "repeat-course-anchor";
        a.href = `#${id}`;
        a.textContent = "Ponownie ten termin";
        document.body.append(a);
      }, hash);
      await page.locator("#repeat-course-anchor").click();
      await expect(target).toHaveAttribute("open", "");
    }
    await page.goto(
      `${roleDetail}&enrollment=${enrollmentId}#rozliczenie-${enrollmentId}`,
    );
    await expect(participantDetails).toHaveAttribute("open", "");
    await expect(
      page.getByRole("heading", { name: "Rozliczenie kursu", exact: true }),
    ).toBeVisible();
    await participantDetails.locator(":scope > summary").click();
    await page.evaluate((id) => {
      document.getElementById("repeat-course-anchor")?.remove();
      const a = document.createElement("a");
      a.id = "repeat-course-anchor";
      a.href = `#rozliczenie-${id}`;
      a.textContent = "Ponownie rozliczenie";
      document.body.append(a);
    }, enrollmentId);
    await page.locator("#repeat-course-anchor").click();
    await expect(participantDetails).toHaveAttribute("open", "");
    expect(new URL(page.url()).searchParams.get("enrollment")).toBe(
      enrollmentId,
    );
    await page.goto(
      `${roleDetail}#wplata-89000000-0000-4000-8000-000000000001`,
    );
    await expect(
      page.getByText("Fikcyjna wpłata do sprawdzenia widoku."),
    ).toBeVisible();
    // Enrollment decisions use the existing forms and retain their sketch when
    // the entire participant is collapsed during an in-flight response.
    for (const kind of ["error", "warning", "success"]) {
      await page.goto(
        `${roleDetail}&feedback=${kind}#zgloszenie-${enrollmentId}`,
      );
      await openSection(
        participant,
        role === "admin" ? "Decyzja o zgłoszeniu" : "Rezygnacja z kursu",
      );
      const decision = participant.getByRole("form", {
        name: "Decyzja: Kluska — dane fikcyjne",
        exact: true,
      });
      await decision
        .locator('textarea[name="note"]')
        .fill("Zachowany powód rezygnacji.");
      await page.evaluate((kind) => {
        window.courseDelay = 400;
        window.courseFailure =
          kind === "error" ? "Błąd decyzji kursowej." : undefined;
        window.courseWarning = kind === "warning";
      }, kind);
      await decision
        .getByRole("button", { name: "Zapisz zmianę", exact: true })
        .click();
      await participantDetails.locator(":scope > summary").click();
      await expect(
        decision.getByRole(kind === "success" ? "status" : "alert"),
      ).toBeVisible();
      if (kind !== "success")
        await expect(decision.getByRole("alert")).toBeFocused();
      await expect(decision.locator('textarea[name="note"]')).toHaveValue(
        "Zachowany powód rezygnacji.",
      );
    }
  }
  // The custom money form has its own action state. Its response must reveal
  // both the payment disclosure and the enclosing participant before focus.
  for (const kind of ["error", "warning", "success"]) {
    await page.goto(
      `${detail}&payment-feedback=${kind}#rozliczenie-${enrollmentId}`,
    );
    const participant = page.locator("[data-course-enrollment]");
    const participantDetails = participant.locator(
      "details[data-course-enrollment-detail]",
    );
    await openSection(participant, "Odnotuj otrzymaną wpłatę");
    const paymentForm = participant.locator("form").filter({
      has: page.getByRole("button", { name: "Zapisz wpłatę", exact: true }),
    });
    await paymentForm
      .getByLabel("Notatka do wpłaty (opcjonalnie)")
      .fill("Potwierdzenie wpłaty.");
    await paymentForm.getByRole("checkbox").check();
    await page.evaluate((kind) => {
      window.courseDelay = 400;
      window.courseFailure =
        kind === "error" ? "Błąd zapisu wpłaty." : undefined;
      window.courseWarning = kind === "warning";
    }, kind);
    await paymentForm
      .getByRole("button", { name: "Zapisz wpłatę", exact: true })
      .click();
    await participantDetails.locator(":scope > summary").click();
    await expect(
      paymentForm.getByRole(kind === "success" ? "status" : "alert"),
    ).toBeVisible();
    if (kind !== "success")
      await expect(paymentForm.getByRole("alert")).toBeFocused();
    expect(await page.evaluate(() => window.courseCalls.at(-1))).toMatchObject({
      operation: "payment",
      values: {
        target_kind: "course",
        target_id: enrollmentId,
        amount: "60,00",
        note: "Potwierdzenie wpłaty.",
      },
    });
  }

  for (const role of ["admin", "client"]) {
    for (const [balance, expected] of [
      ["settlement", "Kwota po rezygnacji do uzgodnienia"],
      ["refund", "Do zwrotu: 27,00"],
      ["review", "Rozliczenie do sprawdzenia"],
    ]) {
      await page.goto(
        `${base}/?view=detail&participants=1&role=${role}&balance=${balance}`,
      );
      const summary = page.locator(
        "[data-course-enrollment] > details > summary",
      );
      await expect(summary).toContainText(expected);
      await expect(
        page.locator("[data-course-enrollment] > details"),
      ).not.toHaveAttribute("open", "");
    }
    await page.goto(`${base}/?view=detail&role=${role}&scenario=empty`);
    await expect(page.getByText("Brak zgłoszeń w tym widoku.")).toBeVisible();
    await expect(
      page.getByText("Ten cykl nie ma jeszcze spotkań."),
    ).toBeVisible();
  }

  let responsive = 0;
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    for (const scenario of [
      "future",
      "mixed",
      "overdue",
      "draft",
      "completed",
      "cancelled",
      "empty",
      "long",
    ]) {
      for (const role of ["admin", "client"]) {
        await page.goto(
          `${base}/?view=detail&scenario=${scenario}&role=${role}&participants=1`,
        );
        await page
          .getByRole("heading", { name: "Plan spotkań", exact: true })
          .waitFor();
        if (role === "admin" && scenario === "overdue")
          await expect(
            page.locator("#spotkanie-2 details > summary").first(),
          ).toContainText("Do uzupełnienia");
        if (role === "client")
          await expect(
            page.getByRole("form", {
              name: "Zmiana kursu",
              exact: true,
              includeHidden: true,
            }),
          ).toHaveCount(0);
        if (
          ["mixed", "overdue"].includes(scenario) &&
          [390, 1440].includes(width)
        )
          await page.screenshot({
            path: resolve(output, `${role}-${scenario}-${width}.png`),
            fullPage: true,
          });
        // Also check all controls when expanded, including settings/history.
        await page.locator("details").evaluateAll((nodes) => {
          nodes.forEach((node) => {
            node.removeAttribute("name");
            node.open = true;
          });
        });
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth > innerWidth + 1,
          ),
          `${role}/${scenario}/${width} overflow`,
        ).toBe(false);
        const clipped = await page
          .locator("input:not([type=hidden]),textarea,select,button")
          .evaluateAll((nodes) =>
            nodes
              .filter((node) => {
                const box = node.getBoundingClientRect();
                return (
                  box.width > 0 && (box.left < -1 || box.right > innerWidth + 1)
                );
              })
              .map((node) => node.outerHTML.slice(0, 100)),
          );
        expect(
          clipped,
          `${role}/${scenario}/${width} clipped controls`,
        ).toEqual([]);
        responsive++;
      }
    }
  }
  await page.goto(`${base}/?empty`);
  await expect(
    page.getByText("Brak aktywnej oferty kursu. Uzupełnij katalog usług."),
  ).toBeVisible();
  expect(errors).toEqual([]);
  console.log(
    `PASS: course forms, preserved drafts/versions, keyboard, compact meetings, direct/repeated anchors, action feedback and ${responsive} responsive detail scenarios; empty catalogue.`,
  );
} finally {
  await browser?.close();
}
