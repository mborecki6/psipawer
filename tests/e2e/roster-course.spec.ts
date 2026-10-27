import {
  expect,
  type Browser,
  type Locator,
  type Page,
} from "@playwright/test";
import { LocalPostgres } from "../helpers/local-postgres.mjs";
import { careFixture, careScreenshot } from "./care-journey";
import { courseFixture, removeCourseCare } from "./course-fixtures";
import { openCourseMeeting } from "./course-ui";
import { revealFor } from "./details-ui";
import {
  checked,
  cleanupSteps,
  disposeCareFixtures,
  freeCalendarStart,
  test,
} from "./local-fixtures";
import { loseCommittedReply } from "./transport-journey";

test.use({ trace: "off" });

async function rosterFixture(browser: Browser, baseURL: string | undefined) {
  const f = await careFixture(browser, baseURL);
  const courses: string[] = [],
    extraDogs: string[] = [];
  let sql: LocalPostgres | undefined;
  const dispose = () =>
    cleanupSteps(
      async () => {
        await sql?.close();
      },
      () => removeCourseCare(f.db, [f.dog, ...extraDogs], courses),
      () => disposeCareFixtures(f.db, [], extraDogs),
      () => f.dispose(),
    );
  try {
    sql = await new LocalPostgres().ready();
    const cycle = await courseFixture(
      f.db,
      f.staffDb,
      f.ownerDb,
      f.dog,
      courses,
      sql,
    );
    const pending: { dog: string; name: string; enrollment: string }[] = [];
    for (const name of ["Runa", "Tola"]) {
      const dogName = `${name} skład ${crypto.randomUUID().slice(0, 8)}`;
      const dog = await checked(
        f.db
          .from("dogs")
          .insert({
            name: dogName,
            guardian_id: f.outsider.id,
          })
          .select("id")
          .single(),
      );
      if (!dog) throw new Error("Missing local roster dog fixture");
      extraDogs.push(dog.id);
      const enrollment = crypto.randomUUID();
      await checked(
        f.outsiderDb.rpc("request_course_enrollment", {
          p_id: enrollment,
          p_course: cycle.id,
          p_dog: dog.id,
          p_expected_course_version: 2,
        }),
      );
      pending.push({ dog: dog.id, name: dogName, enrollment });
    }
    return { f, cycle, pending, dispose };
  } catch (error) {
    await dispose();
    throw error;
  }
}

function attendanceForm(meeting: Locator, name: string, correction = false) {
  return meeting.getByRole("form", {
    name: `${correction ? "Korekta obecności" : "Obecność"}: ${name}`,
    exact: true,
  });
}

async function keyboardFocus(page: Page, button: Locator) {
  // macOS WebKit uses Option+Tab for all controls, matching the established
  // keyboard test in tpay-blik.spec.ts. Plain Tab may skip buttons by default.
  const allControls =
    process.platform === "darwin" &&
    page.context().browser()?.browserType().name() === "webkit";
  await button.focus();
  await page.keyboard.press(allControls ? "Alt+Tab" : "Tab");
  await page.keyboard.press(allControls ? "Alt+Shift+Tab" : "Shift+Tab");
  await expect(button).toBeFocused();
  expect(
    await button.evaluate((element) => {
      const style = getComputedStyle(element);
      return (
        (style.outlineStyle !== "none" && parseFloat(style.outlineWidth) > 0) ||
        style.boxShadow !== "none"
      );
    }),
    "Keyboard focus must remain visible",
  ).toBe(true);
}

async function rosterLayouts(page: Page, roster: Locator, name: string) {
  for (const width of [320, 390, 768, 1440]) {
    await careScreenshot(
      page,
      test.info().outputPath(`${name}-${width}.png`),
      width,
    );
    const buttons = roster.getByRole("button", { name: /^(Był|Nie był): / });
    expect(await buttons.count()).toBeGreaterThan(0);
    for (const button of await buttons.all()) {
      const box = await button.boundingBox();
      expect(box).not.toBeNull();
      expect(box!.width, `Target width at ${width}px`).toBeGreaterThanOrEqual(
        44,
      );
      expect(box!.height, `Target height at ${width}px`).toBeGreaterThanOrEqual(
        44,
      );
      expect(box!.x).toBeGreaterThanOrEqual(-1);
      expect(box!.x + box!.width).toBeLessThanOrEqual(width + 1);
    }
  }
}

test("course roster: decisions outside details, capacity, unmarked full roster and guardian privacy", async ({
  browser,
  baseURL,
}) => {
  const fixture = await rosterFixture(browser, baseURL);
  const {
    f,
    cycle,
    pending: [second, third],
  } = fixture;
  try {
    await f.staff.goto(`/admin/courses/${cycle.id}?filter=requested`);
    const secondRow = f.staff.locator(`#zgloszenie-${second.enrollment}`);
    const thirdRow = f.staff.locator(`#zgloszenie-${third.enrollment}`);
    const decision = secondRow.getByRole("form", {
      name: `Decyzja: ${second.name}`,
      exact: true,
    });
    await expect(decision).toBeVisible();
    await expect(
      secondRow.getByText(second.name, { exact: true }).first(),
    ).toBeVisible();
    await expect(
      secondRow.getByText("Czeka na decyzję", { exact: true }).first(),
    ).toBeVisible();
    await expect(decision.getByRole("combobox")).toHaveCount(0);
    const accept = decision.getByRole("button", {
      name: `Przyjmij: ${second.name}`,
      exact: true,
    });
    await expect(accept).toBeEnabled();
    await expect(
      decision.getByRole("button", {
        name: `Nie przyjmuj: ${second.name}`,
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      decision.getByRole("button", {
        name: `Przenieś na rezerwę: ${second.name}`,
        exact: true,
      }),
    ).toBeVisible();
    await keyboardFocus(f.staff, accept);
    await accept.press("Enter");
    await expect(secondRow).toHaveCount(0);
    await expect(
      f.staff
        .getByRole("status")
        .filter({ hasText: `${second.name}: Przyjęto na kurs.` }),
    ).toBeVisible();
    expect(
      await checked(
        f.staffDb
          .from("course_enrollments")
          .select("status,version,charge_cents,agreed_price_cents")
          .eq("id", second.enrollment)
          .single(),
      ),
    ).toMatchObject({
      status: "accepted",
      version: 2,
      charge_cents: 10000,
      agreed_price_cents: 10000,
    });

    const thirdDecision = thirdRow.getByRole("form", {
      name: `Decyzja: ${third.name}`,
      exact: true,
    });
    await thirdDecision
      .getByRole("button", { name: `Przyjmij: ${third.name}`, exact: true })
      .click();
    await expect(thirdDecision.getByRole("alert")).toContainText(
      "Brak wolnych miejsc",
    );
    await expect(thirdDecision.getByRole("alert")).toBeFocused();
    expect(
      await checked(
        f.staffDb
          .from("course_enrollments")
          .select("status,version,charge_cents")
          .eq("id", third.enrollment)
          .single(),
      ),
    ).toEqual({ status: "requested", version: 1, charge_cents: 0 });
    await thirdDecision
      .getByRole("button", { name: `Nie przyjmuj: ${third.name}`, exact: true })
      .click();
    const reason = thirdDecision.getByLabel("Powód odmowy dla opiekuna");
    await expect(reason).toBeFocused();
    await expect(reason).toHaveAttribute("required", "");
    const reject = thirdDecision.getByRole("button", {
      name: `Potwierdź odmowę: ${third.name}`,
      exact: true,
    });
    await reject.click();
    expect(
      await reason.evaluate(
        (element: HTMLTextAreaElement) => element.validity.valueMissing,
      ),
    ).toBe(true);
    expect(
      await checked(
        f.staffDb
          .from("course_enrollments")
          .select("status")
          .eq("id", third.enrollment)
          .single(),
      ),
    ).toEqual({ status: "requested" });
    const refusal = "Grupa jest już pełna; ustalimy osobny termin.";
    await reason.fill(refusal);
    await reject.click();
    await expect(thirdRow).toHaveCount(0);
    await expect(
      f.staff.getByText("Brak zgłoszeń czekających na decyzję.", {
        exact: true,
      }),
    ).toBeVisible();
    expect(
      await checked(
        f.staffDb
          .from("course_enrollments")
          .select("status,version,charge_cents")
          .eq("id", third.enrollment)
          .single(),
      ),
    ).toEqual({ status: "rejected", version: 2, charge_cents: 0 });
    expect(
      await checked(
        f.staffDb
          .from("course_history")
          .select("note")
          .eq("enrollment_id", third.enrollment)
          .eq("action", "reject"),
      ),
    ).toEqual([{ note: refusal }]);

    // Filtering away every enrollment must not hide accepted attendance rows.
    const meeting = await openCourseMeeting(f.staff, 1);
    const roster = meeting.getByRole("region", {
      name: "Obecności uczestników spotkania 1",
      exact: true,
    });
    await expect(roster).toBeVisible();
    await expect(roster.getByRole("form")).toHaveCount(2);
    await expect(roster.getByRole("combobox")).toHaveCount(0);
    await expect(
      roster.getByText("Obecność zapiszesz po rozpoczęciu spotkania.", {
        exact: true,
      }),
    ).toBeVisible();
    for (const name of [f.dogName, second.name]) {
      const row = attendanceForm(meeting, name);
      await expect(row).toBeVisible();
      await expect(
        row.getByText("Nieoznaczono", { exact: true }),
      ).toBeVisible();
      for (const label of ["Był", "Nie był", "Usprawiedliwiony"])
        await expect(
          row.getByRole("button", { name: `${label}: ${name}`, exact: true }),
        ).toBeDisabled();
      await expect(row.getByRole("button", { name: /Zapisz/ })).toHaveCount(0);
    }
    expect(
      await checked(
        f.staffDb
          .from("course_attendance")
          .select("enrollment_id")
          .eq("session_id", cycle.sessions[0].id),
      ),
    ).toEqual([]);
    await rosterLayouts(f.staff, roster, "future-roster");

    await f.staff
      .getByRole("navigation", { name: "Filtry zgłoszeń" })
      .getByRole("link", { name: "Przyjęte", exact: true })
      .click();
    const acceptedRow = f.staff.locator(`#zgloszenie-${second.enrollment}`);
    await expect(
      acceptedRow.getByText("✓ W składzie kursu", { exact: true }),
    ).toBeVisible();
    await expect(
      acceptedRow.getByRole("button", {
        name: `Nie przyjmuj: ${second.name}`,
        exact: true,
      }),
    ).toHaveCount(0);

    await f.guardian.goto(
      `/app/courses/${cycle.id}?enrollment=${cycle.enrollment}`,
    );
    await openCourseMeeting(f.guardian, 1);
    for (const foreignName of [second.name, third.name])
      await expect(
        f.guardian.getByText(foreignName, { exact: false }),
      ).toHaveCount(0);
    await expect(
      f.guardian.getByRole("button", {
        name: /^(Był|Nie był|Usprawiedliwiony|Przyjmij|Nie przyjmuj):/,
      }),
    ).toHaveCount(0);
    expect(
      await checked(
        f.ownerDb
          .from("course_enrollments")
          .select("dog_id")
          .eq("course_id", cycle.id),
      ),
    ).toEqual([{ dog_id: f.dog }]);
    await careScreenshot(
      f.guardian,
      test.info().outputPath("guardian-roster-390.png"),
      390,
    );
  } finally {
    await fixture.dispose();
  }
});

test("course attendance: one-tap values, completed correction, lost reply and stale row preserve money and history", async ({
  browser,
  baseURL,
}) => {
  const fixture = await rosterFixture(browser, baseURL);
  const {
    f,
    cycle,
    pending: [second],
  } = fixture;
  try {
    await checked(
      f.staffDb.rpc("change_course_enrollment", {
        p_id: second.enrollment,
        p_expected_version: 1,
        p_action: "accept",
        p_note: "",
      }),
    );
    // Move only this fixture's meeting, using an actually unoccupied past slot.
    const starts = await freeCalendarStart(f.db, {
      after: Date.now() - 30 * 86400000,
      before: Date.now() - 3 * 3600000,
      durationMinutes: 120,
    });
    await checked(
      f.db
        .from("course_sessions")
        .update({ starts_at: starts })
        .eq("id", cycle.sessions[0].id),
    );
    const balances = () =>
      checked(
        f.staffDb
          .from("course_balances")
          .select(
            "id,version,agreed_price_cents,charge_cents,paid_cents,refunded_cents,due_cents",
          )
          .eq("course_id", cycle.id)
          .order("id"),
      );
    const moneyBefore = await balances();
    const payments = () =>
      checked(
        f.db
          .from("payments")
          .select("id,status,amount_cents")
          .in("course_enrollment_id", [cycle.enrollment, second.enrollment])
          .order("id"),
      );
    const paymentsBefore = await payments();
    const url = `/admin/courses/${cycle.id}?filter=requested`;
    await f.staff.goto(url);
    const meeting = await openCourseMeeting(f.staff, 1);
    const first = attendanceForm(meeting, f.dogName);
    const other = attendanceForm(meeting, second.name);
    for (const row of [first, other]) {
      await expect(row).toBeVisible();
      await expect(
        row.getByText("Nieoznaczono", { exact: true }),
      ).toBeVisible();
      await expect(row.getByRole("combobox")).toHaveCount(0);
      await expect(row.getByRole("button", { name: /Zapisz/ })).toHaveCount(0);
    }
    const present = first.getByRole("button", {
      name: `Był: ${f.dogName}`,
      exact: true,
    });
    await expect(present).toBeEnabled();
    await keyboardFocus(f.staff, present);
    await present.press("Enter");
    await expect(first.getByRole("status")).toContainText("Obecność zapisana");
    await expect(first.getByText("Obecny", { exact: true })).toBeVisible();
    await expect(
      other.getByText("Nieoznaczono", { exact: true }),
    ).toBeVisible();
    await other
      .getByRole("button", { name: `Nie był: ${second.name}`, exact: true })
      .click();
    await expect(other.getByRole("status")).toContainText("Obecność zapisana");
    await expect(other.getByText("Nieobecny", { exact: true })).toBeVisible();
    const attendance = () =>
      checked(
        f.staffDb
          .from("course_attendance")
          .select("enrollment_id,attendance,version")
          .eq("session_id", cycle.sessions[0].id)
          .order("enrollment_id"),
      );
    expect(await attendance()).toEqual(
      [
        { enrollment_id: cycle.enrollment, attendance: "present", version: 1 },
        { enrollment_id: second.enrollment, attendance: "absent", version: 1 },
      ].sort((a, b) => a.enrollment_id.localeCompare(b.enrollment_id)),
    );
    expect(await balances()).toEqual(moneyBefore);
    await rosterLayouts(f.staff, meeting, "saved-roster");

    await checked(
      f.staffDb.rpc("change_course_session", {
        p_id: cycle.sessions[0].id,
        p_expected_version: 1,
        p_action: "complete",
        p_note: "",
      }),
    );
    for (const session of cycle.sessions.slice(1))
      await checked(
        f.staffDb.rpc("change_course_session", {
          p_id: session.id,
          p_expected_version: 1,
          p_action: "cancel",
          p_note: "Pozostałe fikcyjne spotkania odwołane",
        }),
      );
    const course = await checked(
      f.staffDb.from("courses").select("version").eq("id", cycle.id).single(),
    );
    await checked(
      f.staffDb.rpc("change_course", {
        p_id: cycle.id,
        p_expected_version: course!.version,
        p_action: "complete",
        p_note: "",
      }),
    );
    await f.staff.goto(url);
    const completed = await openCourseMeeting(f.staff, 1);
    const correction = attendanceForm(completed, f.dogName, true);
    await expect(correction).toBeVisible();
    await expect(
      completed.getByRole("form", { name: /^Korekta obecności:/ }),
    ).toHaveCount(2);
    await expect(correction.getByRole("combobox")).toHaveCount(0);
    const reason = correction.getByLabel("Powód korekty obecności");
    await expect(reason).toHaveAttribute("required", "");
    await correction
      .getByRole("button", { name: `Nie był: ${f.dogName}`, exact: true })
      .click();
    expect(
      await reason.evaluate(
        (element: HTMLTextAreaElement) => element.validity.valueMissing,
      ),
    ).toBe(true);
    expect(
      (await attendance())!.find(
        (row) => row.enrollment_id === cycle.enrollment,
      ),
    ).toMatchObject({ attendance: "present", version: 1 });

    const stale = await f.staffContext.newPage();
    await stale.goto(url);
    const staleMeeting = await openCourseMeeting(stale, 1);
    const staleCorrection = attendanceForm(staleMeeting, f.dogName, true);
    const staleReason = "Uzasadnienie ze starszej karty ma pozostać";
    await staleCorrection
      .getByLabel("Powód korekty obecności")
      .fill(staleReason);
    const note = "Usprawiedliwienie uzgodnione po zakończeniu kursu";
    await reason.fill(note);
    const corrections = () =>
      checked(
        f.staffDb
          .from("course_attendance_corrections")
          .select(
            "source_version,result_version,previous_attendance,attendance,note",
          )
          .eq("session_id", cycle.sessions[0].id)
          .eq("enrollment_id", cycle.enrollment)
          .order("source_version"),
      );
    await loseCommittedReply(
      f.staff,
      correction,
      cycle.enrollment,
      async () => {
        for (const button of await correction.getByRole("button").all())
          await expect(button).toBeDisabled();
        await expect(reason).toBeDisabled();
        await expect(correction.getByRole("status")).toHaveCount(0);
        expect(await corrections()).toEqual([
          {
            source_version: 1,
            result_version: 2,
            previous_attendance: "present",
            attendance: "excused",
            note,
          },
        ]);
        expect(await balances()).toEqual(moneyBefore);
      },
    );
    await expect(reason).toHaveValue(note);
    await expect(correction.locator('[name="expected_version"]')).toHaveValue(
      "1",
    );
    await expect(correction.getByText("Obecny", { exact: true })).toBeVisible();
    await expect(
      correction.getByText("Wybrana obecność: Usprawiedliwiony.", {
        exact: true,
      }),
    ).toBeVisible();
    await correction
      .getByRole("button", {
        name: `Usprawiedliwiony: ${f.dogName}`,
        exact: true,
      })
      .click();
    await expect(correction.getByRole("status")).toContainText(
      "Korekta obecności zapisana",
    );
    await expect(
      correction.getByText("Usprawiedliwiony", { exact: true }).first(),
    ).toBeVisible();
    await expect(correction.locator('[name="expected_version"]')).toHaveValue(
      "2",
    );
    expect(await corrections()).toHaveLength(1);
    expect(
      await checked(
        f.db
          .from("audit_events")
          .select("id")
          .eq("entity_id", cycle.enrollment)
          .eq("event", "course_attendance_corrected"),
      ),
    ).toHaveLength(1);
    expect(
      await checked(
        f.staffDb
          .from("course_history")
          .select("id")
          .eq("enrollment_id", cycle.enrollment)
          .eq("session_id", cycle.sessions[0].id)
          .eq("action", "attendance")
          .contains("details", { corrected: true }),
      ),
    ).toHaveLength(1);

    // A successful action in a sibling row revalidates this page. Its new
    // server props must not overwrite the first row's unconfirmed draft/version.
    const staleOther = attendanceForm(staleMeeting, second.name, true);
    await staleOther
      .getByLabel("Powód korekty obecności")
      .fill("Sprawdzona lista drugiego uczestnika");
    await staleOther
      .getByRole("button", { name: `Był: ${second.name}`, exact: true })
      .click();
    await expect(staleOther.getByRole("status")).toContainText(
      "Korekta obecności zapisana",
    );
    await expect(
      staleCorrection.locator('[name="expected_version"]'),
    ).toHaveValue("1");
    await expect(
      staleCorrection.getByLabel("Powód korekty obecności"),
    ).toHaveValue(staleReason);
    await staleCorrection
      .getByRole("button", { name: `Nie był: ${f.dogName}`, exact: true })
      .click();
    await expect(staleCorrection.getByRole("alert")).toContainText(
      "Obecność zmieniła się",
    );
    await expect(staleCorrection.getByRole("alert")).toBeFocused();
    await expect(
      staleCorrection.getByLabel("Powód korekty obecności"),
    ).toHaveValue(staleReason);
    await expect(
      staleCorrection.locator('[name="expected_version"]'),
    ).toHaveValue("1");
    await expect(
      staleCorrection.getByText("Wybrana obecność: Nieobecny.", {
        exact: true,
      }),
    ).toBeVisible();
    expect(await corrections()).toHaveLength(1);
    expect(await balances()).toEqual(moneyBefore);
    expect(await payments()).toEqual(paymentsBefore);
    await careScreenshot(
      stale,
      test.info().outputPath("stale-correction-320.png"),
      320,
    );
    await stale.close();

    await f.guardian.goto(
      `/app/courses/${cycle.id}?enrollment=${cycle.enrollment}`,
    );
    await openCourseMeeting(f.guardian, 1);
    await expect(
      f.guardian.getByText(second.name, { exact: false }),
    ).toHaveCount(0);
    await expect(
      f.guardian.getByRole("form", { name: /^(Obecność|Korekta obecności):/ }),
    ).toHaveCount(0);
    expect(
      await checked(
        f.ownerDb
          .from("course_attendance")
          .select("attendance")
          .eq("session_id", cycle.sessions[0].id),
      ),
    ).toEqual([{ attendance: "excused" }]);
  } finally {
    await fixture.dispose();
  }
});

test("course decisions: the same all view supports acceptance then cancellation and refusal then reconsideration then acceptance", async ({
  browser,
  baseURL,
}) => {
  const fixture = await rosterFixture(browser, baseURL);
  const {
    f,
    cycle,
    pending: [second, third],
  } = fixture;
  try {
    const url = `/admin/courses/${cycle.id}?filter=all`;
    await f.staff.goto(url);
    const row = f.staff.locator(`#zgloszenie-${second.enrollment}`);
    const decision = row.getByRole("form", {
      name: `Decyzja: ${second.name}`,
      exact: true,
    });
    await expect(decision.locator('[name="expected_version"]')).toHaveValue(
      "1",
    );
    await decision
      .getByRole("button", { name: `Przyjmij: ${second.name}`, exact: true })
      .click();
    await expect(decision.getByRole("status")).toContainText(
      "Decyzja zapisana",
    );
    await expect(
      row.getByText("✓ W składzie kursu", { exact: true }),
    ).toBeVisible();

    // No reload or navigation: the secondary command must use the version
    // confirmed by the primary action in this still-mounted enrollment row.
    const cancellation = row.getByRole("form", {
      name: `Rezygnacja: ${second.name}`,
      exact: true,
      includeHidden: true,
    });
    const cancelReason = cancellation.getByLabel("Powód dla opiekuna");
    await revealFor(cancelReason);
    await expect(cancellation.locator('[name="expected_version"]')).toHaveValue(
      "2",
    );
    const cancellationNote =
      "Rezygnacja uzgodniona po przyjęciu w tej samej karcie";
    await cancelReason.fill(cancellationNote);
    await cancellation
      .getByRole("button", { name: "Zapisz zmianę", exact: true })
      .click();
    await expect(cancellation.getByRole("status")).toContainText(
      "Decyzja zapisana",
    );
    await expect(
      row.getByText("✓ W składzie kursu", { exact: true }),
    ).toHaveCount(0);
    expect(
      await checked(
        f.staffDb
          .from("course_balances")
          .select(
            "status,version,agreed_price_cents,charge_cents,paid_cents,needs_settlement",
          )
          .eq("id", second.enrollment)
          .single(),
      ),
    ).toMatchObject({
      status: "cancelled",
      version: 3,
      agreed_price_cents: 10000,
      charge_cents: 10000,
      paid_cents: 0,
      needs_settlement: true,
    });
    expect(
      await checked(
        f.staffDb
          .from("course_history")
          .select("action,note")
          .eq("enrollment_id", second.enrollment)
          .in("action", ["accept", "cancel"])
          .order("created_at")
          .order("id"),
      ),
    ).toEqual([
      { action: "accept", note: "" },
      { action: "cancel", note: cancellationNote },
    ]);

    const reconsideredRow = f.staff.locator(`#zgloszenie-${third.enrollment}`);
    const reconsideredDecision = reconsideredRow.getByRole("form", {
      name: `Decyzja: ${third.name}`,
      exact: true,
    });
    await reconsideredDecision
      .getByRole("button", { name: `Nie przyjmuj: ${third.name}`, exact: true })
      .click();
    const refusalNote = "Najpierw potrzebujemy uzgodnienia terminu";
    await reconsideredDecision
      .getByLabel("Powód odmowy dla opiekuna")
      .fill(refusalNote);
    await reconsideredDecision
      .getByRole("button", {
        name: `Potwierdź odmowę: ${third.name}`,
        exact: true,
      })
      .click();
    await expect(reconsideredDecision.getByRole("status")).toContainText(
      "Decyzja zapisana",
    );
    expect(
      await checked(
        f.staffDb
          .from("course_enrollments")
          .select("status,version,charge_cents")
          .eq("id", third.enrollment)
          .single(),
      ),
    ).toEqual({ status: "rejected", version: 2, charge_cents: 0 });

    const reopening = reconsideredRow.getByRole("form", {
      name: "Powrót do zgłoszenia",
      exact: true,
      includeHidden: true,
    });
    const reopeningReason = reopening.getByLabel("Powód powrotu do zgłoszenia");
    await revealFor(reopeningReason);
    await expect(reopening.locator('[name="expected_version"]')).toHaveValue(
      "2",
    );
    const reopeningNote =
      "Termin został uzgodniony; ponownie rozpatrujemy zgłoszenie";
    await reopeningReason.fill(reopeningNote);
    await reopening
      .getByRole("button", {
        name: "Wróć do decyzji o zgłoszeniu",
        exact: true,
      })
      .click();
    await expect(reopening.getByRole("status")).toContainText(
      "Zgłoszenie wróciło do decyzji",
    );
    expect(
      await checked(
        f.staffDb
          .from("course_enrollments")
          .select("status,version,charge_cents")
          .eq("id", third.enrollment)
          .single(),
      ),
    ).toEqual({ status: "requested", version: 3, charge_cents: 0 });
    await expect(reconsideredDecision).toBeVisible();
    await expect(
      reconsideredDecision.locator('[name="expected_version"]'),
    ).toHaveValue("3");
    const acceptAgain = reconsideredDecision.getByRole("button", {
      name: `Przyjmij: ${third.name}`,
      exact: true,
    });
    await expect(acceptAgain).toBeEnabled();
    await expect(
      reconsideredDecision.getByRole("button", {
        name: `Nie przyjmuj: ${third.name}`,
        exact: true,
      }),
    ).toBeEnabled();

    // Fill the released seat with this fixture's cancelled participant. The
    // next primary action must expose its real error despite the newer version
    // previously confirmed by the separate reopening form.
    const restore = row.getByRole("form", {
      name: "Powrót do zgłoszenia",
      exact: true,
      includeHidden: true,
    });
    const restoreReason = restore.getByLabel("Powód powrotu do zgłoszenia");
    await revealFor(restoreReason);
    await expect(restore.locator('[name="expected_version"]')).toHaveValue("3");
    await restoreReason.fill(
      "Przywrócenie własnego uczestnika do próby pełnej grupy",
    );
    await restore
      .getByRole("button", { name: "Przywróć udział na kursie", exact: true })
      .click();
    await expect(restore.getByRole("status")).toContainText(
      "Udział przywrócony",
    );
    expect(
      await checked(
        f.staffDb
          .from("course_enrollments")
          .select("id")
          .eq("course_id", cycle.id)
          .eq("status", "accepted"),
      ),
    ).toHaveLength(2);
    await acceptAgain.click();
    await expect(reconsideredDecision.getByRole("alert")).toContainText(
      "Brak wolnych miejsc",
    );
    await expect(reconsideredDecision.getByRole("alert")).toBeFocused();
    await expect(
      reconsideredDecision.locator('[name="expected_version"]'),
    ).toHaveValue("3");
    await expect(
      reconsideredDecision.getByText("Wybrana decyzja: Przyjmij.", {
        exact: true,
      }),
    ).toBeVisible();
    expect(
      await checked(
        f.staffDb
          .from("course_enrollments")
          .select("status,version,charge_cents")
          .eq("id", third.enrollment)
          .single(),
      ),
    ).toEqual({ status: "requested", version: 3, charge_cents: 0 });

    await revealFor(cancelReason);
    await expect(cancellation.locator('[name="expected_version"]')).toHaveValue(
      "4",
    );
    await cancelReason.fill(
      "Zwolnienie własnego miejsca po sprawdzeniu limitu",
    );
    await cancellation
      .getByRole("button", { name: "Zapisz zmianę", exact: true })
      .click();
    await expect(cancellation.locator('[name="expected_version"]')).toHaveValue(
      "5",
    );
    await expect(
      reconsideredDecision.locator('[name="expected_version"]'),
    ).toHaveValue("3");
    await acceptAgain.click();
    await expect(
      reconsideredRow.getByText("✓ W składzie kursu", { exact: true }),
    ).toBeVisible();
    expect(
      await checked(
        f.staffDb
          .from("course_balances")
          .select(
            "status,version,agreed_price_cents,charge_cents,paid_cents,due_cents",
          )
          .eq("id", third.enrollment)
          .single(),
      ),
    ).toMatchObject({
      status: "accepted",
      version: 4,
      agreed_price_cents: 10000,
      charge_cents: 10000,
      paid_cents: 0,
      due_cents: 10000,
    });
    expect(
      await checked(
        f.staffDb
          .from("course_history")
          .select("action,note")
          .eq("enrollment_id", third.enrollment)
          .in("action", ["reject", "reconsider", "accept"])
          .order("created_at")
          .order("id"),
      ),
    ).toEqual([
      { action: "reject", note: refusalNote },
      { action: "reconsider", note: reopeningNote },
      { action: "accept", note: "" },
    ]);
    await expect(f.staff).toHaveURL(url);
    expect(
      await checked(
        f.db
          .from("payments")
          .select("id")
          .in("course_enrollment_id", [second.enrollment, third.enrollment]),
      ),
    ).toEqual([]);
    await careScreenshot(
      f.staff,
      test.info().outputPath("same-view-decisions-390.png"),
      390,
    );
  } finally {
    await fixture.dispose();
  }
});

test("course decisions: a lost refusal remains retryable after another row removes both from the requested filter", async ({
  browser,
  baseURL,
}) => {
  const fixture = await rosterFixture(browser, baseURL);
  const {
    f,
    cycle,
    pending: [second, third],
  } = fixture;
  try {
    const url = `/admin/courses/${cycle.id}?filter=requested`;
    await f.staff.goto(url);
    const row = f.staff.locator(`#zgloszenie-${second.enrollment}`);
    const decision = row.getByRole("form", {
      name: `Decyzja: ${second.name}`,
      exact: true,
    });
    await decision
      .getByRole("button", {
        name: `Nie przyjmuj: ${second.name}`,
        exact: true,
      })
      .click();
    const refusalNote =
      "Pozostaw dokładny powód po utracie potwierdzenia i odświeżeniu listy";
    const reason = decision.getByLabel("Powód odmowy dla opiekuna");
    await reason.fill(refusalNote);
    const reject = decision.getByRole("button", {
      name: `Potwierdź odmowę: ${second.name}`,
      exact: true,
    });
    const effects = async () => ({
      enrollment: await checked(
        f.staffDb
          .from("course_enrollments")
          .select("status,version,agreed_price_cents,charge_cents")
          .eq("id", second.enrollment)
          .single(),
      ),
      history: await checked(
        f.staffDb
          .from("course_history")
          .select("id,note,details")
          .eq("enrollment_id", second.enrollment)
          .eq("action", "reject")
          .order("id"),
      ),
      audit: await checked(
        f.db
          .from("audit_events")
          .select("id")
          .eq("entity_id", second.enrollment)
          .eq("event", "course_enrollment_changed")
          .contains("details", { action: "reject" })
          .order("id"),
      ),
      notices: await checked(
        f.outsiderDb
          .from("notifications")
          .select("id,source_key")
          .eq("course_enrollment_id", second.enrollment)
          .eq("recipient_id", f.outsider.id)
          .eq("kind", "course_enrollment_rejected")
          .order("id"),
      ),
    });
    await loseCommittedReply(
      f.staff,
      decision,
      second.enrollment,
      async () => {
        for (const button of await decision.getByRole("button").all())
          await expect(button).toBeDisabled();
        await expect(reason).toBeDisabled();
        await expect(decision.getByRole("status")).toHaveCount(0);
        expect(await effects()).toMatchObject({
          enrollment: {
            status: "rejected",
            version: 2,
            charge_cents: 0,
            agreed_price_cents: 10000,
          },
          history: [{ note: refusalNote }],
        });
      },
      reject,
    );
    await expect(decision.locator('[name="expected_version"]')).toHaveValue(
      "1",
    );
    await expect(reason).toHaveValue(refusalNote);
    await expect(
      decision.getByText("Wybrana decyzja: Nie przyjmuj.", { exact: true }),
    ).toBeVisible();
    const committedEffects = await effects();
    expect(committedEffects.history).toHaveLength(1);
    expect(committedEffects.audit).toHaveLength(1);
    expect(committedEffects.notices).toHaveLength(1);

    // The second real action refreshes this exact page. Its server result has
    // neither A (already refused) nor B (now accepted) in the requested list.
    const otherRow = f.staff.locator(`#zgloszenie-${third.enrollment}`);
    await otherRow
      .getByRole("button", { name: `Przyjmij: ${third.name}`, exact: true })
      .click();
    await expect(otherRow).toHaveCount(0);
    await expect(
      f.staff
        .getByRole("status")
        .filter({ hasText: `${third.name}: Przyjęto na kurs.` }),
    ).toBeVisible();
    expect(
      await checked(
        f.staffDb
          .from("course_enrollments")
          .select("id")
          .eq("course_id", cycle.id)
          .eq("status", "requested"),
      ),
    ).toEqual([]);

    const recovery = f.staff.getByRole("form", {
      name: `Ponowienie decyzji: ${second.name}`,
      exact: true,
    });
    await expect(recovery).toBeVisible();
    await expect(recovery.getByRole("alert")).toContainText(
      "Nie udało się potwierdzić zapisu",
    );
    for (const [name, value] of Object.entries({
      id: second.enrollment,
      expected_version: "1",
      intent: "reject",
      note: refusalNote,
    }))
      await expect(recovery.locator(`[name="${name}"]`)).toHaveValue(value);
    await expect(recovery).toContainText("Nie przyjmuj");
    await expect(recovery).toContainText(refusalNote);

    // Returning A to the visible list remounts its controls from the real
    // rejected row. The lost command must remain usable there as well.
    const filters = f.staff.getByRole("navigation", {
      name: "Filtry zgłoszeń",
    });
    await filters.getByRole("link", { name: "Wszystkie", exact: true }).click();
    await expect(row).toBeVisible();
    await expect(decision).toBeVisible();
    await expect(decision.getByRole("alert")).toContainText(
      "Nie udało się potwierdzić zapisu",
    );
    await expect(decision.locator('[name="id"]')).toHaveValue(
      second.enrollment,
    );
    await expect(decision.locator('[name="expected_version"]')).toHaveValue(
      "1",
    );
    await expect(reason).toHaveValue(refusalNote);
    await expect(reason).toHaveAttribute("readonly", "");
    await expect(
      decision.getByText("Wybrana decyzja: Nie przyjmuj.", { exact: true }),
    ).toBeVisible();
    const inlineRetry = decision.getByRole("button", {
      name: `Ponów tę samą decyzję: ${second.name}`,
      exact: true,
    });
    await expect(inlineRetry).toBeEnabled();
    await expect(inlineRetry).toHaveAttribute("name", "intent");
    await expect(inlineRetry).toHaveAttribute("value", "reject");
    expect(await effects()).toEqual(committedEffects);

    await filters
      .getByRole("link", { name: "Do decyzji", exact: true })
      .click();
    await expect(row).toHaveCount(0);
    await expect(recovery).toBeVisible();
    await expect(recovery.getByRole("alert")).toContainText(
      "Nie udało się potwierdzić zapisu",
    );
    await expect(recovery.locator('[name="expected_version"]')).toHaveValue(
      "1",
    );
    await expect(recovery.locator('[name="intent"]')).toHaveValue("reject");
    await expect(recovery.locator('[name="note"]')).toHaveValue(refusalNote);
    const retry = recovery.getByRole("button", {
      name: `Ponów tę samą decyzję: ${second.name}`,
      exact: true,
    });
    await expect(retry).toBeEnabled();
    await keyboardFocus(f.staff, retry);
    await careScreenshot(
      f.staff,
      test.info().outputPath("lost-decision-retained-320.png"),
      320,
    );
    await retry.click();
    await expect(
      f.staff
        .getByRole("status")
        .filter({ hasText: `${second.name}: Nie przyjęto na kurs.` }),
    ).toBeVisible();
    expect(await effects()).toEqual(committedEffects);
    expect(new URL(f.staff.url()).pathname).toBe(`/admin/courses/${cycle.id}`);
    expect(new URL(f.staff.url()).searchParams.get("filter")).toBe("requested");
    expect(
      await checked(
        f.db
          .from("payments")
          .select("id")
          .in("course_enrollment_id", [second.enrollment, third.enrollment]),
      ),
    ).toEqual([]);
  } finally {
    await fixture.dispose();
  }
});

test("course decisions: lost reconsideration keeps its source, reason and version when retried from a returned primary row", async ({
  browser,
  baseURL,
}) => {
  const fixture = await rosterFixture(browser, baseURL);
  const {
    f,
    cycle,
    pending: [second],
  } = fixture;
  try {
    await checked(
      f.staffDb.rpc("change_course_enrollment", {
        p_id: second.enrollment,
        p_expected_version: 1,
        p_action: "reject",
        p_note: "Własna odmowa do próby utraty ponownego rozpatrzenia",
      }),
    );
    await f.staff.goto(`/admin/courses/${cycle.id}?filter=history`);
    const row = f.staff.locator(`#zgloszenie-${second.enrollment}`);
    const reopening = row.getByRole("form", {
      name: "Powrót do zgłoszenia",
      exact: true,
      includeHidden: true,
    });
    const reason = reopening.getByLabel("Powód powrotu do zgłoszenia");
    await revealFor(reason);
    const note =
      "Ponownie rozpatrujemy po rozmowie; zachowaj ten dokładny powód";
    await reason.fill(note);
    await expect(reopening.locator('[name="expected_version"]')).toHaveValue(
      "2",
    );
    // Submit changes its accessible name to „Proszę czekać…” while pending.
    const submit = reopening.locator("button").last();
    await expect(submit).toHaveText("Wróć do decyzji o zgłoszeniu");
    const money = () =>
      checked(
        f.staffDb
          .from("course_balances")
          .select("agreed_price_cents,charge_cents,paid_cents,refunded_cents")
          .eq("id", second.enrollment)
          .single(),
      );
    const moneyBefore = await money();
    const effects = async () => ({
      enrollment: await checked(
        f.staffDb
          .from("course_enrollments")
          .select("status,version,charge_cents")
          .eq("id", second.enrollment)
          .single(),
      ),
      receipt: await checked(
        f.staffDb
          .from("course_reopening_receipts")
          .select("source_version,result_version,action,note")
          .eq("enrollment_id", second.enrollment)
          .order("source_version"),
      ),
      history: await checked(
        f.staffDb
          .from("course_history")
          .select("id,note,details")
          .eq("enrollment_id", second.enrollment)
          .eq("action", "reconsider")
          .order("id"),
      ),
      audit: await checked(
        f.db
          .from("audit_events")
          .select("id")
          .eq("entity_id", second.enrollment)
          .eq("event", "course_enrollment_reopened")
          .contains("details", { action: "reconsider" })
          .order("id"),
      ),
      notices: await checked(
        f.outsiderDb
          .from("notifications")
          .select("id,source_key")
          .eq("course_enrollment_id", second.enrollment)
          .eq("recipient_id", f.outsider.id)
          .eq("kind", "course_enrollment_reopened")
          .order("id"),
      ),
    });
    await loseCommittedReply(
      f.staff,
      reopening,
      second.enrollment,
      async () => {
        await expect(reason).toBeDisabled();
        await expect(submit).toBeDisabled();
        await expect(reopening.getByRole("status")).toHaveCount(0);
        expect(await effects()).toMatchObject({
          enrollment: { status: "requested", version: 3, charge_cents: 0 },
          receipt: [
            {
              source_version: 2,
              result_version: 3,
              action: "reconsider",
              note,
            },
          ],
          history: [{ note }],
        });
      },
      submit,
    );
    await expect(reason).toHaveValue(note);
    await expect(reopening.locator('[name="expected_version"]')).toHaveValue(
      "2",
    );
    const committedEffects = await effects();
    expect(committedEffects.receipt).toHaveLength(1);
    expect(committedEffects.history).toHaveLength(1);
    expect(committedEffects.audit).toHaveLength(1);
    expect(committedEffects.notices).toHaveLength(1);

    const filters = f.staff.getByRole("navigation", {
      name: "Filtry zgłoszeń",
    });
    await filters.getByRole("link", { name: "Przyjęte", exact: true }).click();
    await expect(row).toHaveCount(0);
    const recovery = f.staff.getByRole("form", {
      name: `Ponowienie decyzji: ${second.name}`,
      exact: true,
    });
    await expect(recovery).toBeVisible();
    await expect(recovery.getByRole("alert")).toContainText(
      "Nie udało się potwierdzić zapisu",
    );
    for (const [name, value] of Object.entries({
      id: second.enrollment,
      expected_version: "2",
      intent: "reconsider",
      note,
    }))
      await expect(recovery.locator(`[name="${name}"]`)).toHaveValue(value);
    await expect(recovery).toContainText(note);

    // The returned row is now requested v3, but its retry still belongs to the
    // reopening action with source v2, rather than to a new primary decision.
    await filters.getByRole("link", { name: "Wszystkie", exact: true }).click();
    const inline = row.getByRole("form", {
      name: `Decyzja: ${second.name}`,
      exact: true,
    });
    await expect(inline).toBeVisible();
    await expect(inline.getByRole("alert")).toContainText(
      "Nie udało się potwierdzić zapisu",
    );
    await expect(inline.locator('[name="id"]')).toHaveValue(second.enrollment);
    await expect(inline.locator('[name="expected_version"]')).toHaveValue("2");
    const inlineReason = inline.getByLabel(
      "Wiadomość dla opiekuna (opcjonalnie)",
    );
    await revealFor(inlineReason);
    await expect(inlineReason).toHaveValue(note);
    await expect(inlineReason).toHaveAttribute("readonly", "");
    await expect(
      inline.getByText("Wybrana decyzja: Wróć do decyzji o zgłoszeniu.", {
        exact: true,
      }),
    ).toBeVisible();
    const retry = inline.getByRole("button", {
      name: `Ponów tę samą decyzję: ${second.name}`,
      exact: true,
    });
    await expect(retry).toBeEnabled();
    await expect(retry).toHaveAttribute("name", "intent");
    await expect(retry).toHaveAttribute("value", "reconsider");
    expect(await effects()).toEqual(committedEffects);
    await careScreenshot(
      f.staff,
      test.info().outputPath("lost-reconsideration-returned-390.png"),
      390,
    );
    await retry.click();
    await expect(
      f.staff
        .getByRole("status")
        .filter({ hasText: `${second.name}: Zgłoszenie wróciło do decyzji.` }),
    ).toBeVisible();
    expect(await effects()).toEqual(committedEffects);
    expect(await money()).toEqual(moneyBefore);
    expect(
      await checked(
        f.db
          .from("payments")
          .select("id")
          .eq("course_enrollment_id", second.enrollment),
      ),
    ).toEqual([]);
  } finally {
    await fixture.dispose();
  }
});
