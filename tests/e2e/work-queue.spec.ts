import { expect, test } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { checked } from "./local-fixtures";
import { walkJourney } from "./walk-journey";
import {
  workHref,
  workKinds,
  type WorkItem,
} from "../../src/modules/work/types";
test.use({ trace: "off" });

test("all six staff queue filters keep global counts, paginate and open the correct cases on a phone", async ({
  browser,
  baseURL,
}) => {
  const j = await walkJourney(browser, baseURL);
  const packages: string[] = [];
  try {
    const baseline = await checked(j.staffDb.rpc("staff_work_counts"));
    const dog = j.dogs[0];
    const owner = await checked(j.ownerDb.auth.getUser());
    const profiles = Array.from({ length: 23 }, () => crypto.randomUUID());
    j.dogs.push(...profiles);
    await checked(
      j.db
        .from("dogs")
        .insert(
          profiles.map((id, n) => ({
            id,
            guardian_id: owner.user!.id,
            name: `Profil kolejki ${n + 1} ${j.suffix}`,
          })),
        ),
    );
    const service = "60000000-0000-4000-8000-000000000010";
    const fitnessService = "60000000-0000-4000-8000-000000000006";
    const terms = await checked(
      j.staffDb
        .from("services")
        .select("id,version")
        .in("id", [service, fitnessService]),
    );
    const consultation = crypto.randomUUID(),
      pack = crypto.randomUUID();
    packages.push(pack);
    await checked(
      j.ownerDb.rpc("request_consultation", {
        p_id: consultation,
        p_dog: dog,
        p_topic: "Fikcyjne zgłoszenie z kolejki",
        p_availability: "Popołudnia",
        p_service: service,
        p_expected_service_version: terms!.find((t) => t.id === service)!
          .version,
      }),
    );
    await checked(
      j.ownerDb.rpc("request_fitness_package", {
        p_id: pack,
        p_dog: dog,
        p_topic: "Fikcyjny pakiet z kolejki",
        p_availability: "Popołudnia",
        p_service: fitnessService,
        p_expected_service_version: terms!.find((t) => t.id === fitnessService)!
          .version,
      }),
    );
    const yesterday = new Intl.DateTimeFormat("sv-SE", {
      timeZone: "Europe/Warsaw",
    }).format(new Date(Date.now() - 86400000));
    const publication = await checked(
      j.staffDb.rpc("save_care_plan", {
        p_dog: dog,
        p_expected_version: 0,
        p_title: "Fikcyjny plan kolejki",
        p_body: "Fikcyjna treść bez zaleceń specjalistycznych.",
        p_follow_up_on: yesterday,
        p_publish: true,
      }),
    );
    const response = crypto.randomUUID();
    await checked(
      j.ownerDb.rpc("submit_care_progress", {
        p_id: response,
        p_plan: publication.published_id,
        p_attempted: "Fikcyjna odpowiedź do sprawdzenia kolejki.",
        p_went_well: "",
        p_difficult: "",
      }),
    );
    const walk = await j.createWalk("Spacer kolejki"),
      registration = await j.submit(walk);
    const expected = {
      profiles: 23,
      consultations: 1,
      fitness: 1,
      followups: 1,
      progress: 1,
      walks: 1,
    };
    const counts = await checked(j.staffDb.rpc("staff_work_counts"));
    for (const [kind, increase] of Object.entries(expected))
      expect(
        Number(
          counts.find((c: { kind: string }) => c.kind === kind)?.total || 0,
        ),
      ).toBe(
        Number(
          baseline.find((c: { kind: string }) => c.kind === kind)?.total || 0,
        ) + increase,
      );
    const total = counts.reduce(
      (sum: number, c: { total: number }) => sum + Number(c.total),
      0,
    );
    const nav = j.staff.getByRole("navigation", { name: "Rodzaj sprawy" });
    async function checkNav() {
      await expect(
        nav.getByRole("link", { name: `Wszystkie ${total}`, exact: true }),
      ).toBeVisible();
      for (const [kind, label] of Object.entries(workKinds))
        await expect(
          nav.getByRole("link", {
            name: `${label} ${counts.find((c: { kind: string }) => c.kind === kind)?.total || 0}`,
            exact: true,
          }),
        ).toBeVisible();
    }
    await j.staff.goto("/admin/work");
    await checkNav();
    await expect(
      j.staff.getByText("Po terminie", { exact: true }),
    ).toBeVisible();
    const items = j.staff.locator("article.card.pad a");
    await expect(items).toHaveCount(20);
    await j.staff
      .getByRole("link", { name: "Następne →", exact: true })
      .click();
    await expect(j.staff).toHaveURL(/filter=all&page=2$/);
    await checkNav();
    for (const [kind, label] of Object.entries(workKinds)) {
      await nav.getByRole("link", { name: new RegExp(`^${label} `) }).click();
      await expect(j.staff).toHaveURL(new RegExp(`filter=${kind}&page=1$`));
      await expect(nav.locator('[aria-current="page"]')).toContainText(label);
      await checkNav();
      const result = await checked(
        j.staffDb.rpc("staff_work_queue", { p_filter: kind, p_offset: 0 }),
      );
      await expect(items).toHaveCount(Math.min(result.length, 20));
      const paths = await items.evaluateAll((a) =>
        a.map((link) => link.getAttribute("href")),
      );
      expect(paths).toEqual(
        result.slice(0, 20).map((row: WorkItem) => workHref(row)),
      );
      expect(
        await j.staff.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
    }
    await j.staff.goto("/admin/work?filter=profiles");
    const firstPage = await items.evaluateAll((a) =>
      a.map((link) => link.getAttribute("href")),
    );
    await j.staff
      .getByRole("link", { name: "Następne →", exact: true })
      .click();
    await expect(j.staff).toHaveURL(/filter=profiles&page=2$/);
    await checkNav();
    const secondPage = await items.evaluateAll((a) =>
      a.map((link) => link.getAttribute("href")),
    );
    expect(secondPage.length).toBeGreaterThan(0);
    expect(secondPage.every((path) => !firstPage.includes(path))).toBe(true);
    await j.staff
      .getByRole("link", { name: "← Poprzednie", exact: true })
      .click();
    await expect(j.staff).toHaveURL(/filter=profiles&page=1$/);
    expect(
      await items.evaluateAll((a) =>
        a.map((link) => link.getAttribute("href")),
      ),
    ).toEqual(firstPage);
    await j.staff.goto("/admin/work?filter=walks");
    await j.staff
      .locator(`a[href="/admin/walks/${walk}#registration-${registration}"]`)
      .click();
    await expect(
      j.staff.locator(`#registration-${registration}`),
    ).toBeVisible();
    await j.staff.goto("/admin/work?filter=consultations");
    await j.staff
      .locator(`a[href="/admin/consultations/${consultation}"]`)
      .click();
    await expect(
      j.staff.getByText("Fikcyjne zgłoszenie z kolejki", { exact: true }),
    ).toBeVisible();
    await j.staff.goto("/admin/work?filter=fitness");
    await j.staff.locator(`a[href="/admin/fitness/${pack}"]`).click();
    await expect(
      j.staff.getByText("Fikcyjny pakiet z kolejki", { exact: true }),
    ).toBeVisible();
    // Opening filters and cases does not resolve or mutate any work item.
    expect(await checked(j.staffDb.rpc("staff_work_counts"))).toEqual(counts);
    for (const api of [j.ownerDb, j.otherDb])
      expect(
        (await api.rpc("staff_work_queue", { p_filter: "all", p_offset: 0 }))
          .error,
      ).toBeTruthy();
    await j.staff.goto("/admin/work");
    mkdirSync("output/work", { recursive: true });
    for (const width of [320, 390, 1440]) {
      await j.staff.setViewportSize({ width, height: 900 });
      await expect(
        j.staff.getByRole("heading", {
          name: "Sprawy do obsłużenia",
          exact: true,
        }),
      ).toBeVisible();
      expect(
        await j.staff.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      await j.staff.screenshot({
        path: `output/work/kolejka-${width}.png`,
        fullPage: true,
      });
    }
  } finally {
    if (packages.length)
      await checked(j.db.from("fitness_packages").delete().in("id", packages));
    await j.dispose();
  }
});
