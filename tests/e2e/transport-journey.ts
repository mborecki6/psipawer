import { expect, type Locator, type Page, type Route } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { checked, test } from "./local-fixtures";

export async function assertRetainedLayout(page: Page, form: Locator) {
  const initialViewport = page.viewportSize();
  const values = () =>
    form.locator("input,select,textarea").evaluateAll((elements) =>
      elements.map((node) => {
        const field = node as HTMLInputElement;
        return {
          name: field.name,
          type: field.type,
          value: field.value,
          checked: field.checked,
        };
      }),
    );
  const draft = await values();
  try {
    for (const width of [320, 390, 768, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await page.evaluate(async () => {
        await document.fonts.ready;
        await new Promise(requestAnimationFrame);
      });
      expect(await values()).toEqual(draft);
      const horizontal = await form.evaluate((element) => {
        const fields = [
          element,
          ...element.querySelectorAll("fieldset,input,select,textarea"),
        ].filter((node) => node.getClientRects().length > 0);
        return {
          documentFits: document.documentElement.scrollWidth <= innerWidth + 1,
          bodyFits: document.body.scrollWidth <= innerWidth + 1,
          fieldsFit: fields.every((node) => {
            const rect = node.getBoundingClientRect();
            return rect.left >= -1 && rect.right <= innerWidth + 1;
          }),
        };
      });
      expect(horizontal, `Retained form at ${width}px`).toEqual({
        documentFits: true,
        bodyFits: true,
        fieldsFit: true,
      });
      for (const control of [
        form.getByRole("alert"),
        form.locator("button").last(),
      ]) {
        await control.scrollIntoViewIfNeeded();
        await expect(control).toBeVisible();
        expect(
          await control.evaluate((element) => {
            const rect = element.getBoundingClientRect();
            const header = document
              .querySelector(".topbar")
              ?.getBoundingClientRect();
            const hit = document.elementFromPoint(
              rect.left + rect.width / 2,
              rect.top + rect.height / 2,
            );
            return {
              inViewport: rect.top >= -1 && rect.bottom <= innerHeight + 1,
              coveredByHeader: Boolean(
                header &&
                rect.left < header.right &&
                rect.right > header.left &&
                rect.top < header.bottom &&
                rect.bottom > header.top,
              ),
              reachable: hit !== null && element.contains(hit),
            };
          }),
          `Feedback/submit after scrolling at ${width}px`,
        ).toEqual({
          inViewport: true,
          coveredByHeader: false,
          reachable: true,
        });
      }
      if (width === 390 || width === 1440)
        await page.screenshot({
          path: test.info().outputPath(`retained-form-${width}.png`),
          fullPage: true,
          animations: "disabled",
        });
    }
  } finally {
    if (initialViewport) await page.setViewportSize(initialViewport);
  }
}

// The real action commits, and a separate API read proves that commit before
// its HTTP confirmation is lost. No business response is mocked or fulfilled.
export async function loseCommittedReply(
  page: Page,
  form: Locator,
  marker: string,
  assertCommitted: () => Promise<void>,
) {
  const current = new URL(page.url());
  const match = (url: URL) =>
    url.origin === current.origin && url.pathname === current.pathname;
  let intercepted = false;
  let resolve!: () => void;
  let reject!: (reason: unknown) => void;
  const committed = new Promise<void>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  // A route callback can fail before the test reaches its await below.
  void committed.catch(() => {});
  const handler = async (route: Route) => {
    const request = route.request();
    if (
      intercepted ||
      request.method() !== "POST" ||
      !request.headers()["next-action"] ||
      !request.postData()?.includes(marker)
    )
      return route.continue();
    intercepted = true;
    try {
      await expect(form.locator("button").last()).toBeDisabled();
      const response = await route.fetch({ maxRedirects: 0 });
      expect(response.status()).toBe(200);
      await assertCommitted();
      resolve();
    } catch (error) {
      reject(error);
    } finally {
      await route.abort("failed");
    }
  };
  await page.route(match, handler);
  try {
    await form.locator("button").last().click();
    await expect.poll(() => intercepted).toBe(true);
    await committed;
    const error = form.getByRole("alert");
    await expect(error).toContainText("Nie udało się potwierdzić zapisu");
    await expect(error).toBeFocused();
    await expect(form.getByRole("status")).toHaveCount(0);
    await expect(form.locator("button").last()).toBeEnabled();
    await assertRetainedLayout(page, form);
  } finally {
    await page.unroute(match, handler);
  }
}

export async function noticesAndAudit(
  db: SupabaseClient,
  id: string,
  event: string,
  kind: string,
  column = "entity_id",
) {
  const audit = await checked(
    db
      .from("audit_events")
      .select("id")
      .eq("entity_id", id)
      .eq("event", event)
      .order("id"),
  );
  const notices = await checked(
    db
      .from("notifications")
      .select("id,recipient_id,source_key")
      .eq(column, id)
      .eq("kind", kind)
      .order("id"),
  );
  expect(audit).toHaveLength(1);
  expect(notices!.length).toBeGreaterThan(0);
  return { audit, notices };
}
