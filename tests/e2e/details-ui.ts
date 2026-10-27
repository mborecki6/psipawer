import { expect, type Locator } from "@playwright/test";

// Open only ancestors of the control needed by this action, using the same
// visible summaries as the user. Assertions of initial hierarchy stay separate.
export async function revealFor(control: Locator) {
  await control.waitFor({ state: "attached" });
  for (let attempt = 0; attempt < 12; attempt++) {
    // The reverse XPath axis chooses the outermost closed ancestor. A visible
    // summary may still be waiting for the first layout after navigation;
    // click auto-waits, whereas a one-shot isVisible can incorrectly give up.
    const summary = control.locator(
      "xpath=ancestor::details[not(@open)][last()]/summary[1]",
    );
    if (!(await summary.count())) break;
    await summary.click();
  }
  await expect(control).toBeVisible();
  return control;
}
