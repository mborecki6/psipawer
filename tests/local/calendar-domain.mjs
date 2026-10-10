// Rehearse the pending calendar schema using independent real PostgreSQL
// sessions in a generated, labelled database on this project's local VM.
// No Auth/API credentials, environment files or source-data mutations.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { after, before, beforeEach, test } from "node:test";
import {
  LocalPostgres,
  literal,
  waitForLock,
} from "../helpers/local-postgres.mjs";

const run = randomUUID(),
  database = `psi_calendar_${run.replaceAll("-", "")}`,
  label = `psi-calendar-fixture:${run}`;
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
});
beforeEach(async () => {
  await observer.query(
    "truncate public.walks,public.consultations,public.calendar_blocks,public.courses,public.fitness_packages,public.calendar_resources cascade; delete from public.audit_events; update public.calendar_settings set version=1,hours_enabled=false,before_minutes=0,after_minutes=0,updated_by=null; update public.calendar_weekly_hours set enabled=weekday<=5,start_minute=540,end_minute=1020;",
  );
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
      `Calendar PostgreSQL: ${observedLocks} observed lock dependencies; owned database removed; source accounts, dogs, services and migrations preserved.`,
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
const week = (start = 0, end = 1440) =>
  Array.from({ length: 7 }, (_, n) => ({
    weekday: n + 1,
    enabled: true,
    start_minute: start,
    end_minute: end,
  }));
const policySQL = (
  before = 0,
  after = 0,
  enabled = false,
  version = 1,
  hours = week(),
) =>
  `select to_json(public.save_calendar_settings(${version},${enabled},${before},${after},${literal(JSON.stringify(hours))}::jsonb));`;
const walkSQL = (at) =>
  `select to_json(public.create_walk(${literal(JSON.stringify({ starts_at: at, duration_minutes: 60, type: "Fikcyjny kalendarz", public_location: "Próba", exact_location: "FIKCYJNA ZBIÓRKA", map_url: "", instructions: "", cancellation_deadline_hours: 24, price_cents: 10000, capacity: 4, booking_mode: "approval", info: "" }))}::jsonb));`;
const state = () =>
  observer.json(`select json_build_object(
  'settings',(select to_jsonb(s) from public.calendar_settings s),
  'week',(select jsonb_agg(to_jsonb(h) order by weekday) from public.calendar_weekly_hours h),
  'slots',(select coalesce(jsonb_agg(to_jsonb(s) order by occupied),'[]') from public.calendar_slots s),
  'walks',(select coalesce(jsonb_agg(to_jsonb(w) order by id),'[]') from public.walks w),
  'audits',(select coalesce(jsonb_agg(to_jsonb(a) order by id),'[]') from public.audit_events a));`);
const refused = (r, pattern) =>
  assert.match(r.second.error?.message || "", pattern);

test("hours saved first serialize a concurrent new appointment and reject its outside-hours source without leftovers", async () => {
  const r = await race(
    admin,
    policySQL(0, 0, true, 1, week(540, 1020)),
    admin,
    walkSQL("2027-05-10T05:00:00Z"),
  );
  refused(r, /wykracza poza godziny pracy/);
  const s = await state();
  assert.equal(s.settings.version, 2);
  assert.equal(s.slots.length, 0);
  assert.equal(s.walks.length, 0);
  assert.equal(s.audits.length, 1);
});
test("an appointment saved first makes the waiting hours change roll back all of its changes", async () => {
  const r = await race(
    admin,
    walkSQL("2027-05-10T05:00:00Z"),
    admin,
    policySQL(0, 0, true, 1, week(540, 1020)),
  );
  refused(r, /wykracza poza godziny pracy/);
  const s = await state();
  assert.equal(s.settings.version, 1);
  assert.equal(s.settings.hours_enabled, false);
  assert.equal(s.slots.length, 1);
  assert.equal(s.walks[0].id, r.first);
  assert.equal(
    s.audits.filter((a) => a.event === "calendar_settings_saved").length,
    0,
  );
});
test("preferred breaks saved first make a concurrent adjacent appointment request acknowledgement after the projection wait", async () => {
  await operation(admin, walkSQL("2027-05-10T10:00:00Z"));
  const r = await race(
    admin,
    policySQL(0, 15),
    admin,
    walkSQL("2027-05-10T11:00:00Z"),
  );
  refused(r, /Krótka przerwa/);
  assert.equal((await state()).walks.length, 1);
});
test("an adjacent appointment saved first permits waiting preferred-break changes without changing either appointment", async () => {
  await operation(admin, walkSQL("2027-05-10T10:00:00Z"));
  const r = await race(
    admin,
    walkSQL("2027-05-10T11:00:00Z"),
    admin,
    policySQL(0, 15),
  );
  assert.equal(r.second.value, 2);
  const s = await state();
  assert.equal(s.settings.version, 2);
  assert.equal(s.settings.after_minutes, 15);
  assert.equal(s.walks.length, 2);
  assert.equal(s.slots.length, 2);
});
test("two editors cannot overwrite a newly committed policy", async () => {
  const r = await race(admin, policySQL(10, 20), admin, policySQL(15, 30));
  refused(r, /Ustawienia kalendarza zmieniły się/);
  const s = await state();
  assert.equal(s.settings.version, 2);
  assert.equal(s.settings.before_minutes, 10);
  assert.equal(s.settings.after_minutes, 20);
  assert.equal(s.audits.length, 1);
});
test("two concurrent retries of the same editor return one version and one audit", async () => {
  const r = await race(admin, policySQL(10, 20), admin, policySQL(10, 20));
  assert.equal(r.first, 2);
  assert.equal(r.second.value, 2);
  assert.equal((await state()).audits.length, 1);
});
test("before-to-after preferred-break changes keep actual collision constraints immediate", async () => {
  await operation(admin, policySQL(15, 0));
  await operation(admin, walkSQL("2027-05-10T10:00:00Z"));
  await operation(admin, walkSQL("2027-05-10T11:15:00Z"));
  assert.equal(await operation(admin, policySQL(0, 15, false, 2)), 3);
  const before = await state();
  await assert.rejects(
    operation(admin, walkSQL("2027-05-10T12:20:00Z")),
    /Krótka przerwa/,
  );
  assert.deepEqual(await state(), before);
});
test("private multi-day holidays are not padded or constrained by working hours", async () => {
  await operation(admin, policySQL(15, 15, true, 1, week(540, 1020)));
  const block = randomUUID();
  await operation(
    admin,
    `select to_json(public.save_calendar_block(${literal(block)},0,'Fikcyjny urlop','2027-05-08T00:00:00Z','2027-05-10T00:00:00Z'));`,
  );
  const s = await state();
  assert.equal(s.slots[0].occupied, s.slots[0].base_occupied);
});

test("completion waiting for new settings retains only the actual past interval for advisory checks", async () => {
  const id = await operation(admin, walkSQL("2027-05-10T10:00:00Z"));
  await observer.query(
    `update public.walks set starts_at=now()-interval '65 minutes' where id=${literal(id)};`,
  );
  const r = await race(
    admin,
    policySQL(0, 15),
    null,
    `update public.walks set status='completed' where id=${literal(id)} returning to_json(id);`,
  );
  assert.equal(r.second.value, id);
  const s = await state();
  assert.equal(s.slots.length, 1);
  assert.equal(
    await observer.json(
      `select to_json(occupied=base_occupied and upper(occupied)<=now()) from public.calendar_slots where walk_id=${literal(id)};`,
    ),
    true,
  );
});
test("completion committed first makes a competing booking request acknowledgement during its preferred after-break", async () => {
  await operation(admin, policySQL(0, 15));
  const id = await operation(admin, walkSQL("2027-05-10T10:00:00Z"));
  await observer.query(
    `update public.walks set starts_at=now()-interval '65 minutes' where id=${literal(id)};`,
  );
  const at = await observer.json("select to_json(now()+interval '1 minute');");
  const r = await race(
    null,
    `update public.walks set status='completed' where id=${literal(id)} returning to_json(id);`,
    admin,
    walkSQL(at),
  );
  refused(r, /Krótka przerwa/);
  const s = await state();
  assert.equal(s.walks.length, 1);
  assert.equal(s.slots.length, 1);
  assert.equal(s.walks[0].status, "completed");
});

const teamWalkSQL = (at, staff, room = null, confirm = false) =>
  `select public.calendar_write('create_walk',${literal(JSON.stringify({ payload: { starts_at: at, duration_minutes: 60, type: "Fikcyjny kalendarz zespołu", public_location: "Próba publiczna", exact_location: "FIKCYJNA ZBIÓRKA", map_url: "", instructions: "", cancellation_deadline_hours: 24, price_cents: 10000, capacity: 4, booking_mode: "approval", info: "" } }))}::jsonb,${confirm},${literal(JSON.stringify({ staff_id: staff, resource_id: room, expected_version: 0 }))}::jsonb);`;
const createRoom = async (exclusive = true) => {
  const id = randomUUID();
  await operation(
    admin,
    `select to_json(public.save_calendar_resource(${literal(id)},0,'Fikcyjna sala',${exclusive},true));`,
  );
  return id;
};

test("two independently open staff transactions book the same time without blocking each other", async () => {
  const first = await new LocalPostgres({ database }).ready(),
    second = await new LocalPostgres({ database }).ready();
  try {
    await first.asUser(admin);
    const a = await first.json(teamWalkSQL("2027-05-10T10:00:00Z", admin));
    await second.asUser(admin2);
    // First transaction is still open; a global calendar mutex would prevent
    // this statement finishing. Native disjoint staff scopes allow it.
    const b = await second.json(teamWalkSQL("2027-05-10T10:00:00Z", admin2));
    assert.notEqual(a, b);
    await second.query("commit;");
    await first.query("commit;");
    assert.equal((await state()).walks.length, 2);
  } finally {
    await first.close();
    await second.close();
  }
});
test("same staff overlapping writes serialize and the loser cannot bypass the real collision with confirmation", async () => {
  const r = await race(
    admin,
    teamWalkSQL("2027-05-10T10:00:00Z", admin),
    admin2,
    teamWalkSQL("2027-05-10T10:30:00Z", admin, null, true),
  );
  refused(r, /Ten czas jest już zajęty/);
  assert.equal((await state()).walks.length, 1);
});
test("distinct staff concurrently reserving an exclusive room retain only the winning booking", async () => {
  const room = await createRoom();
  const r = await race(
    admin,
    teamWalkSQL("2027-05-10T10:00:00Z", admin, room),
    admin2,
    teamWalkSQL("2027-05-10T10:00:00Z", admin2, room, true),
  );
  refused(r, /Ten czas jest już zajęty/);
  assert.equal((await state()).walks.length, 1);
});
test("same staff adjacent concurrent writes recheck the committed neighbour and require explicit short-break acknowledgement", async () => {
  await operation(admin, policySQL(0, 15));
  const r = await race(
    admin,
    teamWalkSQL("2027-05-10T10:00:00Z", admin),
    admin2,
    teamWalkSQL("2027-05-10T11:00:00Z", admin),
  );
  refused(r, /Krótka przerwa/);
  const id = await operation(
    admin2,
    teamWalkSQL("2027-05-10T11:00:00Z", admin, null, true),
  );
  assert.equal((await state()).walks.length, 2);
  assert.equal(
    await observer.json(
      `select to_json(count(*)) from public.audit_events where entity_id=${literal(id)} and event='calendar_short_break_confirmed';`,
    ),
    1,
  );
});
test("resource deactivation committed first makes a waiting booking reject the inactive room", async () => {
  const room = await createRoom();
  const r = await race(
    admin,
    `select to_json(public.save_calendar_resource(${literal(room)},1,'Fikcyjna sala',true,false));`,
    admin2,
    teamWalkSQL("2027-05-10T10:00:00Z", admin2, room),
  );
  refused(r, /Wybierz aktywne miejsce/);
  assert.equal((await state()).walks.length, 0);
});
test("legacy and new block writers use the same projection-before-source lock order", async () => {
  const id = randomUUID();
  const legacy = (version, start = "2027-05-10T10:00:00Z") =>
    `select to_json(public.save_calendar_block(${literal(id)},${version},'Fikcyjna blokada',${literal(start)},'2027-05-10T12:00:00Z'));`;
  const modern = (version, assignment) =>
    `select public.save_calendar_team_block(${literal(id)},${version},'Fikcyjna blokada','2027-05-10T10:30:00Z','2027-05-10T12:00:00Z',${literal(admin)},null,${assignment},false);`;
  const r = await race(admin, legacy(0), admin, modern(0, 0));
  refused(r, /Blokada zmieniła się/);
  const reverse = await race(admin, modern(1, 1), admin, legacy(1));
  refused(reverse, /Blokada zmieniła się/);
  const s = await state();
  assert.equal(s.slots.length, 1);
  assert.equal(s.slots[0].base_occupied, s.slots[0].occupied);
});
test("assignment editors serialize and an identical retry keeps one revision/audit", async () => {
  const id = await operation(admin, teamWalkSQL("2027-05-10T10:00:00Z", admin));
  const change = `select to_json(public.save_calendar_assignment('walk',${literal(id)},1,${literal(admin2)},null,false));`;
  const r = await race(admin, change, admin, change);
  assert.equal(r.first, 2);
  assert.equal(r.second.value, 2);
  assert.equal(
    await observer.json(
      `select to_json(count(*)) from public.audit_events where entity_id=${literal(id)} and event='calendar_assignment_saved';`,
    ),
    1,
  );
});

const draftCourse = async (actor, offset = 0) => {
  const id = randomUUID();
  await operation(
    actor,
    `select to_json(public.create_course(${literal(id)},'60000000-0000-4000-8000-000000000001',1,'Fikcyjny kurs zespołu',2,'Park próbny','Fikcyjna zbiórka',${literal(JSON.stringify(Array.from({ length: 5 }, (_, n) => new Date(Date.parse("2027-05-10T10:00:00Z") + (offset + n * 7 * 1440) * 60000).toISOString())))}::jsonb));`,
  );
  return {
    id,
    sessions: await observer.json(
      `select json_agg(id order by ordinal) from public.course_sessions where course_id=${literal(id)};`,
    ),
  };
};
test("whole-course rebuilds with opposite A/B session lead orders acquire batch staff locks consistently", async () => {
  const first = await draftCourse(admin),
    second = await draftCourse(admin2, 120);
  for (let n = 0; n < 5; n++) {
    if (n % 2 === 1)
      await operation(
        admin,
        `select to_json(public.save_calendar_assignment('course',${literal(first.sessions[n])},1,${literal(admin2)},null,false));`,
      );
    if (n % 2 === 1)
      await operation(
        admin,
        `select to_json(public.save_calendar_assignment('course',${literal(second.sessions[n])},1,${literal(admin)},null,false));`,
      );
  }
  const publish = (id) =>
    `select to_json(public.change_course(${literal(id)},1,'publish',''));`;
  const r = await race(admin, publish(first.id), admin2, publish(second.id));
  assert.equal(r.first, 2);
  assert.equal(r.second.value, 2);
  assert.equal((await state()).slots.length, 10);
});
test("a mixed assigned/unassigned course takes its exclusive practice scope before any staff lock", async () => {
  const course = await draftCourse(admin);
  await operation(
    admin,
    `select to_json(public.save_calendar_assignment('course',${literal(course.sessions[1])},1,null,null,false));`,
  );
  const r = await race(
    admin,
    `select to_json(public.change_course(${literal(course.id)},1,'publish',''));`,
    admin2,
    teamWalkSQL("2027-05-10T12:00:00Z", admin2),
  );
  assert.equal(r.first, 2);
  assert.ok(r.second.value);
  assert.equal((await state()).slots.length, 6);
});
