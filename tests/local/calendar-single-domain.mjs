// Rehearse the current single-practitioner calendar schema using independent real PostgreSQL
// sessions in a generated, labelled database on this project's local VM.
// No Auth/API credentials, environment files or source-data mutations.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { after, before, beforeEach, test } from "node:test";
import { configureCalendarPrimary } from "../helpers/calendar-primary.mjs";
import {
  LocalPostgres,
  literal,
  waitForLock,
} from "../helpers/local-postgres.mjs";

const run = randomUUID(),
  database = `psi_calendar_${run.replaceAll("-", "")}`,
  label = `psi-single-calendar-fixture:${run}`;
const admin2 = "d3100000-0000-4000-8000-000000000004";
const admin = "d3100000-0000-4000-8000-000000000001",
  owner = "d3100000-0000-4000-8000-000000000002",
  other = "d3100000-0000-4000-8000-000000000003";
const dog = "d3200000-0000-4000-8000-000000000001",
  dog2 = "d3200000-0000-4000-8000-000000000002";
let source,
  observer,
  baseline,
  created = false,
  observedLocks = 0;
const originalState = () =>
  source.json(`select json_build_object(
  'databases',(select jsonb_agg(datname order by datname) from pg_database),
  'accounts',(select jsonb_agg(id order by id) from auth.users),
  'dogs',(select jsonb_agg(to_jsonb(d) order by id) from public.dogs d),
  'services',(select jsonb_agg(to_jsonb(s) order by id) from public.services s),
  'migrations',(select jsonb_agg(version order by version) from supabase_migrations.schema_migrations));`);
before(async () => {
  source = await new LocalPostgres().ready();
  baseline = await originalState();
  assert(!baseline.databases.includes(database));
  await source.query(`create database "${database}";`);
  created = true;
  await source.query(`comment on database "${database}" is ${literal(label)};`);
  observer = await new LocalPostgres({ database }).ready();
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
  await observer.query(`insert into auth.users(id,email) values(${literal(admin)},'gift-admin@example.test'),(${literal(owner)},'gift-owner@example.test'),(${literal(other)},'gift-other@example.test'),(${literal(admin2)},'team-admin2@example.test');
    update public.user_roles set role='admin' where user_id in (${literal(admin)},${literal(admin2)});
    insert into public.dogs(id,guardian_id,name) values(${literal(dog)},${literal(owner)},'Fikcyjny pies karty'),(${literal(dog2)},${literal(owner)},'Drugi fikcyjny pies karty');
    update public.dogs set status='approved';`);
  await configureCalendarPrimary(observer, admin);
});
beforeEach(async () => {
  await observer.query(
    "truncate public.walks,public.consultations,public.calendar_blocks,public.courses,public.fitness_packages,public.calendar_resources cascade; delete from public.audit_events; update public.calendar_settings set version=1,hours_enabled=false,before_minutes=0,after_minutes=0,updated_by=null; update public.calendar_weekly_hours set enabled=weekday<=5,start_minute=540,end_minute=1020; update public.user_roles set role='admin' where user_id in ('d3100000-0000-4000-8000-000000000001','d3100000-0000-4000-8000-000000000004');",
  );
  await configureCalendarPrimary(observer, admin);
});
after(async () => {
  try {
    await observer?.close();
    if (created) {
      const owned =
        await source.json(`select to_json(shobj_description(oid,'pg_database')) from pg_database
        where datname=${literal(database)} and datdba=(select oid from pg_roles where rolname='postgres');`);
      assert.equal(owned, label, "Do not remove an unrecognised database");
      await source.query(`drop database "${database}";`);
    }
    if (baseline) assert.deepEqual(await originalState(), baseline);
    console.log(
      `Single-practitioner PostgreSQL: ${observedLocks} observed lock dependencies; owned database removed; source accounts, dogs, services and migrations preserved.`,
    );
  } finally {
    await source?.close();
  }
});

async function operation(actor, sql) {
  const c = await new LocalPostgres({ database }).ready();
  try {
    await c.asUser(actor);
    const result = await c.json(sql);
    await c.query("commit;");
    return result;
  } finally {
    await c.close();
  }
}
// Hold a finished first statement open and observe the second waiting on that
// actual backend. This proves concurrency, rather than relying on Promise.all.
async function race(firstActor, firstSQL, secondActor, secondSQL) {
  const holder = await new LocalPostgres({ database }).ready(),
    waiter = await new LocalPostgres({ database }).ready();
  let pending;
  try {
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
const at = "2027-05-10T10:00:00Z";
const plus = (minutes) =>
  new Date(Date.parse(at) + minutes * 60000).toISOString();
const payload = (starts_at) => ({
  starts_at,
  duration_minutes: 60,
  type: "Fikcyjna praktyka",
  public_location: "Fikcyjny park",
  exact_location: "FIKCYJNA ZBIÓRKA",
  map_url: "",
  instructions: "",
  cancellation_deadline_hours: 24,
  price_cents: 10000,
  capacity: 4,
  booking_mode: "approval",
  info: "",
});
const writeSQL = (operationName, args, choice = null, confirm = false) =>
  `select public.calendar_write(${literal(operationName)},${literal(JSON.stringify(args))}::jsonb,${confirm},${choice === null ? "null" : literal(JSON.stringify(choice)) + "::jsonb"});`;
const walkSQL = (start) => writeSQL("create_walk", { payload: payload(start) });
async function history(id, staff) {
  await observer.query(`update public.calendar_assignments set assigned_staff_id=${staff === null ? "null" : literal(staff)},legacy_unassigned=${staff === null} where appointment_id=${literal(id)};
    update public.calendar_slots set occupied=base_occupied where walk_id=${literal(id)};`);
}

for (const reverse of [false, true]) {
  test(`historical UUID and primary compete for the same booking interval, reverse=${reverse}`, async () => {
    const id = await operation(admin2, walkSQL(at));
    await history(id, admin2);
    const stamp = await observer.json(
      `select to_json(updated_at) from public.walks where id=${literal(id)};`,
    );
    const change = writeSQL(
      "update_walk",
      {
        p_walk: id,
        p_expected_updated_at: stamp,
        payload: payload(plus(120)),
        p_note: "Fikcyjne przełożenie",
      },
      { staff_id: admin2, resource_id: null, expected_version: 1 },
    );
    const firstSQL = reverse ? walkSQL(plus(120)) : change;
    const secondSQL = reverse ? change : walkSQL(plus(120));
    const result = await race(
      reverse ? admin : admin2,
      firstSQL,
      reverse ? admin2 : admin,
      secondSQL,
    );
    assert.match(result.second.error?.message || "", /już zajęty/);
    assert.equal(
      await observer.json(
        `select to_json(count(*)) from public.calendar_slots where occupied && tstzrange(${literal(plus(120))},${literal(plus(180))},'[)');`,
      ),
      1,
    );
    assert.equal(
      await observer.json(
        `select to_json(assigned_staff_id) from public.calendar_assignments where appointment_id=${literal(id)};`,
      ),
      admin2,
    );
    if (!reverse)
      assert.equal(
        await observer.json(`select to_json(count(*)) from public.walks;`),
        1,
      );
  });
}

test("concurrent different organising administrators both select the one primary", async () => {
  const result = await race(admin2, walkSQL(at), admin, walkSQL(plus(120)));
  assert(!result.second.error, result.second.error?.message);
  const rows = await observer.json(
    "select jsonb_agg(jsonb_build_object('assigned',assigned_staff_id,'creator',created_by) order by created_by) from public.calendar_assignments;",
  );
  assert.equal(rows.length, 2);
  assert(rows.every((row) => row.assigned === admin));
  assert.deepEqual(
    new Set(rows.map((row) => row.creator)),
    new Set([admin, admin2]),
  );
});

test("a historic null blocks the same global availability", async () => {
  const id = await operation(admin2, walkSQL(at));
  await history(id, null);
  const block = randomUUID();
  const result = await race(
    admin,
    `select to_json(public.save_calendar_assignment('walk',${literal(id)},1,null,null,false));`,
    admin2,
    `select public.save_calendar_team_block(${literal(block)},0,'Fikcyjna blokada',${literal(at)},${literal(plus(60))},${literal(admin)},null,0,false);`,
  );
  assert.match(result.second.error?.message || "", /już zajęty/);
  assert.equal(
    await observer.json(
      `select to_json(count(*)) from public.calendar_blocks;`,
    ),
    0,
  );
});

test("two identical block retries produce one assignment audit with the true organiser", async () => {
  const id = randomUUID();
  await operation(
    admin2,
    `select public.save_calendar_team_block(${literal(id)},0,'Fikcyjna blokada',${literal(at)},${literal(plus(60))},${literal(admin)},null,0,false);`,
  );
  await observer.query(`update public.calendar_assignments set assigned_staff_id=null,legacy_unassigned=true where block_id=${literal(id)};
    update public.calendar_slots set occupied=base_occupied where block_id=${literal(id)};`);
  const change = `select public.save_calendar_team_block(${literal(id)},1,'Fikcyjna blokada',${literal(plus(120))},${literal(plus(180))},${literal(admin)},null,1,false);`;
  const result = await race(admin2, change, admin2, change);
  assert(!result.second.error, result.second.error?.message);
  assert.deepEqual(result.first, { version: 2, assignment_version: 2 });
  assert.deepEqual(result.second.value, result.first);
  assert.deepEqual(
    await observer.json(
      `select jsonb_agg(jsonb_build_object('actor',actor_id,'details',details)) from public.audit_events where event='calendar_assignment_saved' and entity_id=${literal(id)};`,
    ),
    [
      {
        actor: admin2,
        details: {
          kind: "block",
          version: 2,
          assigned_staff_id: admin,
          resource_id: null,
        },
      },
    ],
  );
});

for (const invalidRole of [false, true]) {
  test(`an individual course cancellation preserves siblings without a valid primary, roleLost=${invalidRole}`, async () => {
    const course = randomUUID();
    await operation(
      admin2,
      writeSQL("create_course", {
        p_id: course,
        p_service: "60000000-0000-4000-8000-000000000001",
        p_expected_service_version: 1,
        p_title: "Fikcyjny kurs",
        p_capacity: 2,
        p_public_location: "Fikcyjny park",
        p_exact_location: "Fikcyjna zbiórka",
        p_starts: Array.from({ length: 5 }, (_, n) => plus(n * 7 * 1440)),
      }),
    );
    await operation(
      admin2,
      writeSQL("change_course", {
        p_id: course,
        p_expected_version: 1,
        p_action: "publish",
        p_note: "",
      }),
    );
    const id = await observer.json(
      `select to_json(id) from public.course_sessions where course_id=${literal(course)} and ordinal=1;`,
    );
    const siblingsSQL = `select jsonb_agg(to_jsonb(s) order by course_session_id) from public.calendar_slots s where course_session_id<>${literal(id)};`;
    const before = await observer.json(siblingsSQL);
    await observer.query(
      invalidRole
        ? `update public.user_roles set role='client' where user_id=${literal(admin)};`
        : "update public.calendar_settings set primary_practitioner_id=null;",
    );
    await operation(
      admin2,
      `select to_json(public.change_course_session(${literal(id)},1,'cancel','Fikcyjne odwołanie'));`,
    );
    assert.deepEqual(await observer.json(siblingsSQL), before);
  });
}
