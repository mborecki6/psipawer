import { expect, test, type Page } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import {
  LocalPostgres,
  literal as q,
  waitForLock,
} from "../helpers/local-postgres.mjs";
import { careFixture, careScreenshot } from "./care-journey";
import { courseFixture, removeCourseCare } from "./course-fixtures";
import {
  account,
  checked,
  disposeCareFixtures,
  localClients,
} from "./local-fixtures";

test.use({ trace: "off" });
async function reopening(page: Page) {
  await page
    .getByText("Ponowna decyzja lub przywrócenie udziału", { exact: true })
    .click();
  return page.getByRole("form", { name: "Powrót do zgłoszenia", exact: true });
}

test("course return: capacity error, retained stale form, frozen quote and partial refund, reconsideration without a seat", async ({
  browser,
  baseURL,
}) => {
  const f = await careFixture(browser, baseURL),
    courses: string[] = [],
    extraDogs: string[] = [];
  const sql = await new LocalPostgres().ready();
  try {
    await mkdir("output/course-reopening", { recursive: true });
    const cycle = await courseFixture(
      f.db,
      f.staffDb,
      f.ownerDb,
      f.dog,
      courses,
      sql,
    );
    const request = (id: string, dog: string) =>
      checked(
        f.ownerDb.rpc("request_course_enrollment", {
          p_id: id,
          p_course: cycle.id,
          p_dog: dog,
          p_expected_course_version: 2,
        }),
      );
    const decision = (id: string, version: number, action: string, note = "") =>
      checked(
        f.staffDb.rpc("change_course_enrollment", {
          p_id: id,
          p_expected_version: version,
          p_action: action,
          p_note: note,
        }),
      );
    const plan = await checked(
      f.staffDb.rpc("save_care_plan", {
        p_dog: f.dog,
        p_expected_version: 0,
        p_title: "Plan przed rezygnacją",
        p_body: "Zachowane zalecenia uczestnika",
        p_follow_up_on: null,
        p_publish: true,
        p_consultation: null,
        p_course_enrollment: cycle.enrollment,
        p_course_session: null,
      }),
    );
    const payment = await checked(
      f.staffDb.rpc("record_payment", {
        p_registration: null,
        p_package: null,
        p_amount_cents: 4000,
        p_method: "transfer",
        p_note: "Pierwsza wpłata",
        p_request_id: crypto.randomUUID(),
        p_consultation: null,
        p_course_enrollment: cycle.enrollment,
      }),
    );
    await decision(cycle.enrollment, 3, "cancel", "Rezygnacja do testu");
    await checked(
      f.staffDb.rpc("settle_course_enrollment", {
        p_id: cycle.enrollment,
        p_expected_version: 4,
        p_amount_cents: 3000,
        p_note: "Uzgodniona należność po rezygnacji",
        p_request_id: crypto.randomUUID(),
      }),
    );
    await checked(
      f.staffDb.rpc("refund_course_payment", {
        p_payment: payment,
        p_amount_cents: 1000,
        p_note: "Zwrot nadwyżki",
        p_request_id: crypto.randomUUID(),
      }),
    );
    const settlements = await checked(
      f.db
        .from("course_settlement_receipts")
        .select("*")
        .eq("enrollment_id", cycle.enrollment),
    );
    const refunds = await checked(
      f.db
        .from("course_payment_refunds")
        .select("*")
        .eq("enrollment_id", cycle.enrollment),
    );
    const extraEnrollments: string[] = [];
    for (let n = 0; n < 3; n++) {
      const dog = await checked(
        f.db
          .from("dogs")
          .insert({ name: `Powrót do kursu ${n}`, guardian_id: f.owner.id })
          .select("id")
          .single(),
      );
      extraDogs.push(dog!.id);
      const id = crypto.randomUUID();
      extraEnrollments.push(id);
      await request(id, dog!.id);
      if (n < 2) await decision(id, 1, "accept");
    }
    const url = `/admin/courses/${cycle.id}?enrollment=${cycle.enrollment}`;
    await f.staff.goto(url);
    const form = await reopening(f.staff),
      stale = await f.staffContext.newPage();
    await stale.goto(url);
    const oldForm = await reopening(stale);
    await oldForm
      .getByLabel("Powód powrotu do zgłoszenia")
      .fill("Treść starszej karty powrotu");
    await expect(form).toContainText("100");
    await expect(form).toContainText("Dotychczasowe wpłaty i zwroty pozostają");
    await form
      .getByLabel("Powód powrotu do zgłoszenia")
      .fill("Uzgodniony powrót po zwrocie");
    await form
      .getByRole("button", { name: "Przywróć udział na kursie", exact: true })
      .click();
    await expect(form.getByRole("alert")).toContainText("Brak wolnych miejsc");
    await expect(form.getByLabel("Powód powrotu do zgłoszenia")).toHaveValue(
      "Uzgodniony powrót po zwrocie",
    );
    await careScreenshot(
      f.staff,
      "output/course-reopening/capacity-320.png",
      320,
    );
    await form.screenshot({
      path: "output/course-reopening/capacity-form-320.png",
    });
    await decision(
      extraEnrollments[0],
      2,
      "cancel",
      "Zwolnienie miejsca dla powrotu",
    );
    await form
      .getByRole("button", { name: "Przywróć udział na kursie", exact: true })
      .click();
    await expect(form.getByRole("status")).toContainText("Udział przywrócony");
    await expect(
      form.getByRole("button", {
        name: "Przywróć udział na kursie",
        exact: true,
      }),
    ).toBeDisabled();
    await oldForm
      .getByRole("button", { name: "Przywróć udział na kursie", exact: true })
      .click();
    await expect(oldForm.getByRole("alert")).toContainText(
      "Zgłoszenie zmieniło",
    );
    await expect(oldForm.getByLabel("Powód powrotu do zgłoszenia")).toHaveValue(
      "Treść starszej karty powrotu",
    );
    await careScreenshot(stale, "output/course-reopening/stale-390.png", 390);
    await oldForm.screenshot({
      path: "output/course-reopening/stale-form-390.png",
    });
    await stale.close();
    expect(
      await checked(
        f.db
          .from("course_settlement_receipts")
          .select("*")
          .eq("enrollment_id", cycle.enrollment),
      ),
    ).toEqual(settlements);
    expect(
      await checked(
        f.db
          .from("course_payment_refunds")
          .select("*")
          .eq("enrollment_id", cycle.enrollment),
      ),
    ).toEqual(refunds);
    const balance = await checked(
      f.ownerDb
        .from("course_balances")
        .select("*")
        .eq("id", cycle.enrollment)
        .single(),
    );
    expect(balance).toMatchObject({
      status: "accepted",
      version: 7,
      charge_cents: 10000,
      agreed_price_cents: 10000,
      paid_cents: 3000,
      refunded_cents: 1000,
      due_cents: 7000,
      needs_review: false,
    });
    const plans = await checked(
      f.ownerDb
        .from("care_plan_versions")
        .select("id,body")
        .eq("id", plan.published_id),
    );
    expect(plans).toEqual([
      { id: plan.published_id, body: "Zachowane zalecenia uczestnika" },
    ]);
    const jobs = await checked(
      f.db
        .from("reminder_jobs")
        .select("id")
        .eq("course_enrollment_id", cycle.enrollment)
        .eq("status", "pending"),
    );
    expect(jobs).toHaveLength(5);
    await checked(
      f.staffDb.rpc("record_payment", {
        p_registration: null,
        p_package: null,
        p_amount_cents: 7000,
        p_method: "transfer",
        p_note: "Pozostała należność po powrocie",
        p_request_id: crypto.randomUUID(),
        p_consultation: null,
        p_course_enrollment: cycle.enrollment,
      }),
    );
    await f.guardian.goto(
      `/app/courses/${cycle.id}?enrollment=${cycle.enrollment}`,
    );
    await expect(
      f.guardian.getByText("Przywrócony udział na kursie", { exact: true }),
    ).toBeVisible();
    await expect(
      f.guardian.getByRole("form", { name: "Powrót do zgłoszenia" }),
    ).toHaveCount(0);
    const meetingPoint = f.guardian
      .locator("#spotkanie-1 p")
      .filter({ hasText: "Dokładna zbiórka" });
    await expect(meetingPoint).toBeVisible();
    await expect(meetingPoint).toContainText("FIKCYJNA ZBIÓRKA");
    expect(
      await checked(
        f.ownerDb
          .from("course_session_private_details")
          .select("exact_location")
          .in(
            "session_id",
            cycle.sessions.map((s) => s.id),
          ),
      ),
    ).toEqual(
      Array.from({ length: 5 }, () => ({ exact_location: "FIKCYJNA ZBIÓRKA" })),
    );
    await careScreenshot(
      f.guardian,
      "output/course-reopening/guardian-390.png",
      390,
    );
    await f.guardian.locator("#zgloszenia").screenshot({
      path: "output/course-reopening/guardian-balance-390.png",
      // Exclude fixed navigation from this long element capture only.
      // The full-page screenshot above retains the actual navigation.
      style:
        ".topbar,.topbar *,.skip-link { visibility: hidden !important; transition: none !important; }",
      animations: "disabled",
    });
    const refusalUrl = `/admin/courses/${cycle.id}?enrollment=${extraEnrollments[2]}`;
    await f.staff.goto(refusalUrl);
    await f.staff.getByText("Decyzja o zgłoszeniu", { exact: true }).click();
    const command = f.staff.getByRole("form", {
      name: "Decyzja: Powrót do kursu 2",
      exact: true,
    });
    await command.getByRole("combobox").selectOption("reject");
    await command
      .getByLabel("Powód dla opiekuna")
      .fill("Najpierw uzgodnienie powrotu");
    await command
      .getByRole("button", { name: "Zapisz zmianę", exact: true })
      .click();
    await expect(command.getByRole("status")).toContainText("Decyzja zapisana");
    // A fresh reopening editor appears after this page's own refusal without
    // inheriting the earlier requested version or losing success on revalidate.
    const reconsider = await reopening(f.staff);
    await reconsider
      .getByLabel("Powód powrotu do zgłoszenia")
      .fill("Możemy ponownie rozpatrzyć zgłoszenie");
    await reconsider
      .getByRole("button", {
        name: "Wróć do decyzji o zgłoszeniu",
        exact: true,
      })
      .click();
    await expect(reconsider.getByRole("status")).toContainText(
      "Zgłoszenie wróciło do decyzji",
    );
    await reconsider.screenshot({
      path: "output/course-reopening/reconsidered-form-320.png",
    });
    expect(
      await checked(
        f.ownerDb
          .from("course_balances")
          .select("status,version,charge_cents,due_cents,can_pay")
          .eq("id", extraEnrollments[2])
          .single(),
      ),
    ).toMatchObject({
      status: "requested",
      version: 3,
      charge_cents: 0,
      due_cents: 0,
      can_pay: false,
    });
    expect(
      await checked(
        f.db
          .from("course_enrollments")
          .select("id")
          .eq("course_id", cycle.id)
          .eq("status", "accepted"),
      ),
    ).toHaveLength(2);
    expect(
      await checked(
        f.db
          .from("reminder_jobs")
          .select("id")
          .eq("course_enrollment_id", extraEnrollments[2]),
      ),
    ).toEqual([]);
    expect(
      (
        await f.ownerDb.rpc("reopen_course_enrollment", {
          p_id: extraEnrollments[2],
          p_expected_version: 3,
          p_action: "reconsider",
          p_note: "Fałszywy powrót",
        })
      ).error,
    ).toBeTruthy();
    expect(
      await checked(f.outsiderDb.from("course_reopening_receipts").select("*")),
    ).toEqual([]);
  } finally {
    await sql.close();
    try {
      await checked(
        f.db
          .from("payments")
          .delete()
          .in("dog_id", [f.dog, ...extraDogs]),
      );
      await removeCourseCare(f.db, [f.dog, ...extraDogs], courses);
    } finally {
      try {
        await disposeCareFixtures(f.db, [], extraDogs);
      } finally {
        await f.dispose();
      }
    }
  }
});

test("course return: real locks against acceptance, refund, cycle cancellation, retry and dog transfer", async ({
  baseURL,
}) => {
  const { db, client } = localClients(baseURL),
    staff = client(),
    ownerApi = client();
  const users: string[] = [],
    dogs: string[] = [],
    courses: string[] = [];
  const observer = await new LocalPostgres().ready();
  try {
    const admin = await account(db, users, "admin"),
      owner = await account(db, users, "client"),
      newOwner = await account(db, users, "client");
    for (const [api, user] of [
      [staff, admin],
      [ownerApi, owner],
    ] as const)
      await checked(
        api.auth.signInWithPassword({
          email: user.email,
          password: user.password,
        }),
      );
    for (let n = 0; n < 2; n++) {
      const dog = await checked(
        db
          .from("dogs")
          .insert({ name: `Blokady powrotu ${n}`, guardian_id: owner.id })
          .select("id")
          .single(),
      );
      dogs.push(dog!.id);
    }
    const make = () =>
      courseFixture(db, staff, ownerApi, dogs[0], courses, observer);
    const cancel = (id: string, version = 2) =>
      checked(
        staff.rpc("change_course_enrollment", {
          p_id: id,
          p_expected_version: version,
          p_action: "cancel",
          p_note: "Rezygnacja do próby",
        }),
      );
    const restore = (id: string, version = 3) =>
      `select public.reopen_course_enrollment(${q(id)},${version},'restore','Uzgodniony powrót');`;
    async function race(
      firstSQL: string,
      secondSQL: string,
      rootFirst = false,
    ) {
      const first = await new LocalPostgres().ready(),
        second = await new LocalPostgres().ready();
      let pending: Promise<{ error: unknown; result?: string[] }> | undefined;
      try {
        if (rootFirst) await first.query("begin;");
        else await first.asUser(admin.id);
        await second.asUser(admin.id);
        await first.query(firstSQL);
        pending = second.query(secondSQL).then(
          (result) => ({ error: null, result }),
          (error) => ({ error }),
        );
        await waitForLock(observer, first, second);
        await first.query("commit;");
        const result = await pending;
        if (!result.error) await second.query("commit;");
        return result;
      } finally {
        await Promise.all([first.close(), second.close()]);
        if (pending) await pending;
      }
    }
    for (const restoreFirst of [true, false]) {
      const c = await make();
      await cancel(c.enrollment);
      await checked(
        staff.rpc("edit_course", {
          p_id: c.id,
          p_expected_version: 2,
          p_title: "Jedno miejsce powrotu",
          p_capacity: 1,
          p_note: "Próba ostatniego miejsca",
          p_request_id: crypto.randomUUID(),
        }),
      );
      const second = crypto.randomUUID();
      await checked(
        ownerApi.rpc("request_course_enrollment", {
          p_id: second,
          p_course: c.id,
          p_dog: dogs[1],
          p_expected_course_version: 3,
        }),
      );
      const accept = `select public.change_course_enrollment(${q(second)},1,'accept','');`;
      const result = await race(
        restoreFirst ? restore(c.enrollment) : accept,
        restoreFirst ? accept : restore(c.enrollment),
      );
      expect(String(result.error)).toContain("Brak wolnych miejsc");
      expect(
        await checked(
          staff
            .from("course_enrollments")
            .select("id")
            .eq("course_id", c.id)
            .eq("status", "accepted"),
        ),
      ).toHaveLength(1);
    }
    for (const restoreFirst of [true, false]) {
      const c = await make();
      await cancel(c.enrollment);
      const close = `select public.change_course(${q(c.id)},2,'cancel','Odwołanie cyklu');`;
      const result = await race(
        restoreFirst ? restore(c.enrollment) : close,
        restoreFirst ? close : restore(c.enrollment),
      );
      if (restoreFirst) expect(result.error).toBeNull();
      else expect(String(result.error)).toContain("aktywnego kursu");
      expect(
        await checked(
          staff
            .from("course_enrollments")
            .select("status")
            .eq("id", c.enrollment)
            .single(),
        ),
      ).toMatchObject({ status: "cancelled" });
      expect(
        await checked(
          db
            .from("reminder_jobs")
            .select("id")
            .eq("course_enrollment_id", c.enrollment)
            .eq("status", "pending"),
        ),
      ).toEqual([]);
    }
    for (const restoreFirst of [true, false]) {
      const c = await make();
      const pay = await checked(
        staff.rpc("record_payment", {
          p_registration: null,
          p_package: null,
          p_amount_cents: 4000,
          p_method: "cash",
          p_note: "Wpłata do próby",
          p_request_id: crypto.randomUUID(),
          p_consultation: null,
          p_course_enrollment: c.enrollment,
        }),
      );
      await cancel(c.enrollment, 3);
      await checked(
        staff.rpc("settle_course_enrollment", {
          p_id: c.enrollment,
          p_expected_version: 4,
          p_amount_cents: 3000,
          p_note: "Uzgodniona cena",
          p_request_id: crypto.randomUUID(),
        }),
      );
      const refund = `select public.refund_course_payment(${q(pay)},1000,'Zwrot nadwyżki',${q(crypto.randomUUID())});`;
      const result = await race(
        restoreFirst ? restore(c.enrollment, 5) : refund,
        restoreFirst ? refund : restore(c.enrollment, 5),
      );
      if (restoreFirst) expect(result.error).toBeNull();
      else expect(String(result.error)).toContain("Zgłoszenie zmieniło");
      const balance = await checked(
        staff
          .from("course_balances")
          .select("status,charge_cents,paid_cents,refunded_cents,due_cents")
          .eq("id", c.enrollment)
          .single(),
      );
      expect(balance).toMatchObject(
        restoreFirst
          ? {
              status: "accepted",
              charge_cents: 10000,
              paid_cents: 3000,
              refunded_cents: 1000,
              due_cents: 7000,
            }
          : {
              status: "cancelled",
              charge_cents: 3000,
              paid_cents: 3000,
              refunded_cents: 1000,
              due_cents: 0,
            },
      );
    }
    const retry = await make();
    await cancel(retry.enrollment);
    const repeated = await race(
      restore(retry.enrollment),
      restore(retry.enrollment),
    );
    expect(repeated.error).toBeNull();
    expect(repeated.result).toEqual(["4"]);
    expect(
      await checked(
        db
          .from("course_reopening_receipts")
          .select("enrollment_id")
          .eq("enrollment_id", retry.enrollment),
      ),
    ).toHaveLength(1);
    expect(
      await checked(
        db
          .from("notifications")
          .select("id")
          .eq("course_enrollment_id", retry.enrollment)
          .eq("recipient_id", owner.id)
          .eq("kind", "course_enrollment_reopened"),
      ),
    ).toHaveLength(1);
    expect(
      await checked(
        db
          .from("course_history")
          .select("id")
          .eq("enrollment_id", retry.enrollment)
          .eq("action", "restore"),
      ),
    ).toHaveLength(1);
    const transfer = await make();
    await cancel(transfer.enrollment);
    const changed = await race(
      `update public.dogs set guardian_id=${q(newOwner.id)} where id=${q(dogs[0])};`,
      restore(transfer.enrollment),
      true,
    );
    expect(String(changed.error)).toContain("Opiekun psa zmienił");
    expect(
      await checked(
        staff
          .from("course_enrollments")
          .select("status,version")
          .eq("id", transfer.enrollment)
          .single(),
      ),
    ).toMatchObject({ status: "cancelled", version: 3 });
    expect(
      await checked(
        db
          .from("course_reopening_receipts")
          .select("enrollment_id")
          .eq("enrollment_id", transfer.enrollment),
      ),
    ).toEqual([]);
  } finally {
    await observer.close();
    try {
      if (dogs.length)
        await checked(db.from("payments").delete().in("dog_id", dogs));
      await removeCourseCare(db, dogs, courses);
    } finally {
      await disposeCareFixtures(db, users, dogs);
    }
  }
});
