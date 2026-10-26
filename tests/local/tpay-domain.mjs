// Real PostgreSQL races in a generated, labelled database on this project's
// local VM. Migrations/settings and synthetic accounts exist only in that
// isolated database. The source application is fingerprinted and unchanged.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { after, before, test } from "node:test";
import {
  LocalPostgres,
  literal,
  waitForLock,
} from "../helpers/local-postgres.mjs";

let source,
  observer,
  first,
  second,
  baseline,
  created = false,
  observedLocks = 0;
const run = randomUUID();
const database = `psi_tpay_${run.replaceAll("-", "")}`;
const label = `psi-tpay-local-fixture:${run}`;
const admin = randomUUID(),
  owner = randomUUID();
const fixtures = [];
const practice = "00000000-0000-4000-8000-000000000001";
const json = (expression) => `select to_jsonb(${expression});`;
const beginSql = (f, request = randomUUID()) =>
  json(
    `public.begin_online_payment(${literal(owner)},'fitness',${literal(f.target)},${literal(request)},'simulator',6000,'local-merchant')`,
  );
const confirmSql = (a) =>
  json(
    `public.record_online_payment_outcome(${literal(a.id)},'simulator',${literal(a.transaction_id)},'local-merchant','paid',6000,'PLN',${literal(a.transaction_title)})`,
  );
const manualSql = (f) =>
  json(
    `public.record_fitness_payment(${literal(f.target)},6000,'transfer','Lokalny test konkurencji',${literal(randomUUID())})`,
  );
async function service(db) {
  await db.query("begin; set local role service_role;");
}
async function originalState() {
  const tables = await source.json(
    "select coalesce(json_agg(tablename order by tablename),'[]') from pg_tables where schemaname='public';",
  );
  const hashes = [];
  for (const table of tables) {
    assert.match(table, /^[a-z_][a-z0-9_]*$/);
    hashes.push([
      table,
      await source.json(
        `select json_build_object('count',count(*),'hash',md5(coalesce(string_agg(md5(to_jsonb(r)::text),'' order by md5(to_jsonb(r)::text)),''))) from public."${table}" r;`,
      ),
    ]);
  }
  const metadata = await source.json(`select json_build_object(
    'databases',(select jsonb_agg(datname order by datname) from pg_database),
    'accounts',(select md5(coalesce(string_agg(md5(to_jsonb(u)::text),'' order by id),'')) from auth.users u),
    'columns',(select jsonb_agg(to_jsonb(c) order by table_name,ordinal_position) from information_schema.columns c where table_schema='public'),
    'migrations',(select jsonb_agg(version order by version) from supabase_migrations.schema_migrations));`);
  return { hashes, metadata };
}

async function fixture() {
  const f = { dog: randomUUID(), target: randomUUID() };
  fixtures.push(f);
  await observer.query(`insert into public.dogs(id,guardian_id,name) values(${literal(f.dog)},${literal(owner)},'Lokalny BLIK race');
    insert into public.fitness_packages(id,practice_id,dog_id,guardian_id,service_id,service_version,service_name,sessions_count,
      duration_minutes,agreed_price_cents,is_test_price,topic,status,charge_cents,accepted_at,updated_by)
    select ${literal(f.target)},${literal(practice)},${literal(f.dog)},${literal(owner)},id,version,name,2,
      60,6000,true,'Lokalny test BLIK','active',6000,now(),${literal(admin)}
    from public.services where booking_flow='fitness' order by id limit 1;`);
  return f;
}
async function boundAttempt(f) {
  await service(first);
  const { attempt } = await first.json(beginSql(f));
  await first.query("commit;");
  await service(first);
  const bound = await first.json(
    json(
      `public.bind_online_payment(${literal(attempt.id)},${literal(`tx-${attempt.id}`)},${literal(`title-${attempt.id}`)},'local-merchant',${literal(`http://localhost:3000/app/payments/${attempt.id}`)})`,
    ),
  );
  await first.query("commit;");
  return bound;
}

before(async () => {
  source = await new LocalPostgres().ready();
  baseline = await originalState();
  assert(!baseline.metadata.databases.includes(database));
  await source.query(`create database "${database}";`);
  created = true;
  await source.query(`comment on database "${database}" is ${literal(label)};`);
  observer = await new LocalPostgres({ database }).ready();
  first = await new LocalPostgres({ database }).ready();
  second = await new LocalPostgres({ database }).ready();
  await observer.query(`create schema auth;
    create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,encrypted_password text);
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    grant usage on schema public,auth to anon,authenticated,service_role;
    grant execute on function auth.uid() to anon,authenticated,service_role;
    create schema storage;
    create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
    create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text);
    alter table storage.objects enable row level security;
    create function storage.foldername(name text) returns text[] language sql as $$select string_to_array(name,'/')$$;
    grant usage on schema storage to authenticated;grant select,insert,delete on storage.objects to authenticated;`);
  for (const file of readdirSync("supabase/migrations")
    .filter((name) => /^\d{12}_.+\.sql$/.test(name))
    .sort())
    await observer.query(readFileSync(`supabase/migrations/${file}`, "utf8"));
  assert.equal(
    await observer.json(
      "select to_json(enabled) from public.online_payment_settings where singleton;",
    ),
    false,
  );
  await observer.query(
    "update public.online_payment_settings set enabled=true,walk_gate='accepted';",
  );
  await observer.query(`insert into auth.users(id,email) values(${literal(admin)},${literal(`tpay-race-admin-${admin}@example.test`)}),
    (${literal(owner)},${literal(`tpay-race-owner-${owner}@example.test`)});
    update public.user_roles set role='admin' where user_id=${literal(admin)};`);
});

after(async () => {
  try {
    await Promise.allSettled([
      first?.close(),
      second?.close(),
      observer?.close(),
    ]);
    if (created) {
      const actualLabel =
        await source.json(`select to_json(shobj_description(oid,'pg_database')) from pg_database
        where datname=${literal(database)} and datdba=(select oid from pg_roles where rolname='postgres');`);
      assert.equal(
        actualLabel,
        label,
        "Only this run's owned, labelled database may be removed",
      );
      await source.query(`drop database "${database}";`);
    }
    if (baseline)
      assert.deepEqual(
        await originalState(),
        baseline,
        "Source DB/account/schema/settings/migrations must remain unchanged",
      );
    if (baseline)
      console.log(
        `Tpay PostgreSQL: ${observedLocks} observed lock dependencies; owned fixture DB removed; source fingerprints unchanged.`,
      );
    else
      console.log(
        "Tpay PostgreSQL: source connection/snapshot unavailable; no fixture DB was created; concurrency not verified.",
      );
  } finally {
    await source?.close();
  }
});

test("two cards wait on the same charge and create only one durable attempt", async () => {
  const f = await fixture();
  await service(first);
  const a = await first.json(beginSql(f));
  await service(second);
  const pending = second.json(beginSql(f));
  await waitForLock(observer, first, second);
  observedLocks++;
  await first.query("commit;");
  const b = await pending;
  await second.query("commit;");
  assert.equal(a.created, true);
  assert.equal(b.created, false);
  assert.equal(b.attempt.id, a.attempt.id);
});

test("poll and webhook confirmations wait on the parent and record one payment and one system audit", async () => {
  const f = await fixture();
  const a = await boundAttempt(f);
  await service(first);
  const one = await first.json(confirmSql(a));
  await service(second);
  const pending = second.json(confirmSql(a));
  await waitForLock(observer, first, second);
  observedLocks++;
  await first.query("commit;");
  const two = await pending;
  await second.query("commit;");
  assert.equal(one.status, "paid");
  assert.equal(two.payment_id, one.payment_id);
  assert.equal(
    await observer.json(
      `select to_json(count(*)) from public.payments where online_attempt_id=${literal(a.id)};`,
    ),
    1,
  );
  assert.equal(
    await observer.json(
      `select to_json(count(*)) from public.audit_events where entity_id=${literal(a.id)} and event='online_payment_confirmed' and actor_id is null;`,
    ),
    1,
  );
});

for (const manualFirst of [true, false]) {
  test(`manual payment versus gateway confirmation: ${manualFirst ? "manual" : "gateway"} commits first`, async () => {
    const f = await fixture();
    const a = await boundAttempt(f);
    if (manualFirst) {
      await first.asUser(admin);
      await first.json(manualSql(f));
      await service(second);
      const pending = second.json(confirmSql(a));
      await waitForLock(observer, first, second);
      observedLocks++;
      await first.query("commit;");
      const result = await pending;
      await second.query("commit;");
      assert.equal(result.status, "requires_review");
      assert.equal(result.review_reason, "balance_changed");
      assert.equal(result.confirmed_amount_cents, 6000);
      assert.equal(result.payment_id, null);
    } else {
      await service(first);
      assert.equal((await first.json(confirmSql(a))).status, "paid");
      await second.asUser(admin);
      const pending = second.json(manualSql(f));
      const rejected = assert.rejects(pending, /pozostałą kwotę/);
      await waitForLock(observer, first, second);
      observedLocks++;
      await first.query("commit;");
      await rejected;
      // psql exits on the expected SQL failure; no write from that connection survives.
      await second.close();
      second = await new LocalPostgres({ database }).ready();
    }
    assert.equal(
      await observer.json(
        `select to_json(sum(amount_cents)) from public.payments where fitness_package_id=${literal(f.target)} and status='paid';`,
      ),
      6000,
    );
  });
}

for (const cancelFirst of [true, false]) {
  test(`cancellation versus gateway confirmation: ${cancelFirst ? "cancellation" : "gateway"} commits first`, async () => {
    const f = await fixture();
    const a = await boundAttempt(f);
    const cancelSql = json(
      `public.change_fitness_package(${literal(f.target)},1,'cancel','Lokalna rezygnacja',${literal(randomUUID())})`,
    );
    if (cancelFirst) {
      await first.asUser(admin);
      await first.json(cancelSql);
      await service(second);
      const pending = second.json(confirmSql(a));
      await waitForLock(observer, first, second);
      observedLocks++;
      await first.query("commit;");
      const result = await pending;
      await second.query("commit;");
      assert.equal(result.status, "requires_review");
      assert.equal(result.review_reason, "no_longer_payable");
      assert.equal(result.payment_id, null);
      assert.equal(
        await observer.json(
          `select to_json(status) from public.fitness_packages where id=${literal(f.target)};`,
        ),
        "cancelled",
      );
    } else {
      await service(first);
      assert.equal((await first.json(confirmSql(a))).status, "paid");
      await second.asUser(admin);
      const pending = second.json(cancelSql);
      const rejected = assert.rejects(pending, /zmienił się/);
      await waitForLock(observer, first, second);
      observedLocks++;
      await first.query("commit;");
      await rejected;
      await second.close();
      second = await new LocalPostgres({ database }).ready();
      assert.equal(
        await observer.json(
          `select to_json(status) from public.fitness_packages where id=${literal(f.target)};`,
        ),
        "active",
      );
    }
  });
}

test("real PostgreSQL RLS preserves the original guardian, and anon/client/admin cannot finalize", async () => {
  const f = await fixture();
  const a = await boundAttempt(f);
  const other = randomUUID();
  await observer.query(`insert into auth.users(id,email) values(${literal(other)},${literal(`tpay-race-other-${other}@example.test`)});
    update public.dogs set guardian_id=${literal(other)} where id=${literal(f.dog)};`);
  await service(first);
  const received = await first.json(confirmSql(a));
  await first.query("commit;");
  assert.equal(received.review_reason, "owner_changed");
  for (const [user, expected] of [
    [owner, 1],
    [other, 0],
    [admin, 1],
  ]) {
    await first.asUser(user);
    assert.equal(
      await first.json(
        `select to_json(count(*)) from public.online_payment_attempts where id=${literal(a.id)};`,
      ),
      expected,
    );
    await first.query("commit;");
  }
  for (const user of [owner, admin, null]) {
    const denied = await new LocalPostgres({ database }).ready();
    try {
      if (user) await denied.asUser(user);
      else await denied.query("begin; set local role anon;");
      await assert.rejects(denied.json(confirmSql(a)), /permission denied/);
    } finally {
      await denied.close();
    }
  }
});
