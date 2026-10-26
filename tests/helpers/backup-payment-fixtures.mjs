import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { LocalPostgres, literal as q } from "./local-postgres.mjs";

const tables = [
  "online_payment_attempts",
  "online_payment_notifications",
  "payments",
  "business_email_outbox",
];
const fixtureDogs = (fixture) =>
  fixture.dogs?.length ? fixture.dogs : fixture.dog ? [fixture.dog] : [];
const ids = (values) => values.map(q).join(",");
const select = (fixture, table) => {
  const attempts = ids(fixture.attempts.map((a) => a.id));
  return `select coalesce(jsonb_agg(to_jsonb(r) order by id),'[]') from public.${table} r where ${
    table === "online_payment_attempts"
      ? `id in (${attempts})`
      : table === "online_payment_notifications"
        ? `attempt_id in (${attempts})`
        : table === "payments"
          ? `dog_id in (${ids(fixtureDogs(fixture))})`
          : `payment_id in (select id from public.payments where dog_id in (${ids(fixtureDogs(fixture))}))`
  };`;
};
const confirm = (
  attempt,
  hash,
) => `select to_jsonb(public.record_online_payment_notification(
  ${q(attempt.id)},'sandbox',${q(attempt.transaction_id)},'backup-merchant','paid',10000,'PLN',
  ${q(attempt.transaction_title)},10000,${q(hash)}));`;

export async function prepareBackupPayments({
  owner,
  staff,
  fixture,
  onStage,
  connect = () => new LocalPostgres().ready(),
}) {
  const db = await connect();
  try {
    fixture.owner = owner.id;
    fixture.dogs = [];
    fixture.targets = [];
    fixture.attempts = [];
    fixture.requests = [];
    fixture.settings = await db.json(
      "select jsonb_build_object('online',(select to_jsonb(s) from public.online_payment_settings s where singleton),'email',(select to_jsonb(s) from public.business_email_settings s where singleton));",
    );
    onStage("source-payment-fixtures");
    await db.query(`update public.online_payment_settings set enabled=true,walk_gate='accepted';
      update public.business_email_settings set enabled=true;`);
    for (let i = 0; i < 3; i++) {
      const target = randomUUID(),
        dog = randomUUID(),
        request = randomUUID();
      fixture.targets.push(target);
      fixture.dogs.push(dog);
      fixture.requests.push(request);
      // Journal exact ownership before the first write, including interrupted setup.
      onStage(`source-payment-fixture-${i + 1}`);
      await db.query(`insert into public.dogs(id,guardian_id,name) values(${q(dog)},${q(owner.id)},'Próba kopii BLIK');
        insert into public.fitness_packages(id,practice_id,dog_id,guardian_id,service_id,service_version,service_name,
        sessions_count,duration_minutes,agreed_price_cents,is_test_price,topic,status,charge_cents,accepted_at,updated_by)
        select ${q(target)},'00000000-0000-4000-8000-000000000001',${q(dog)},${q(owner.id)},id,version,name,
        2,60,10000,true,'Próba kopii wpłaty','active',10000,now(),${q(staff.id)}
        from public.services where booking_flow='fitness' order by id limit 1;
        begin; set local role service_role;`);
      const started = await db.json(
        `select public.begin_online_payment(${q(owner.id)},'fitness',${q(target)},${q(request)},'sandbox',10000,'backup-merchant');`,
      );
      const a = started.attempt;
      const bound = await db.json(
        `select to_jsonb(public.bind_online_payment(${q(a.id)},${q(`backup-${a.id}`)},${q(`title-${a.id}`)},'backup-merchant',${q(`https://secure.sandbox.tpay.com/${a.id}`)}));`,
      );
      fixture.attempts.push(bound);
      onStage(`source-payment-attempt-${i + 1}-owned`);
      if (i < 2) {
        const hash = createHash("sha256").update(a.id).digest("hex");
        await db.json(confirm(bound, hash));
      }
      await db.query("commit;");
    }
    // An interrupted SMTP delivery must stay uncertain after restart/restore.
    await db.query(`update public.business_email_outbox set status='uncertain',finished_at=clock_timestamp(),last_error_code='smtp_uncertain'
      where payment_id=(select payment_id from public.online_payment_attempts where id=${q(fixture.attempts[1].id)});`);
    fixture.snapshots = {};
    for (const table of tables)
      fixture.snapshots[table] = await db.json(select(fixture, table));
    assert.equal(fixture.snapshots.payments.length, 2);
    assert.deepEqual(
      fixture.snapshots.business_email_outbox.map((r) => r.status).sort(),
      ["pending", "uncertain"],
    );
  } finally {
    await db.close();
  }
}

export async function verifyBackupPayments({ sql, fixture, report, onStage }) {
  const json = (statement) => {
    const output = sql(statement).trim();
    // The physical restore's psql helper returns one JSON scalar per call.
    return JSON.parse(output);
  };
  onStage("restore-payments-email");
  for (const table of tables)
    assert.deepEqual(
      json(select(fixture, table)),
      fixture.snapshots[table],
      `${table} survives physical restore`,
    );
  const paid = fixture.attempts[0];
  const hash = createHash("sha256").update(paid.id).digest("hex");
  sql(`begin; set local role service_role; ${confirm(paid, hash)} commit;`);
  assert.equal(
    json(select(fixture, "payments")).length,
    2,
    "Replaying a signed receipt after restore must not duplicate money",
  );
  assert.equal(
    json(select(fixture, "online_payment_notifications")).length,
    2,
    "Duplicate webhook receipt remains once-only",
  );
  assert.equal(
    json(select(fixture, "business_email_outbox")).length,
    2,
    "Replayed payment must not enqueue another email",
  );
  const pending = fixture.attempts[2];
  const pendingHash = createHash("sha256").update(pending.id).digest("hex");
  sql(
    `begin; set local role service_role; ${confirm(pending, pendingHash)} ${confirm(pending, pendingHash)} commit;`,
  );
  assert.equal(
    json(select(fixture, "payments")).length,
    3,
    "An unfinished payment can settle exactly once after restore",
  );
  const email = json(select(fixture, "business_email_outbox"));
  assert.equal(email.length, 3);
  assert.equal(email.filter((r) => r.status === "uncertain").length, 1);
  report.payment_restore_verified = {
    attempts: 3,
    original_receipts: 2,
    replay_receipts: 3,
    email_rows: email.length,
    uncertain_preserved: true,
  };
}

/** Delete care dependencies only for explicitly owned dog IDs, before their parent. */
export async function disposeBackupPaymentCare(db, dogs) {
  if (!dogs.length) return;
  const owned = ids(dogs);
  await db.query(
    `delete from public.care_follow_up_history where follow_up_id in (select id from public.care_follow_ups where dog_id in (${owned}));`,
  );
  for (const table of [
    "care_control_invitations",
    "care_reporting_entitlements",
    "care_follow_ups",
    "care_progress",
    "care_events",
    "care_drafts",
    "care_plan_versions",
  ])
    await db.query(`delete from public.${table} where dog_id in (${owned});`);
}

export async function disposeBackupPayments(
  fixture,
  { connect = () => new LocalPostgres().ready() } = {},
) {
  const dogs = fixtureDogs(fixture);
  if (!dogs.length) return;
  assert(fixture.owner, "Payment fixture cleanup requires its original owner");
  const db = await connect();
  try {
    const owned = ids(dogs);
    const actual = await db.json(
      `select coalesce(jsonb_agg(jsonb_build_object('id',id,'guardian_id',guardian_id) order by id),'[]') from public.dogs where id in (${owned});`,
    );
    assert(
      actual.every((row) => row.guardian_id === fixture.owner),
      "Do not delete another guardian's fixture",
    );
    await db.query("begin;");
    await disposeBackupPaymentCare(db, dogs);
    await db.query(`update public.online_payment_attempts set status='failed',payment_id=null where dog_id in (${owned});
      delete from public.online_payment_notifications where attempt_id in (select id from public.online_payment_attempts where dog_id in (${owned}));
      delete from public.audit_events where entity_id in (select id from public.online_payment_attempts where dog_id in (${owned}) union all select id from public.payments where dog_id in (${owned}));
      delete from public.payments where dog_id in (${owned});
      delete from public.online_payment_attempts where dog_id in (${owned});
      delete from public.fitness_packages where dog_id in (${owned});
      delete from public.notifications where dog_id in (${owned});
      delete from public.dogs where id in (${owned});
      commit;`);
  } finally {
    await db.close();
  }
}

/** Independent connection/stage: a failed fixture DELETE must not leave mail on. */
export async function restoreBackupPaymentSettings(fixture) {
  if (!fixture.settings) return;
  const db = await new LocalPostgres().ready();
  try {
    await db.query(`begin;
      update public.online_payment_settings s set (enabled,walk_gate)=(select enabled,walk_gate from jsonb_populate_record(null::public.online_payment_settings,${q(JSON.stringify(fixture.settings.online))}::jsonb)) where singleton;
      update public.business_email_settings set enabled=${fixture.settings.email.enabled ? "true" : "false"} where singleton;
      update public.business_email_settings set changed_at=${q(fixture.settings.email.changed_at)} where singleton;
      commit;`);
  } finally {
    await db.close();
  }
}
