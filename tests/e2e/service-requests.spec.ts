import { expect } from "@playwright/test";
import { careScreenshot } from "./care-journey";
import {
  test,
  account,
  checked,
  disposeCareFixtures,
  localClients,
  login,
} from "./local-fixtures";

test.use({ trace: "off" });
test("individual service date request: guardian → activities → staff note → guardian, with private history", async ({
  browser,
  baseURL,
}, testInfo) => {
  const { db, client } = localClients(baseURL);
  const users: string[] = [],
    dogs: string[] = [];
  const service = crypto.randomUUID(),
    name = `Indywidualny kurs terminu ${service.slice(0, 8)}`;
  const ownerContext = await browser.newContext({
    baseURL,
    viewport: { width: 390, height: 844 },
  });
  const adminContext = await browser.newContext({
    baseURL,
    viewport: { width: 1440, height: 1000 },
  });
  const otherContext = await browser.newContext({
    baseURL,
    viewport: { width: 390, height: 844 },
  });
  const guardian = await ownerContext.newPage(),
    staff = await adminContext.newPage(),
    stranger = await otherContext.newPage();
  const outsiderDb = client();
  try {
    const owner = await account(db, users, "client"),
      admin = await account(db, users, "admin"),
      outsider = await account(db, users, "client");
    const template = await checked(
      db
        .from("services")
        .select(
          "practice_id,price_cents,price_unit,duration_minutes,sessions_count,source_url,meeting_mode",
        )
        .eq("id", "60000000-0000-4000-8000-000000000003")
        .single(),
    );
    await checked(
      db.from("services").insert({
        ...template,
        id: service,
        name,
        kind: "course",
        course_format: "individual",
        booking_flow: "catalogue",
        active: true,
        is_test_price: true,
      }),
    );
    const dog = crypto.randomUUID();
    dogs.push(dog);
    await checked(
      db.from("dogs").insert({
        id: dog,
        guardian_id: owner.id,
        name: "Figa prośba o termin",
      }),
    );
    await checked(
      outsiderDb.auth.signInWithPassword({
        email: outsider.email,
        password: outsider.password,
      }),
    );
    await login(guardian, owner, "client");
    await guardian.goto("/app/calendar/offer?category=individual");
    const arrange = guardian
      .locator("article")
      .filter({ has: guardian.getByRole("heading", { name, exact: true }) })
      .getByRole("link", { name: "Uzgodnij termin →", exact: true });
    await arrange.focus();
    await guardian.keyboard.press("Enter");
    await expect(guardian).toHaveURL(
      new RegExp(`/app/services/${service}/request$`),
    );
    await guardian.getByLabel("Pies", { exact: true }).selectOption(dog);
    await guardian
      .getByLabel("W czym możemy Wam pomóc?")
      .fill("Prywatna wiadomość: proszę o spokojny kurs indywidualny.");
    await guardian
      .getByLabel("Kiedy możecie się spotkać? (opcjonalnie)")
      .fill("Wtorki po 17:00 i sobotnie poranki");
    await guardian
      .getByRole("button", {
        name: "Zgłoś potrzebę ustalenia terminu",
        exact: true,
      })
      .click();
    await expect(guardian).toHaveURL(/saved=[a-f0-9-]+/);
    const request = new URL(guardian.url()).searchParams.get("saved")!;
    const card = guardian.locator(`#request-${request}`);
    await expect(card).toContainText("Do ustalenia");
    await expect(card).toContainText("Wtorki po 17:00");
    await guardian.setViewportSize({ width: 320, height: 900 });
    await expect
      .poll(() =>
        guardian.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      )
      .toBe(true);
    await careScreenshot(
      guardian,
      testInfo.outputPath("request-client-320.png"),
      320,
    );

    expect(
      await checked(
        outsiderDb
          .from("service_requests")
          .select("id,message")
          .eq("id", request),
      ),
    ).toEqual([]);
    expect(
      await checked(
        outsiderDb
          .from("service_request_history")
          .select("id,note")
          .eq("request_id", request),
      ),
    ).toEqual([]);
    const forged = await outsiderDb.rpc("request_service_date", {
      p_request_id: crypto.randomUUID(),
      p_service: service,
      p_dog: dog,
      p_message: "Nieuprawnione zgłoszenie",
      p_availability: "",
    });
    expect(forged.error).toBeTruthy();
    await login(stranger, outsider, "client");
    await stranger.goto(`/app/services/${service}/request?saved=${request}`);
    await expect(
      stranger.getByText("Prywatna wiadomość:", { exact: false }),
    ).toHaveCount(0);
    await expect(
      stranger.getByRole("button", { name: "Wycofaj zgłoszenie", exact: true }),
    ).toHaveCount(0);
    await expect(
      stranger.getByText("Zgłoszenie zapisane.", { exact: false }),
    ).toHaveCount(0);

    await login(staff, admin, "admin");
    await staff.goto("/admin/activities");
    await staff
      .getByRole("link", { name: "Otwórz zgłoszenia →", exact: true })
      .click();
    await expect(staff).toHaveURL(/\/admin\/service-requests$/);
    const adminCard = staff.locator(`#request-${request}`);
    await expect(adminCard).toContainText("Figa prośba o termin");
    await expect(adminCard).toContainText("Wtorki po 17:00");
    await adminCard
      .getByLabel("Notatka dla opiekuna")
      .fill("Uzgodniono dalsze kroki. Termin potwierdzimy po wyborze cyklu.");
    await staff.setViewportSize({ width: 390, height: 900 });
    await expect
      .poll(() =>
        staff.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      )
      .toBe(true);
    await careScreenshot(
      staff,
      testInfo.outputPath("request-admin-390.png"),
      390,
    );
    await adminCard
      .getByRole("button", { name: "Oznacz jako załatwione", exact: true })
      .click();
    await expect(adminCard).toHaveCount(0);
    await staff.getByRole("link", { name: "Historia", exact: true }).click();
    await expect(staff.locator(`#request-${request}`)).toContainText(
      "Załatwione",
    );
    await guardian.reload();
    await expect(card).toContainText("Załatwione");
    await expect(card).toContainText(
      "Uzgodniono dalsze kroki. Termin potwierdzimy po wyborze cyklu.",
    );
    await card.getByText("Historia zgłoszenia", { exact: true }).click();
    await expect(card.locator("ol li")).toHaveCount(2);
    await expect(
      card.getByRole("button", { name: "Wycofaj zgłoszenie", exact: true }),
    ).toHaveCount(0);
    expect(
      await checked(db.from("courses").select("id").eq("service_id", service)),
    ).toEqual([]);
    expect(
      (
        await checked(
          db.from("services").select("price_cents").eq("id", service).single(),
        )
      )?.price_cents,
    ).toBe(template?.price_cents);
  } finally {
    await Promise.allSettled([
      ownerContext.close(),
      adminContext.close(),
      otherContext.close(),
      outsiderDb.auth.signOut(),
    ]);
    const requests = await checked(
      db.from("service_requests").select("id").eq("service_id", service),
    );
    const ids = requests?.map((request) => request.id) || [];
    if (ids.length) {
      await checked(
        db.from("service_request_receipts").delete().in("result_id", ids),
      );
      await checked(
        db.from("service_request_history").delete().in("request_id", ids),
      );
      await checked(db.from("service_requests").delete().in("id", ids));
    }
    await checked(
      db.from("service_revisions").delete().eq("service_id", service),
    );
    await checked(db.from("services").delete().eq("id", service));
    await disposeCareFixtures(db, users, dogs);
  }
});
