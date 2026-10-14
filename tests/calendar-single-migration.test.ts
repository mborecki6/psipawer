import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { beforeAll, beforeEach, afterAll, expect, it } from "vitest";

let db: PGlite;
const a = "83000000-0000-4000-8000-000000000001";
const b = "83000000-0000-4000-8000-000000000002";
const migrationName = "202610140001_single_practitioner.sql";
const migration = readFileSync(`supabase/migrations/${migrationName}`, "utf8");
const at = "2027-05-10T10:00:00Z";
const plus = (minutes: number) =>
  new Date(Date.parse(at) + minutes * 60000).toISOString();
async function user<T>(fn: () => Promise<T>) {
  await db.exec("begin;set local role authenticated;");
  await db.query("select set_config('request.jwt.claim.sub',$1,true)", [a]);
  try {
    const result = await fn();
    await db.exec("commit");
    return result;
  } catch (error) {
    await db.exec("rollback");
    throw error;
  }
}
async function room() {
  const id = randomUUID();
  await user(() =>
    db.query(
      "select public.save_calendar_resource($1,0,'Fikcyjna sala',true,true)",
      [id],
    ),
  );
  return id;
}
async function legacyWalk(
  start: string,
  staff: string | null,
  resource: string | null,
) {
  return (
    await user(() =>
      db.query<{ id: string }>(
        "select public.calendar_write('create_walk',$1,false,$2) id",
        [
          {
            payload: {
              starts_at: start,
              duration_minutes: 60,
              public_location: "Park próbny",
              type: "Historyczny spacer",
              price_cents: 10000,
              capacity: 4,
              booking_mode: "approval",
              info: "",
              exact_location: "Fikcyjna zbiórka",
              map_url: "",
              instructions: "",
              cancellation_deadline_hours: 24,
            },
          },
          { staff_id: staff, resource_id: resource, expected_version: 0 },
        ],
      ),
    )
  ).rows[0].id;
}
async function snapshot() {
  return (
    await db.query<{ data: unknown }>(`select jsonb_build_object(
    'assignments',(select jsonb_agg(to_jsonb(a) order by appointment_id) from public.calendar_assignments a),
    'slots',(select jsonb_agg(to_jsonb(s)-'staff_scope' order by walk_id) from public.calendar_slots s),
    'audit',(select jsonb_agg(to_jsonb(a) order by id) from public.audit_events a),
    'profiles',(select jsonb_agg(to_jsonb(p) order by id) from public.profiles p),
    'roles',(select jsonb_agg(to_jsonb(r) order by user_id) from public.user_roles r),
    'walks',(select jsonb_agg(to_jsonb(w) order by id) from public.walks w),
    'resources',(select jsonb_agg(to_jsonb(r) order by id) from public.calendar_resources r)) data`)
  ).rows[0].data;
}
beforeAll(async () => {
  db = new PGlite();
  await db.exec(`set timezone='UTC';create role anon;create role authenticated;create role service_role;create schema auth;
    create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,encrypted_password text);
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    grant usage on schema public,auth to anon,authenticated;grant execute on function auth.uid() to anon,authenticated;
    create schema storage;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
    create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text);alter table storage.objects enable row level security;
    create function storage.foldername(name text) returns text[] language sql as $$select string_to_array(name,'/')$$;
    grant usage on schema storage to authenticated;grant select,insert,delete on storage.objects to authenticated;`);
  for (const file of readdirSync("supabase/migrations")
    .filter((f) => f.endsWith(".sql") && f < migrationName)
    .sort())
    await db.exec(readFileSync(`supabase/migrations/${file}`, "utf8"));
  await db.query("insert into auth.users(id) values($1),($2)", [a, b]);
  await db.query(
    "update public.user_roles set role='admin' where user_id in ($1,$2)",
    [a, b],
  );
});
beforeEach(async () => {
  await db.exec(
    "truncate public.walks,public.calendar_resources cascade;delete from public.audit_events;",
  );
});
afterAll(async () => {
  await db?.close();
});

it("migrates historic UUIDs, null, rooms and audit without reassigning or changing source records", async () => {
  await legacyWalk(at, a, await room());
  await legacyWalk(plus(120), b, null);
  await legacyWalk(plus(240), null, null);
  const before = await snapshot();
  await db.exec("begin");
  try {
    await db.exec(migration);
    expect(await snapshot()).toEqual(before);
    expect(
      (
        await db.query(
          "select primary_practitioner_id from public.calendar_settings",
        )
      ).rows,
    ).toEqual([{ primary_practitioner_id: null }]);
    expect(
      (
        await db.query<{ global: boolean }>(
          "select bool_and(staff_scope=int4range(null,null,'()')) global from public.calendar_slots",
        )
      ).rows[0].global,
    ).toBe(true);
    expect(
      (
        await db.query<{ definition: string }>(
          "select pg_get_constraintdef(oid) definition from pg_constraint where conname='calendar_no_overlap'",
        )
      ).rows[0].definition,
    ).not.toContain("staff_scope");
  } finally {
    await db.exec("rollback");
  }
});
it("atomically refuses old parallel staff bookings without changing the prior schema or records", async () => {
  await legacyWalk(at, a, await room());
  await legacyWalk(at, b, await room());
  const before = await snapshot();
  const constraint = (
    await db.query(
      "select pg_get_constraintdef(oid) definition from pg_constraint where conname='calendar_no_overlap'",
    )
  ).rows;
  await db.exec("begin");
  try {
    await expect(db.exec(migration)).rejects.toThrow(
      "Istnieją nakładające się terminy",
    );
  } finally {
    await db.exec("rollback");
  }
  expect(await snapshot()).toEqual(before);
  expect(
    (
      await db.query(
        "select pg_get_constraintdef(oid) definition from pg_constraint where conname='calendar_no_overlap'",
      )
    ).rows,
  ).toEqual(constraint);
  expect(
    (
      await db.query(
        "select column_name from information_schema.columns where table_schema='public' and table_name='calendar_settings' and column_name='primary_practitioner_id'",
      )
    ).rows,
  ).toEqual([]);
});
