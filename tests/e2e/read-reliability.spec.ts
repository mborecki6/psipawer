import { expect, test } from "@playwright/test";
import { careFixture, publishCarePlan } from "./care-journey";

test.use({ trace: "off" });
test("authenticated reads keep inboxes and work available across repeated parallel page requests", async ({
  browser,
  baseURL,
}) => {
  test.setTimeout(180000);
  const f = await careFixture(browser, baseURL);
  try {
    await publishCarePlan(
      f.staff,
      "Plan do próby odczytów",
      "Fikcyjne zalecenia do sprawdzenia dostępności stron.",
    );
    await f.guardian.goto(`/app/dogs/${f.dog}/care`);
    const form = f.guardian.locator("#odpowiedz form");
    await form
      .getByLabel("Co udało się zrobić?", { exact: true })
      .fill("Fikcyjna odpowiedź do kolejki odczytów.");
    await form
      .getByRole("button", { name: "Przekaż odpowiedź prowadzącej" })
      .click();
    await expect(form.getByRole("status")).toContainText("Odpowiedź zapisana");
    // These are actual authenticated SSR requests, using the browser's cookies.
    // Only aggregate booleans are asserted; HTML, headers and tokens stay out
    // of failure output. This is a read reliability check, not a 50-user load claim.
    for (let batch = 0; batch < 24; batch++) {
      const results = await Promise.allSettled(
        Array.from({ length: 4 }, async (_, n) => {
          const staff = n % 2 === 0;
          const route = staff
            ? "/admin/work?filter=progress"
            : "/app/notifications";
          const page = staff ? f.staff : f.guardian;
          const response = await page.request.get(route, {
            maxRedirects: 0,
            timeout: 20000,
          });
          const html = await response.text();
          return {
            route,
            status: response.status(),
            expectedHeading: html.includes(
              staff ? "Sprawy do obsłużenia" : "Co nowego u Was?",
            ),
            errorBoundary: html.includes("Nie udało się wczytać danych"),
          };
        }),
      );
      for (const result of results) {
        expect(result.status).toBe("fulfilled");
        if (result.status !== "fulfilled")
          throw new Error("Authenticated page request did not complete.");
        expect(result.value).toEqual({
          route: result.value.route,
          status: 200,
          expectedHeading: true,
          errorBoundary: false,
        });
      }
    }
  } finally {
    await f.dispose();
  }
});
