// Real PostgreSQL replay/concurrency acceptance in a generated, labelled DB.
// No Auth/API credentials, source-data mutations or application server needed.
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
const database = `psi_dog_${run.replaceAll("-", "")}`;
const label = `psi-dog-qualification-fixture:${run}`;
const owner = randomUUID();
const other = randomUUID();
const guardian = randomUUID();
const dog = randomUUID();
const connections = new Set();
let source, observer, baseline;
let created = false;
let observedLocks = 0;
let migrationCount = 0;

async function originalState() {
  const tables = await source.json(`begin;
    create temporary table dog_qualification_source_snapshot(name text,rows bigint,digest text) on commit drop;
    do $$ declare t record; n bigint; h text; begin
      for t in select c.relname from pg_class c join pg_namespace s on s.oid=c.relnamespace
        where s.nspname='public' and c.relkind='r' order by c.relname loop
        execute format('select count(*),md5(coalesce(string_agg(md5(to_jsonb(r)::text),%L order by md5(to_jsonb(r)::text)),%L)) from public.%I r','','',t.relname) into n,h;
        insert into dog_qualification_source_snapshot values(t.relname,n,h);
      end loop;
    end $$;
    select coalesce(jsonb_agg(s order by name),'[]') from dog_qualification_source_snapshot s;
    commit;`);
  const metadata = await source.json(`select json_build_object(
    'databases',(select jsonb_agg(datname order by datname) from pg_database),
    'accounts',(select coalesce(jsonb_agg(id order by id),'[]') from auth.users),
    'migrations',(select jsonb_agg(version order by version) from supabase_migrations.schema_migrations));`);
  return { tables, metadata };
}

before(async () => {
  source = new LocalPostgres();
  await source.ready();
  baseline = await originalState();
  assert(!baseline.metadata.databases.includes(database));
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
  const migrations = readdirSync("supabase/migrations")
    .filter((file) => /^\d{12}_.+\.sql$/.test(file))
    .sort();
  assert(migrations.includes("202610160002_dog_qualification_recovery.sql"));
  for (const file of migrations)
    await observer.query(readFileSync(`supabase/migrations/${file}`, "utf8"));
  migrationCount = migrations.length;
  await observer.query(`insert into auth.users(id,email) values
    (${literal(owner)},${literal(`psi-dog-creation-${run}-owner@example.test`)}),
    (${literal(other)},${literal(`psi-dog-qualification-${run}-other@example.test`)}),
    (${literal(guardian)},${literal(`psi-dog-qualification-${run}-guardian@example.test`)});
    update public.user_roles set role='admin' where user_id in (${literal(owner)},${literal(other)});`);
});

beforeEach(async () => {
  await observer.query(`truncate public.dogs cascade;
    truncate public.dog_creation_receipts;
    truncate public.dog_qualification_receipts;
    delete from public.audit_events;
    insert into public.dogs(id,guardian_id,name) values(${literal(dog)},${literal(guardian)},'Pies kwalifikacji');`);
});

after(async () => {
  try {
    for (const connection of connections) await connection.close();
    await observer?.close();
    if (created) {
      const owned =
        await source.json(`select to_json(shobj_description(oid,'pg_database'))
        from pg_database where datname=${literal(database)}
        and datdba=(select oid from pg_roles where rolname='postgres');`);
      assert.equal(owned, label, "Do not remove an unrecognised database");
      await source.query(`drop database "${database}";`);
    }
    if (baseline)
      assert.deepEqual(
        await originalState(),
        baseline,
        "Source accounts, public tables and migrations must remain unchanged",
      );
    console.log(
      `Dog qualification PostgreSQL: ${migrationCount} migrations; ${observedLocks} observed lock dependencies; owned database removed; source preserved.`,
    );
  } finally {
    await source?.close();
  }
});

function connection() {
  const result = new LocalPostgres({ database });
  connections.add(result);
  return result;
}

async function close(client) {
  await client.close();
  connections.delete(client);
}

async function operation(actor, sql) {
  const client = connection();
  try {
    await client.ready();
    await client.asUser(actor);
    const value = await client.json(sql);
    await client.query("commit;");
    return { value, pid: client.pid };
  } finally {
    await close(client);
  }
}

async function race(firstActor, firstSQL, secondActor, secondSQL) {
  const holder = connection();
  const waiter = connection();
  let pending;
  try {
    await holder.ready();
    await waiter.ready();
    await holder.asUser(firstActor);
    const first = await holder.json(firstSQL);
    await waiter.asUser(secondActor);
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
    await close(holder);
    await close(waiter);
    if (pending) await pending;
  }
}

const qualify = (
  key,
  {
    expected = "new",
    version = 0,
    status = "approved",
    note = "Próbna decyzja",
  } = {},
) =>
  `select to_json(public.qualify_dog(${literal(key)},${literal(dog)},${literal(expected)},${version},${literal(status)},${literal(note)}));`;
const evidence = () =>
  observer.json(`select json_build_object(
  'status',(select status from public.dogs where id=${literal(dog)}),
  'version',(select qualification_version from public.dogs where id=${literal(dog)}),
  'notes',(select count(*) from public.dog_notes where dog_id=${literal(dog)}),
  'audits',(select count(*) from public.audit_events where entity_id=${literal(dog)}),
  'receipts',(select count(*) from public.dog_qualification_receipts where dog_id=${literal(dog)}));`);
const single = {
  status: "approved",
  version: 1,
  notes: 1,
  audits: 1,
  receipts: 1,
};

test("identical concurrent qualification retries wait and commit one decision", async () => {
  const key = randomUUID();
  const result = await race(owner, qualify(key), owner, qualify(key));
  assert.equal(result.first, 1);
  assert.equal(result.second.value, 1);
  assert.deepEqual(await evidence(), single);
});

test("two administrators with different old-state decisions cannot overwrite the winner", async () => {
  const result = await race(
    owner,
    qualify(randomUUID()),
    other,
    qualify(randomUUID(), { status: "not_eligible", note: "Druga decyzja" }),
  );
  assert.equal(result.first, 1);
  assert.match(
    result.second.error?.message || "",
    /Kwalifikacja psa zmieniła się/,
  );
  assert.deepEqual(await evidence(), single);
});

test("a different administrator cannot reuse a request key after waiting", async () => {
  const key = randomUUID();
  const result = await race(owner, qualify(key), other, qualify(key));
  assert.match(
    result.second.error?.message || "",
    /formularz kwalifikacji został już użyty/,
  );
  assert.deepEqual(await evidence(), single);
});

test("a fresh backend after lost acknowledgement replays without a second note or audit", async () => {
  const key = randomUUID();
  const first = await operation(owner, qualify(key));
  const replay = await operation(owner, qualify(key));
  assert.notEqual(replay.pid, first.pid);
  assert.equal(replay.value, first.value);
  await assert.rejects(
    operation(owner, qualify(key, { note: "Inna treść decyzji" })),
    /formularz kwalifikacji został już użyty/,
  );
  assert.deepEqual(await evidence(), single);
});

test("the same status and an ABA transition both invalidate old versions", async () => {
  await operation(owner, qualify(randomUUID(), { status: "new" }));
  await assert.rejects(
    operation(other, qualify(randomUUID())),
    /Kwalifikacja psa zmieniła się/,
  );
  await operation(owner, qualify(randomUUID(), { version: 1 }));
  await operation(
    owner,
    qualify(randomUUID(), { expected: "approved", version: 2, status: "new" }),
  );
  await assert.rejects(
    operation(other, qualify(randomUUID())),
    /Kwalifikacja psa zmieniła się/,
  );
  assert.deepEqual(await evidence(), {
    status: "new",
    version: 3,
    notes: 3,
    audits: 3,
    receipts: 3,
  });
});

test("a failed note rolls back status, version, receipt and audit before a clean retry", async () => {
  const key = randomUUID();
  await observer.query(`create function public.fixture_qualification_failure() returns trigger language plpgsql as $$begin raise exception 'Owned fixture failure';end$$;
    create trigger fixture_qualification_failure before insert on public.dog_notes for each row execute function public.fixture_qualification_failure();`);
  try {
    await assert.rejects(
      operation(owner, qualify(key)),
      /Owned fixture failure/,
    );
    assert.deepEqual(await evidence(), {
      status: "new",
      version: 0,
      notes: 0,
      audits: 0,
      receipts: 0,
    });
  } finally {
    await observer.query(
      "drop trigger fixture_qualification_failure on public.dog_notes;drop function public.fixture_qualification_failure();",
    );
  }
  await operation(owner, qualify(key));
  assert.deepEqual(await evidence(), single);
});

test("revoked staff, ordinary clients and the legacy RPC cannot bypass qualification", async () => {
  const key = randomUUID();
  await operation(owner, qualify(key));
  await observer.query(
    `update public.user_roles set role='client' where user_id=${literal(owner)};`,
  );
  try {
    await assert.rejects(operation(owner, qualify(key)), /Brak uprawnień/);
    await assert.rejects(
      operation(guardian, qualify(randomUUID())),
      /Brak uprawnień/,
    );
    await assert.rejects(
      operation(
        other,
        `select public.set_dog_status(${literal(dog)},'not_eligible','Próba obejścia');`,
      ),
      /permission denied/,
    );
    assert.deepEqual(await evidence(), single);
  } finally {
    await observer.query(
      `update public.user_roles set role='admin' where user_id=${literal(owner)};`,
    );
  }
});
