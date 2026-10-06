import { expect, test } from "@playwright/test";
import { courseFixture } from "./course-fixtures";
import { checked } from "./local-fixtures";
import { walkJourney } from "./walk-journey";
import { LocalPostgres } from "../helpers/local-postgres.mjs";
test.use({ trace: "off" });

test("a gift pays consultation, course and entry package in real panels and each service return restores the same card", async ({
  browser,
  baseURL,
}) => {
  const j = await walkJourney(browser, baseURL);
  const sql = await new LocalPostgres().ready();
  const courses: string[] = [],
    cards: string[] = [];
  try {
    const owner = await checked(j.ownerDb.auth.getUser());
    const pack = await j.createPackage(4);
    const cycle = await courseFixture(
      j.db,
      j.staffDb,
      j.ownerDb,
      j.dogs[0],
      courses,
      sql,
    );
    const service = "60000000-0000-4000-8000-000000000010";
    const terms = await checked(
      j.staffDb
        .from("services")
        .select("version,duration_minutes")
        .eq("id", service)
        .single(),
    );
    const consultation = crypto.randomUUID();
    await checked(
      j.ownerDb.rpc("request_consultation", {
        p_id: consultation,
        p_dog: j.dogs[0],
        p_service: service,
        p_expected_service_version: terms!.version,
        p_topic: "Fikcyjna konsultacja z karty",
        p_availability: "Popołudnia",
      }),
    );
    await checked(
      j.staffDb.rpc("change_consultation", {
        p_id: consultation,
        p_expected_version: 1,
        p_action: "schedule",
        p_starts_at: await j.freeStart("future"),
        p_duration: terms!.duration_minutes,
        p_mode: "in_person",
        p_location: "FIKCYJNE MIEJSCE PRÓBY KARTY",
        p_note: "Uzgodniony fikcyjny termin",
      }),
    );
    async function cashTotal() {
      await j.staff.goto("/admin/finance");
      const card = j.staff
        .getByRole("link")
        .filter({
          has: j.staff.getByText("Otrzymane wpłaty", { exact: true }),
        });
      await expect(card).toBeVisible();
      const text = (await card.locator("strong").innerText()).replace(
        /[^\d,]/g,
        "",
      );
      const parts = /^(\d+),(\d{2})$/.exec(text);
      expect(parts).toBeTruthy();
      return Number(parts![1]) * 100 + Number(parts![2]);
    }
    const originalCash = await cashTotal();
    await j.staff.goto("/admin/gifts/new");
    const issue = j.staff
      .locator("form")
      .filter({ has: j.staff.getByLabel("Rodzaj karty") });
    const card = await issue.locator('[name="id"]').inputValue();
    cards.push(card);
    await issue.getByLabel("Wartość karty (zł)").fill("300,00");
    await issue
      .getByLabel("Od kogo", { exact: true })
      .fill("Darczyńca próby usług");
    await issue
      .getByLabel("Dla kogo", { exact: true })
      .fill("Opiekun próby usług");
    await issue.getByLabel("Konto opiekuna").selectOption(owner.user!.id);
    await issue.getByRole("checkbox").check();
    await issue
      .getByRole("button", { name: "Potwierdź wpłatę i wystaw kartę" })
      .click();
    await expect(issue.getByRole("status")).toContainText("Karta wystawiona");
    expect(await cashTotal()).toBe(originalCash + 30000);
    const targets = [
      { kind: "consultation", id: consultation, column: "consultation_id" },
      { kind: "course", id: cycle.enrollment, column: "course_enrollment_id" },
      { kind: "package", id: pack, column: "package_id" },
    ];
    const balance = async () =>
      (await checked(
        j.ownerDb
          .from("gift_card_balances")
          .select("balance_cents,redeemed_cents,returned_cents")
          .eq("id", card)
          .single(),
      ))!;
    const payments: string[] = [];
    for (const [index, target] of targets.entries()) {
      await j.staff.goto(`/admin/gifts/${card}`);
      const form = j.staff
        .locator("form")
        .filter({ has: j.staff.getByLabel("Należność tego opiekuna") });
      await form
        .getByLabel("Należność tego opiekuna")
        .selectOption(`${target.kind}:${target.id}`);
      await form.getByLabel("Kwota z karty (zł)").fill("100,00");
      await form.getByRole("button", { name: "Rozlicz z salda karty" }).click();
      await expect(form.getByRole("status")).toContainText(
        "nie zapisano nowego wpływu",
      );
      expect((await balance()).balance_cents).toBe(20000 - index * 10000);
      const payment = await checked(
        j.ownerDb
          .from("payments")
          .select("id,amount_cents,method,gift_card_id")
          .eq(target.column, target.id)
          .single(),
      );
      expect(payment).toMatchObject({
        amount_cents: 10000,
        method: "gift_card",
        gift_card_id: card,
      });
      payments.push(payment!.id);
      expect(await cashTotal()).toBe(originalCash + 30000);
    }
    await j.guardian.goto(`/app/gifts/${card}`);
    await expect(
      j.guardian.getByText("Saldo wykorzystane", { exact: true }),
    ).toBeVisible();
    await j.refund(payments[0], "Fikcyjny zwrot konsultacji na tę samą kartę.");
    expect((await balance()).balance_cents).toBe(10000);
    await j.staff.goto(`/admin/courses/${cycle.id}`);
    await j.staff
      .getByText("Historia wpłat i zwrotów (1)", { exact: true })
      .click();
    await j.staff
      .getByText("Odnotuj zwrot tej wpłaty", { exact: true })
      .click();
    const refund = j.staff
      .locator("form")
      .filter({ has: j.staff.getByLabel("Kwota przywracana na kartę (zł)") });
    await refund.getByLabel("Kwota przywracana na kartę (zł)").fill("100,00");
    await refund
      .getByLabel("Powód zwrotu")
      .fill("Fikcyjny zwrot kursu na tę samą kartę.");
    await refund.getByRole("checkbox").check();
    await refund
      .getByRole("button", { name: "Odnotuj zwrot", exact: true })
      .click();
    await expect(refund.getByRole("status")).toContainText("Zwrot odnotowany");
    expect((await balance()).balance_cents).toBe(20000);
    await j.refund(
      payments[2],
      "Fikcyjny zwrot nieużytego pakietu na tę samą kartę.",
    );
    expect(await balance()).toMatchObject({
      balance_cents: 30000,
      redeemed_cents: 30000,
      returned_cents: 30000,
    });
    expect(await cashTotal()).toBe(originalCash + 30000);
    await j.guardian.goto(`/app/gifts/${card}`);
    await expect(
      j.guardian.getByText("Zwrot na saldo karty", { exact: true }),
    ).toHaveCount(3);
    expect(
      await checked(
        j.otherDb.from("gift_card_balances").select("id").eq("id", card),
      ),
    ).toEqual([]);
  } finally {
    if (cards.length) {
      await checked(j.db.from("payments").delete().in("gift_card_id", cards));
      await checked(j.db.from("gift_cards").delete().in("id", cards));
    }
    if (courses.length)
      await checked(j.db.from("courses").delete().in("id", courses));
    await sql.close();
    await j.dispose();
  }
});
