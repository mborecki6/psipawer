// Real independent PostgreSQL sessions, with no SMTP transport. All domain
// sources and queue changes live in a generated, labelled fixture database.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { after, before, test } from "node:test";
import {
  LocalPostgres,
  literal,
  waitForLock,
} from "../helpers/local-postgres.mjs";

const run = randomUUID();
const database = `psi_email_${run.replaceAll("-", "")}`;
const label = `psi-email-local-fixture:${run}`;
const admin = randomUUID(),
  owner = randomUUID(),
  other = randomUUID(),
  dog = randomUUID(),
  consultation = randomUUID();
const practice = "00000000-0000-4000-8000-000000000001";
let source,
  observer,
  first,
  second,
  baseline,
  created = false;
let overlappingClaims = 0,
  observedFinishLocks = 0;
const owns = new Set();
const paymentIds = [];
const json = (expression) => `select to_jsonb(${expression});`;
const claimsSql = (limit = 1) =>
  `select coalesce(jsonb_agg(to_jsonb(c)),'[]'::jsonb) from public.worker_claim_business_email(${limit}) c;`;
const prepareSql = (job) =>
  `select coalesce(jsonb_agg(to_jsonb(c)),'[]'::jsonb) from public.worker_prepare_business_email(${literal(job.id)},${literal(job.claim_token)}) c;`;
const finishSql = (job, outcome = "accepted") =>
  json(
    `public.worker_finish_business_email(${literal(job.id)},${literal(job.claim_token)},${literal(outcome)})`,
  );

async function service(db) {
  await db.query(
    "begin; set local role service_role; set local lock_timeout='2s';",
  );
}
async function serviceCall(db, sql) {
  await service(db);
  const result = await db.json(sql);
  await db.query("commit;");
  return result;
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
async function createPayment() {
  const id = randomUUID();
  paymentIds.push(id);
  await observer.query(`insert into public.payments(id,guardian_id,dog_id,consultation_id,amount_cents,method,status,paid_at,note,author_id)
    values(${literal(id)},${literal(owner)},${literal(dog)},${literal(consultation)},100,'cash','paid',clock_timestamp(),'Syntetyczne potwierdzenie bez transportu',${literal(admin)});`);
  const job = await observer.json(
    `select jsonb_build_object('id',id,'kind',kind,'payment_id',payment_id,'status',status) from public.business_email_outbox where payment_id=${literal(id)};`,
  );
  assert.equal(job.kind, "payment_confirmed");
  assert.equal(job.payment_id, id);
  assert.equal(job.status, "pending");
  owns.add(job.id);
  return job;
}
async function assertPrepared(db, job) {
  assert(owns.has(job.id), "Only this run's generated jobs are prepared");
  const rows = await serviceCall(db, prepareSql(job));
  assert.equal(rows.length, 1);
  assert.equal(rows[0].recipient, `email-${owner}@example.test`);
  assert.equal(rows[0].recipient_role, "client");
  assert.equal(rows[0].kind, "payment_confirmed");
  assert(paymentIds.includes(rows[0].entity_id));
  assert.equal(rows[0].enrollment_id, null);
  assert.equal(rows[0].session_id, null);
}
async function row(id) {
  return observer.json(
    `select jsonb_build_object('status',status,'attempts',attempts,'error',last_error_code,'token',claim_token) from public.business_email_outbox where id=${literal(id)};`,
  );
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
  assert.notEqual(first.pid, second.pid);
  await observer.query(`create schema auth;
    create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,encrypted_password text,banned_until timestamptz,deleted_at timestamptz);
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    grant usage on schema public,auth to anon,authenticated,service_role;
    grant execute on function auth.uid() to anon,authenticated,service_role;
    create schema storage;
    create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
    create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text);
    alter table storage.objects enable row level security;
    create function storage.foldername(name text) returns text[] language sql as $$select string_to_array(name,'/')$$;
    grant usage on schema storage to authenticated;grant select,insert,delete on storage.objects to authenticated;`);
  const migrations = readdirSync("supabase/migrations")
    .filter((name) => /^\d{12}_.+\.sql$/.test(name))
    .sort();
  assert(migrations.includes("202610230002_business_email.sql"));
  for (const file of migrations)
    await observer.query(readFileSync(`supabase/migrations/${file}`, "utf8"));
  assert.equal(
    await observer.json(
      "select to_json(enabled) from public.business_email_settings where singleton;",
    ),
    false,
  );
  await observer.query(`insert into auth.users(id,email) values
    (${literal(admin)},${literal(`email-admin-${admin}@example.test`)}),
    (${literal(owner)},${literal(`email-${owner}@example.test`)}),
    (${literal(other)},${literal(`email-other-${other}@example.test`)});
    update public.user_roles set role='admin' where user_id=${literal(admin)};
    insert into public.dogs(id,guardian_id,name,status) values(${literal(dog)},${literal(owner)},'Syntetyczny pies e-mail','approved');
    insert into public.consultations(id,practice_id,dog_id,requested_by,topic)
      values(${literal(consultation)},${literal(practice)},${literal(dog)},${literal(owner)},'Syntetyczna usługa e-mail');
    update public.business_email_settings set enabled=true;`);
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
        "Remove only this run's owned labelled database",
      );
      await source.query(`drop database "${database}";`);
    }
    if (baseline)
      assert.deepEqual(
        await originalState(),
        baseline,
        "Source DB/accounts/schema/settings/migrations must remain unchanged",
      );
    console.log(
      baseline
        ? `Email PostgreSQL: overlappingClaims=${overlappingClaims}; observedFinishLocks=${observedFinishLocks}; fixture DB removed; source fingerprints unchanged; no SMTP.`
        : "Email PostgreSQL: source snapshot unavailable; no source mutations or fixture verification.",
    );
  } finally {
    await source?.close();
  }
});

test("two real sessions skip each other's locked rows and process 50 owned jobs once", async () => {
  for (let n = 0; n < 50; n++) await createPayment();
  const received = new Set();
  const started = performance.now();
  for (let batch = 0; batch < 25; batch++) {
    await service(first);
    const a = await first.json(claimsSql());
    assert.equal(a.length, 1);
    // first holds the row lock in an uncommitted transaction. second must
    // return a different job before first commits, proving real SKIP LOCKED.
    await service(second);
    const b = await second.json(claimsSql());
    assert.equal(b.length, 1);
    assert.notEqual(a[0].id, b[0].id);
    assert.equal(
      await observer.json(
        `select to_json(state='idle in transaction') from pg_stat_activity where pid=${first.pid};`,
      ),
      true,
    );
    assert.deepEqual(
      await observer.json(`select to_json(pg_blocking_pids(${second.pid}));`),
      [],
    );
    overlappingClaims++;
    await first.query("commit;");
    await second.query("commit;");
    for (const [db, [job]] of [
      [first, a],
      [second, b],
    ]) {
      assert(owns.has(job.id));
      assert(!received.has(job.id));
      received.add(job.id);
      await assertPrepared(db, job);
      assert.equal(await serviceCall(db, finishSql(job)), true);
    }
  }
  assert.equal(received.size, 50);
  assert.deepEqual(await serviceCall(first, claimsSql(2)), []);
  assert.deepEqual(
    await observer.json(
      "select jsonb_build_object('jobs',count(*),'accepted',count(*) filter(where status='accepted'),'once',count(*) filter(where attempts=1)) from public.business_email_outbox;",
    ),
    { jobs: 50, accepted: 50, once: 50 },
  );
  assert.equal(
    await observer.json(
      "select to_json(count(*)) from public.payments where status='paid' and amount_cents=100;",
    ),
    50,
  );
  console.log(
    `Email PostgreSQL synthetic 50: claims=50 accepted=50 duplicates=0 elapsedMs=${Math.ceil(performance.now() - started)}; SMTP not invoked.`,
  );
});

test("prepare rechecks current role and source before transport", async () => {
  const sourceChanged = await createPayment();
  const [sourceClaim] = await serviceCall(first, claimsSql());
  assert.equal(sourceClaim.id, sourceChanged.id);
  await observer.query(
    `update public.payments set status='due' where id=${literal(sourceChanged.payment_id)};`,
  );
  assert.deepEqual(await serviceCall(first, prepareSql(sourceClaim)), []);
  assert.equal((await row(sourceClaim.id)).status, "cancelled");
  const roleChanged = await createPayment();
  const [roleClaim] = await serviceCall(first, claimsSql());
  assert.equal(roleClaim.id, roleChanged.id);
  await observer.query(
    `update public.user_roles set role='admin' where user_id=${literal(owner)};`,
  );
  try {
    assert.deepEqual(await serviceCall(first, prepareSql(roleClaim)), []);
    assert.equal((await row(roleClaim.id)).status, "cancelled");
  } finally {
    await observer.query(
      `update public.user_roles set role='client' where user_id=${literal(owner)};`,
    );
  }
});

test("an abandoned claim is safely retried but a started transport stays uncertain", async () => {
  const abandoned = await createPayment();
  const [old] = await serviceCall(first, claimsSql());
  assert.equal(old.id, abandoned.id);
  await observer.query(
    `update public.business_email_outbox set claimed_at=clock_timestamp()-interval '91 seconds' where id=${literal(old.id)};`,
  );
  assert.deepEqual(await serviceCall(second, claimsSql()), []);
  assert.deepEqual(await row(old.id), {
    status: "retry",
    attempts: 1,
    error: "lease_expired",
    token: null,
  });
  await observer.query(
    `update public.business_email_outbox set next_attempt_at=clock_timestamp()-interval '1 second' where id=${literal(old.id)};`,
  );
  const [fresh] = await serviceCall(second, claimsSql());
  assert.equal(fresh.id, old.id);
  assert.notEqual(fresh.claim_token, old.claim_token);
  assert.deepEqual(await serviceCall(first, prepareSql(old)), []);
  assert.equal(await serviceCall(first, finishSql(old)), false);
  await assertPrepared(second, fresh);
  assert.equal(await serviceCall(second, finishSql(fresh)), true);
  assert.equal((await row(fresh.id)).attempts, 2);

  const started = await createPayment();
  const [sending] = await serviceCall(first, claimsSql());
  assert.equal(sending.id, started.id);
  await assertPrepared(first, sending);
  await observer.query(
    `update public.business_email_outbox set claimed_at=clock_timestamp()-interval '91 seconds',next_attempt_at=clock_timestamp()-interval '1 day' where id=${literal(sending.id)};`,
  );
  assert.deepEqual(await serviceCall(second, claimsSql()), []);
  assert.deepEqual(await row(sending.id), {
    status: "uncertain",
    attempts: 1,
    error: "lease_expired",
    token: null,
  });
  assert.equal(await serviceCall(first, finishSql(sending)), false);
  assert.deepEqual(await serviceCall(second, claimsSql()), []);
  assert.equal((await row(sending.id)).attempts, 1);
});

test("concurrent duplicate finish waits for the same row and applies only one result", async () => {
  const pending = await createPayment();
  const [job] = await serviceCall(first, claimsSql());
  assert.equal(job.id, pending.id);
  await assertPrepared(first, job);
  await service(first);
  assert.equal(await first.json(finishSql(job)), true);
  await service(second);
  const late = second.json(finishSql(job));
  await waitForLock(observer, first, second);
  observedFinishLocks++;
  await first.query("commit;");
  assert.equal(await late, false);
  await second.query("commit;");
  assert.deepEqual(await row(job.id), {
    status: "accepted",
    attempts: 1,
    error: null,
    token: null,
  });
  assert.equal(await serviceCall(first, finishSql(job)), false);
});

test("anon, client and administrator cannot read private outbox data or call worker RPCs", async () => {
  for (const user of [null, owner, admin]) {
    for (const sql of [
      "select * from public.business_email_outbox;",
      "select * from public.business_email_settings;",
      claimsSql(),
      `select * from public.worker_prepare_business_email(${literal(randomUUID())},${literal(randomUUID())});`,
      json(
        `public.worker_finish_business_email(${literal(randomUUID())},${literal(randomUUID())},'accepted')`,
      ),
    ]) {
      const denied = await new LocalPostgres({ database }).ready();
      try {
        if (user) await denied.asUser(user);
        else await denied.query("begin; set local role anon;");
        await assert.rejects(denied.query(sql), /permission denied/);
      } finally {
        await denied.close();
      }
    }
  }
  await observer.asUser(admin);
  const counts = await observer.json(json("public.business_email_status()"));
  await observer.query("commit;");
  assert.equal(counts.enabled, true);
  assert.equal(counts.counts.accepted, 52);
  assert.equal(counts.counts.cancelled, 2);
  assert.equal(counts.counts.uncertain, 1);
  assert.deepEqual(Object.keys(counts).sort(), ["counts", "enabled"]);
});
