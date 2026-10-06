// Nonempty application data for the physical restore rehearsal. All mutations
// target this run's fictional dog and generated course identifiers only.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { LocalPostgres } from "./local-postgres.mjs";

const serviceId = "60000000-0000-4000-8000-000000000001";
const checked = (result) => {
  assert(!result.error, "Próbna operacja kursu musi zakończyć się poprawnie.");
  return result.data;
};
export async function prepareBackupCourses({
  db,
  staff,
  owner,
  dog,
  courses,
  onStage,
}) {
  const sql = await new LocalPostgres().ready();
  const rpc = async (name, args) => {
    onStage(`source-${name}`);
    return checked(await staff.rpc(name, args));
  };
  async function cycle(title) {
    const catalog = checked(
      await staff
        .from("services")
        .select("version,price_cents,duration_minutes,sessions_count")
        .eq("id", serviceId)
        .single(),
    );
    assert.equal(catalog.sessions_count, 5);
    const starts = await sql.json(`select to_json(min(t)) from (
      select now()+interval '3 years'+make_interval(days=>n) t from generate_series(1,100) n
    ) candidates where not exists(select 1 from public.calendar_slots slot,generate_series(0,4) week
      where slot.occupied && tstzrange(t+make_interval(days=>week*7),t+make_interval(days=>week*7)+make_interval(mins=>${catalog.duration_minutes}),'[)'));`);
    assert.equal(typeof starts, "string");
    const id = randomUUID(),
      enrollment = randomUUID();
    courses.push(id);
    await rpc("create_course", {
      p_id: id,
      p_service: serviceId,
      p_expected_service_version: catalog.version,
      p_title: title,
      p_capacity: 2,
      p_public_location: "Próbna okolica kopii",
      p_exact_location: "PRYWATNA ZBIÓRKA PRÓBY KOPII",
      p_starts: Array.from({ length: 5 }, (_, n) =>
        new Date(Date.parse(starts) + n * 7 * 86400000).toISOString(),
      ),
    });
    await rpc("change_course", {
      p_id: id,
      p_expected_version: 1,
      p_action: "publish",
      p_note: "",
    });
    onStage("source-request_course_enrollment");
    checked(
      await owner.rpc("request_course_enrollment", {
        p_id: enrollment,
        p_course: id,
        p_dog: dog,
        p_expected_course_version: 2,
      }),
    );
    await rpc("change_course_enrollment", {
      p_id: enrollment,
      p_expected_version: 1,
      p_action: "accept",
      p_note: "",
    });
    const sessions = checked(
      await db
        .from("course_sessions")
        .select("id,ordinal,version")
        .eq("course_id", id)
        .order("ordinal"),
    );
    assert.equal(sessions.length, 5);
    return {
      id,
      enrollment,
      sessions,
      price: catalog.price_cents,
      duration: catalog.duration_minutes,
    };
  }
  try {
    const future = await cycle("Kurs kopii przed rozpoczęciem");
    assert.equal(future.price, 10000, "Próba zakłada roboczą cenę 100 zł.");
    const settings = {
      p_id: future.id,
      p_expected_version: 2,
      p_title: "Kurs kopii po zmianie ustawień",
      p_capacity: 3,
      p_note: "Zachowana zmiana nazwy i miejsc",
      p_request_id: randomUUID(),
    };
    assert.equal(await rpc("edit_course", settings), 3);
    const wholePlan = {
      p_dog: dog,
      p_expected_version: 0,
      p_title: "Zachowany plan całego kursu",
      p_body: "Pierwsze zalecenia do próby odtworzenia.",
      p_follow_up_on: null,
      p_publish: true,
      p_consultation: null,
      p_course_enrollment: future.enrollment,
      p_course_session: null,
    };
    const whole = await rpc("save_care_plan", wholePlan);
    const payment = await rpc("record_payment", {
      p_registration: null,
      p_package: null,
      p_amount_cents: 10000,
      p_method: "transfer",
      p_note: "Pierwotna wpłata próby",
      p_request_id: randomUUID(),
      p_consultation: null,
      p_course_enrollment: future.enrollment,
    });
    await rpc("change_course_enrollment", {
      p_id: future.enrollment,
      p_expected_version: 3,
      p_action: "cancel",
      p_note: "Rezygnacja przed próbą kopii",
    });
    const settlement = {
      p_id: future.enrollment,
      p_expected_version: 4,
      p_amount_cents: 3000,
      p_note: "Zachowane uzgodnienie rezygnacji",
      p_request_id: randomUUID(),
    };
    assert.equal(await rpc("settle_course_enrollment", settlement), 5);
    const refund = {
      p_payment: payment,
      p_amount_cents: 7000,
      p_note: "Zachowany rzeczywisty zwrot",
      p_request_id: randomUUID(),
    };
    assert.equal(
      await rpc("refund_course_payment", refund),
      refund.p_request_id,
    );
    const reopening = {
      p_id: future.enrollment,
      p_expected_version: 6,
      p_action: "restore",
      p_note: "Uzgodniony powrót przed kopią",
    };
    assert.equal(await rpc("reopen_course_enrollment", reopening), 7);
    const history = await cycle("Kurs kopii z zakończonym spotkaniem");
    const past = await sql.json(`select to_json(max(t)) from (
      select now()-make_interval(days=>n) t from generate_series(2,90) n
    ) candidates where not exists(select 1 from public.calendar_slots slot
      where slot.occupied && tstzrange(t,t+make_interval(mins=>${history.duration}),'[)'));`);
    assert.equal(typeof past, "string");
    // Only the new fixture's first meeting changes time. The server clock and
    // every pre-existing appointment remain untouched.
    onStage("source-own-past-meeting");
    checked(
      await db
        .from("course_sessions")
        .update({ starts_at: past })
        .eq("id", history.sessions[0].id)
        .eq("course_id", history.id),
    );
    await rpc("record_course_attendance", {
      p_session: history.sessions[0].id,
      p_enrollment: history.enrollment,
      p_expected_version: 0,
      p_attendance: "present",
    });
    await rpc("change_course_session", {
      p_id: history.sessions[0].id,
      p_expected_version: 1,
      p_action: "complete",
      p_note: "",
    });
    const correction = {
      p_session: history.sessions[0].id,
      p_enrollment: history.enrollment,
      p_expected_version: 1,
      p_attendance: "excused",
      p_note: "Zachowana korekta obecności",
    };
    assert.equal(await rpc("correct_course_attendance", correction), 2);
    const meeting = await rpc("save_care_plan", {
      p_dog: dog,
      p_expected_version: 1,
      p_title: "Zalecenia po zachowanym spotkaniu",
      p_body: "Druga publikacja nie zastępuje pierwszej.",
      p_follow_up_on: null,
      p_publish: true,
      p_consultation: null,
      p_course_enrollment: history.enrollment,
      p_course_session: history.sessions[0].id,
    });
    await rpc("save_care_plan", {
      p_dog: dog,
      p_expected_version: 2,
      p_title: "Prywatny szkic do kopii",
      p_body: "SZKIC WYŁĄCZNIE DLA PROWADZĄCEJ",
      p_follow_up_on: null,
      p_publish: false,
      p_consultation: null,
      p_course_enrollment: history.enrollment,
      p_course_session: history.sessions[1].id,
    });
    const progress = randomUUID();
    onStage("source-submit_care_progress");
    checked(
      await owner.rpc("submit_care_progress", {
        p_id: progress,
        p_plan: whole.published_id,
        p_attempted: "Praca według pierwszej wersji.",
        p_went_well: "Zachowano wcześniejsze zalecenia.",
        p_difficult: "Odpowiedź czeka na przegląd.",
      }),
    );
    const balance = checked(
      await owner
        .from("course_balances")
        .select("*")
        .eq("id", future.enrollment)
        .single(),
    );
    assert.equal(balance.status, "accepted");
    assert.equal(balance.charge_cents, 10000);
    assert.equal(balance.paid_cents, 3000);
    assert.equal(balance.refunded_cents, 7000);
    assert.equal(balance.due_cents, 7000);
    return {
      future,
      history,
      settings,
      wholePlan,
      whole,
      meeting,
      payment,
      settlement,
      refund,
      reopening,
      correction,
      progress,
    };
  } finally {
    await sql.close();
  }
}

export async function verifyBackupCourses({
  http,
  json,
  headers,
  owner,
  stranger,
  staff,
  dog,
  fixture,
  source,
  report,
  onStage,
}) {
  const {
    future,
    history,
    settings,
    wholePlan,
    whole,
    meeting,
    payment,
    settlement,
    refund,
    reopening,
    correction,
    progress,
  } = fixture;
  const get = (path, user) => {
    onStage(`restore-read-${path.slice(1).split("?")[0]}`);
    const response = http("rest", path, { headers: headers(user) });
    assert.equal(response.status, 200, "Odtworzony odczyt kursu musi działać.");
    return json(response);
  };
  const rpc = (name, args, user = staff) => {
    onStage(`restore-${name}`);
    const response = http("rest", `/rpc/${name}`, {
      method: "POST",
      headers: { ...headers(user), "Content-Type": "application/json" },
      body: args,
    });
    assert.equal(
      response.status,
      200,
      "Odtworzona operacja kursu musi działać.",
    );
    return json(response);
  };
  const before = checked(
    await source
      .from("course_balances")
      .select("*")
      .eq("id", future.enrollment)
      .single(),
  );
  assert.deepEqual(
    get(`/course_balances?select=*&id=eq.${future.enrollment}`, owner),
    [before],
  );
  assert.deepEqual(
    get(`/course_balances?select=id&id=eq.${future.enrollment}`, stranger),
    [],
  );
  const originalPayments = get(
    `/payments?select=*&course_enrollment_id=eq.${future.enrollment}`,
    owner,
  );
  assert.equal(originalPayments.length, 1);
  assert.equal(originalPayments[0].id, payment);
  assert.equal(originalPayments[0].amount_cents, 10000);
  assert.equal(originalPayments[0].status, "paid");
  const refunds = get(
    `/course_payment_refunds?select=id,amount_cents,enrollment_id&enrollment_id=eq.${future.enrollment}`,
    owner,
  );
  assert.deepEqual(refunds, [
    {
      id: refund.p_request_id,
      amount_cents: 7000,
      enrollment_id: future.enrollment,
    },
  ]);
  assert.deepEqual(
    get(
      `/course_payment_refunds?select=id&enrollment_id=eq.${future.enrollment}`,
      stranger,
    ),
    [],
  );
  assert.deepEqual(
    get(
      `/course_settlement_receipts?select=request_id&request_id=eq.${settlement.p_request_id}`,
      staff,
    ),
    [{ request_id: settlement.p_request_id }],
  );
  assert.deepEqual(
    get(
      `/course_settlement_receipts?select=request_id&request_id=eq.${settlement.p_request_id}`,
      owner,
    ),
    [],
  );
  assert.deepEqual(
    get(
      `/course_reopening_receipts?select=source_version,result_version,previous_charge_cents&enrollment_id=eq.${future.enrollment}`,
      staff,
    ),
    [{ source_version: 6, result_version: 7, previous_charge_cents: 3000 }],
  );
  assert.deepEqual(
    get(
      `/course_reopening_receipts?select=enrollment_id&enrollment_id=eq.${future.enrollment}`,
      owner,
    ),
    [],
  );
  assert.deepEqual(
    get(
      `/course_session_private_details?select=exact_location&session_id=in.(${future.sessions.map((s) => s.id).join(",")})`,
      owner,
    ),
    Array.from({ length: 5 }, () => ({
      exact_location: "PRYWATNA ZBIÓRKA PRÓBY KOPII",
    })),
  );
  assert.deepEqual(
    get(
      `/course_session_private_details?select=session_id&session_id=in.(${future.sessions.map((s) => s.id).join(",")})`,
      stranger,
    ),
    [],
  );
  const attendancePath = `/course_attendance?select=attendance,version&session_id=eq.${history.sessions[0].id}&enrollment_id=eq.${history.enrollment}`;
  assert.deepEqual(get(attendancePath, owner), [
    { attendance: "excused", version: 2 },
  ]);
  assert.deepEqual(
    get(
      `/course_attendance_corrections?select=previous_attendance,attendance,note&enrollment_id=eq.${history.enrollment}`,
      owner,
    ),
    [
      {
        previous_attendance: "present",
        attendance: "excused",
        note: correction.p_note,
      },
    ],
  );
  assert.deepEqual(
    get(
      `/course_attendance_corrections?select=enrollment_id&enrollment_id=eq.${history.enrollment}`,
      stranger,
    ),
    [],
  );
  assert.deepEqual(
    get(
      `/care_plan_versions?select=id,course_id,course_enrollment_id,course_session_id&id=eq.${whole.published_id}`,
      owner,
    ),
    [
      {
        id: whole.published_id,
        course_id: future.id,
        course_enrollment_id: future.enrollment,
        course_session_id: null,
      },
    ],
  );
  assert.deepEqual(
    get(
      `/care_plan_versions?select=id,course_id,course_enrollment_id,course_session_id&id=eq.${meeting.published_id}`,
      owner,
    ),
    [
      {
        id: meeting.published_id,
        course_id: history.id,
        course_enrollment_id: history.enrollment,
        course_session_id: history.sessions[0].id,
      },
    ],
  );
  assert.deepEqual(
    get(`/care_plan_versions?select=id&dog_id=eq.${dog}`, stranger),
    [],
  );
  assert.deepEqual(
    get(`/care_drafts?select=body,version&dog_id=eq.${dog}`, staff),
    [{ body: "SZKIC WYŁĄCZNIE DLA PROWADZĄCEJ", version: 3 }],
  );
  assert.deepEqual(get(`/care_drafts?select=body&dog_id=eq.${dog}`, owner), []);
  assert.deepEqual(
    get(`/care_progress?select=plan_id,reviewed_at&id=eq.${progress}`, staff),
    [{ plan_id: whole.published_id, reviewed_at: null }],
  );
  const notices = get(
    `/notifications?select=kind,course_enrollment_id&course_enrollment_id=eq.${future.enrollment}&kind=eq.course_enrollment_reopened`,
    owner,
  );
  assert.deepEqual(notices, [
    {
      kind: "course_enrollment_reopened",
      course_enrollment_id: future.enrollment,
    },
  ]);
  assert.equal(
    get(
      `/reminder_jobs?select=id&course_enrollment_id=eq.${future.enrollment}&status=eq.pending`,
      staff,
    ).length,
    5,
  );
  const denied = http("rest", "/rpc/reopen_course_enrollment", {
    method: "POST",
    headers: { ...headers(owner), "Content-Type": "application/json" },
    body: reopening,
  });
  assert(
    denied.status >= 400,
    "Opiekun nie może wykonywać powrotu w odtworzonym stosie.",
  );
  // Mutations apply to the isolated restored resources only. Earlier exact
  // retries must still recognize their original receipts and authors.
  assert.equal(
    rpc("edit_course", {
      ...settings,
      p_expected_version: 3,
      p_title: "ZMIANA TYLKO W ODTWORZENIU",
      p_request_id: randomUUID(),
    }),
    4,
  );
  assert.equal(rpc("edit_course", settings), 3);
  assert.deepEqual(
    get(`/courses?select=title,version&id=eq.${future.id}`, staff),
    [{ title: "ZMIANA TYLKO W ODTWORZENIU", version: 4 }],
  );
  assert.equal(rpc("settle_course_enrollment", settlement), 5);
  assert.equal(rpc("refund_course_payment", refund), refund.p_request_id);
  assert.equal(
    rpc("save_care_plan", wholePlan).published_id,
    whole.published_id,
  );
  rpc("record_payment", {
    p_registration: null,
    p_package: null,
    p_amount_cents: 7000,
    p_method: "transfer",
    p_note: "Wpłata tylko w odtworzeniu",
    p_request_id: randomUUID(),
    p_consultation: null,
    p_course_enrollment: future.enrollment,
  });
  assert.equal(rpc("reopen_course_enrollment", reopening), 7);
  const after = get(
    `/course_balances?select=version,charge_cents,paid_cents,refunded_cents,due_cents&id=eq.${future.enrollment}`,
    owner,
  );
  assert.deepEqual(after, [
    {
      version: 8,
      charge_cents: 10000,
      paid_cents: 10000,
      refunded_cents: 7000,
      due_cents: 0,
    },
  ]);
  assert.equal(
    rpc("correct_course_attendance", {
      ...correction,
      p_expected_version: 2,
      p_attendance: "present",
      p_note: "Korekta tylko w odtworzeniu",
    }),
    3,
  );
  assert.equal(rpc("correct_course_attendance", correction), 2);
  assert.deepEqual(get(attendancePath, owner), [
    { attendance: "present", version: 3 },
  ]);
  assert.deepEqual(
    checked(
      await source
        .from("course_balances")
        .select("*")
        .eq("id", future.enrollment)
        .single(),
    ),
    before,
  );
  assert.deepEqual(
    checked(
      await source.from("courses").select("title,version").eq("id", future.id),
    ),
    [{ title: settings.p_title, version: 3 }],
  );
  assert.deepEqual(
    checked(
      await source
        .from("course_attendance")
        .select("attendance,version")
        .eq("session_id", history.sessions[0].id)
        .eq("enrollment_id", history.enrollment),
    ),
    [{ attendance: "excused", version: 2 }],
  );
  report.course_restore_verified = {
    courses: 2,
    settlement: true,
    partial_refund: true,
    restoration: true,
    settings_receipt: true,
    attendance_correction: true,
    publications: 2,
    private_draft: true,
    historical_response: true,
    pending_reminders: 5,
    guardian_notice: true,
    rls: true,
    restored_mutations: true,
    historical_retries: true,
    source_unchanged: true,
  };
}

export async function disposeBackupCourses(db, dog, courses) {
  if (!dog) return;
  const followups = checked(
    await db.from("care_follow_ups").select("id").eq("dog_id", dog),
  );
  if (followups.length)
    checked(
      await db
        .from("care_follow_up_history")
        .delete()
        .in(
          "follow_up_id",
          followups.map((f) => f.id),
        ),
    );
  for (const table of [
    "care_follow_ups",
    "care_progress",
    "care_events",
    "care_drafts",
    "care_plan_versions",
    "payments",
  ])
    checked(await db.from(table).delete().eq("dog_id", dog));
  if (courses.length)
    checked(await db.from("courses").delete().in("id", courses));
}
