import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { configureCalendarPrimary } from "./helpers/calendar-primary.mjs";

let db: PGlite;
const primary = "81000000-0000-4000-8000-000000000001";
const organiser = "81000000-0000-4000-8000-000000000002";
const former = "81000000-0000-4000-8000-000000000003";
const owner = "81000000-0000-4000-8000-000000000004";
const dog = "82000000-0000-4000-8000-000000000001";
const at = "2027-05-10T10:00:00Z";
const plus = (minutes: number) =>
  new Date(Date.parse(at) + minutes * 60000).toISOString();
const week = (start = 0, end = 1440) =>
  Array.from({ length: 7 }, (_, n) => ({
    weekday: n + 1,
    enabled: true,
    start_minute: start,
    end_minute: end,
  }));
const payload = (starts_at = at) => ({
  starts_at,
  duration_minutes: 60,
  public_location: "Park próbny",
  type: "Fikcyjny spacer",
  price_cents: 10000,
  capacity: 4,
  booking_mode: "approval",
  info: "",
  exact_location: "Fikcyjna zbiórka",
  map_url: "",
  instructions: "",
  cancellation_deadline_hours: 24,
});
async function user<T>(id: string, fn: () => Promise<T>, readOnly = false) {
  await db.exec(
    `begin${readOnly ? " read only" : ""}; set local role authenticated;`,
  );
  await db.query("select set_config('request.jwt.claim.sub',$1,true)", [id]);
  try {
    const result = await fn();
    await db.exec("commit");
    return result;
  } catch (error) {
    await db.exec("rollback");
    throw error;
  }
}
async function write(
  operation: string,
  args: unknown,
  assignment: unknown = null,
  confirm = false,
) {
  return (
    await user(organiser, () =>
      db.query<{ result: unknown }>(
        "select public.calendar_write($1,$2,$3,$4) result",
        [operation, args, confirm, assignment],
      ),
    )
  ).rows[0].result;
}
async function walk(start = at, assignment: unknown = null) {
  return (await write(
    "create_walk",
    { payload: payload(start) },
    assignment,
  )) as string;
}
async function assignment(id: string) {
  return (
    await db.query<Record<string, unknown>>(
      "select * from public.calendar_assignments where appointment_id=$1",
      [id],
    )
  ).rows[0];
}
async function team() {
  return (
    await user(
      organiser,
      () =>
        db.query<Record<string, unknown>>(
          "select * from public.calendar_team_appointments($1,$2)",
          [at, plus(42 * 1440)],
        ),
      true,
    )
  ).rows;
}
// These privileged edits only arrange imported history in the disposable DB.
// The application has no table-write access and never rewrites this metadata.
async function arrangeHistory(id: string, staff: string | null) {
  await db.query(
    "update public.calendar_assignments set assigned_staff_id=$2,legacy_unassigned=($2::uuid is null) where appointment_id=$1",
    [id, staff],
  );
  await db.query(
    "update public.calendar_slots set occupied=base_occupied where coalesce(walk_id,consultation_id,block_id,course_session_id,fitness_session_id)=$1",
    [id],
  );
}
type Kind = "walk" | "consultation" | "block" | "course" | "fitness";
async function meeting(kind: Kind, start = at) {
  if (kind === "walk") return await walk(start);
  const id = randomUUID();
  if (kind === "block") {
    await user(organiser, () =>
      db.query(
        "select public.save_calendar_team_block($1,0,'Fikcyjna przerwa',$2,$3,$4,null,0,false)",
        [
          id,
          start,
          new Date(Date.parse(start) + 3600000).toISOString(),
          primary,
        ],
      ),
    );
    return id;
  }
  if (kind === "consultation") {
    await user(owner, () =>
      db.query(
        "select public.request_consultation($1,$2,'Fikcyjne zgłoszenie','','60000000-0000-4000-8000-000000000011',1)",
        [id, dog],
      ),
    );
    await write(
      "change_consultation",
      {
        p_id: id,
        p_expected_version: 1,
        p_action: "schedule",
        p_starts_at: start,
        p_duration: 60,
        p_mode: "online",
        p_location: "Spotkanie online",
        p_note: "",
      },
      { staff_id: primary, resource_id: null, expected_version: 1 },
    );
    return id;
  }
  if (kind === "course") {
    await write("create_course", {
      p_id: id,
      p_service: "60000000-0000-4000-8000-000000000001",
      p_expected_service_version: 1,
      p_title: "Fikcyjny kurs",
      p_capacity: 2,
      p_public_location: "Park próbny",
      p_exact_location: "Fikcyjna zbiórka",
      p_starts: Array.from({ length: 5 }, (_, n) =>
        new Date(Date.parse(start) + n * 7 * 86400000).toISOString(),
      ),
    });
    await write("change_course", {
      p_id: id,
      p_expected_version: 1,
      p_action: "publish",
      p_note: "",
    });
    return (
      await db.query<{ id: string }>(
        "select id from public.course_sessions where course_id=$1 order by ordinal",
        [id],
      )
    ).rows[0].id;
  }
  const serviceVersion = (
    await db.query<{ version: number }>(
      "select version from public.services where id='60000000-0000-4000-8000-000000000006'",
    )
  ).rows[0].version;
  await user(owner, () =>
    db.query(
      "select public.request_fitness_package($1,$2,'60000000-0000-4000-8000-000000000006',$3,'Fikcyjny pakiet','')",
      [id, dog, serviceVersion],
    ),
  );
  await user(organiser, () =>
    db.query("select public.change_fitness_package($1,1,'accept','',$2)", [
      id,
      randomUUID(),
    ]),
  );
  const session = (
    await db.query<{ id: string }>(
      "select id from public.fitness_sessions where package_id=$1 order by ordinal",
      [id],
    )
  ).rows[0].id;
  await write("save_fitness_session", {
    p_id: session,
    p_expected_version: 1,
    p_starts_at: start,
    p_location: "Fikcyjna sala",
    p_note: "",
    p_request_id: randomUUID(),
  });
  return session;
}
async function move(
  kind: Kind,
  id: string,
  staff: string | null,
  start = plus(120),
) {
  const selected = {
    staff_id: staff,
    resource_id: null,
    expected_version: (await assignment(id)).version,
  };
  if (kind === "walk") {
    const stamp = (
      await db.query<{ stamp: string }>(
        "select updated_at::text stamp from public.walks where id=$1",
        [id],
      )
    ).rows[0].stamp;
    return await write(
      "update_walk",
      {
        p_walk: id,
        p_expected_updated_at: stamp,
        payload: payload(start),
        p_note: "Uzgodnione przełożenie",
      },
      selected,
    );
  }
  if (kind === "block")
    return await user(organiser, () =>
      db.query(
        "select public.save_calendar_team_block($1,1,'Fikcyjna przerwa',$2,$3,$4,null,1,false)",
        [id, start, new Date(Date.parse(start) + 3600000).toISOString(), staff],
      ),
    );
  if (kind === "consultation")
    return await write(
      "change_consultation",
      {
        p_id: id,
        p_expected_version: 2,
        p_action: "schedule",
        p_starts_at: start,
        p_duration: 60,
        p_mode: "online",
        p_location: "Spotkanie online",
        p_note: "Uzgodnione przełożenie",
      },
      selected,
    );
  if (kind === "course")
    return await write(
      "reschedule_course_session",
      {
        p_id: id,
        p_expected_version: 1,
        p_starts_at: start,
        p_note: "Uzgodnione przełożenie",
      },
      selected,
    );
  return await write(
    "save_fitness_session",
    {
      p_id: id,
      p_expected_version: 2,
      p_starts_at: start,
      p_location: "Fikcyjna sala",
      p_note: "Uzgodnione przełożenie",
      p_request_id: randomUUID(),
    },
    selected,
  );
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
    .filter((f) => f.endsWith(".sql"))
    .sort())
    await db.exec(readFileSync(`supabase/migrations/${file}`, "utf8"));
  await db.query("insert into auth.users(id) values($1),($2),($3),($4)", [
    primary,
    organiser,
    former,
    owner,
  ]);
  await db.query(
    "update public.user_roles set role='admin' where user_id in ($1,$2,$3)",
    [primary, organiser, former],
  );
  await db.query(
    "update public.profiles set full_name=case id when $1 then 'Prowadząca' when $2 then 'Organizator' else 'Historyczna osoba' end",
    [primary, organiser],
  );
  await db.query(
    "insert into public.dogs(id,guardian_id,name,status) values($1,$2,'Fikcyjny pies','approved')",
    [dog, owner],
  );
});
beforeEach(async () => {
  await db.exec(
    "truncate public.walks,public.consultations,public.calendar_blocks,public.courses,public.fitness_packages,public.calendar_resources cascade;delete from public.audit_events;update public.calendar_settings set version=1,hours_enabled=false,before_minutes=0,after_minutes=0,updated_by=null;update public.calendar_weekly_hours set enabled=true,start_minute=0,end_minute=1440;update public.calendar_staff_settings set version=1,use_default=true,hours_enabled=false,before_minutes=0,after_minutes=0,updated_by=null;",
  );
  await db.query(
    "update public.user_roles set role='admin' where user_id in ($1,$2,$3)",
    [primary, organiser, former],
  );
  await configureCalendarPrimary(db, primary);
});
afterAll(async () => {
  await db?.close();
});

describe.sequential(
  "current schema: one practitioner and preserved history",
  () => {
    it("chooses the configured practitioner when another administrator creates a term", async () => {
      const id = await walk();
      expect(await assignment(id)).toMatchObject({
        assigned_staff_id: primary,
        created_by: organiser,
        updated_by: organiser,
      });
      expect((await team())[0]).toMatchObject({
        assigned_staff_name: "Prowadząca",
        created_by_name: "Organizator",
      });
      expect(
        (
          await user(
            organiser,
            () => db.query("select * from public.calendar_team_members()"),
            true,
          )
        ).rows,
      ).toEqual([{ user_id: primary, full_name: "Prowadząca" }]);
    });
    it.each([false, true])(
      "assigns the first client-request booking to primary through direct/wrapped schedule: %s",
      async (wrapped) => {
        await db.exec(
          "update public.calendar_settings set primary_practitioner_id=null",
        );
        const id = randomUUID();
        await user(owner, () =>
          db.query(
            "select public.request_consultation($1,$2,'Fikcyjne zgłoszenie','','60000000-0000-4000-8000-000000000011',1)",
            [id, dog],
          ),
        );
        expect(await assignment(id)).toMatchObject({
          assigned_staff_id: null,
          legacy_unassigned: false,
          version: 1,
        });
        await configureCalendarPrimary(db, primary);
        if (wrapped)
          await write("change_consultation", {
            p_id: id,
            p_expected_version: 1,
            p_action: "schedule",
            p_starts_at: at,
            p_duration: 60,
            p_mode: "online",
            p_location: "Spotkanie online",
            p_note: "",
          });
        else
          await user(organiser, () =>
            db.query(
              "select public.change_consultation($1,1,'schedule',$2,60,'online','Spotkanie online','')",
              [id, at],
            ),
          );
        expect(await assignment(id)).toMatchObject({
          assigned_staff_id: primary,
          created_by: owner,
          updated_by: organiser,
        });
      },
    );
    it("selects primary in a configured client request without reserving time", async () => {
      const id = randomUUID();
      await user(owner, () =>
        db.query(
          "select public.request_consultation($1,$2,'Fikcyjne zgłoszenie','','60000000-0000-4000-8000-000000000011',1)",
          [id, dog],
        ),
      );
      expect((await assignment(id)).assigned_staff_id).toBe(primary);
      expect(
        (await db.query("select * from public.calendar_slots")).rows,
      ).toEqual([]);
    });
    it("assigns the first direct fitness schedule of a fresh pending session to primary", async () => {
      const id = await meeting("fitness");
      await db.query(
        "update public.fitness_sessions set status='pending',starts_at=null where id=$1",
        [id],
      );
      await db.query(
        "update public.calendar_assignments set assigned_staff_id=null,legacy_unassigned=false,version=1,booked_interval=null,booked_staff_id=null where appointment_id=$1",
        [id],
      );
      await user(organiser, () =>
        db.query(
          "select public.save_fitness_session($1,2,$2,'Fikcyjna sala','',$3)",
          [id, at, randomUUID()],
        ),
      );
      expect(await assignment(id)).toMatchObject({
        assigned_staff_id: primary,
        updated_by: organiser,
      });
    });
    it.each([null, organiser, former, owner])(
      "rejects a new explicit practitioner choice %s without inserting anything",
      async (staff_id) => {
        await expect(
          walk(at, { staff_id, resource_id: null, expected_version: 0 }),
        ).rejects.toThrow("Wybierz aktywną prowadzącą");
        expect((await db.query("select * from public.walks")).rows).toEqual([]);
        expect(
          (await db.query("select * from public.audit_events")).rows,
        ).toEqual([]);
      },
    );
    it.each(["walk", "consultation", "block", "course", "fitness"] as const)(
      "%s with a former assignment blocks the same practitioner",
      async (kind) => {
        const id = await meeting(kind);
        await arrangeHistory(id, former);
        await expect(walk()).rejects.toThrow(/czas jest już zajęty/);
        expect((await assignment(id)).assigned_staff_id).toBe(former);
      },
    );
    it.each(["walk", "consultation", "block", "course", "fitness"] as const)(
      "preserves unchanged historic %s UUID after its admin role is lost",
      async (kind) => {
        const id = await meeting(kind);
        await arrangeHistory(id, former);
        const before = await assignment(id);
        await db.query(
          "update public.user_roles set role='client' where user_id=$1",
          [former],
        );
        await move(kind, id, former);
        expect(await assignment(id)).toMatchObject({
          assigned_staff_id: former,
          created_by: before.created_by,
          resource_id: null,
        });
        expect(
          (await team()).find((row) => row.appointment_id === id),
        ).toMatchObject({
          assigned_staff_id: former,
          assigned_staff_name: "Historyczna osoba",
          starts_at: new Date(plus(120)),
        });
        const members = await user(
          organiser,
          () => db.query("select * from public.calendar_team_members()"),
          true,
        );
        expect(members.rows).toContainEqual({
          user_id: former,
          full_name: "Historyczna osoba",
        });
      },
    );
    it.each(["walk", "consultation", "block", "course", "fitness"] as const)(
      "preserves an unchanged historic null %s assignment",
      async (kind) => {
        const id = await meeting(kind);
        await arrangeHistory(id, null);
        await move(kind, id, null);
        expect((await assignment(id)).assigned_staff_id).toBeNull();
        await expect(walk(plus(120))).rejects.toThrow(/czas jest już zajęty/);
      },
    );
    it("retains existing assignments in direct save RPC but refuses another administrator or clearing a current choice", async () => {
      const id = await walk();
      await arrangeHistory(id, former);
      await db.query(
        "update public.user_roles set role='client' where user_id=$1",
        [former],
      );
      const save = (staff: string | null, version = 1) =>
        user(organiser, () =>
          db.query(
            "select public.save_calendar_assignment('walk',$1,$2,$3,null,false)",
            [id, version, staff],
          ),
        );
      await save(former);
      await expect(save(organiser, 2)).rejects.toThrow(
        "Wybierz aktywną prowadzącą",
      );
      await expect(save(null, 2)).rejects.toThrow("Wybierz aktywną prowadzącą");
      await save(primary, 2);
      expect((await assignment(id)).assigned_staff_id).toBe(primary);
      await expect(save(former, 3)).rejects.toThrow(
        "Wybierz aktywną prowadzącą",
      );
    });
    it("applies primary hours and short-break warnings to historic appointments", async () => {
      const id = await walk();
      await arrangeHistory(id, former);
      await user(organiser, () =>
        db.query(
          "select public.save_calendar_staff_settings($1,1,false,true,15,15,$2)",
          [primary, week(720, 960)],
        ),
      );
      await expect(walk(plus(70))).rejects.toThrow("Krótka przerwa");
      const next = (await write(
        "create_walk",
        { payload: payload(plus(70)) },
        null,
        true,
      )) as string;
      expect((await assignment(next)).assigned_staff_id).toBe(primary);
      await expect(move("walk", id, former, plus(300))).rejects.toThrow(
        "Termin wykracza poza godziny pracy",
      );
      expect(
        (
          await db.query(
            "select * from public.audit_events where event='calendar_short_break_confirmed'",
          )
        ).rows,
      ).toHaveLength(1);
    });
    it("revalidates every historic assignment when primary hours change", async () => {
      const id = await walk();
      await arrangeHistory(id, former);
      await expect(
        user(organiser, () =>
          db.query(
            "select public.save_calendar_staff_settings($1,1,false,true,0,0,$2)",
            [primary, week(900, 960)],
          ),
        ),
      ).rejects.toThrow("Termin wykracza poza godziny pracy");
      expect(
        (
          await db.query<{ version: number }>(
            "select version from public.calendar_staff_settings where staff_id=$1",
            [primary],
          )
        ).rows[0].version,
      ).toBe(1);
    });
    it.each([null, former])(
      "records a changed historic block choice %s exactly once under an exact retry",
      async (staff) => {
        const id = await meeting("block");
        await arrangeHistory(id, staff);
        const room = randomUUID();
        await user(organiser, () =>
          db.query(
            "select public.save_calendar_resource($1,0,'Fikcyjna sala',true,true)",
            [room],
          ),
        );
        const save = () =>
          user(organiser, () =>
            db.query(
              "select public.save_calendar_team_block($1,1,'Fikcyjna przerwa',$2,$3,$4,$5,1,false)",
              [id, plus(120), plus(180), primary, room],
            ),
          );
        await save();
        await save();
        const events = (
          await db.query<Record<string, unknown>>(
            "select actor_id,details from public.audit_events where entity_id=$1 and event='calendar_assignment_saved'",
            [id],
          )
        ).rows;
        expect(events).toEqual([
          {
            actor_id: organiser,
            details: {
              kind: "block",
              version: 2,
              assigned_staff_id: primary,
              resource_id: room,
            },
          },
        ]);
        expect(await assignment(id)).toMatchObject({
          version: 2,
          assigned_staff_id: primary,
          resource_id: room,
        });
      },
    );
    it.each([false, true])(
      "cancels one course meeting without primary or a valid primary role: %s",
      async (invalidRole) => {
        const id = await meeting("course");
        const siblings = (
          await db.query<Record<string, unknown>>(
            "select * from public.calendar_slots where course_session_id is not null and course_session_id<>$1 order by course_session_id",
            [id],
          )
        ).rows;
        if (invalidRole)
          await db.query(
            "update public.user_roles set role='client' where user_id=$1",
            [primary],
          );
        else
          await db.exec(
            "update public.calendar_settings set primary_practitioner_id=null",
          );
        await user(organiser, () =>
          db.query(
            "select public.change_course_session($1,1,'cancel','Uzgodnione odwołanie')",
            [id],
          ),
        );
        expect(
          (
            await db.query(
              "select * from public.calendar_slots where course_session_id is not null order by course_session_id",
            )
          ).rows,
        ).toEqual(siblings);
        const next = siblings[0].course_session_id as string;
        const oldStart = (
          await db.query<{ starts_at: Date }>(
            "select starts_at from public.course_sessions where id=$1",
            [next],
          )
        ).rows[0].starts_at;
        await expect(
          user(organiser, () =>
            db.query(
              "select public.reschedule_course_session($1,1,$2,'Próba przełożenia')",
              [next, new Date(oldStart.getTime() + 120 * 60000).toISOString()],
            ),
          ),
        ).rejects.toThrow("Brak aktywnej prowadzącej");
      },
    );
    it("allows client requests, reads and cancellation without primary while refusing direct and wrapped reservations", async () => {
      const existing = await meeting("block");
      await db.exec(
        "update public.calendar_settings set primary_practitioner_id=null",
      );
      expect(await team()).toHaveLength(1);
      const request = randomUUID();
      await user(owner, () =>
        db.query(
          "select public.request_consultation($1,$2,'Fikcyjne zgłoszenie','','60000000-0000-4000-8000-000000000011',1)",
          [request, dog],
        ),
      );
      expect((await assignment(request)).assigned_staff_id).toBeNull();
      await expect(walk(plus(120))).rejects.toThrow(
        "Brak aktywnej prowadzącej",
      );
      await expect(
        user(organiser, () =>
          db.query("select public.create_walk($1)", [payload(plus(120))]),
        ),
      ).rejects.toThrow("Brak aktywnej prowadzącej");
      await expect(
        user(organiser, () =>
          db.query(
            "select public.save_calendar_block($1,0,'Fikcyjna blokada',$2,$3)",
            [randomUUID(), plus(120), plus(180)],
          ),
        ),
      ).rejects.toThrow("Brak aktywnej prowadzącej");
      await expect(
        user(organiser, () =>
          db.query(
            "select public.change_consultation($1,1,'schedule',$2,60,'online','Spotkanie online','')",
            [request, plus(120)],
          ),
        ),
      ).rejects.toThrow("Brak aktywnej prowadzącej");
      await user(organiser, () =>
        db.query("select public.cancel_calendar_block($1,1)", [existing]),
      );
      await user(owner, () =>
        db.query(
          "select public.change_consultation($1,1,'cancel',null,null,null,null,'Wycofanie zgłoszenia')",
          [request],
        ),
      );
      expect(
        (await db.query("select * from public.calendar_slots")).rows,
      ).toEqual([]);
      expect((await assignment(request)).assigned_staff_id).toBeNull();
    });
    it("fails closed after the configured practitioner's role is lost, without hiding historic names", async () => {
      const id = await walk();
      await db.query(
        "update public.user_roles set role='client' where user_id=$1",
        [primary],
      );
      expect(
        (
          await user(
            organiser,
            () => db.query("select public.calendar_primary_practitioner() id"),
            true,
          )
        ).rows[0],
      ).toEqual({ id: null });
      expect(await team()).toHaveLength(1);
      await expect(walk(plus(120))).rejects.toThrow(
        "Brak aktywnej prowadzącej",
      );
      expect((await assignment(id)).assigned_staff_id).toBe(primary);
    });
    it("denies clients configuration changes and private practitioner APIs", async () => {
      await expect(
        user(owner, () =>
          db.query("select public.calendar_primary_practitioner()"),
        ),
      ).rejects.toThrow("Brak uprawnień");
      await expect(
        user(owner, () =>
          db.query(
            "update public.calendar_settings set primary_practitioner_id=$1",
            [owner],
          ),
        ),
      ).rejects.toThrow("permission denied");
      await expect(
        user(organiser, () =>
          db.query("select public.calendar_require_primary()"),
        ),
      ).rejects.toThrow("permission denied");
    });
  },
);
