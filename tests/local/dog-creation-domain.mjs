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
const label = `psi-dog-creation-fixture:${run}`;
const owner = randomUUID();
const other = randomUUID();
const payload = {
  name: "Fikcyjny pies ponowienia",
  breed: "Mieszaniec testowy",
  approximate_age: "3 lata",
  sex: "female",
  weight_kg: 12.5,
  color: "Brązowa",
};
const refusedReplay = /Nie można ponowić zapisu tego formularza/;
const changedPayload = /formularz został już zapisany z innymi danymi/;
const connections = new Set();
let source, observer, baseline;
let created = false;
let observedLocks = 0;
let migrationCount = 0;

async function originalState() {
  const tables = await source.json(`begin;
    create temporary table dog_creation_source_snapshot(name text,rows bigint,digest text) on commit drop;
    do $$ declare t record; n bigint; h text; begin
      for t in select c.relname from pg_class c join pg_namespace s on s.oid=c.relnamespace
        where s.nspname='public' and c.relkind='r' order by c.relname loop
        execute format('select count(*),md5(coalesce(string_agg(md5(to_jsonb(r)::text),%L order by md5(to_jsonb(r)::text)),%L)) from public.%I r','','',t.relname) into n,h;
        insert into dog_creation_source_snapshot values(t.relname,n,h);
      end loop;
    end $$;
    select coalesce(jsonb_agg(s order by name),'[]') from dog_creation_source_snapshot s;
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
  assert(migrations.includes("202610160001_dog_creation_recovery.sql"));
  for (const file of migrations)
    await observer.query(readFileSync(`supabase/migrations/${file}`, "utf8"));
  migrationCount = migrations.length;
  await observer.query(`insert into auth.users(id,email) values
    (${literal(owner)},${literal(`psi-dog-creation-${run}-owner@example.test`)}),
    (${literal(other)},${literal(`psi-dog-creation-${run}-other@example.test`)});`);
});

beforeEach(async () => {
  await observer.query(`truncate public.dogs cascade;
    truncate public.dog_creation_receipts;
    delete from public.audit_events;`);
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
      `Dog creation PostgreSQL: ${migrationCount} migrations; ${observedLocks} observed lock dependencies; owned database removed; source preserved.`,
    );
  } finally {
    await source?.close();
  }
});

const createSQL = (key, fields = payload) =>
  `select to_json(public.create_dog_profile(${literal(key)},${literal(JSON.stringify(fields))}::jsonb));`;

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

const evidence = () =>
  observer.json(`select json_build_object(
  'dogs',(select coalesce(jsonb_agg(to_jsonb(d) order by id),'[]') from public.dogs d),
  'receipts',(select coalesce(jsonb_agg(to_jsonb(r) order by request_id),'[]') from public.dog_creation_receipts r));`);

async function singleDog(key, dog) {
  const state = await evidence();
  assert.equal(state.dogs.length, 1);
  assert.equal(state.dogs[0].id, dog);
  assert.equal(state.dogs[0].guardian_id, owner);
  assert.equal(state.dogs[0].status, "new");
  assert.deepEqual(state.receipts, [
    { request_id: key, result_id: dog, guardian_id: owner, payload },
  ]);
  return state;
}

test("two simultaneous identical creates wait and return one committed dog UUID", async () => {
  const key = randomUUID();
  const result = await race(owner, createSQL(key), owner, createSQL(key));
  assert.match(result.first, /^[0-9a-f-]{36}$/);
  assert.equal(result.second.value, result.first);
  await singleDog(key, result.first);
});

test("another guardian waits for the same key and cannot reuse its committed result", async () => {
  const key = randomUUID();
  const result = await race(owner, createSQL(key), other, createSQL(key));
  assert.match(result.second.error?.message || "", refusedReplay);
  await singleDog(key, result.first);
});

test("the same guardian with a changed payload waits and conflicts without overwriting", async () => {
  const key = randomUUID();
  const result = await race(
    owner,
    createSQL(key),
    owner,
    createSQL(key, { ...payload, name: "Inne dane formularza" }),
  );
  assert.match(result.second.error?.message || "", changedPayload);
  await singleDog(key, result.first);
});

test("a new backend recovers a discarded creation response after COMMIT without duplicating", async () => {
  const key = randomUUID();
  const creator = connection();
  let firstPid;
  try {
    await creator.ready();
    await creator.asUser(owner);
    firstPid = creator.pid;
    // Deliberately discard the returned UUID: only the server commit survives.
    await creator.query(createSQL(key));
    await creator.query("commit;");
  } finally {
    await close(creator);
  }
  const beforeReplay = await evidence();
  assert.equal(beforeReplay.dogs.length, 1);
  const replay = await operation(owner, createSQL(key));
  assert.notEqual(
    replay.pid,
    firstPid,
    "Replay must use an independent backend",
  );
  assert.equal(replay.value, beforeReplay.dogs[0].id);
  assert.deepEqual(await evidence(), beforeReplay);
  await singleDog(key, replay.value);
});

test("replay after a profile edit returns the same dog and preserves current fields", async () => {
  const key = randomUUID();
  const { value: dog } = await operation(owner, createSQL(key));
  await operation(
    owner,
    `update public.dogs set name='Fikcyjny pies po edycji',weight_kg=18.5,
    color='Nowy kolor' where id=${literal(dog)} returning to_jsonb(dogs);`,
  );
  const edited = await evidence();
  assert.equal(edited.dogs[0].name, "Fikcyjny pies po edycji");
  assert.equal((await operation(owner, createSQL(key))).value, dog);
  assert.deepEqual(await evidence(), edited);
});

test("a transferred dog refuses replay by both the original and the current guardian", async () => {
  const key = randomUUID();
  const { value: dog } = await operation(owner, createSQL(key));
  await observer.query(
    `update public.dogs set guardian_id=${literal(other)} where id=${literal(dog)};`,
  );
  const transferred = await evidence();
  assert.equal(transferred.dogs[0].guardian_id, other);
  for (const actor of [owner, other])
    await assert.rejects(operation(actor, createSQL(key)), refusedReplay);
  assert.deepEqual(await evidence(), transferred);
});

test("deleting a dog retains its acknowledgement and refuses recreation with the old key", async () => {
  const key = randomUUID();
  const { value: dog } = await operation(owner, createSQL(key));
  await observer.query(`delete from public.dogs where id=${literal(dog)};`);
  const deleted = await evidence();
  assert.equal(deleted.dogs.length, 0);
  assert.equal(deleted.receipts.length, 1);
  for (const actor of [owner, other])
    await assert.rejects(operation(actor, createSQL(key)), refusedReplay);
  assert.deepEqual(await evidence(), deleted);
});
