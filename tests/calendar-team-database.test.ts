import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

let db: PGlite;
const staffA = "71000000-0000-4000-8000-000000000001";
const staffB = "71000000-0000-4000-8000-000000000002";
const owner = "71000000-0000-4000-8000-000000000003";
const stranger = "71000000-0000-4000-8000-000000000004";
const dog = "72000000-0000-4000-8000-000000000001";
const at = "2027-05-10T10:00:00Z";
const plus = (minutes: number) =>
  new Date(Date.parse(at) + minutes * 60000).toISOString();
const week = () =>
  Array.from({ length: 7 }, (_, n) => ({
    weekday: n + 1,
    enabled: true,
    start_minute: 0,
    end_minute: 1440,
  }));
let migratedLegacy: Record<string, unknown>;
async function user<T>(id: string, fn: () => Promise<T>, readOnly = false) {
  await db.exec(
    `begin${readOnly ? " read only" : ""}; set local role authenticated;`,
  );
  await db.query("select set_config('request.jwt.claim.sub',$1,true)", [id]);
  try {
    const value = await fn();
    await db.exec("commit");
    return value;
  } catch (error) {
    await db.exec("rollback");
    throw error;
  }
}
const payload = (start = at) => ({
  starts_at: start,
  duration_minutes: 60,
  public_location: "Publiczny park",
  type: "Spacer zespołu",
  price_cents: 10000,
  capacity: 4,
  booking_mode: "approval",
  info: "",
  exact_location: "PRYWATNA ZBIÓRKA",
  map_url: "",
  instructions: "",
  cancellation_deadline_hours: 24,
});
async function write(
  operation: string,
  args: unknown,
  actor = staffA,
  confirm = false,
  assignment: unknown = null,
) {
  return (
    await user(actor, () =>
      db.query<{ result: unknown }>(
        "select public.calendar_write($1,$2,$3,$4) result",
        [operation, args, confirm, assignment],
      ),
    )
  ).rows[0].result;
}
async function walk(
  start = at,
  actor = staffA,
  lead?: string | null,
  room: string | null = null,
  confirm = false,
) {
  return (await write(
    "create_walk",
    { payload: payload(start) },
    actor,
    confirm,
    lead === undefined
      ? null
      : { staff_id: lead, resource_id: room, expected_version: 0 },
  )) as string;
}
async function resource(exclusive = true) {
  const id = randomUUID();
  await user(staffA, () =>
    db.query(
      "select public.save_calendar_resource($1,0,'Sala próbna',$2,true)",
      [id, exclusive],
    ),
  );
  return id;
}
async function assign(
  id: string,
  lead: string | null,
  room: string | null = null,
  version = 1,
  kind = "walk",
  confirm = false,
) {
  return (
    await user(staffA, () =>
      db.query<{ version: number }>(
        "select public.save_calendar_assignment($1,$2,$3,$4,$5,$6) version",
        [kind, id, version, lead, room, confirm],
      ),
    )
  ).rows[0].version;
}
async function team(actor = staffA, from = at, to = plus(1440)) {
  return (
    await user(
      actor,
      () =>
        db.query<Record<string, unknown>>(
          "select * from public.calendar_team_appointments($1,$2)",
          [from, to],
        ),
      true,
    )
  ).rows;
}
beforeAll(async () => {
  db = new PGlite();
  await db.exec(`set timezone='UTC';create role anon;create role authenticated;create schema auth;
    create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,encrypted_password text);
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    grant usage on schema public,auth to anon,authenticated;grant execute on function auth.uid() to anon,authenticated;
    create schema storage;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
    create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text);
    alter table storage.objects enable row level security;
    create function storage.foldername(name text) returns text[] language sql as $$select string_to_array(name,'/')$$;
    grant usage on schema storage to authenticated;grant select,insert,delete on storage.objects to authenticated;`);
  for (const file of readdirSync("supabase/migrations")
    .filter((f) => f.endsWith(".sql") && f < "202610100001_calendar_team.sql")
    .sort())
    await db.exec(readFileSync(`supabase/migrations/${file}`, "utf8"));
  await db.query("insert into auth.users(id) values($1),($2),($3),($4)", [
    staffA,
    staffB,
    owner,
    stranger,
  ]);
  await db.query(
    "update public.user_roles set role='admin' where user_id in ($1,$2)",
    [staffA, staffB],
  );
  await db.query(
    "update public.profiles set full_name=case id when $1 then 'Prowadząca A' when $2 then 'Prowadząca B' else 'Opiekun testowy' end",
    [staffA, staffB],
  );
  await db.query(
    "insert into public.dogs(id,guardian_id,name) values($1,$2,'Kluska')",
    [dog, owner],
  );
  const legacy = (
    await user(staffA, () =>
      db.query<{ id: string }>("select public.create_walk($1) id", [payload()]),
    )
  ).rows[0].id;
  await db.exec(
    readFileSync("supabase/migrations/202610100001_calendar_team.sql", "utf8"),
  );
  migratedLegacy = (
    await db.query<Record<string, unknown>>(
      "select a.*,s.base_occupied=s.occupied actual_interval_only from public.calendar_assignments a join public.calendar_slots s on s.walk_id=a.walk_id where a.appointment_id=$1",
      [legacy],
    )
  ).rows[0];
});
beforeEach(async () => {
  await db.exec(
    "truncate public.walks,public.consultations,public.calendar_blocks,public.courses,public.fitness_packages,public.calendar_resources cascade;delete from public.audit_events;update public.calendar_settings set version=1,hours_enabled=false,before_minutes=0,after_minutes=0,updated_by=null;update public.calendar_weekly_hours set enabled=weekday<=5,start_minute=540,end_minute=1020;update public.calendar_staff_settings set version=1,use_default=true,hours_enabled=false,before_minutes=0,after_minutes=0,updated_by=null;",
  );
});
afterAll(async () => {
  await db?.close();
});

describe.sequential(
  "team calendar: migration, transactional scopes and private APIs",
  () => {
    it("preserves legacy creation provenance without interpreting creator as assigned lead", async () => {
      expect(migratedLegacy).toMatchObject({
        legacy_unassigned: true,
        assigned_staff_id: null,
        created_by: staffA,
        actual_interval_only: true,
        version: 1,
      });
      const id = await walk(at, staffA, null);
      await db.query(
        "update public.calendar_assignments set legacy_unassigned=true where appointment_id=$1",
        [id],
      );
      await expect(walk(at, staffB)).rejects.toThrow(
        "Ten czas jest już zajęty",
      );
      await assign(id, staffA);
      await walk(at, staffB);
      expect(await team()).toHaveLength(2);
    });
    it("books different staff simultaneously from one actor and records creator separately", async () => {
      await walk(at, staffA, staffA);
      const b = await walk(at, staffA, staffB);
      expect(await team()).toHaveLength(2);
      expect((await team()).find((row) => row.id === b)).toMatchObject({
        created_by: staffA,
        created_by_name: "Prowadząca A",
        assigned_staff_id: staffB,
        assigned_staff_name: "Prowadząca B",
      });
    });
    it("true staff collisions cannot be acknowledged and leave no partial source/private metadata", async () => {
      await walk();
      await expect(walk(plus(30), staffB, staffA, null, true)).rejects.toThrow(
        "Ten czas jest już zajęty",
      );
      expect((await db.query("select * from public.walks")).rows).toHaveLength(
        1,
      );
      expect(
        (await db.query("select * from public.walk_private_details")).rows,
      ).toHaveLength(1);
      expect(
        (await db.query("select * from public.calendar_assignments")).rows,
      ).toHaveLength(1);
      await walk(plus(60));
    });
    it("exclusive rooms reject simultaneous distinct leads while an unrestricted location permits them", async () => {
      const room = await resource();
      await walk(at, staffA, staffA, room);
      await expect(walk(at, staffA, staffB, room, true)).rejects.toThrow(
        "Ten czas jest już zajęty",
      );
      const outdoor = await resource(false);
      await walk(at, staffA, staffB, outdoor);
      expect(await team()).toHaveLength(2);
      await expect(
        user(staffA, () =>
          db.query(
            "select public.save_calendar_resource($1,1,'Sala próbna',true,false)",
            [room],
          ),
        ),
      ).resolves.toBeDefined();
      await expect(walk(plus(120), staffA, staffA, room)).rejects.toThrow(
        "Wybierz aktywne miejsce",
      );
    });
    it("resource exclusivity changes atomically recheck existing simultaneous bookings", async () => {
      const room = await resource(false);
      await walk(at, staffA, staffA, room);
      await walk(at, staffA, staffB, room);
      await expect(
        user(staffA, () =>
          db.query(
            "select public.save_calendar_resource($1,1,'Sala próbna',true,true)",
            [room],
          ),
        ),
      ).rejects.toThrow("Sala jest zajęta");
      expect(
        (
          await db.query(
            "select exclusive,version from public.calendar_resources where id=$1",
            [room],
          )
        ).rows[0],
      ).toMatchObject({ exclusive: false, version: 1 });
      expect(await team()).toHaveLength(2);
    });
    it("assignment edits preserve immutable creator, idempotent retries and stale protection", async () => {
      const id = await walk();
      expect(await assign(id, staffB)).toBe(2);
      expect(await assign(id, staffB)).toBe(2);
      await expect(assign(id, staffA)).rejects.toThrow(
        "Przypisanie zmieniło się",
      );
      const row = (await team())[0];
      expect(row).toMatchObject({
        created_by: staffA,
        assigned_staff_id: staffB,
        assignment_version: 2,
      });
      expect(
        (
          await db.query(
            "select * from public.audit_events where event='calendar_assignment_saved'",
          )
        ).rows,
      ).toHaveLength(1);
    });
    it("team block checks both source and assignment versions, including a reassignment from another tab", async () => {
      const id = randomUUID();
      const save = (
        sourceVersion: number,
        assignmentVersion: number,
        lead: string,
      ) =>
        user(staffA, () =>
          db.query<{ result: unknown }>(
            "select public.save_calendar_team_block($1,$2,'Urlop próbny',$3,$4,$5,null,$6,false) result",
            [id, sourceVersion, at, plus(60), lead, assignmentVersion],
          ),
        );
      expect((await save(0, 0, staffB)).rows[0].result).toEqual({
        version: 1,
        assignment_version: 1,
      });
      expect((await save(0, 0, staffB)).rows[0].result).toEqual({
        version: 1,
        assignment_version: 1,
      });
      await assign(id, staffA, null, 1, "block");
      await expect(save(1, 1, staffB)).rejects.toThrow(
        "Przypisanie zmieniło się",
      );
      expect((await team())[0]).toMatchObject({
        version: 1,
        assignment_version: 2,
        assigned_staff_id: staffA,
        created_by: staffA,
      });
    });
    it("returns concrete short-break endpoints, rolls back the initial attempt and audits explicit acknowledgement", async () => {
      await user(staffA, () =>
        db.query("select public.save_calendar_settings(1,false,0,15,$1)", [
          week(),
        ]),
      );
      await walk();
      let warning: { hint?: string; detail?: string } = {};
      try {
        await walk(plus(60));
      } catch (error) {
        warning = error as typeof warning;
      }
      expect(warning.hint).toBe("CALENDAR_SHORT_BREAK");
      expect(JSON.parse(warning.detail!)[0]).toMatchObject({
        previous_end: "2027-05-10T11:00:00+00:00",
        next_start: "2027-05-10T11:00:00+00:00",
        gap_minutes: 0,
        required_minutes: 15,
      });
      expect((await db.query("select * from public.walks")).rows).toHaveLength(
        1,
      );
      await walk(plus(60), staffA, staffA, null, true);
      expect(
        (
          await db.query(
            "select * from public.audit_events where event='calendar_short_break_confirmed'",
          )
        ).rows,
      ).toHaveLength(1);
      expect(
        (
          await db.query<{ actual_only: boolean }>(
            "select occupied=base_occupied actual_only from public.calendar_slots",
          )
        ).rows.every((row) => row.actual_only),
      ).toBe(true);
      await expect(walk(plus(120))).rejects.toThrow("Krótka przerwa");
    });
    it("does not require a new acknowledgement when rebuilding an unchanged appointment after a neighbouring booking", async () => {
      await user(staffA, () =>
        db.query("select public.save_calendar_settings(1,false,0,15,$1)", [
          week(),
        ]),
      );
      const id = await walk();
      await walk(plus(60), staffA, staffA, null, true);
      await db.query("update public.walks set status='closed' where id=$1", [
        id,
      ]);
      expect(await team()).toHaveLength(2);
      expect(
        (
          await db.query(
            "select * from public.audit_events where event='calendar_short_break_confirmed'",
          )
        ).rows,
      ).toHaveLength(1);
    });
    it("staff override enforces actual working time while another member keeps the default", async () => {
      const mondayOnly = week().map((day) => ({
        ...day,
        enabled: day.weekday === 1,
        start_minute: 540,
        end_minute: 1020,
      }));
      await user(staffA, () =>
        db.query(
          "select public.save_calendar_staff_settings($1,1,false,true,30,30,$2)",
          [staffA, mondayOnly],
        ),
      );
      await walk("2027-05-10T07:00:00Z", staffA, staffA);
      await expect(
        walk("2027-05-15T10:00:00Z", staffA, staffA),
      ).rejects.toThrow("godziny pracy prowadzącego");
      await walk("2027-05-15T10:00:00Z", staffA, staffB);
      const pref = (
        await user(
          staffA,
          () =>
            db.query<{ result: unknown }>(
              "select public.calendar_staff_preferences($1) result",
              [staffA],
            ),
          true,
        )
      ).rows[0].result;
      expect(pref).toMatchObject({
        use_default: false,
        version: 2,
        hours_enabled: true,
      });
    });
    it("staff reads work in read-only transactions, including the autumn six-week calendar grid", async () => {
      expect(
        await user(
          staffA,
          () => db.query("select * from public.calendar_team_members()"),
          true,
        ),
      ).toHaveProperty("rows");
      expect(
        (
          await user(
            staffA,
            () =>
              db.query("select public.calendar_staff_preferences($1)", [
                staffB,
              ]),
            true,
          )
        ).rows,
      ).toHaveLength(1);
      expect(
        await team(staffA, "2026-09-27T22:00:00Z", "2026-11-08T23:00:00Z"),
      ).toEqual([]);
      expect(
        (
          await user(
            owner,
            () =>
              db.query(
                "select * from public.calendar_appointments('2026-09-27T22:00:00Z','2026-11-08T23:00:00Z')",
              ),
            true,
          )
        ).rows,
      ).toEqual([]);
    });
    it("denies client/anonymous team APIs and keeps metadata out of the guardian calendar", async () => {
      await walk();
      for (const actor of [owner, stranger]) {
        await expect(team(actor)).rejects.toThrow("Brak uprawnień");
        await expect(
          write("create_walk", { payload: payload() }, actor),
        ).rejects.toThrow("Brak uprawnień");
        expect(
          (
            await user(actor, () =>
              db.query("select * from public.calendar_assignments"),
            )
          ).rows,
        ).toEqual([]);
        expect(
          (
            await user(actor, () =>
              db.query("select * from public.calendar_resources"),
            )
          ).rows,
        ).toEqual([]);
        await expect(
          user(actor, () =>
            db.query(
              "update public.calendar_assignments set assigned_staff_id=$1",
              [actor],
            ),
          ),
        ).rejects.toThrow("permission denied");
      }
      expect(
        (
          await db.query<{ allowed: boolean }>(
            "select has_function_privilege('anon','public.calendar_write(text,jsonb,boolean,jsonb)','execute') allowed",
          )
        ).rows[0].allowed,
      ).toBe(false);
      await expect(write("save_calendar_settings", {})).rejects.toThrow(
        "Nieprawidłowa operacja",
      );
      await expect(walk(at, staffA, owner)).rejects.toThrow(
        "Wybierz aktywnego członka",
      );
    });
    it("preserves an existing inactive room during rescheduling but refuses a new inactive assignment", async () => {
      const room = await resource();
      const id = await walk(at, staffA, staffA, room);
      await user(staffA, () =>
        db.query(
          "select public.save_calendar_resource($1,1,'Sala próbna',true,false)",
          [room],
        ),
      );
      const version = (
        await db.query<{ stamp: string }>(
          "select updated_at::text stamp from public.walks where id=$1",
          [id],
        )
      ).rows[0].stamp;
      await write(
        "update_walk",
        {
          p_walk: id,
          p_expected_updated_at: version,
          payload: payload(plus(120)),
          p_note: "Uzgodniona zmiana terminu",
        },
        staffA,
        false,
        { staff_id: staffA, resource_id: room, expected_version: 1 },
      );
      expect((await team())[0]).toMatchObject({
        resource_id: room,
        assigned_staff_id: staffA,
      });
      await expect(walk(plus(240), staffA, staffB, room)).rejects.toThrow(
        "Wybierz aktywne miejsce",
      );
    });
    it("keeps an explicitly unassigned client request unassigned instead of silently choosing its scheduling actor", async () => {
      const id = randomUUID();
      await user(owner, () =>
        db.query(
          "select public.request_consultation($1,$2,'Potrzeba konsultacji','','60000000-0000-4000-8000-000000000011',1)",
          [id, dog],
        ),
      );
      await write(
        "change_consultation",
        {
          p_id: id,
          p_expected_version: 1,
          p_action: "schedule",
          p_starts_at: at,
          p_duration: 60,
          p_mode: "online",
          p_location: "Spotkanie online",
          p_note: "",
        },
        staffA,
        false,
        { staff_id: null, resource_id: null, expected_version: 1 },
      );
      expect((await team())[0]).toMatchObject({
        assigned_staff_id: null,
        created_by: owner,
        assignment_version: 2,
      });
      await expect(walk(at, staffB)).rejects.toThrow(
        "Ten czas jest już zajęty",
      );
    });
    it("assigns all new draft-course sessions before publishing and keeps actual session identities in the team feed", async () => {
      await walk();
      const id = randomUUID();
      const args = {
        p_id: id,
        p_service: "60000000-0000-4000-8000-000000000001",
        p_expected_service_version: 1,
        p_title: "Kurs zespołu",
        p_capacity: 2,
        p_public_location: "Park próbny",
        p_exact_location: "Fikcyjna zbiórka",
        p_starts: Array.from({ length: 5 }, (_, n) => plus(n * 7 * 1440)),
      };
      const choice = {
        staff_id: staffB,
        resource_id: null,
        expected_version: 0,
      };
      expect(await write("create_course", args, staffA, false, choice)).toBe(
        id,
      );
      expect(await write("create_course", args, staffA, false, choice)).toBe(
        id,
      );
      await expect(
        write("create_course", args, staffA, false, {
          ...choice,
          staff_id: staffA,
        }),
      ).rejects.toThrow("Przypisanie zmieniło się");
      await write("change_course", {
        p_id: id,
        p_expected_version: 1,
        p_action: "publish",
        p_note: "",
      });
      const rows = (await team(staffA, at, plus(42 * 1440))).filter(
        (row) => row.kind === "course",
      );
      expect(rows).toHaveLength(5);
      expect(new Set(rows.map((row) => row.appointment_id)).size).toBe(5);
      expect(
        rows.every(
          (row) =>
            row.id === id &&
            row.appointment_id !== id &&
            row.assigned_staff_id === staffB,
        ),
      ).toBe(true);
    });
    it("rejects overlapping fitness sessions of the same package even with different leads and no shared room", async () => {
      const pack = randomUUID();
      const service = (
        await db.query<{ version: number }>(
          "select version from public.services where id='60000000-0000-4000-8000-000000000006'",
        )
      ).rows[0];
      await user(owner, () =>
        db.query(
          "select public.request_fitness_package($1,$2,'60000000-0000-4000-8000-000000000006',$3,'Pakiet testowy','')",
          [pack, dog, service.version],
        ),
      );
      await user(staffA, () =>
        db.query("select public.change_fitness_package($1,1,'accept','',$2)", [
          pack,
          randomUUID(),
        ]),
      );
      const sessions = (
        await db.query<{ id: string }>(
          "select id from public.fitness_sessions where package_id=$1 order by ordinal",
          [pack],
        )
      ).rows;
      const args = (id: string) => ({
        p_id: id,
        p_expected_version: 1,
        p_starts_at: at,
        p_location: "Sala próbna",
        p_note: "",
        p_request_id: randomUUID(),
      });
      await write("save_fitness_session", args(sessions[0].id), staffA, false, {
        staff_id: staffA,
        resource_id: null,
        expected_version: 1,
      });
      await expect(
        write("save_fitness_session", args(sessions[1].id), staffA, true, {
          staff_id: staffB,
          resource_id: null,
          expected_version: 1,
        }),
      ).rejects.toThrow("Spotkania tego samego pakietu");
      expect((await team())[0]).toMatchObject({
        id: pack,
        appointment_id: sessions[0].id,
      });
      expect(await team()).toHaveLength(1);
    });
    it("rescheduling one course meeting changes only its targeted assignment, even when a sibling has a different assignment revision", async () => {
      const id = randomUUID();
      await write(
        "create_course",
        {
          p_id: id,
          p_service: "60000000-0000-4000-8000-000000000001",
          p_expected_service_version: 1,
          p_title: "Kurs różnych prowadzących",
          p_capacity: 2,
          p_public_location: "Park próbny",
          p_exact_location: "Fikcyjna zbiórka",
          p_starts: Array.from({ length: 5 }, (_, n) => plus(n * 7 * 1440)),
        },
        staffA,
        false,
        { staff_id: staffB, resource_id: null, expected_version: 0 },
      );
      const sessions = (
        await db.query<{ id: string }>(
          "select id from public.course_sessions where course_id=$1 order by ordinal",
          [id],
        )
      ).rows;
      await assign(sessions[1].id, staffA, null, 1, "course");
      const before = (
        await db.query(
          "select appointment_id,assigned_staff_id,version from public.calendar_assignments where course_session_id is not null and appointment_id<>$1 order by appointment_id",
          [sessions[0].id],
        )
      ).rows;
      await write("change_course", {
        p_id: id,
        p_expected_version: 1,
        p_action: "publish",
        p_note: "",
      });
      await write(
        "reschedule_course_session",
        {
          p_id: sessions[0].id,
          p_expected_version: 1,
          p_starts_at: plus(120),
          p_note: "Uzgodniona zmiana",
          p_public_location: "Park próbny",
          p_exact_location: "Fikcyjna zbiórka",
        },
        staffA,
        false,
        { staff_id: staffA, resource_id: null, expected_version: 1 },
      );
      expect(
        (
          await db.query(
            "select appointment_id,assigned_staff_id,version from public.calendar_assignments where course_session_id is not null and appointment_id<>$1 order by appointment_id",
            [sessions[0].id],
          )
        ).rows,
      ).toEqual(before);
      expect((await team())[0]).toMatchObject({
        appointment_id: sessions[0].id,
        assigned_staff_id: staffA,
        assignment_version: 2,
      });
    });
    it("a cancelled block cannot be reported as an active successful combined retry", async () => {
      const id = randomUUID();
      await user(staffA, () =>
        db.query(
          "select public.save_calendar_team_block($1,0,'Urlop próbny',$2,$3,$4,null,0,false)",
          [id, at, plus(60), staffA],
        ),
      );
      await user(staffA, () =>
        db.query("select public.cancel_calendar_block($1,1)", [id]),
      );
      await expect(
        user(staffA, () =>
          db.query(
            "select public.save_calendar_team_block($1,1,'Urlop próbny',$2,$3,$4,null,0,false)",
            [id, at, plus(60), staffA],
          ),
        ),
      ).rejects.toThrow("Ta blokada została już usunięta");
      expect(await team()).toEqual([]);
    });
    it("provisions a newly promoted member when an existing booking is rescheduled to that lead", async () => {
      const id = await walk();
      const promoted = randomUUID();
      await db.query("insert into auth.users(id) values($1)", [promoted]);
      await db.query(
        "update public.user_roles set role='admin' where user_id=$1",
        [promoted],
      );
      expect(
        (
          await db.query(
            "select * from public.calendar_staff_indices where staff_id=$1",
            [promoted],
          )
        ).rows,
      ).toHaveLength(0);
      const stamp = (
        await db.query<{ stamp: string }>(
          "select updated_at::text stamp from public.walks where id=$1",
          [id],
        )
      ).rows[0].stamp;
      await write(
        "update_walk",
        {
          p_walk: id,
          p_expected_updated_at: stamp,
          payload: payload(plus(120)),
          p_note: "Uzgodniona zmiana prowadzącego",
        },
        staffA,
        false,
        { staff_id: promoted, resource_id: null, expected_version: 1 },
      );
      expect((await team())[0]).toMatchObject({
        assigned_staff_id: promoted,
        assignment_version: 2,
      });
      expect(
        (
          await db.query(
            "select * from public.calendar_staff_indices where staff_id=$1",
            [promoted],
          )
        ).rows,
      ).toHaveLength(1);
    });
    it("preserves consultation receipts with assignment versions across a lost scheduling response", async () => {
      const id = randomUUID();
      await user(owner, () =>
        db.query(
          "select public.request_consultation($1,$2,'Potrzeba konsultacji','','60000000-0000-4000-8000-000000000011',1)",
          [id, dog],
        ),
      );
      const args = {
        p_id: id,
        p_expected_version: 1,
        p_action: "schedule",
        p_starts_at: at,
        p_duration: 60,
        p_mode: "online",
        p_location: "Spotkanie online",
        p_note: "",
      };
      const choice = {
        staff_id: staffB,
        resource_id: null,
        expected_version: 1,
      };
      expect(
        await write("change_consultation", args, staffA, false, choice),
      ).toBe(2);
      expect(
        await write("change_consultation", args, staffA, false, choice),
      ).toBe(2);
      expect((await team())[0]).toMatchObject({
        created_by: owner,
        assigned_staff_id: staffB,
        assignment_version: 2,
      });
      await expect(
        write("change_consultation", args, staffA, false, {
          ...choice,
          staff_id: staffA,
        }),
      ).rejects.toThrow("Przypisanie zmieniło się");
      expect(
        (
          await db.query(
            "select * from public.consultation_history where consultation_id=$1",
            [id],
          )
        ).rows,
      ).toHaveLength(2);
    });
  },
);
