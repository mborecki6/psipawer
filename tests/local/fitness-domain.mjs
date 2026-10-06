// Exercise pending fitness migrations on PostgreSQL without installing them in
// the application's database. Only a labelled, generated fixture DB is dropped.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { after, before, beforeEach, test } from "node:test";
import {
  LocalPostgres,
  literal,
  waitForLock,
} from "../helpers/local-postgres.mjs";

const run = randomUUID();
const database = `psi_fitness_${run.replaceAll("-", "")}`;
const label = `psi-fitness-fixture:${run}`;
const admin = "b1000000-0000-4000-8000-000000000001";
const owner = "b1000000-0000-4000-8000-000000000002";
const other = "b1000000-0000-4000-8000-000000000003";
const dog = "b2000000-0000-4000-8000-000000000001";
const service = "60000000-0000-4000-8000-000000000006";
let source,
  observer,
  baseline,
  created = false;
let observedLocks = 0;
const originalState = () =>
  source.json(`select json_build_object(
  'databases',(select jsonb_agg(datname order by datname) from pg_database),
  'accounts',(select count(*) from auth.users),
  'dogs',(select count(*) from public.dogs),
  'migrations',(select count(*) from supabase_migrations.schema_migrations));`);
before(async () => {
  source = new LocalPostgres();
  await source.ready();
  baseline = await originalState();
  assert(!baseline.databases.includes(database));
  await source.query(`create database "${database}";`);
  created = true;
  await source.query(`comment on database "${database}" is ${literal(label)};`);
  observer = new LocalPostgres({ database });
  await observer.ready();
  await observer.query(`create schema auth;
    create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,encrypted_password text);
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    grant usage on schema public,auth to anon,authenticated;grant execute on function auth.uid() to anon,authenticated;
    create schema storage;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
    create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text);
    alter table storage.objects enable row level security;
    create function storage.foldername(name text) returns text[] language sql as $$select string_to_array(name,'/')$$;
    grant usage on schema storage to authenticated;grant select,insert,delete on storage.objects to authenticated;`);
  for (const file of readdirSync("supabase/migrations")
    .filter((f) => /^\d{12}_.+\.sql$/.test(f))
    .sort())
    await observer.query(readFileSync(`supabase/migrations/${file}`, "utf8"));
  await observer.query(`insert into auth.users(id,email) values(${literal(admin)},'fitness-admin@example.test'),(${literal(owner)},'fitness-owner@example.test'),(${literal(other)},'fitness-other@example.test');
    update public.user_roles set role='admin' where user_id=${literal(admin)};
    insert into public.dogs(id,guardian_id,name) values(${literal(dog)},${literal(owner)},'Fikcyjny fitness PostgreSQL');`);
});
beforeEach(async () => {
  await observer.query(`truncate public.fitness_packages cascade;truncate public.calendar_blocks cascade;delete from public.audit_events;
    update public.dogs set guardian_id=${literal(owner)} where id=${literal(dog)};`);
});
after(async () => {
  try {
    await observer?.close();
    if (created) {
      const owned = await source.json(
        `select to_json(shobj_description(oid,'pg_database')) from pg_database where datname=${literal(database)} and datdba=(select oid from pg_roles where rolname='postgres');`,
      );
      assert.equal(owned, label, "Do not remove an unrecognised database");
      await source.query(`drop database "${database}";`);
    }
    if (baseline) assert.deepEqual(await originalState(), baseline);
    console.log(
      `Fitness PostgreSQL: ${observedLocks} obserwowanych zależności blokad; własna baza usunięta; źródło zachowane.`,
    );
  } finally {
    await source?.close();
  }
});

const requestSQL = (id = randomUUID()) =>
  `select to_json(public.request_fitness_package(${literal(id)},${literal(dog)},${literal(service)},2,'Próbny cel','Popołudnia'));`;
const changeSQL = (
  id,
  version,
  action,
  actorNote = "Uzgodniona decyzja",
  key = randomUUID(),
) =>
  `select to_json(public.change_fitness_package(${literal(id)},${version},${literal(action)},${literal(actorNote)},${literal(key)}));`;
const paySQL = (id, amount, key = randomUUID()) =>
  `select to_json(public.record_fitness_payment(${literal(id)},${amount},'transfer','Próbna wpłata',${literal(key)}));`;
const scheduleSQL = (
  id,
  version = 1,
  starts = new Date(Date.now() + 7 * 86400000).toISOString(),
  key = randomUUID(),
) =>
  `select to_json(public.save_fitness_session(${literal(id)},${version},${literal(starts)},'PRYWATNY ADRES PRÓBY','Próbny termin',${literal(key)}));`;
const refundSQL = (payment, amount, key = randomUUID()) =>
  `select to_json(public.refund_fitness_payment(${literal(payment)},${amount},'Próbny zwrot',${literal(key)}));`;
const settleSQL = (id, version, amount) =>
  `select to_json(public.settle_fitness_package(${literal(id)},${version},${amount},'Uzgodniona należność',${literal(randomUUID())}));`;
async function operation(actor, sql) {
  const c = new LocalPostgres({ database });
  try {
    await c.ready();
    await c.asUser(actor);
    const result = await c.json(sql);
    await c.query("commit;");
    return result;
  } finally {
    await c.close();
  }
}
async function fixture(active = true) {
  const id = await operation(owner, requestSQL());
  if (active) await operation(admin, changeSQL(id, 1, "accept"));
  const { meeting } = await observer.json(
    `select json_build_object('meeting',(select id from public.fitness_sessions where package_id=${literal(id)} and ordinal=1));`,
  );
  if (active) assert.equal(typeof meeting, "string");
  else assert.equal(meeting, null);
  return { id, meeting };
}
async function race(firstActor, firstSQL, secondActor, secondSQL) {
  const holder = new LocalPostgres({ database }),
    waiter = new LocalPostgres({ database });
  let pending;
  try {
    await holder.ready();
    await waiter.ready();
    if (firstActor) await holder.asUser(firstActor);
    else await holder.query("begin;");
    const first = await holder.json(firstSQL);
    if (secondActor) await waiter.asUser(secondActor);
    else await waiter.query("begin;");
    pending = waiter.json(secondSQL).then(
      (value) => ({ value }),
      (error) => ({ error }),
    );
    await waitForLock(observer, holder, waiter);
    observedLocks++;
    await holder.query("commit;");
    const second = await pending;
    if (!second.error) await waiter.query("commit;");
    return { first, second };
  } finally {
    await holder.close();
    await waiter.close();
    if (pending) await pending;
  }
}
const status = (id) =>
  observer.json(
    `select to_jsonb(p) from public.fitness_packages p where id=${literal(id)};`,
  );
const balance = (id) =>
  operation(
    owner,
    `select to_jsonb(b) from public.fitness_balances b where id=${literal(id)};`,
  );
const sessionCount = (id) =>
  observer.json(
    `select to_json(count(*)) from public.fitness_sessions where package_id=${literal(id)};`,
  );
const refused = (result, pattern) =>
  assert.match(result.second.error?.message || "", pattern);

test("only one of two distinct open requests survives an observed unique-index wait", async () => {
  const { first, second } = await race(
    owner,
    requestSQL(),
    owner,
    requestSQL(),
  );
  assert(first);
  assert.match(second.error?.message || "", /otwarte zgłoszenie/);
  assert.equal(
    await observer.json(
      "select to_json(count(*)) from public.fitness_packages;",
    ),
    1,
  );
});
test("same request key reuses its first result after an observed advisory-lock wait", async () => {
  const id = randomUUID(),
    { first, second } = await race(
      owner,
      requestSQL(id),
      owner,
      requestSQL(id),
    );
  assert.equal(first, id);
  assert.equal(second.value, id);
  assert.equal(
    await observer.json(
      "select to_json(count(*)) from public.fitness_history;",
    ),
    1,
  );
  assert.equal(
    await observer.json(
      "select to_json(count(*)) from public.notifications where kind='fitness_requested';",
    ),
    1,
  );
});
for (const acceptFirst of [true, false])
  test(`acceptance and cancellation serialize (${acceptFirst ? "acceptance" : "cancellation"} first)`, async () => {
    const { id } = await fixture(false);
    const result = await race(
      acceptFirst ? admin : owner,
      changeSQL(id, 1, acceptFirst ? "accept" : "cancel"),
      acceptFirst ? owner : admin,
      changeSQL(id, 1, acceptFirst ? "cancel" : "accept"),
    );
    refused(result, /Pakiet zmienił/);
    assert.equal(
      (await status(id)).status,
      acceptFirst ? "active" : "cancelled",
    );
    assert.equal(await sessionCount(id), acceptFirst ? 4 : 0);
  });
test("competing receipts cannot both spend the remaining package balance", async () => {
  const { id } = await fixture();
  const result = await race(admin, paySQL(id, 6000), admin, paySQL(id, 6000));
  refused(result, /przekracza/);
  assert.equal((await balance(id)).paid_cents, 6000);
  assert.equal((await balance(id)).due_cents, 4000);
});
test("same payment key waits for its receipt and does not increment the package twice", async () => {
  const { id } = await fixture(),
    key = randomUUID();
  const result = await race(
    admin,
    paySQL(id, 4000, key),
    admin,
    paySQL(id, 4000, key),
  );
  assert.equal(result.second.value, result.first);
  assert.equal((await status(id)).version, 3);
  assert.equal((await balance(id)).paid_cents, 4000);
  assert.equal(
    await observer.json(
      "select to_json(count(*)) from public.notifications where kind='fitness_payment_recorded';",
    ),
    1,
  );
  assert.equal(
    await observer.json(
      "select to_json(count(*)) from public.notifications where kind='payment_recorded';",
    ),
    0,
  );
});
for (const fitnessFirst of [true, false])
  test(`fitness and calendar block cannot occupy the same time (${fitnessFirst ? "fitness" : "block"} first)`, async () => {
    const { id, meeting } = await fixture(),
      starts = new Date(Date.now() + 7 * 86400000).toISOString(),
      ends = new Date(Date.parse(starts) + 3600000).toISOString();
    const booking = scheduleSQL(meeting, 1, starts),
      block = `select to_json(public.save_calendar_block(${literal(randomUUID())},0,'Próbna blokada',${literal(starts)},${literal(ends)}));`;
    const result = await race(
      admin,
      fitnessFirst ? booking : block,
      admin,
      fitnessFirst ? block : booking,
    );
    refused(result, /czas jest już zajęty/);
    assert.equal(
      await observer.json(
        "select to_json(count(*)) from public.calendar_slots;",
      ),
      1,
    );
    assert.equal((await status(id)).version, fitnessFirst ? 3 : 2);
  });
for (const scheduleFirst of [true, false])
  test(`date and whole-package cancellation serialize (${scheduleFirst ? "date" : "cancellation"} first)`, async () => {
    const { id, meeting } = await fixture();
    const result = await race(
      scheduleFirst ? admin : owner,
      scheduleFirst ? scheduleSQL(meeting) : changeSQL(id, 2, "cancel"),
      scheduleFirst ? owner : admin,
      scheduleFirst ? changeSQL(id, 2, "cancel") : scheduleSQL(meeting),
    );
    refused(result, /zmienił/);
    assert.equal(
      (await status(id)).status,
      scheduleFirst ? "active" : "cancelled",
    );
    assert.equal(
      await observer.json(
        "select to_json(count(*)) from public.calendar_slots;",
      ),
      scheduleFirst ? 1 : 0,
    );
  });
for (const refundFirst of [true, false])
  test(`refund and settlement preserve one consistent liability (${refundFirst ? "refund" : "settlement"} first)`, async () => {
    const { id } = await fixture(),
      payment = await operation(admin, paySQL(id, 10000));
    await operation(owner, changeSQL(id, 3, "cancel"));
    const result = await race(
      admin,
      refundFirst ? refundSQL(payment, 1000) : settleSQL(id, 4, 3000),
      admin,
      refundFirst ? settleSQL(id, 4, 3000) : refundSQL(payment, 1000),
    );
    if (refundFirst) refused(result, /Pakiet zmienił/);
    else assert(result.second.value);
    const b = await balance(id);
    assert.equal(b.paid_cents, 9000);
    assert.equal(b.refunded_cents, 1000);
    assert.equal(b.charge_cents, refundFirst ? 10000 : 3000);
    assert.equal(b.needs_settlement, refundFirst);
  });
test("a committed dog transfer blocks a new meeting at the ownership boundary", async () => {
  const { id, meeting } = await fixture();
  const transfer = `with changed as(update public.dogs set guardian_id=${literal(other)} where id=${literal(dog)} returning id)select to_json(count(*))from changed;`;
  const result = await race(null, transfer, admin, scheduleSQL(meeting));
  refused(result, /Opiekun psa zmienił/);
  assert.equal((await status(id)).version, 2);
  assert.equal(
    await observer.json("select to_json(count(*)) from public.calendar_slots;"),
    0,
  );
});

const dispatchSQL = "select public.worker_process_due_reminders(50);";
async function workerConnection() {
  const connection = await new LocalPostgres({ database }).ready();
  await connection.query("begin;set local role service_role;");
  return connection;
}
async function processWorker() {
  const connection = await workerConnection();
  try {
    const result = await connection.json(dispatchSQL);
    await connection.query("commit;");
    return result;
  } finally {
    await connection.close();
  }
}
const reminderEvidence = () =>
  observer.json(`select json_build_object(
    'jobs',(select coalesce(json_agg(json_build_object('status',status,'generation',generation,'attempts',attempts) order by generation),'[]') from public.reminder_jobs where kind='fitness'),
    'notices',(select count(*) from public.notifications where kind='fitness_reminder'),
    'attempts',(select count(*) from public.reminder_attempts));`);

for (const change of ["reschedule", "cancel", "transfer"])
  test(`fitness worker skips an uncommitted ${change} and reads its committed result`, async () => {
    const { id, meeting } = await fixture();
    await operation(
      admin,
      scheduleSQL(meeting, 1, new Date(Date.now() + 3 * 3600000).toISOString()),
    );
    const holder = await new LocalPostgres({ database }).ready();
    try {
      if (change === "transfer") await holder.query("begin;");
      else await holder.asUser(change === "cancel" ? owner : admin);
      const command =
        change === "reschedule"
          ? scheduleSQL(
              meeting,
              2,
              new Date(Date.now() + 4 * 3600000).toISOString(),
            )
          : change === "cancel"
            ? changeSQL(id, 3, "cancel")
            : `with changed as(update public.dogs set guardian_id=${literal(other)} where id=${literal(dog)} returning id)select to_json(count(*))from changed;`;
      await holder.json(command);
      assert.deepEqual(await processWorker(), {
        sent: 0,
        failed: 0,
        cancelled: 0,
        skipped: 1,
      });
      await holder.query("commit;");
      assert.equal(
        (await processWorker()).sent,
        change === "reschedule" ? 1 : 0,
      );
      const evidence = await reminderEvidence();
      assert.equal(evidence.notices, change === "reschedule" ? 1 : 0);
      assert.deepEqual(
        evidence.jobs.map((j) => j.status),
        change === "reschedule" ? ["cancelled", "sent"] : ["cancelled"],
      );
    } finally {
      await holder.close();
    }
  });

test("two independent fitness workers and a new connection after commit deliver only once", async () => {
  const { meeting } = await fixture();
  await operation(
    admin,
    scheduleSQL(meeting, 1, new Date(Date.now() + 3 * 3600000).toISOString()),
  );
  const first = await workerConnection();
  const second = await workerConnection();
  let pending;
  try {
    assert.equal((await first.json(dispatchSQL)).sent, 1);
    pending = second.json(dispatchSQL);
    // Job/source locks are skipped, but the existing shared worker heartbeat
    // serializes transaction completion. Observe that dependency before release;
    // do not leave the first transaction open while waiting for the second.
    await waitForLock(observer, first, second);
    observedLocks++;
    await first.query("commit;");
    assert.deepEqual(await pending, {
      sent: 0,
      failed: 0,
      cancelled: 0,
      skipped: 1,
    });
    await second.query("commit;");
    // A newly opened backend sees committed success even when the caller does
    // not keep the first result. It does not repeat the local inbox write.
    assert.deepEqual(await processWorker(), {
      sent: 0,
      failed: 0,
      cancelled: 0,
      skipped: 0,
    });
    assert.deepEqual(await reminderEvidence(), {
      jobs: [{ status: "sent", generation: 1, attempts: 1 }],
      notices: 1,
      attempts: 1,
    });
  } finally {
    await first.close();
    await second.close();
    if (pending) await pending;
  }
});

test("a fitness cancellation waits for real delivery and preserves its already committed message", async () => {
  const { id, meeting } = await fixture();
  await operation(
    admin,
    scheduleSQL(meeting, 1, new Date(Date.now() + 3 * 3600000).toISOString()),
  );
  const result = await race(
    admin,
    "select public.process_due_reminders(50);",
    owner,
    changeSQL(id, 3, "cancel"),
  );
  assert.equal(result.first.sent, 1);
  assert.equal(result.second.value, 4);
  assert.equal((await status(id)).status, "cancelled");
  assert.equal((await processWorker()).sent, 0);
  assert.deepEqual(await reminderEvidence(), {
    jobs: [{ status: "sent", generation: 1, attempts: 1 }],
    notices: 1,
    attempts: 1,
  });
});

test("a failed fitness inbox insert rolls back delivery and a fresh worker recovers once", async () => {
  const { meeting } = await fixture();
  await operation(
    admin,
    scheduleSQL(meeting, 1, new Date(Date.now() + 3 * 3600000).toISOString()),
  );
  await observer.query(`create function public.fixture_fitness_reminder_failure() returns trigger language plpgsql as $$begin if new.kind='fitness_reminder' then raise exception 'PRIVATE FIXTURE FAILURE';end if;return new;end$$;
    create trigger fixture_fitness_reminder_failure before insert on public.notifications for each row execute function public.fixture_fitness_reminder_failure();`);
  try {
    assert.equal((await processWorker()).failed, 1);
    assert.deepEqual(await reminderEvidence(), {
      jobs: [{ status: "retry", generation: 1, attempts: 1 }],
      notices: 0,
      attempts: 1,
    });
    const safeError = await observer.json(
      "select to_json(error_code) from public.reminder_attempts;",
    );
    assert.equal(safeError, "delivery_failed");
  } finally {
    await observer.query(
      "drop trigger fixture_fitness_reminder_failure on public.notifications;drop function public.fixture_fitness_reminder_failure();",
    );
  }
  await observer.query(
    "update public.reminder_jobs set next_attempt_at=now() where kind='fitness';",
  );
  assert.equal((await processWorker()).sent, 1);
  assert.equal((await processWorker()).sent, 0);
  assert.deepEqual(await reminderEvidence(), {
    jobs: [{ status: "sent", generation: 1, attempts: 2 }],
    notices: 1,
    attempts: 2,
  });
});

const careSQL = (
  id,
  meeting = null,
  version = 0,
  publish = true,
  title = "Plan fitness PostgreSQL",
) =>
  `select public.save_care_plan(${literal(dog)},${version},${literal(title)},'Własne wskazówki prowadzącej.',null,${publish},null,null,null,${literal(id)},${meeting ? literal(meeting) : "null"});`;
const careEvidence = (id) =>
  observer.json(`select json_build_object(
  'plans',(select count(*) from public.care_plan_versions where fitness_package_id=${literal(id)}),
  'drafts',(select count(*) from public.care_drafts where fitness_package_id=${literal(id)}),
  'notices',(select count(*) from public.notifications where kind='plan_published' and dog_id=${literal(dog)}));`);

test("a committed package cancellation refuses a waiting publication without a draft or notice", async () => {
  const { id } = await fixture();
  const result = await race(
    owner,
    changeSQL(id, 2, "cancel"),
    admin,
    careSQL(id),
  );
  refused(result, /aktywny lub zakończony pakiet/);
  assert.deepEqual(await careEvidence(id), { plans: 0, drafts: 0, notices: 0 });
});
test("a committed publication survives a waiting cancellation and its historical retry stays single", async () => {
  const { id } = await fixture();
  const result = await race(
    admin,
    careSQL(id),
    owner,
    changeSQL(id, 2, "cancel"),
  );
  assert.equal(result.second.value, 3);
  assert.deepEqual(await operation(admin, careSQL(id)), result.first);
  assert.deepEqual(await careEvidence(id), { plans: 1, drafts: 1, notices: 1 });
  await assert.rejects(
    operation(admin, careSQL(id, null, 1)),
    /aktywny lub zakończony pakiet/,
  );
});
test("a committed guardian transfer refuses a waiting publication for the previous agreement", async () => {
  const { id } = await fixture();
  const result = await race(
    null,
    `update public.dogs set guardian_id=${literal(other)} where id=${literal(dog)}; select to_json(true);`,
    admin,
    careSQL(id),
  );
  refused(result, /aktualnego opiekuna/);
  assert.deepEqual(await careEvidence(id), { plans: 0, drafts: 0, notices: 0 });
});
test("a waiting guardian transfer preserves the committed plan but removes it from the old guardian feed", async () => {
  const { id } = await fixture();
  const result = await race(
    admin,
    careSQL(id),
    null,
    `update public.dogs set guardian_id=${literal(other)} where id=${literal(dog)}; select to_json(true);`,
  );
  assert.equal(result.second.value, true);
  assert.deepEqual(await careEvidence(id), { plans: 1, drafts: 1, notices: 1 });
  const feed = await operation(
    owner,
    `select to_jsonb(f) from public.fitness_care_feed(${literal(id)},0) f;`,
  );
  assert.deepEqual(feed, { plans: [], has_draft: false, can_prepare: false });
});
test("two independent identical publications share one version and notification after a real dog lock wait", async () => {
  const { id } = await fixture();
  const result = await race(admin, careSQL(id), admin, careSQL(id));
  assert.deepEqual(result.second.value, result.first);
  assert.deepEqual(await careEvidence(id), { plans: 1, drafts: 1, notices: 1 });
});
test("a competing different publication loses its version conflict without replacing the first text", async () => {
  const { id } = await fixture();
  const result = await race(
    admin,
    careSQL(id),
    admin,
    careSQL(id, null, 0, true, "Inny plan fitness"),
  );
  refused(result, /Plan zmienił się/);
  assert.deepEqual(await careEvidence(id), { plans: 1, drafts: 1, notices: 1 });
  assert.equal(
    await observer.json(
      `select to_json(title) from public.care_plan_versions where fitness_package_id=${literal(id)};`,
    ),
    "Plan fitness PostgreSQL",
  );
});
test("a publication waiting behind completion reads the completed meeting and retains its precise source", async () => {
  const { id, meeting } = await fixture();
  await operation(admin, scheduleSQL(meeting));
  await observer.query(
    `update public.fitness_sessions set starts_at=now()-interval '3 hours' where id=${literal(meeting)};`,
  );
  const result = await race(
    admin,
    `select to_json(public.change_fitness_session(${literal(meeting)},2,'complete','present','Potwierdzona obecność',${literal(randomUUID())}));`,
    admin,
    careSQL(id, meeting),
  );
  assert.equal(result.second.value.version, 1);
  assert.equal(
    await observer.json(
      `select to_json(fitness_session_id) from public.care_plan_versions where id=${literal(result.second.value.published_id)};`,
    ),
    meeting,
  );
  assert.deepEqual(await careEvidence(id), { plans: 1, drafts: 1, notices: 1 });
});
