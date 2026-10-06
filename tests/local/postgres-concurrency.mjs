// Run explicitly with `pnpm local:concurrency`; never part of cloud/E2E setup.
// Fixtures use non-login @example.test users and are removed in the after hook.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { before, after, test } from "node:test";
import {
  LocalPostgres,
  literal as q,
  waitForLock,
} from "../helpers/local-postgres.mjs";

const admin = randomUUID();
const owners = [randomUUID(), randomUUID()];
const dogs = [randomUUID(), randomUUID()];
const users = [admin, ...owners];
const templates = [];
let observer;
let nextSlot;

before(async () => {
  observer = await new LocalPostgres().ready();
  const state = await observer.json(`select json_build_object(
    'database',current_database(), 'version',current_setting('server_version_num')::integer,
    'catalogue',to_regclass('public.services') is not null,
    'calendar',to_regclass('public.calendar_slots') is not null);`);
  assert.equal(state.database, "postgres");
  assert(state.version >= 170000 && state.catalogue && state.calendar);
  // Pick empty future time without moving/deleting any existing appointment.
  const start =
    await observer.json(`select to_json(greatest(now()+interval '30 days',
    coalesce(max(upper(occupied)),now()))+interval '1 day') from public.calendar_slots;`);
  nextSlot = new Date(start).getTime();
  await observer.query(`begin;
    insert into auth.users(id,email) values ${users.map((id) => `(${q(id)},${q(`psi-concurrency-${id}@example.test`)})`).join(",")};
    update public.user_roles set role='admin' where user_id=${q(admin)};
    select set_config('request.jwt.claim.sub',${q(admin)},true);
    insert into public.dogs(id,guardian_id,name,status) values
      (${q(dogs[0])},${q(owners[0])},'Test współbieżności A','approved'),
      (${q(dogs[1])},${q(owners[1])},'Test współbieżności B','approved');
    commit;`);
});

after(async () => {
  if (!observer) return;
  // An SQL syntax/connection failure must not leave this run's fixtures behind.
  if (observer.ended) observer = await new LocalPostgres().ready();
  try {
    await observer.query(`begin;
      delete from public.invitation_attempts where invitation_id in
        (select id from public.client_invitations where created_by=${q(admin)});
      delete from public.client_invitations where created_by=${q(admin)};
      delete from public.payments where dog_id in (${dogs.map(q)});
      delete from public.package_transactions where package_id in
        (select id from public.packages where dog_id in (${dogs.map(q)}));
      delete from public.walks where leader_id=${q(admin)};
      delete from public.packages where dog_id in (${dogs.map(q)});
      delete from public.calendar_blocks where updated_by=${q(admin)};
      delete from public.care_follow_up_history where follow_up_id in
        (select id from public.care_follow_ups where dog_id in (${dogs.map(q)}));
      delete from public.care_follow_ups where dog_id in (${dogs.map(q)});
      delete from public.care_progress where dog_id in (${dogs.map(q)});
      delete from public.care_events where dog_id in (${dogs.map(q)});
      delete from public.care_drafts where dog_id in (${dogs.map(q)});
      delete from public.care_plan_versions where dog_id in (${dogs.map(q)});
      ${templates.length ? `delete from public.care_templates where id in (${templates.map(q)});` : ""}
      delete from public.consultation_events where history_id in
        (select h.id from public.consultation_history h join public.consultations c on c.id=h.consultation_id where c.dog_id in (${dogs.map(q)}));
      delete from public.consultation_history where consultation_id in
        (select id from public.consultations where dog_id in (${dogs.map(q)}));
      delete from public.consultations where dog_id in (${dogs.map(q)});
      delete from public.dogs where id in (${dogs.map(q)});
      delete from public.audit_events where actor_id in (${users.map(q)});
      delete from auth.users where id in (${users.map(q)});
      commit;`);
    assert.equal(
      await observer.json(
        `select to_json(count(*)) from auth.users where id in (${users.map(q)});`,
      ),
      0,
    );
    assert.equal(
      await observer.json(
        `select to_json(count(*)) from public.dogs where id in (${dogs.map(q)});`,
      ),
      0,
    );
    if (templates.length) {
      assert.equal(
        await observer.json(
          `select to_json(count(*)) from public.care_templates where id in (${templates.map(q)});`,
        ),
        0,
      );
    }
  } finally {
    await observer.close();
  }
});

const slot = () => {
  const start = nextSlot;
  nextSlot += 3 * 3600000;
  return [
    new Date(start).toISOString(),
    new Date(start + 3600000).toISOString(),
  ];
};

async function walk({
  capacity = 2,
  accepted = false,
  automatic = false,
  registered = true,
} = {}) {
  const id = randomUUID();
  const registrations = [randomUUID(), randomUUID()];
  const [start] = slot();
  await observer.query(`begin;
    insert into public.walks(id,starts_at,public_location,type,price_cents,capacity,leader_id,booking_mode)
      values(${q(id)},${q(start)},'Lokalna próba','Test współbieżności',10000,${capacity},${q(admin)},${q(automatic ? "automatic" : "approval")});
    ${
      registered
        ? `
    insert into public.walk_registrations(id,walk_id,dog_id,status,payment_status) values
      ${registrations.map((reg, i) => `(${q(reg)},${q(id)},${q(dogs[i])},${q(accepted ? "accepted" : "pending")},${q(accepted ? "due" : "none")})`).join(",")};`
        : ""
    }
    commit;`);
  return { id, registrations };
}

async function invitationDraft() {
  const id = randomUUID();
  await observer.query(`insert into public.client_invitations(id,email,display_name,created_by)
    values(${q(id)},${q(`psi-concurrency-invite-${id}@example.test`)},'Archiwum — próba równoczesna',${q(admin)});`);
  return id;
}
const setArchive = (id, version, archived) =>
  `select public.set_client_invitation_archived(${q(id)},${version},${archived});`;
const claimInvitation = (id) =>
  `select public.claim_client_invitation(${q(id)},1,${q(randomUUID())});`;
async function invitationState(id) {
  return observer.json(`select json_build_object('archived',i.archived_at is not null,'version',i.version,
    'attempts',(select count(*) from public.invitation_attempts where invitation_id=i.id),
    'archive_events',(select count(*) from public.audit_events where entity_id=i.id and event='client_invitation_archived'),
    'restore_events',(select count(*) from public.audit_events where entity_id=i.id and event='client_invitation_restored'))
    from public.client_invitations i where i.id=${q(id)};`);
}

test("archive wins against sending an unused invitation", async (t) => {
  const id = await invitationDraft();
  await race(
    t,
    setArchive(id, 1, true),
    claimInvitation(id),
    /Odśwież zaproszenie/,
  );
  assert.deepEqual(await invitationState(id), {
    archived: true,
    version: 2,
    attempts: 0,
    archive_events: 1,
    restore_events: 0,
  });
});
test("starting delivery prevents archival of the invitation", async (t) => {
  const id = await invitationDraft();
  await race(
    t,
    claimInvitation(id),
    setArchive(id, 1, true),
    /archiwizować tylko/,
  );
  assert.deepEqual(await invitationState(id), {
    archived: false,
    version: 2,
    attempts: 1,
    archive_events: 0,
    restore_events: 0,
  });
});
test("repeated concurrent archive and restore each record one transition", async (t) => {
  const id = await invitationDraft();
  await race(t, setArchive(id, 1, true), setArchive(id, 1, true));
  assert.deepEqual(await invitationState(id), {
    archived: true,
    version: 2,
    attempts: 0,
    archive_events: 1,
    restore_events: 0,
  });
  await race(t, setArchive(id, 2, false), setArchive(id, 2, false));
  assert.deepEqual(await invitationState(id), {
    archived: false,
    version: 3,
    attempts: 0,
    archive_events: 1,
    restore_events: 1,
  });
});

const decide = (id) =>
  `select public.decide_registration(${q(id)},'accepted','Próba równoczesna');`;
const pay = (id, request) =>
  `select public.record_payment(${q(id)},null,10000,'transfer','Próba równoczesna',${q(request)});`;
const cancel = (id) =>
  `select public.cancel_walk(${q(id)},'Lokalna próba odwołania');`;
const outcome = (promise) =>
  promise.then(
    (value) => ({ value }),
    (error) => ({ error }),
  );

async function race(t, first, second, expectedError, actors = [admin, admin]) {
  const a = new LocalPostgres();
  const b = new LocalPostgres();
  let pending;
  try {
    await a.ready();
    await b.ready();
    await a.asUser(actors[0]);
    await b.asUser(actors[1]);
    const resultA = await a.query(first);
    pending = outcome(b.query(second));
    await waitForLock(observer, a, b);
    t.diagnostic(
      `Verified PostgreSQL lock: PID ${b.pid} waited for PID ${a.pid}`,
    );
    await a.query("commit;");
    const resultB = await pending;
    if (expectedError) {
      assert(resultB.error, "Conflicting operation must fail");
      assert.match(resultB.error.message, expectedError);
    } else {
      assert.ifError(resultB.error);
      await b.query("commit;");
    }
    return { first: resultA, second: resultB.value };
  } finally {
    // Disconnect rolls back any uncommitted transaction, including failures.
    await Promise.all([a.close(), b.close()]);
    if (pending) await pending;
  }
}

async function registrations(id) {
  return observer.json(`select coalesce(json_agg(json_build_object('status',status,
    'payment',payment_status) order by dog_id),'[]') from public.walk_registrations where walk_id=${q(id)};`);
}

async function ledger(id) {
  return observer.json(`select json_build_object(
    'count',count(*),'total',coalesce(sum(amount_cents),0),
    'audits',(select count(*) from public.audit_events where event='payment_recorded' and entity_id in
      (select id from public.payments where registration_id=${q(id)})),
    'notifications',(select count(*) from public.notifications where kind='payment_recorded' and entity_id in
      (select id from public.payments where registration_id=${q(id)})))
    from public.payments where registration_id=${q(id)};`);
}

test("last place: two guardians registering automatically cannot exceed capacity", async (t) => {
  const w = await walk({ capacity: 1, automatic: true, registered: false });
  await race(
    t,
    `select public.register_dog(${q(w.id)},${q(dogs[0])});`,
    `select public.register_dog(${q(w.id)},${q(dogs[1])});`,
    /Brak wolnych miejsc/,
    owners,
  );
  assert.deepEqual(await registrations(w.id), [
    { status: "accepted", payment: "due" },
  ]);
  assert.equal(
    await observer.json(`select to_json(count(*)) from public.audit_events
    where event='registration_created' and entity_id in
    (select id from public.walk_registrations where walk_id=${q(w.id)});`),
    1,
  );
});

test("last place: two approvals cannot exceed capacity", async (t) => {
  const w = await walk({ capacity: 1 });
  await race(
    t,
    decide(w.registrations[0]),
    decide(w.registrations[1]),
    /Brak wolnych miejsc/,
  );
  assert.deepEqual(
    (await registrations(w.id)).sort((a, b) =>
      a.status.localeCompare(b.status),
    ),
    [
      { status: "accepted", payment: "due" },
      { status: "pending", payment: "none" },
    ],
  );
  assert.equal(
    await observer.json(`select to_json(count(*)) from public.audit_events
    where event='registration_decided' and entity_id in (${w.registrations.map(q)});`),
    1,
  );
});

test("repeated approval has one decision and one notification", async (t) => {
  const w = await walk();
  await race(t, decide(w.registrations[0]), decide(w.registrations[0]));
  assert.equal(
    await observer.json(`select to_json(count(*)) from public.audit_events
    where event='registration_decided' and entity_id=${q(w.registrations[0])};`),
    1,
  );
  assert.equal(
    await observer.json(`select to_json(count(*)) from public.notifications
    where kind='registration_changed' and entity_id=${q(w.id)};`),
    1,
  );
});

test("same payment request returns the same receipt without duplicate ledger or notification", async (t) => {
  const w = await walk({ accepted: true });
  const request = randomUUID();
  const result = await race(
    t,
    pay(w.registrations[0], request),
    pay(w.registrations[0], request),
  );
  assert.deepEqual(result.first, result.second);
  assert.deepEqual(await ledger(w.registrations[0]), {
    count: 1,
    total: 10000,
    audits: 1,
    notifications: 1,
  });
});

test("different payment requests cannot overpay the same charge", async (t) => {
  const w = await walk({ accepted: true });
  await race(
    t,
    pay(w.registrations[0], randomUUID()),
    pay(w.registrations[0], randomUUID()),
    /przekracza pozostałą kwotę/,
  );
  assert.deepEqual(await ledger(w.registrations[0]), {
    count: 1,
    total: 10000,
    audits: 1,
    notifications: 1,
  });
});

test("payment request reused for a different charge rolls back the second receipt", async (t) => {
  // Different walks avoid the common parent lock: this exercises the unique
  // request key while the first receipt is still invisible to connection B.
  const a = await walk({ accepted: true });
  const b = await walk({ accepted: true });
  const request = randomUUID();
  await race(
    t,
    pay(a.registrations[0], request),
    pay(b.registrations[0], request),
    /identyfikator wpłaty został już użyty/,
  );
  assert.deepEqual(await ledger(a.registrations[0]), {
    count: 1,
    total: 10000,
    audits: 1,
    notifications: 1,
  });
  assert.deepEqual(await ledger(b.registrations[0]), {
    count: 0,
    total: 0,
    audits: 0,
    notifications: 0,
  });
});

for (const cancelFirst of [false, true]) {
  test(`approval versus cancellation: ${cancelFirst ? "cancellation" : "approval"} commits first`, async (t) => {
    const w = await walk();
    await race(
      t,
      cancelFirst ? cancel(w.id) : decide(w.registrations[0]),
      cancelFirst ? decide(w.registrations[0]) : cancel(w.id),
      cancelFirst
        ? /Niedozwolona zmiana statusu|po rozpoczęciu lub odwołaniu/
        : undefined,
    );
    assert(
      (await registrations(w.id)).every(
        (r) => r.status === "cancelled_on_time" && r.payment === "none",
      ),
    );
    assert.equal(
      await observer.json(
        `select to_json(count(*)) from public.calendar_slots where walk_id=${q(w.id)};`,
      ),
      0,
    );
    assert.equal(
      await observer.json(
        `select to_json(count(*)) from public.reminder_jobs where source_id in (${w.registrations.map(q)}) and status in ('pending','retry');`,
      ),
      0,
    );
  });

  test(`payment versus cancellation: ${cancelFirst ? "cancellation" : "payment"} commits first`, async (t) => {
    const w = await walk({ accepted: true });
    const payment = pay(w.registrations[0], randomUUID());
    await race(
      t,
      cancelFirst ? cancel(w.id) : payment,
      cancelFirst ? payment : cancel(w.id),
      cancelFirst ? /nie wymaga wpłaty/ : undefined,
    );
    const count = cancelFirst ? 0 : 1;
    assert.deepEqual(await ledger(w.registrations[0]), {
      count,
      total: count * 10000,
      audits: count,
      notifications: count,
    });
    assert(
      (await registrations(w.id)).every(
        (r) => r.status === "cancelled_on_time" && r.payment !== "due",
      ),
    );
  });
}

for (const blockFirst of [false, true]) {
  test(`calendar collision: ${blockFirst ? "block" : "walk"} commits first`, async (t) => {
    const [start, end] = slot();
    const block = randomUUID();
    const createBlock = `select public.save_calendar_block(${q(block)},0,'Lokalna próba',${q(start)},${q(end)});`;
    const createWalk = `select public.create_walk(${q(
      JSON.stringify({
        starts_at: start,
        duration_minutes: 60,
        public_location: "Lokalna próba",
        exact_location: "Fikcyjne miejsce",
        type: "Test współbieżności",
        price_cents: 10000,
        capacity: 2,
        booking_mode: "approval",
        cancellation_deadline_hours: 24,
      }),
    )}::jsonb);`;
    await race(
      t,
      blockFirst ? createBlock : createWalk,
      blockFirst ? createWalk : createBlock,
      /Ten czas jest już zajęty/,
    );
    assert.equal(
      await observer.json(`select to_json(count(*)) from public.calendar_slots
      where occupied && tstzrange(${q(start)},${q(end)},'[)');`),
      1,
    );
    assert.equal(
      await observer.json(
        `select to_json(count(*)) from public.calendar_blocks where id=${q(block)};`,
      ),
      blockFirst ? 1 : 0,
    );
    assert.equal(
      await observer.json(`select to_json(count(*)) from public.walks
      where leader_id=${q(admin)} and starts_at=${q(start)};`),
      blockFirst ? 0 : 1,
    );
  });
}

async function oneEntryPackage() {
  const id = randomUUID();
  await observer.query(`begin;
    insert into public.packages(id,dog_id,name,price_cents)
      values(${q(id)},${q(dogs[0])},'Test ostatniego wejścia',10000);
    insert into public.package_transactions(package_id,available_delta,reason,author_id)
      values(${q(id)},1,'Fikcyjne wejście do próby',${q(admin)});
    commit;`);
  return id;
}

const usePackage = (registration, pack) =>
  `select public.use_package(${q(registration)},${q(pack)},'Lokalna próba');`;

async function packageBalance(id) {
  return observer.json(`select json_build_object('available',sum(available_delta),
    'reserved',sum(reserved_delta),'used',sum(used_delta),'transactions',count(*))
    from public.package_transactions where package_id=${q(id)};`);
}

test("last package entry cannot be assigned to two different walks", async (t) => {
  const a = await walk({ accepted: true });
  const b = await walk({ accepted: true });
  const pack = await oneEntryPackage();
  await race(
    t,
    usePackage(a.registrations[0], pack),
    usePackage(b.registrations[0], pack),
    /Brak dostępnych wejść/,
  );
  assert.deepEqual(await packageBalance(pack), {
    available: 0,
    reserved: 1,
    used: 0,
    transactions: 2,
  });
  assert.equal(
    await observer.json(
      `select to_json(count(*)) from public.walk_registrations where package_id=${q(pack)};`,
    ),
    1,
  );
});

test("repeated assignment and repeated cancellation return exactly one package entry", async (t) => {
  const w = await walk({ accepted: true });
  const pack = await oneEntryPackage();
  await race(
    t,
    usePackage(w.registrations[0], pack),
    usePackage(w.registrations[0], pack),
  );
  assert.deepEqual(await packageBalance(pack), {
    available: 0,
    reserved: 1,
    used: 0,
    transactions: 2,
  });
  await race(t, cancel(w.id), cancel(w.id));
  assert.deepEqual(await packageBalance(pack), {
    available: 1,
    reserved: 0,
    used: 0,
    transactions: 3,
  });
  assert.equal(
    await observer.json(`select to_json(count(*)) from public.audit_events
    where event='walk_cancelled' and entity_id=${q(w.id)};`),
    1,
  );
});

for (const differentContent of [false, true]) {
  test(`care publication: ${differentContent ? "conflicting edit is preserved as a conflict" : "retry creates one plan and follow-up"}`, async (t) => {
    const dog = dogs[differentContent ? 1 : 0];
    const followUp = slot()[0].slice(0, 10);
    const publish = (body) =>
      `select public.save_care_plan(${q(dog)},0,'Plan próbny',${q(body)},${q(followUp)},true);`;
    const body =
      "Treść fikcyjna do próby współbieżności, bez zaleceń specjalistycznych.";
    const result = await race(
      t,
      publish(body),
      publish(differentContent ? "Inna fikcyjna treść planu do próby." : body),
      differentContent ? /Plan zmienił się/ : undefined,
    );
    if (!differentContent) assert.deepEqual(result.first, result.second);
    const state = await observer.json(`select json_build_object(
      'plans',(select count(*) from public.care_plan_versions where dog_id=${q(dog)}),
      'body',(select body from public.care_plan_versions where dog_id=${q(dog)}),
      'events',(select count(*) from public.care_events where dog_id=${q(dog)} and kind='plan_published'),
      'followUps',(select count(*) from public.care_follow_ups where dog_id=${q(dog)} and status='open'),
      'notifications',(select count(*) from public.notifications where dog_id=${q(dog)} and kind='plan_published'));`);
    assert.deepEqual(state, {
      plans: 1,
      body,
      events: 1,
      followUps: 1,
      notifications: 1,
    });
  });
}

// Each consultation gets its own disposable dog and real domain transitions.
// This avoids changing an existing client, appointment, catalogue or receipt.
async function consultation({ unpriced = false } = {}) {
  const dog = randomUUID(),
    id = randomUUID(),
    start = slot()[0];
  dogs.push(dog);
  await observer.query(`insert into public.dogs(id,guardian_id,name,status)
    values(${q(dog)},${q(owners[0])},'Próba konsultacji równoczesnej','approved');`);
  if (unpriced) {
    await observer.query(`begin;
      insert into public.consultations(id,practice_id,dog_id,requested_by,topic)
        values(${q(id)},'00000000-0000-4000-8000-000000000001',${q(dog)},${q(owners[0])},'Starsza fikcyjna konsultacja bez ceny');
      insert into public.consultation_history(consultation_id,version,action,author_id)
        values(${q(id)},1,'requested',${q(owners[0])}); commit;`);
  } else {
    await observer.asUser(owners[0]);
    await observer.query(`select public.request_consultation(${q(id)},${q(dog)},'Fikcyjne zgłoszenie','',
      '60000000-0000-4000-8000-000000000011',(select version from public.services where id='60000000-0000-4000-8000-000000000011')); commit;`);
  }
  await observer.asUser(admin);
  await observer.query(`${schedule(id, 1, start, "")} commit;`);
  const c = { id, dog, start };
  assert.deepEqual(await consultationMoney(id), {
    status: "scheduled",
    version: 2,
    price: unpriced ? null : 10000,
    paid: 0,
    due: unpriced ? 0 : 10000,
    review: false,
    receipts: 0,
    refunds: 0,
    payment_audits: 0,
    refund_audits: 0,
    payment_notifications: 0,
    refund_notifications: 0,
  });
  return c;
}
const schedule = (id, version, start, note = "Fikcyjna zmiana terminu") =>
  `select public.change_consultation(${q(id)},${version},'schedule',${q(start)},90,'online','Fikcyjne połączenie',${q(note)});`;
const cancelConsultation = (id, version = 2) =>
  `select public.change_consultation(${q(id)},${version},'cancel',null,null,null,null,'Fikcyjne odwołanie');`;
const payConsultation = (id, amount = 4000, request = randomUUID()) =>
  `select public.record_payment(null,null,${amount},'transfer','Fikcyjna wpłata',${q(request)},${q(id)});`;
const refund = (id) =>
  `select public.void_payment(${q(id)},'Fikcyjny zwrot do próby');`;
async function consultationMoney(id) {
  return observer.json(`select json_build_object('status',c.status,'version',c.version,'price',b.agreed_price_cents,
    'paid',b.paid_cents,'due',b.due_cents,'review',b.needs_review,
    'receipts',(select count(*) from public.payments where consultation_id=c.id),
    'refunds',(select count(*) from public.payments where consultation_id=c.id and status='refunded'),
    'payment_audits',(select count(*) from public.audit_events where event='payment_recorded' and entity_id in (select id from public.payments where consultation_id=c.id)),
    'refund_audits',(select count(*) from public.audit_events where event='payment_refunded' and entity_id in (select id from public.payments where consultation_id=c.id)),
    'payment_notifications',(select count(*) from public.notifications where recipient_id=${q(owners[0])} and kind='payment_recorded' and entity_id in (select id from public.payments where consultation_id=c.id)),
    'refund_notifications',(select count(*) from public.notifications where recipient_id=${q(owners[0])} and kind='payment_refunded' and entity_id in (select id from public.payments where consultation_id=c.id)))
    from public.consultations c join public.consultation_balances b on b.id=c.id where c.id=${q(id)};`);
}
async function consultationCalendar(id) {
  return observer.json(`select json_build_object(
    'slot_start',(select lower(occupied) from public.calendar_slots where consultation_id=${q(id)}),
    'history',(select json_agg(action order by version) from public.consultation_history where consultation_id=${q(id)}),
    'reminders',(select coalesce(json_agg(status order by generation),'[]') from public.reminder_jobs where kind='consultation' and source_id=${q(id)}),
    'rescheduled_notifications',(select count(*) from public.notifications where entity_id=${q(id)} and recipient_id=${q(owners[0])} and kind='consultation_rescheduled'));
  `);
}
async function asStaff(statement) {
  await observer.asUser(admin);
  const result = await observer.query(statement);
  await observer.query("commit;");
  return result;
}

const attendance = (id, status) =>
  `select public.mark_attendance(${q(id)},${q(status)});`;
const guardianCancellation = (id) =>
  `select public.cancel_registration(${q(id)});`;

async function startFixtureWalk(id) {
  const past = await observer.json(`select to_json(candidate) from
    generate_series(date_trunc('hour',now())-interval '3 days',
      date_trunc('hour',now())-interval '1 day',interval '1 hour') candidate
    where not exists(select 1 from public.calendar_slots
      where occupied && tstzrange(candidate,candidate+interval '1 hour','[)'))
    order by candidate limit 1;`);
  assert(past, "Use an unoccupied historical time for this fixture only");
  await observer.query(`update public.walks set starts_at=${q(past)},status='completed'
    where id=${q(id)} and leader_id=${q(admin)};`);
}
async function walkSettlement(id) {
  return observer.json(`select json_build_object('status',r.status,'attendance',r.attendance,
    'payment',r.payment_status,'package',r.package_id,
    'receipts',(select count(*) from public.payments where registration_id=r.id),
    'paid',(select coalesce(sum(amount_cents) filter(where status='paid'),0) from public.payments where registration_id=r.id),
    'refunds',(select count(*) from public.payments where registration_id=r.id and status='refunded'),
    'attendance_audits',(select count(*) from public.audit_events where entity_id=r.id and event='attendance_changed'),
    'cancellation_audits',(select count(*) from public.audit_events where entity_id=r.id and event='registration_cancelled'),
    'refund_audits',(select count(*) from public.audit_events where event='payment_refunded' and entity_id in
      (select id from public.payments where registration_id=r.id)))
    from public.walk_registrations r where id=${q(id)};`);
}

for (const cancellationFirst of [false, true]) {
  test(`walk guardian cancellation/payment: ${cancellationFirst ? "cancellation" : "payment"} commits first`, async (t) => {
    const w = await walk({ accepted: true }),
      id = w.registrations[0];
    await race(
      t,
      cancellationFirst ? guardianCancellation(id) : pay(id, randomUUID()),
      cancellationFirst ? pay(id, randomUUID()) : guardianCancellation(id),
      cancellationFirst ? /nie wymaga wpłaty/ : undefined,
      cancellationFirst ? [owners[0], admin] : [admin, owners[0]],
    );
    assert.deepEqual(await walkSettlement(id), {
      status: "cancelled_on_time",
      attendance: "pending",
      payment: cancellationFirst ? "none" : "paid",
      package: null,
      receipts: cancellationFirst ? 0 : 1,
      paid: cancellationFirst ? 0 : 10000,
      refunds: 0,
      attendance_audits: 0,
      cancellation_audits: 1,
      refund_audits: 0,
    });
    assert.equal(
      await observer.json(`select to_json(count(*)) from public.reminder_jobs
      where kind='walk' and source_id=${q(id)} and status in ('pending','retry');`),
      0,
    );
    assert.equal(
      await observer.json(`select to_json(count(*)) from public.notifications
      where entity_id=${q(w.id)} and recipient_id=${q(admin)} and kind='registration_cancelled';`),
      1,
    );
  });
}
for (const attendanceFirst of [false, true]) {
  test(`walk excused absence/payment: ${attendanceFirst ? "attendance" : "payment"} commits first`, async (t) => {
    const w = await walk({ accepted: true }),
      id = w.registrations[0];
    await startFixtureWalk(w.id);
    await race(
      t,
      attendanceFirst ? attendance(id, "absent") : pay(id, randomUUID()),
      attendanceFirst ? pay(id, randomUUID()) : attendance(id, "absent"),
      attendanceFirst ? /nie wymaga wpłaty/ : undefined,
    );
    assert.deepEqual(await walkSettlement(id), {
      status: "accepted",
      attendance: "absent",
      payment: attendanceFirst ? "none" : "paid",
      package: null,
      receipts: attendanceFirst ? 0 : 1,
      paid: attendanceFirst ? 0 : 10000,
      refunds: 0,
      attendance_audits: 1,
      cancellation_audits: 0,
      refund_audits: 0,
    });
  });
  test(`walk excused absence/refund: ${attendanceFirst ? "attendance" : "refund"} commits first`, async (t) => {
    const w = await walk({ accepted: true }),
      id = w.registrations[0];
    const [payment] = await asStaff(pay(id, randomUUID()));
    await startFixtureWalk(w.id);
    await race(
      t,
      attendanceFirst ? attendance(id, "absent") : refund(payment),
      attendanceFirst ? refund(payment) : attendance(id, "absent"),
    );
    assert.deepEqual(await walkSettlement(id), {
      status: "accepted",
      attendance: "absent",
      payment: "refunded",
      package: null,
      receipts: 1,
      paid: 0,
      refunds: 1,
      attendance_audits: 1,
      cancellation_audits: 0,
      refund_audits: 1,
    });
  });
}

for (const correctionFirst of [false, true]) {
  test(`returned package entry: ${correctionFirst ? "attendance correction" : "future allocation"} commits first`, async (t) => {
    const past = await walk({ accepted: true }),
      future = await walk({ accepted: true }),
      pack = await oneEntryPackage();
    const oldReg = past.registrations[0],
      nextReg = future.registrations[0];
    await asStaff(usePackage(oldReg, pack));
    await startFixtureWalk(past.id);
    await asStaff(attendance(oldReg, "absent"));
    await race(
      t,
      correctionFirst
        ? attendance(oldReg, "present")
        : usePackage(nextReg, pack),
      correctionFirst
        ? usePackage(nextReg, pack)
        : attendance(oldReg, "present"),
      /Brak dostępnych wejść/,
    );
    assert.deepEqual(await packageBalance(pack), {
      available: 0,
      reserved: correctionFirst ? 0 : 1,
      used: correctionFirst ? 1 : 0,
      transactions: 4,
    });
    const old = await walkSettlement(oldReg),
      next = await walkSettlement(nextReg);
    assert.equal(old.attendance, correctionFirst ? "present" : "absent");
    assert.equal(old.attendance_audits, correctionFirst ? 2 : 1);
    assert.equal(old.payment, "none");
    assert.equal(old.receipts, 0);
    assert.equal(next.package, correctionFirst ? null : pack);
    assert.equal(next.payment, correctionFirst ? "due" : "none");
    assert.equal(next.receipts, 0);
  });
}
for (const status of ["present", "absent"]) {
  test(`repeated concurrent package attendance ${status} changes one entry and records one audit`, async (t) => {
    const w = await walk({ accepted: true }),
      id = w.registrations[0],
      pack = await oneEntryPackage();
    await asStaff(usePackage(id, pack));
    await startFixtureWalk(w.id);
    await race(t, attendance(id, status), attendance(id, status));
    assert.deepEqual(await packageBalance(pack), {
      available: status === "absent" ? 1 : 0,
      reserved: 0,
      used: status === "present" ? 1 : 0,
      transactions: 3,
    });
    const state = await walkSettlement(id);
    assert.equal(state.attendance, status);
    assert.equal(state.attendance_audits, 1);
    assert.equal(state.payment, "none");
    assert.equal(state.receipts, 0);
  });
}

test("consultation payment retry records one partial receipt, audit and notification", async (t) => {
  const c = await consultation(),
    request = randomUUID();
  const result = await race(
    t,
    payConsultation(c.id, 4000, request),
    payConsultation(c.id, 4000, request),
  );
  assert.deepEqual(result.first, result.second);
  assert.deepEqual(await consultationMoney(c.id), {
    status: "scheduled",
    version: 2,
    price: 10000,
    paid: 4000,
    due: 6000,
    review: false,
    receipts: 1,
    refunds: 0,
    payment_audits: 1,
    refund_audits: 0,
    payment_notifications: 1,
    refund_notifications: 0,
  });
});
test("different consultation payments cannot jointly exceed the remaining charge", async (t) => {
  const c = await consultation();
  await race(
    t,
    payConsultation(c.id, 7000),
    payConsultation(c.id, 4000),
    /przekracza pozostałą/,
  );
  const state = await consultationMoney(c.id);
  assert.equal(state.paid, 7000);
  assert.equal(state.due, 3000);
  assert.equal(state.receipts, 1);
  assert.equal(state.payment_audits, 1);
  assert.equal(state.payment_notifications, 1);
});
for (const cancellationFirst of [false, true]) {
  test(`consultation cancellation/payment: ${cancellationFirst ? "cancellation" : "payment"} commits first`, async (t) => {
    const c = await consultation(),
      request = randomUUID(),
      pay = payConsultation(c.id, 4000, request),
      cancel = cancelConsultation(c.id);
    await race(
      t,
      cancellationFirst ? cancel : pay,
      cancellationFirst ? pay : cancel,
      cancellationFirst ? /tylko dla umówionej/ : undefined,
    );
    assert.deepEqual(await consultationMoney(c.id), {
      status: "cancelled",
      version: 3,
      price: 10000,
      paid: cancellationFirst ? 0 : 4000,
      due: 0,
      review: !cancellationFirst,
      receipts: cancellationFirst ? 0 : 1,
      refunds: 0,
      payment_audits: cancellationFirst ? 0 : 1,
      refund_audits: 0,
      payment_notifications: cancellationFirst ? 0 : 1,
      refund_notifications: 0,
    });
    assert.deepEqual(await consultationCalendar(c.id), {
      slot_start: null,
      history: ["requested", "scheduled", "cancelled"],
      reminders: ["cancelled"],
      rescheduled_notifications: 0,
    });
    if (!cancellationFirst) {
      const first = await asStaff(pay);
      const receipt = await observer.json(
        `select to_json(id) from public.payments where request_id=${q(request)};`,
      );
      assert.deepEqual(first, [receipt]);
      await asStaff(refund(receipt));
      await asStaff(pay); // An exact retry after refund must not create a charge.
      const state = await consultationMoney(c.id);
      assert.equal(state.paid, 0);
      assert.equal(state.due, 0);
      assert.equal(state.review, false);
      assert.equal(state.receipts, 1);
      assert.equal(state.refunds, 1);
      assert.equal(state.refund_audits, 1);
    }
  });
}
for (const refundFirst of [false, true]) {
  test(`consultation refund/payment: ${refundFirst ? "refund" : "new payment"} commits first`, async (t) => {
    const c = await consultation(),
      [receipt] = await asStaff(payConsultation(c.id, 6000));
    await race(
      t,
      refundFirst ? refund(receipt) : payConsultation(c.id, 4000),
      refundFirst ? payConsultation(c.id, 10000) : refund(receipt),
    );
    const state = await consultationMoney(c.id);
    assert.equal(state.paid, refundFirst ? 10000 : 4000);
    assert.equal(state.due, refundFirst ? 0 : 6000);
    assert.equal(state.receipts, 2);
    assert.equal(state.refunds, 1);
    assert.equal(state.payment_audits, 2);
    assert.equal(state.refund_audits, 1);
    assert.equal(state.payment_notifications, 2);
    assert.equal(state.refund_notifications, 1);
  });
}
test("concurrent consultation refund retry retains one original receipt and one correction", async (t) => {
  const c = await consultation(),
    [receipt] = await asStaff(payConsultation(c.id, 10000));
  const result = await race(t, refund(receipt), refund(receipt));
  assert.deepEqual(result.first, result.second);
  const state = await consultationMoney(c.id);
  assert.equal(state.paid, 0);
  assert.equal(state.due, 10000);
  assert.equal(state.receipts, 1);
  assert.equal(state.refunds, 1);
  assert.equal(state.refund_audits, 1);
  assert.equal(state.refund_notifications, 1);
});
for (const cancellationFirst of [false, true]) {
  test(`consultation reschedule/guardian cancellation: ${cancellationFirst ? "cancellation" : "reschedule"} commits first`, async (t) => {
    const c = await consultation(),
      start = slot()[0],
      cancel = cancelConsultation(c.id),
      reschedule = schedule(c.id, 2, start);
    await race(
      t,
      cancellationFirst ? cancel : reschedule,
      cancellationFirst ? reschedule : cancel,
      /Konsultacja zmieniła się/,
      cancellationFirst ? [owners[0], admin] : [admin, owners[0]],
    );
    const money = await consultationMoney(c.id),
      calendar = await consultationCalendar(c.id);
    assert.equal(money.status, cancellationFirst ? "cancelled" : "scheduled");
    assert.equal(money.version, 3);
    assert.equal(money.due, cancellationFirst ? 0 : 10000);
    assert.equal(money.price, 10000);
    assert.deepEqual(calendar.history, [
      "requested",
      "scheduled",
      cancellationFirst ? "cancelled" : "rescheduled",
    ]);
    assert.deepEqual(
      calendar.reminders,
      cancellationFirst ? ["cancelled"] : ["cancelled", "pending"],
    );
    assert.equal(calendar.rescheduled_notifications, cancellationFirst ? 0 : 1);
    if (cancellationFirst) assert.equal(calendar.slot_start, null);
    else assert.equal(Date.parse(calendar.slot_start), Date.parse(start));
  });
}
for (const paymentFirst of [false, true]) {
  test(`consultation reschedule/payment: ${paymentFirst ? "payment" : "reschedule"} commits first`, async (t) => {
    const c = await consultation(),
      start = slot()[0],
      pay = payConsultation(c.id),
      reschedule = schedule(c.id, 2, start);
    await race(
      t,
      paymentFirst ? pay : reschedule,
      paymentFirst ? reschedule : pay,
    );
    const money = await consultationMoney(c.id),
      calendar = await consultationCalendar(c.id);
    assert.equal(money.status, "scheduled");
    assert.equal(money.version, 3);
    assert.equal(money.price, 10000);
    assert.equal(money.paid, 4000);
    assert.equal(money.due, 6000);
    assert.equal(money.receipts, 1);
    assert.equal(Date.parse(calendar.slot_start), Date.parse(start));
    assert.deepEqual(calendar.reminders, ["cancelled", "pending"]);
    assert.equal(calendar.rescheduled_notifications, 1);
  });
}
test("a concurrent request key reused for another consultation is rejected", async (t) => {
  const a = await consultation(),
    b = await consultation(),
    key = randomUUID();
  await race(
    t,
    payConsultation(a.id, 4000, key),
    payConsultation(b.id, 4000, key),
    /identyfikator wpłaty.*innych danych/,
  );
  const first = await consultationMoney(a.id),
    second = await consultationMoney(b.id);
  assert.equal(first.paid, 4000);
  assert.equal(first.receipts, 1);
  assert.equal(first.payment_audits, 1);
  assert.equal(second.paid, 0);
  assert.equal(second.due, 10000);
  assert.equal(second.receipts, 0);
  assert.equal(second.payment_audits, 0);
  assert.equal(second.payment_notifications, 0);
});
test("two consultation reschedules cannot reserve the same practice slot", async (t) => {
  const a = await consultation(),
    b = await consultation(),
    start = slot()[0];
  await race(
    t,
    schedule(a.id, 2, start),
    schedule(b.id, 2, start),
    /koliduje z inną konsultacją/,
  );
  const first = await consultationCalendar(a.id),
    second = await consultationCalendar(b.id);
  assert.equal(Date.parse(first.slot_start), Date.parse(start));
  assert.equal(Date.parse(second.slot_start), Date.parse(b.start));
  assert.deepEqual(first.reminders, ["cancelled", "pending"]);
  assert.deepEqual(second.reminders, ["pending"]);
  assert.deepEqual(second.history, ["requested", "scheduled"]);
  assert.equal(second.rescheduled_notifications, 0);
});

const agreePrice = (id, amount = 17550, key = randomUUID()) =>
  `select public.agree_consultation_price(${q(id)},2,${amount},true,'Fikcyjne uzgodnienie dawnej ceny',${q(key)});`;
async function agreementState(id) {
  return observer.json(`select json_build_object(
    'history',(select count(*) from public.consultation_history where consultation_id=${q(id)} and action='price_agreed'),
    'audit',(select count(*) from public.audit_events where entity_id=${q(id)} and event='consultation_price_agreed'),
    'notification',(select count(*) from public.notifications where entity_id=${q(id)} and recipient_id=${q(owners[0])} and kind='consultation_price_agreed'));`);
}
test("concurrent historical price retries create one agreement, audit and notification", async (t) => {
  const c = await consultation({ unpriced: true }),
    key = randomUUID();
  const before = await consultationCalendar(c.id);
  const result = await race(
    t,
    agreePrice(c.id, 17550, key),
    agreePrice(c.id, 17550, key),
  );
  assert.deepEqual(result.first, result.second);
  const state = await consultationMoney(c.id);
  assert.equal(state.version, 3);
  assert.equal(state.price, 17550);
  assert.equal(state.due, 17550);
  assert.deepEqual(await agreementState(c.id), {
    history: 1,
    audit: 1,
    notification: 1,
  });
  const after = await consultationCalendar(c.id);
  assert.equal(after.slot_start, before.slot_start);
  assert.deepEqual(after.reminders, before.reminders);
});
test("competing historical prices cannot replace the first agreed amount", async (t) => {
  const c = await consultation({ unpriced: true });
  await race(
    t,
    agreePrice(c.id, 17550),
    agreePrice(c.id, 20000),
    /Konsultacja zmieniła się/,
  );
  const state = await consultationMoney(c.id);
  assert.equal(state.price, 17550);
  assert.equal(state.due, 17550);
  assert.equal(state.version, 3);
  assert.deepEqual(await agreementState(c.id), {
    history: 1,
    audit: 1,
    notification: 1,
  });
});
for (const cancellationFirst of [false, true]) {
  test(`historical price/guardian cancellation: ${cancellationFirst ? "cancellation" : "price"} commits first`, async (t) => {
    const c = await consultation({ unpriced: true }),
      price = agreePrice(c.id),
      cancel = cancelConsultation(c.id);
    await race(
      t,
      cancellationFirst ? cancel : price,
      cancellationFirst ? price : cancel,
      /Konsultacja zmieniła się/,
      cancellationFirst ? [owners[0], admin] : [admin, owners[0]],
    );
    const state = await consultationMoney(c.id),
      calendar = await consultationCalendar(c.id);
    assert.equal(state.version, 3);
    assert.equal(state.status, cancellationFirst ? "cancelled" : "scheduled");
    assert.equal(state.price, cancellationFirst ? null : 17550);
    assert.equal(state.due, cancellationFirst ? 0 : 17550);
    assert.deepEqual(calendar.history, [
      "requested",
      "scheduled",
      cancellationFirst ? "cancelled" : "price_agreed",
    ]);
    assert.deepEqual(calendar.reminders, [
      cancellationFirst ? "cancelled" : "pending",
    ]);
    assert.deepEqual(await agreementState(c.id), {
      history: cancellationFirst ? 0 : 1,
      audit: cancellationFirst ? 0 : 1,
      notification: cancellationFirst ? 0 : 1,
    });
  });
}
test("payment waiting for a historical price uses the committed agreement and preserves its balance", async (t) => {
  const c = await consultation({ unpriced: true });
  await race(t, agreePrice(c.id), payConsultation(c.id, 10000));
  const state = await consultationMoney(c.id);
  assert.equal(state.price, 17550);
  assert.equal(state.paid, 10000);
  assert.equal(state.due, 7550);
  assert.equal(state.receipts, 1);
  assert.equal(state.payment_audits, 1);
  assert.deepEqual(await agreementState(c.id), {
    history: 1,
    audit: 1,
    notification: 1,
  });
});
test("a historical price request key reused concurrently for another meeting rolls back the second amount", async (t) => {
  const a = await consultation({ unpriced: true }),
    b = await consultation({ unpriced: true }),
    key = randomUUID();
  await race(
    t,
    agreePrice(a.id, 17550, key),
    agreePrice(b.id, 17550, key),
    /consultation_history_price_request_id_key/,
  );
  const first = await consultationMoney(a.id),
    second = await consultationMoney(b.id);
  assert.equal(first.price, 17550);
  assert.equal(first.version, 3);
  assert.equal(second.price, null);
  assert.equal(second.version, 2);
  assert.equal(second.due, 0);
  assert.deepEqual(await agreementState(a.id), {
    history: 1,
    audit: 1,
    notification: 1,
  });
  assert.deepEqual(await agreementState(b.id), {
    history: 0,
    audit: 0,
    notification: 0,
  });
});

// The editor must compete for the same parent lock as decisions/cancellation.
// Preserve PostgreSQL timestamp precision; a JS Date would truncate the version.
async function walkEdit(id, changes = {}, note = "Lokalna zmiana spaceru") {
  const draft =
    await observer.json(`select json_build_object('version',w.updated_at::text,
    'payload',json_build_object('starts_at',w.starts_at,'duration_minutes',w.duration_minutes,
      'public_location',w.public_location,'type',w.type,'price_cents',w.price_cents,
      'capacity',w.capacity,'booking_mode',w.booking_mode,'info',w.info,
      'cancellation_deadline_hours',w.cancellation_deadline_hours,
      'exact_location',coalesce(d.exact_location,'Fikcyjne miejsce'),
      'map_url',coalesce(d.map_url,''),'instructions',coalesce(d.instructions,'')))
    from public.walks w left join public.walk_private_details d on d.walk_id=w.id where w.id=${q(id)};`);
  return `select public.update_walk(${q(id)},${q(draft.version)}::timestamptz,
    ${q(JSON.stringify({ ...draft.payload, ...changes }))}::jsonb,${q(note)});`;
}

async function walkEditState(id) {
  return observer.json(`select json_build_object('capacity',w.capacity,'status',w.status,
    'location',w.public_location,'price',w.price_cents,
    'start_ms',extract(epoch from w.starts_at)*1000,
    'slot_ms',(select extract(epoch from lower(occupied))*1000 from public.calendar_slots where walk_id=w.id),
    'accepted',(select count(*) from public.walk_registrations where walk_id=w.id and status='accepted'),
    'edits',(select count(*) from public.audit_events where entity_id=w.id and event='walk_updated'),
    'cancellations',(select count(*) from public.audit_events where entity_id=w.id and event='walk_cancelled'),
    'changed_notifications',(select count(*) from public.notifications where entity_id=w.id and kind='walk_changed'),
    'cancelled_notifications',(select count(*) from public.notifications where entity_id=w.id and kind='walk_cancelled'),
    'pending_reminders',(select count(*) from public.reminder_jobs where entity_id=w.id and status in ('pending','retry')))
    from public.walks w where w.id=${q(id)};`);
}

async function editedRegistrations(w) {
  return observer.json(`select json_agg(json_build_object('status',status,'payment',payment_status)
    order by array_position(array[${w.registrations.map(q)}]::uuid[],id))
    from public.walk_registrations where walk_id=${q(w.id)};`);
}

for (const editFirst of [true, false]) {
  test(`capacity reduction/approval: ${editFirst ? "edit" : "approval"} commits first without exceeding the new limit`, async (t) => {
    const w = await walk({ capacity: 2 });
    await asStaff(decide(w.registrations[0]));
    const edit = await walkEdit(w.id, { capacity: 1 });
    await race(
      t,
      editFirst ? edit : decide(w.registrations[1]),
      editFirst ? decide(w.registrations[1]) : edit,
      editFirst ? /Brak wolnych miejsc/ : /Limit nie może być mniejszy/,
    );
    const state = await walkEditState(w.id);
    assert.equal(state.capacity, editFirst ? 1 : 2);
    assert.equal(state.accepted, state.capacity);
    assert.equal(state.edits, editFirst ? 1 : 0);
    assert.equal(state.changed_notifications, editFirst ? 2 : 0);
    assert.equal(state.price, 10000);
    assert.equal(state.start_ms, state.slot_ms);
    assert.equal(state.pending_reminders, state.accepted);
    assert.deepEqual(await editedRegistrations(w), [
      { status: "accepted", payment: "due" },
      {
        status: editFirst ? "pending" : "accepted",
        payment: editFirst ? "none" : "due",
      },
    ]);
  });
}

for (const reverse of [false, true]) {
  test(`two stale walk editors: ${reverse ? "second" : "first"} draft wins; losing location/history stay untouched`, async (t) => {
    const w = await walk({ accepted: true });
    const drafts = [];
    for (const note of ["Pierwsza zmiana", "Druga zmiana"])
      drafts.push(
        await walkEdit(
          w.id,
          { public_location: note, exact_location: `Prywatna ${note}` },
          note,
        ),
      );
    const index = reverse ? 1 : 0;
    await race(
      t,
      drafts[index],
      drafts[1 - index],
      /Spacer zmienił się w międzyczasie/,
    );
    const state = await walkEditState(w.id),
      winner = index ? "Druga zmiana" : "Pierwsza zmiana";
    assert.equal(state.location, winner);
    assert.equal(state.edits, 1);
    assert.equal(state.accepted, 2);
    assert.equal(state.price, 10000);
    assert.equal(state.changed_notifications, 2);
    assert.equal(state.start_ms, state.slot_ms);
    assert.equal(state.pending_reminders, 2);
    assert.equal(
      await observer.json(
        `select to_json(exact_location) from public.walk_private_details where walk_id=${q(w.id)};`,
      ),
      `Prywatna ${winner}`,
    );
  });
}

for (const editFirst of [true, false]) {
  test(`reschedule/organizer cancellation: ${editFirst ? "edit" : "cancellation"} commits first; cancelled time is released`, async (t) => {
    const w = await walk({ accepted: true }),
      target = slot()[0];
    const edit = await walkEdit(w.id, { starts_at: target });
    await race(
      t,
      editFirst ? edit : cancel(w.id),
      editFirst ? cancel(w.id) : edit,
      editFirst ? undefined : /Nie można edytować rozpoczętego lub odwołanego/,
    );
    const state = await walkEditState(w.id);
    assert.equal(state.status, "cancelled");
    assert.equal(state.slot_ms, null);
    assert.equal(state.accepted, 0);
    assert.equal(state.edits, editFirst ? 1 : 0);
    assert.equal(state.cancellations, 1);
    assert.equal(state.changed_notifications, editFirst ? 2 : 0);
    assert.equal(state.cancelled_notifications, 2);
    assert.equal(state.pending_reminders, 0);
    assert(
      (await registrations(w.id)).every(
        (r) => r.status === "cancelled_on_time" && r.payment === "none",
      ),
    );
  });
}

for (const editFirst of [true, false]) {
  test(`earlier date/guardian cancellation: ${editFirst ? "edit" : "cancellation"} commits first; moving within 24h creates no late fee`, async (t) => {
    const w = await walk({ accepted: true });
    // Pick a free near-future hour without moving or deleting any earlier data.
    const target =
      await observer.json(`select to_json(min(candidate)) from generate_series(
      date_trunc('hour',now()+interval '6 hours'),date_trunc('hour',now()+interval '18 hours'),interval '1 hour') candidate
      where not exists(select 1 from public.calendar_slots s where s.occupied && tstzrange(candidate,candidate+interval '1 hour','[)'));`);
    assert(target, "No free near-future fixture time");
    const previous = await walkEditState(w.id);
    const edit = await walkEdit(w.id, { starts_at: target }),
      cancelOwner = guardianCancellation(w.registrations[0]);
    await race(
      t,
      editFirst ? edit : cancelOwner,
      editFirst ? cancelOwner : edit,
      undefined,
      editFirst ? [admin, owners[0]] : [owners[0], admin],
    );
    const state = await walkEditState(w.id);
    assert.equal(state.edits, 1);
    assert.equal(state.accepted, 1);
    assert.equal(state.pending_reminders, 1);
    assert.equal(state.changed_notifications, editFirst ? 2 : 1);
    assert.equal(state.start_ms, Date.parse(target));
    assert.equal(state.slot_ms, state.start_ms);
    assert.deepEqual(await editedRegistrations(w), [
      { status: "cancelled_on_time", payment: "none" },
      { status: "accepted", payment: "due" },
    ]);
    const { grace } =
      await observer.json(`select json_build_object('grace',extract(epoch from cancellation_free_until)*1000)
      from public.walk_registrations where id=${q(w.registrations[0])};`);
    assert.equal(grace, editFirst ? previous.start_ms - 24 * 3600000 : null);
    assert.deepEqual(await ledger(w.registrations[0]), {
      count: 0,
      total: 0,
      audits: 0,
      notifications: 0,
    });
  });
}

// Fresh dogs keep every care race independent of older publications and drafts.
const publishCare = (c, due = c.nextDue) =>
  `select public.save_care_plan(${q(c.dog)},1,'Nowszy plan próbny','Nowsza fikcyjna treść bez porad specjalistycznych.',${due ? q(due) : "null"},true);`;
const changeContact = (
  c,
  action,
  { version = 1, due = null, note = "Prywatna fikcyjna notatka zespołu." } = {},
) =>
  `select public.change_care_follow_up(${q(c.followup)},${version},${q(action)},${due ? q(due) : "null"},${q(note)});`;
const respondCare = (
  c,
  id,
  attempted = "Fikcyjna odpowiedź do pierwotnych zaleceń.",
) =>
  `select public.submit_care_progress(${q(id)},${q(c.plan)},${q(attempted)},'Fikcyjny sukces','Fikcyjna trudność');`;

async function careCase({ closed = false } = {}) {
  const dog = randomUUID();
  dogs.push(dog);
  const due = slot()[0].slice(0, 10),
    nextDue = slot()[0].slice(0, 10);
  // Slots can share a date; a manual reschedule must choose a different date.
  const moved = new Date(`${nextDue}T12:00:00Z`);
  moved.setUTCDate(moved.getUTCDate() + 3);
  const c = { dog, due, nextDue: moved.toISOString().slice(0, 10) };
  await observer.query(`insert into public.dogs(id,guardian_id,name,status)
    values(${q(dog)},${q(owners[0])},'Próba kontaktu równoczesnego','approved');`);
  await observer.asUser(admin);
  const publication =
    await observer.json(`select public.save_care_plan(${q(dog)},0,
    'Plan próbny','Pierwotna fikcyjna treść bez porad specjalistycznych.',${q(due)},true);`);
  await observer.query("commit;");
  c.plan = publication.published_id;
  c.followup = await observer.json(
    `select to_json(id) from public.care_follow_ups where plan_id=${q(c.plan)};`,
  );
  if (closed) {
    await observer.asUser(admin);
    await observer.query(`${changeContact(c, "completed")} commit;`);
  }
  return c;
}

async function contactState(c) {
  return observer.json(`select json_build_object('status',f.status,'version',f.version,'due',f.due_on,
    'history',(select json_agg(json_build_object('version',version,'action',action,'note',note) order by version)
      from public.care_follow_up_history where follow_up_id=f.id),
    'audits',(select count(*) from public.audit_events where event='care_follow_up_changed' and entity_id=f.id),
    'notifications',(select count(*) from public.notifications where kind='follow_up_changed' and entity_id=f.id),
    'waiting',(select count(*) from public.reminder_jobs where source_id=f.id and status in ('pending','retry','failed')),
    'reminders_current',not exists(select 1 from public.reminder_jobs j where j.source_id=f.id and j.status in ('pending','retry','failed')
      and (j.source_token<>f.version::text or j.target_at<>(f.due_on+time '09:00') at time zone 'Europe/Warsaw')))
    from public.care_follow_ups f where f.id=${q(c.followup)};`);
}

async function carePublicationState(c) {
  return observer.json(`select json_build_object(
    'plans',(select count(*) from public.care_plan_versions where dog_id=${q(c.dog)}),
    'original',(select json_build_object('body',body,'due',follow_up_on) from public.care_plan_versions where id=${q(c.plan)}),
    'open',(select count(*) from public.care_follow_ups where dog_id=${q(c.dog)} and status='open'),
    'latest_open',exists(select 1 from public.care_follow_ups where dog_id=${q(c.dog)} and status='open' and
      plan_id=(select id from public.care_plan_versions where dog_id=${q(c.dog)} order by revision desc limit 1)),
    'waiting',(select count(*) from public.reminder_jobs where dog_id=${q(c.dog)} and status in ('pending','retry','failed')));`);
}

test("concurrent follow-up reschedule retries have one history, audit, notification and current reminder", async (t) => {
  const c = await careCase();
  const change = changeContact(c, "rescheduled", { due: c.nextDue });
  const result = await race(t, change, change);
  assert.deepEqual(result.first, result.second);
  const state = await contactState(c);
  assert.deepEqual(state, {
    status: "open",
    version: 2,
    due: c.nextDue,
    history: [
      { version: 1, action: "scheduled", note: "" },
      {
        version: 2,
        action: "rescheduled",
        note: "Prywatna fikcyjna notatka zespołu.",
      },
    ],
    audits: 1,
    notifications: 1,
    waiting: 1,
    reminders_current: true,
  });
});

for (const reverse of [false, true]) {
  test(`competing follow-up reschedules: ${reverse ? "second" : "first"} note wins without overwriting history`, async (t) => {
    const c = await careCase();
    const notes = [
      "Prywatna notatka pierwszej karty.",
      "Prywatna notatka drugiej karty.",
    ];
    const changes = notes.map((note) =>
      changeContact(c, "rescheduled", { due: c.nextDue, note }),
    );
    await race(
      t,
      changes[reverse ? 1 : 0],
      changes[reverse ? 0 : 1],
      /Kontakt zmienił się/,
    );
    const state = await contactState(c);
    assert.equal(state.version, 2);
    assert.equal(state.history.length, 2);
    assert.equal(state.history[1].note, notes[reverse ? 1 : 0]);
    assert.equal(state.audits, 1);
    assert.equal(state.notifications, 1);
    assert.equal(state.waiting, 1);
    assert(state.reminders_current);
  });
}

for (const completeFirst of [false, true]) {
  test(`follow-up completion/reschedule: ${completeFirst ? "completion" : "reschedule"} wins and the stale action has no side effects`, async (t) => {
    const c = await careCase();
    const complete = changeContact(c, "completed"),
      reschedule = changeContact(c, "rescheduled", { due: c.nextDue });
    await race(
      t,
      completeFirst ? complete : reschedule,
      completeFirst ? reschedule : complete,
      /Kontakt zmienił się/,
    );
    const state = await contactState(c);
    assert.equal(state.status, completeFirst ? "done" : "open");
    assert.equal(state.version, 2);
    assert.equal(state.history.length, 2);
    assert.equal(
      state.history[1].action,
      completeFirst ? "completed" : "rescheduled",
    );
    assert.equal(state.audits, 1);
    assert.equal(state.notifications, completeFirst ? 0 : 1);
    assert.equal(state.waiting, completeFirst ? 0 : 1);
    assert(state.reminders_current);
  });
}

for (const publishFirst of [false, true]) {
  test(`new plan/completing its previous contact: ${publishFirst ? "publication" : "completion"} commits first`, async (t) => {
    const c = await careCase();
    const publish = publishCare(c),
      complete = changeContact(c, "completed");
    await race(
      t,
      publishFirst ? publish : complete,
      publishFirst ? complete : publish,
      publishFirst ? /Kontakt zmienił się/ : undefined,
    );
    const state = await contactState(c);
    assert.equal(state.status, publishFirst ? "superseded" : "done");
    assert.equal(state.version, 2);
    assert.equal(state.history.length, 2);
    assert.equal(
      state.history[1].action,
      publishFirst ? "superseded" : "completed",
    );
    assert.equal(state.audits, publishFirst ? 0 : 1);
    assert.equal(state.notifications, 0);
    assert.equal(state.waiting, 0);
    assert.deepEqual(await carePublicationState(c), {
      plans: 2,
      original: {
        body: "Pierwotna fikcyjna treść bez porad specjalistycznych.",
        due: c.due,
      },
      open: 1,
      latest_open: true,
      waiting: 1,
    });
  });
}

function templateId() {
  const id = randomUUID();
  templates.push(id);
  return id;
}
const saveMaterial = (
  id,
  version,
  title = "Fikcyjny materiał biblioteki",
  body = "Fikcyjna treść bez porad specjalistycznych.",
) =>
  `select public.save_care_template(${q(id)},${version},${q(title)},${q(body)});`;
async function templateState(id) {
  return observer.json(`select json_build_object('title',t.title,'body',t.body,'version',t.version,'author',t.updated_by,
    'audits',(select count(*) from public.audit_events where entity_id=t.id and event='care_template_saved'))
    from public.care_templates t where t.id=${q(id)};`);
}
for (const conflicting of [false, true]) {
  test(`concurrent material creation: ${conflicting ? "a different body cannot replace the first material" : "exact retry records one material and audit"}`, async (t) => {
    const id = templateId();
    await race(
      t,
      saveMaterial(id, 0),
      saveMaterial(
        id,
        0,
        undefined,
        conflicting ? "Sprzeczna fikcyjna treść." : undefined,
      ),
      conflicting ? /Materiał zmienił się/ : undefined,
    );
    assert.deepEqual(await templateState(id), {
      title: "Fikcyjny materiał biblioteki",
      body: "Fikcyjna treść bez porad specjalistycznych.",
      version: 1,
      author: admin,
      audits: 1,
    });
  });
}
test("concurrent exact material edits create one new version and audit", async (t) => {
  const id = templateId();
  await observer.asUser(admin);
  await observer.query(`${saveMaterial(id, 0)} commit;`);
  const edit = saveMaterial(
    id,
    1,
    "Poprawiony materiał",
    "Poprawiona fikcyjna treść.",
  );
  await race(t, edit, edit);
  assert.deepEqual(await templateState(id), {
    title: "Poprawiony materiał",
    body: "Poprawiona fikcyjna treść.",
    version: 2,
    author: admin,
    audits: 2,
  });
});
for (const first of ["A", "B"]) {
  test(`conflicting material edits: ${first} commits first and the other card cannot overwrite it`, async (t) => {
    const id = templateId();
    await observer.asUser(admin);
    await observer.query(`${saveMaterial(id, 0)} commit;`);
    await race(
      t,
      saveMaterial(id, 1, `Materiał ${first}`, `Fikcyjna treść ${first}.`),
      saveMaterial(
        id,
        1,
        `Materiał ${first === "A" ? "B" : "A"}`,
        "Inna fikcyjna treść ze starej karty.",
      ),
      /Materiał zmienił się/,
    );
    assert.deepEqual(await templateState(id), {
      title: `Materiał ${first}`,
      body: `Fikcyjna treść ${first}.`,
      version: 2,
      author: admin,
      audits: 2,
    });
  });
}
test("a delayed creation retry cannot overwrite a material edit that commits first", async (t) => {
  const id = templateId();
  await observer.asUser(admin);
  await observer.query(`${saveMaterial(id, 0)} commit;`);
  await race(
    t,
    saveMaterial(id, 1, "Aktualny materiał", "Aktualna fikcyjna treść."),
    saveMaterial(id, 0),
    /Materiał zmienił się/,
  );
  assert.deepEqual(await templateState(id), {
    title: "Aktualny materiał",
    body: "Aktualna fikcyjna treść.",
    version: 2,
    author: admin,
    audits: 2,
  });
});

for (const publishFirst of [false, true]) {
  test(`new plan/reopening an old completed contact: ${publishFirst ? "publication" : "reopening"} commits first`, async (t) => {
    const c = await careCase({ closed: true });
    const publish = publishCare(c, null),
      reopen = changeContact(c, "reopened", { version: 2, due: c.nextDue });
    await race(
      t,
      publishFirst ? publish : reopen,
      publishFirst ? reopen : publish,
      publishFirst ? /wcześniejszego planu/ : undefined,
    );
    const state = await contactState(c);
    assert.equal(state.status, publishFirst ? "done" : "superseded");
    assert.equal(state.version, publishFirst ? 2 : 4);
    assert.equal(state.history.length, publishFirst ? 2 : 4);
    assert.equal(state.audits, publishFirst ? 1 : 2);
    assert.equal(state.notifications, publishFirst ? 0 : 1);
    assert.equal(state.waiting, 0);
    assert.deepEqual(await carePublicationState(c), {
      plans: 2,
      original: {
        body: "Pierwotna fikcyjna treść bez porad specjalistycznych.",
        due: c.due,
      },
      open: 0,
      latest_open: false,
      waiting: 0,
    });
  });
}

async function responseState(id) {
  return observer.json(`select json_build_object('plan',p.plan_id,'author',p.author_id,'attempted',p.attempted,
    'reviewed',p.reviewed_at is not null,'reviewer',p.reviewed_by,
    'events',(select count(*) from public.care_events where kind='progress_submitted' and entity_id=p.id),
    'submitted_audits',(select count(*) from public.audit_events where event='care_progress_submitted' and entity_id=p.id),
    'reviewed_audits',(select count(*) from public.audit_events where event='care_progress_reviewed' and entity_id=p.id),
    'submitted_notifications',(select count(*) from public.notifications where kind='progress_submitted' and entity_id=p.id and recipient_id=${q(admin)}),
    'reviewed_notifications',(select count(*) from public.notifications where kind='progress_reviewed' and entity_id=p.id))
    from public.care_progress p where p.id=${q(id)};`);
}

for (const conflicting of [false, true]) {
  test(`concurrent progress submission: ${conflicting ? "changed text cannot overwrite the first reply" : "exact retry creates one reply and notification"}`, async (t) => {
    const c = await careCase(),
      id = randomUUID();
    await race(
      t,
      respondCare(c, id),
      respondCare(
        c,
        id,
        conflicting ? "Sprzeczna fikcyjna odpowiedź." : undefined,
      ),
      conflicting ? /Ta odpowiedź została już zapisana/ : undefined,
      [owners[0], owners[0]],
    );
    assert.deepEqual(await responseState(id), {
      plan: c.plan,
      author: owners[0],
      attempted: "Fikcyjna odpowiedź do pierwotnych zaleceń.",
      reviewed: false,
      reviewer: null,
      events: 1,
      submitted_audits: 1,
      reviewed_audits: 0,
      submitted_notifications: 1,
      reviewed_notifications: 0,
    });
  });
}

test("concurrent progress review retries mark one reply once and leave a second reply unread", async (t) => {
  const c = await careCase(),
    ids = [randomUUID(), randomUUID()];
  await observer.asUser(owners[0]);
  await observer.query(
    `${respondCare(c, ids[0])} ${respondCare(c, ids[1])} commit;`,
  );
  const review = `select public.review_care_progress(${q(ids[0])});`;
  await race(t, review, review);
  const state = await responseState(ids[0]);
  assert.equal(state.reviewed, true);
  assert.equal(state.reviewer, admin);
  assert.equal(state.reviewed_audits, 1);
  assert.equal(state.reviewed_notifications, 1);
  assert.equal((await responseState(ids[1])).reviewed, false);
  await observer.asUser(admin);
  const queued = await observer.json(
    `select json_agg(id) from public.staff_work_items() where dog_id=${q(c.dog)} and kind='progress';`,
  );
  await observer.query("commit;");
  assert.deepEqual(queued, [ids[1]]);
});

for (const publishFirst of [false, true]) {
  test(`new publication/response to the old plan: ${publishFirst ? "publication" : "response"} commits first; the reply retains its original plan`, async (t) => {
    const c = await careCase(),
      id = randomUUID();
    const publish = publishCare(c),
      respond = respondCare(c, id);
    await race(
      t,
      publishFirst ? publish : respond,
      publishFirst ? respond : publish,
      undefined,
      publishFirst ? [admin, owners[0]] : [owners[0], admin],
    );
    const state = await responseState(id);
    assert.equal(state.plan, c.plan);
    assert.equal(state.events, 1);
    assert.equal(state.submitted_audits, 1);
    assert.equal(state.submitted_notifications, 1);
    assert.equal(state.reviewed, false);
    assert.equal((await carePublicationState(c)).plans, 2);
    assert.equal((await contactState(c)).status, "superseded");
  });
}
