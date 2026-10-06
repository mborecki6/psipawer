// Real API fixtures for the physical backup rehearsal. All source mutations
// use this run's generated dogs/packages; delivery runs only in the restore.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { LocalPostgres } from "./local-postgres.mjs";

const service = "60000000-0000-4000-8000-000000000006";
const location = "FIKCYJNA ZBIÓRKA PRÓBY KOPII FITNESS";
const checked = (reply) => {
  assert(!reply.error, "Próbna operacja fitness musi zakończyć się poprawnie.");
  return reply.data;
};
async function snapshot({ owner, staff, specs }) {
  const result = [];
  for (const spec of specs) {
    const api = spec.role === "owner" ? owner : staff;
    result.push({
      ...spec,
      rows: checked(
        await api
          .from(spec.table)
          .select("*")
          .in(spec.key, spec.ids)
          .order(spec.order),
      ),
    });
  }
  return result;
}

export async function prepareBackupFitness({
  db,
  staff,
  owner,
  guardianId,
  fitness,
  onStage,
}) {
  const sql = await new LocalPostgres().ready();
  const retries = [];
  const actors = { owner, staff };
  async function rpc(name, args, role = "staff", remember = true) {
    onStage(`source-fitness-${name}`);
    const result = checked(await actors[role].rpc(name, args));
    if (remember) retries.push({ name, args, role, result });
    return result;
  }
  const pack = async (id) =>
    checked(
      await staff.from("fitness_packages").select("*").eq("id", id).single(),
    );
  const change = async (id, action, role = "staff") =>
    rpc(
      "change_fitness_package",
      {
        p_id: id,
        p_expected_version: (await pack(id)).version,
        p_action: action,
        p_note: "Zachowana decyzja próby kopii",
        p_request_id: randomUUID(),
      },
      role,
    );
  const free = async (past = false) => {
    const value =
      await sql.json(`select to_json(${past ? "max" : "min"}(t)) from (
      select now()${past ? "-" : "+"}interval '3 years'+make_interval(days=>n) t from generate_series(1,90) n
    ) candidates where not exists(select 1 from public.calendar_slots slot where slot.occupied && tstzrange(t,t+interval '45 minutes','[)'));`);
    assert.equal(typeof value, "string");
    return value;
  };
  const schedule = (meeting, starts) =>
    rpc("save_fitness_session", {
      p_id: meeting.id,
      p_expected_version: meeting.version,
      p_starts_at: starts,
      p_location: location,
      p_note: "Zachowany termin kopii fitness",
      p_request_id: randomUUID(),
    });
  async function createPackage(title) {
    const dog = randomUUID(),
      id = randomUUID();
    fitness.dogs.push(dog);
    onStage("source-fitness-dog");
    checked(
      await db
        .from("dogs")
        .insert({ id: dog, guardian_id: guardianId, name: title }),
    );
    fitness.packages.push(id);
    const terms = checked(
      await staff
        .from("services")
        .select("version,price_cents,sessions_count,duration_minutes")
        .eq("id", service)
        .single(),
    );
    assert.deepEqual(
      {
        price: terms.price_cents,
        count: terms.sessions_count,
        duration: terms.duration_minutes,
      },
      { price: 10000, count: 4, duration: 45 },
    );
    await rpc(
      "request_fitness_package",
      {
        p_id: id,
        p_dog: dog,
        p_service: service,
        p_expected_service_version: terms.version,
        p_topic: "Fikcyjny cel próby odtworzenia",
        p_availability: "Popołudnia",
      },
      "owner",
    );
    await change(id, "accept");
    const meetings = checked(
      await staff
        .from("fitness_sessions")
        .select("id,ordinal,version")
        .eq("package_id", id)
        .order("ordinal"),
    );
    assert.equal(meetings.length, 4);
    const payment = await rpc("record_fitness_payment", {
      p_package: id,
      p_amount_cents: 10000,
      p_method: "transfer",
      p_note: "Pierwotna wpłata fitness do kopii",
      p_request_id: randomUUID(),
    });
    return { dog, id, meetings, payment };
  }
  const settleAndRefund = async (p) => {
    await change(p.id, "cancel", "owner");
    await rpc("settle_fitness_package", {
      p_id: p.id,
      p_expected_version: (await pack(p.id)).version,
      p_amount_cents: 3000,
      p_note: "Zachowane uzgodnienie rezygnacji fitness",
      p_request_id: randomUUID(),
    });
    await rpc("refund_fitness_payment", {
      p_payment: p.payment,
      p_amount_cents: 7000,
      p_note: "Zachowany rzeczywisty częściowy zwrot fitness",
      p_request_id: randomUUID(),
    });
  };
  try {
    const active = await createPackage("Aktywny pies fitness próby kopii");
    await settleAndRefund(active);
    await change(active.id, "restore");
    // Restoration deliberately makes all cancelled meetings pending, with
    // fresh versions. Re-read them before scheduling instead of inventing IDs.
    active.meetings = checked(
      await staff
        .from("fitness_sessions")
        .select("id,ordinal,version")
        .eq("package_id", active.id)
        .order("ordinal"),
    );
    const wholePlan = {
      p_dog: active.dog,
      p_expected_version: 0,
      p_title: "Zachowany plan całego pakietu fitness",
      p_body: "Pierwsza własna publikacja prowadzącej do próby kopii.",
      p_follow_up_on: null,
      p_publish: true,
      p_consultation: null,
      p_fitness_package: active.id,
      p_fitness_session: null,
    };
    active.whole = await rpc("save_care_plan", wholePlan);
    await schedule(active.meetings[0], await free());
    onStage("source-fitness-own-past-meeting");
    checked(
      await db
        .from("fitness_sessions")
        .update({ starts_at: await free(true) })
        .eq("id", active.meetings[0].id)
        .eq("package_id", active.id),
    );
    const completion = await rpc("change_fitness_session", {
      p_id: active.meetings[0].id,
      p_expected_version: active.meetings[0].version + 1,
      p_action: "complete",
      p_attendance: "present",
      p_note: "Potwierdzone spotkanie próby kopii",
      p_request_id: randomUUID(),
    });
    active.correctedVersion = await rpc("change_fitness_session", {
      p_id: active.meetings[0].id,
      p_expected_version: completion,
      p_action: "correct",
      p_attendance: "excused",
      p_note: "Zachowana korekta obecności fitness",
      p_request_id: randomUUID(),
    });
    active.meetingPlan = await rpc("save_care_plan", {
      ...wholePlan,
      p_expected_version: 1,
      p_title: "Zachowane zalecenia po spotkaniu fitness",
      p_body: "Druga publikacja zachowuje własne spotkanie.",
      p_fitness_session: active.meetings[0].id,
    });
    const near = await sql.json(`select to_json(min(t)) from (
      select now()+make_interval(hours=>n) t from generate_series(3,18,3) n
    ) candidates where not exists(select 1 from public.calendar_slots s where s.occupied && tstzrange(t,t+interval '45 minutes','[)'));`);
    assert.equal(typeof near, "string");
    await schedule(active.meetings[1], near);
    await rpc(
      "save_care_plan",
      {
        ...wholePlan,
        p_expected_version: 2,
        p_publish: false,
        p_title: "Prywatny szkic fitness do kopii",
        p_body: "SZKIC FITNESS WYŁĄCZNIE DLA PROWADZĄCEJ",
        p_fitness_session: active.meetings[1].id,
      },
      "staff",
      false,
    );
    active.progress = randomUUID();
    await rpc(
      "submit_care_progress",
      {
        p_id: active.progress,
        p_plan: active.whole.published_id,
        p_attempted: "Odpowiedź do pierwszego planu fitness.",
        p_went_well: "Zachowano wcześniejszy kontekst.",
        p_difficult: "Odpowiedź czeka na przegląd.",
      },
      "owner",
    );
    const cancelled = await createPackage(
      "Pies fitness po rezygnacji próby kopii",
    );
    await schedule(cancelled.meetings[0], await free());
    cancelled.whole = await rpc("save_care_plan", {
      ...wholePlan,
      p_dog: cancelled.dog,
      p_expected_version: 0,
      p_title: "Plan fitness zachowany po rezygnacji",
      p_fitness_package: cancelled.id,
    });
    await settleAndRefund(cancelled);
    const futureSlot = await free();
    const meetings = [...active.meetings, ...cancelled.meetings].map(
      (m) => m.id,
    );
    const spec = (table, key, ids, role = "owner", order = "id") => ({
      table,
      key,
      ids,
      role,
      order,
    });
    const specs = [
      spec("fitness_packages", "id", fitness.packages),
      spec("fitness_sessions", "package_id", fitness.packages),
      spec("fitness_balances", "id", fitness.packages),
      spec("fitness_history", "package_id", fitness.packages),
      spec("fitness_receipts", "package_id", fitness.packages, "staff"),
      spec("fitness_payment_refunds", "package_id", fitness.packages),
      spec("payments", "fitness_package_id", fitness.packages),
      spec(
        "fitness_session_private_details",
        "session_id",
        meetings,
        "staff",
        "session_id",
      ),
      spec("care_plan_versions", "dog_id", fitness.dogs),
      spec("care_drafts", "dog_id", fitness.dogs, "staff", "dog_id"),
      spec("care_progress", "dog_id", fitness.dogs),
      spec("reminder_jobs", "dog_id", fitness.dogs, "staff"),
      spec("notifications", "dog_id", fitness.dogs),
      spec("notifications", "dog_id", fitness.dogs, "staff"),
    ];
    return {
      active,
      cancelled,
      futureSlot,
      retries,
      snapshots: await snapshot({ owner, staff, specs }),
    };
  } finally {
    await sql.close();
  }
}

export async function verifyBackupFitness({
  http,
  json,
  headers,
  owner,
  staff,
  stranger,
  fixture,
  sourceOwner,
  sourceStaff,
  report,
  onStage,
}) {
  const { active, cancelled, futureSlot, retries, snapshots } = fixture;
  const users = { owner, staff };
  const get = (table, key, ids, user = owner, select = "*", order = "id") => {
    onStage(`restore-fitness-read-${table}`);
    const response = http(
      "rest",
      `/${table}?select=${select}&${key}=in.(${ids.join(",")})&order=${order}.asc`,
      { headers: headers(user) },
    );
    assert.equal(
      response.status,
      200,
      "Odtworzony odczyt fitness musi działać.",
    );
    return json(response);
  };
  const rpc = (name, args, user = staff) => {
    onStage(`restore-fitness-${name}`);
    const response = http("rest", `/rpc/${name}`, {
      method: "POST",
      headers: { ...headers(user), "Content-Type": "application/json" },
      body: args,
    });
    onStage(`restore-fitness-${name}-http-${response.status}`);
    // The progress command returns SQL void. PostgREST correctly answers
    // 204 with no JSON; Supabase's source client represents that as null.
    if (name === "submit_care_progress") {
      assert.equal(response.status, 204);
      assert.equal(response.bytes.length, 0);
      return null;
    }
    assert.equal(
      response.status,
      200,
      "Odtworzona operacja fitness musi działać.",
    );
    return json(response);
  };
  const denied = (name, args, user) => {
    const response = http("rest", `/rpc/${name}`, {
      method: "POST",
      headers: { ...headers(user), "Content-Type": "application/json" },
      body: args,
    });
    assert(
      response.status >= 400,
      "Niedozwolony zapis fitness musi być odrzucony.",
    );
  };
  for (const entry of snapshots)
    assert.deepEqual(
      get(
        entry.table,
        entry.key,
        entry.ids,
        users[entry.role],
        "*",
        entry.order,
      ),
      entry.rows,
    );
  const initialActive = get("fitness_balances", "id", [active.id])[0],
    initialCancelled = get("fitness_balances", "id", [cancelled.id])[0];
  assert.equal(initialActive.status, "active");
  assert.equal(initialActive.paid_cents, 3000);
  assert.equal(initialActive.refunded_cents, 7000);
  assert.equal(initialActive.due_cents, 7000);
  assert.equal(initialCancelled.status, "cancelled");
  assert.equal(initialCancelled.charge_cents, 3000);
  assert.equal(initialCancelled.due_cents, 0);
  for (const [table, key, ids] of [
    ["fitness_packages", "id", [active.id, cancelled.id]],
    ["fitness_sessions", "package_id", [active.id, cancelled.id]],
    ["fitness_balances", "id", [active.id, cancelled.id]],
    ["payments", "fitness_package_id", [active.id, cancelled.id]],
    ["fitness_payment_refunds", "package_id", [active.id, cancelled.id]],
    ["care_plan_versions", "dog_id", [active.dog, cancelled.dog]],
    ["care_progress", "dog_id", [active.dog]],
    ["notifications", "dog_id", [active.dog, cancelled.dog]],
    [
      "fitness_session_private_details",
      "session_id",
      active.meetings.map((m) => m.id),
    ],
  ])
    assert.deepEqual(
      get(
        table,
        key,
        ids,
        stranger,
        "id" === key
          ? "id"
          : table === "fitness_session_private_details"
            ? "session_id"
            : "*",
        table === "fitness_session_private_details" ? "session_id" : "id",
      ),
      [],
    );
  assert.deepEqual(
    get("care_drafts", "dog_id", [active.dog], owner, "*", "dog_id"),
    [],
  );
  assert.deepEqual(
    get("fitness_receipts", "package_id", [active.id], owner),
    [],
  );
  assert.deepEqual(
    get(
      "fitness_session_private_details",
      "session_id",
      active.meetings.map((m) => m.id),
      owner,
      "exact_location",
      "session_id",
    ),
    [{ exact_location: location }, { exact_location: location }],
  );
  assert.deepEqual(
    get(
      "fitness_session_private_details",
      "session_id",
      cancelled.meetings.map((m) => m.id),
      owner,
      "exact_location",
      "session_id",
    ),
    [],
  );
  const feed = rpc(
    "fitness_care_feed",
    { p_package: active.id, p_offset: 0 },
    owner,
  )[0];
  assert.equal(feed.has_draft, false);
  assert.equal(feed.can_prepare, false);
  assert.deepEqual(
    feed.plans.map((p) => p.id),
    [active.meetingPlan.published_id, active.whole.published_id],
  );
  assert.equal(
    rpc("fitness_care_feed", { p_package: active.id, p_offset: 0 })[0]
      .has_draft,
    true,
  );
  assert.deepEqual(
    rpc("fitness_care_feed", { p_package: active.id, p_offset: 0 }, stranger),
    [],
  );
  const progress = get("care_progress", "id", [active.progress], staff)[0];
  assert.equal(progress.plan_id, active.whole.published_id);
  assert.equal(progress.reviewed_at, null);
  denied(
    "record_fitness_payment",
    {
      p_package: active.id,
      p_amount_cents: 7000,
      p_method: "transfer",
      p_note: "Niedozwolony zapis",
      p_request_id: randomUUID(),
    },
    owner,
  );
  denied(
    "save_care_plan",
    {
      p_dog: active.dog,
      p_expected_version: 3,
      p_title: "Obcy plan",
      p_body: "Obcy zapis próby.",
      p_follow_up_on: null,
      p_publish: true,
      p_fitness_package: active.id,
    },
    stranger,
  );

  // Only the isolated restored stack runs delivery. Source jobs and its global
  // worker heartbeat remain byte-for-byte unchanged for the final comparison.
  const ownReminder = () =>
    get("notifications", "fitness_package_id", [active.id]).filter(
      (n) => n.kind === "fitness_reminder",
    );
  assert.equal(ownReminder().length, 0);
  assert(rpc("process_due_reminders", { p_limit: 100 }).sent >= 1);
  const notice = ownReminder();
  assert.equal(notice.length, 1);
  assert.equal(notice[0].fitness_session_id, active.meetings[1].id);
  rpc("process_due_reminders", { p_limit: 100 });
  assert.equal(ownReminder().length, 1);
  denied("read_notifications", { p_ids: [notice[0].id] }, stranger);
  assert.equal(rpc("read_notifications", { p_ids: [notice[0].id] }, owner), 1);
  assert.equal(rpc("read_notifications", { p_ids: [notice[0].id] }, owner), 0);
  assert(ownReminder()[0].read_at);
  const sent = get(
    "reminder_jobs",
    "fitness_package_id",
    [active.id],
    staff,
  ).find(
    (j) =>
      j.fitness_session_id === active.meetings[1].id && j.status === "sent",
  );
  assert(sent);
  assert.equal(sent.attempts, 1);
  assert.equal(
    get("reminder_attempts", "job_id", [sent.id], staff, "*", "attempt").length,
    1,
  );

  rpc("record_fitness_payment", {
    p_package: active.id,
    p_amount_cents: 7000,
    p_method: "transfer",
    p_note: "Wpłata wyłącznie w odtworzeniu fitness",
    p_request_id: randomUUID(),
  });
  const paid = get("fitness_balances", "id", [active.id])[0];
  assert.equal(paid.paid_cents, 10000);
  assert.equal(paid.due_cents, 0);
  rpc("change_fitness_session", {
    p_id: active.meetings[0].id,
    p_expected_version: active.correctedVersion,
    p_action: "correct",
    p_attendance: "present",
    p_note: "Korekta wyłącznie w odtworzeniu fitness",
    p_request_id: randomUUID(),
  });
  const restoredMeeting = get("fitness_sessions", "id", [
    active.meetings[2].id,
  ])[0];
  rpc("save_fitness_session", {
    p_id: restoredMeeting.id,
    p_expected_version: restoredMeeting.version,
    p_starts_at: futureSlot,
    p_location: location,
    p_note: "Termin wyłącznie w odtworzeniu fitness",
    p_request_id: randomUUID(),
  });
  const nextPlan = rpc("save_care_plan", {
    p_dog: active.dog,
    p_expected_version: 3,
    p_title: "Nowy plan wyłącznie w odtworzeniu fitness",
    p_body: "Nowa własna publikacja próby.",
    p_follow_up_on: null,
    p_publish: true,
    p_consultation: null,
    p_fitness_package: active.id,
    p_fitness_session: null,
  });
  rpc("change_fitness_package", {
    p_id: cancelled.id,
    p_expected_version: initialCancelled.version,
    p_action: "restore",
    p_note: "Powrót wyłącznie w odtworzeniu fitness",
    p_request_id: randomUUID(),
  });
  const returned = get("fitness_balances", "id", [cancelled.id])[0];
  assert.equal(returned.status, "active");
  assert.equal(returned.charge_cents, 10000);
  assert.equal(returned.due_cents, 7000);
  for (const retry of retries)
    assert.deepEqual(
      rpc(retry.name, retry.args, users[retry.role]),
      retry.result,
    );
  const final = get("fitness_balances", "id", [active.id])[0];
  assert.equal(final.paid_cents, 10000);
  assert.equal(final.due_cents, 0);
  assert.equal(
    get("fitness_sessions", "id", [active.meetings[0].id])[0].attendance,
    "present",
  );
  assert.equal(
    rpc("fitness_care_feed", { p_package: active.id, p_offset: 0 }, owner)[0]
      .plans[0].id,
    nextPlan.published_id,
  );
  assert.equal(
    get("fitness_balances", "id", [cancelled.id])[0].status,
    "active",
  );
  assert.equal(get("payments", "fitness_package_id", [active.id]).length, 2);
  assert.equal(get("care_plan_versions", "dog_id", [active.dog]).length, 3);
  const responses = get("care_progress", "dog_id", [active.dog], staff);
  assert.equal(responses.length, 1);
  assert.equal(responses[0].id, active.progress);
  assert.equal(responses[0].plan_id, active.whole.published_id);
  assert.equal(responses[0].reviewed_at, null);
  assert.deepEqual(
    await snapshot({
      owner: sourceOwner,
      staff: sourceStaff,
      specs: snapshots,
    }),
    snapshots,
  );
  report.fitness_restore_verified = {
    packages: 2,
    sessions: 8,
    partial_refunds: true,
    restoration: true,
    attendance_correction: true,
    publications_preserved: 3,
    new_publication: true,
    private_draft: true,
    historical_response: true,
    reminder_delivery: true,
    reminder_read: true,
    rls: true,
    restored_mutations: true,
    historical_retries: retries.length,
    source_unchanged: true,
  };
}

export async function disposeBackupFitness(db, fitness) {
  if (!fitness.dogs.length) return;
  const followups = checked(
    await db.from("care_follow_ups").select("id").in("dog_id", fitness.dogs),
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
  ])
    checked(await db.from(table).delete().in("dog_id", fitness.dogs));
  if (fitness.packages.length) {
    checked(
      await db
        .from("payments")
        .delete()
        .in("fitness_package_id", fitness.packages),
    );
    checked(
      await db.from("fitness_packages").delete().in("id", fitness.packages),
    );
  }
  checked(await db.from("dogs").delete().in("id", fitness.dogs));
}
