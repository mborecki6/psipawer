import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { beforeAll, beforeEach, afterAll, describe, expect, it } from "vitest";

let db: PGlite;
const admin = "10000000-0000-4000-8000-000000000001";
const owner = "10000000-0000-4000-8000-000000000002";
const stranger = "10000000-0000-4000-8000-000000000003";
const dog = "20000000-0000-4000-8000-000000000001";
const otherDog = "20000000-0000-4000-8000-000000000002";

async function asUser<T>(id: string, fn: () => Promise<T>) {
  await db.exec("begin; set local role authenticated;");
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
beforeAll(async () => {
  db = new PGlite();
  await db.exec("set timezone='UTC'");
  await db.exec(`create role anon; create role authenticated; create schema auth;
    create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,encrypted_password text);
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    grant usage on schema public,auth to anon,authenticated;
    grant execute on function auth.uid() to anon,authenticated;
    create schema storage; create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
    create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text);
    alter table storage.objects enable row level security;
    create function storage.foldername(name text) returns text[] language sql as $$select string_to_array(name,'/')$$;
    grant usage on schema storage to authenticated; grant select,insert,delete on storage.objects to authenticated;`);
  for (const name of readdirSync("supabase/migrations")
    .filter((name) => name.endsWith(".sql"))
    .sort()) {
    await db.exec(readFileSync(`supabase/migrations/${name}`, "utf8"));
  }
  await db.query("insert into auth.users(id) values($1),($2),($3)", [
    admin,
    owner,
    stranger,
  ]);
  await db.query("update public.user_roles set role='admin' where user_id=$1", [
    admin,
  ]);
  await db.query(
    "insert into public.dogs(id,guardian_id,name) values($1,$2,'Kluska'),($3,$4,'Borys')",
    [dog, owner, otherDog, stranger],
  );
});

beforeEach(async () => {
  await db.exec(
    "truncate public.calendar_slots,public.courses,public.fitness_packages,public.consultation_events,public.consultation_history,public.consultations,public.calendar_blocks,public.walk_registrations,public.walk_private_details,public.walks cascade;",
  );
  await db.exec(
    "update public.calendar_settings set version=1,hours_enabled=false,before_minutes=0,after_minutes=0,updated_by=null; update public.calendar_weekly_hours set enabled=weekday<=5,start_minute=540,end_minute=1020;",
  );
});
afterAll(async () => {
  await db?.close();
});
const start = () => new Date(Date.now() + 7 * 86400000).toISOString();
const plus = (s: string, minutes: number) =>
  new Date(Date.parse(s) + minutes * 60000).toISOString();
const fullWeek = () =>
  Array.from({ length: 7 }, (_, n) => ({
    weekday: n + 1,
    enabled: true,
    start_minute: 0,
    end_minute: 1440,
  }));
async function settings(
  before = 0,
  after = 0,
  enabled = false,
  week = fullWeek(),
  version = 1,
  user = admin,
) {
  return (
    await asUser(user, () =>
      db.query<{ version: number }>(
        "select public.save_calendar_settings($1,$2,$3,$4,$5) version",
        [version, enabled, before, after, week],
      ),
    )
  ).rows[0].version;
}
function payload(at = start()) {
  return {
    starts_at: at,
    duration_minutes: 60,
    public_location: "Park publiczny",
    type: "Spacer testowy",
    price_cents: 10000,
    capacity: 4,
    booking_mode: "approval",
    info: "",
    exact_location: "TAJNA ZBIÓRKA",
    map_url: "",
    instructions: "",
    cancellation_deadline_hours: 24,
  };
}
async function walk(at = start()) {
  return (
    await asUser(admin, () =>
      db.query<{ id: string }>("select public.create_walk($1) id", [
        payload(at),
      ]),
    )
  ).rows[0].id;
}
async function request(user = owner, dogId = dog) {
  const id = randomUUID();
  await asUser(user, () =>
    db.query(
      "select public.request_consultation($1,$2,'Prośba o spotkanie','','60000000-0000-4000-8000-000000000011',1)",
      [id, dogId],
    ),
  );
  return id;
}
async function schedule(id: string, at: string, version = 1) {
  return asUser(admin, () =>
    db.query(
      "select public.change_consultation($1,$2,'schedule',$3,60,'online','PRYWATNA KONSULTACJA','Zmiana terminu')",
      [id, version, at],
    ),
  );
}
async function block(
  at: string,
  end: string,
  id = randomUUID(),
  version = 0,
  user = admin,
  title = "Prywatna przerwa",
) {
  await asUser(user, () =>
    db.query("select public.save_calendar_block($1,$2,$3,$4,$5)", [
      id,
      version,
      title,
      at,
      end,
    ]),
  );
  return id;
}
async function agenda(at: string, user = admin) {
  return (
    await asUser(user, () =>
      db.query<{ id: string; kind: string; location: string; title: string }>(
        "select * from public.calendar_appointments($1,$2)",
        [at, plus(at, 7 * 1440)],
      ),
    )
  ).rows;
}
describe.sequential("shared calendar: real SQL writes and RLS", () => {
  it("blocks a consultation overlapping a walk without adding history or losing the request", async () => {
    const at = start();
    await walk(at);
    const id = await request();
    await expect(schedule(id, plus(at, 30))).rejects.toThrow(
      "Ten czas jest już zajęty",
    );
    expect(
      (
        await db.query(
          "select status,version from public.consultations where id=$1",
          [id],
        )
      ).rows[0],
    ).toMatchObject({ status: "requested", version: 1 });
    expect(
      (
        await db.query(
          "select * from public.consultation_history where consultation_id=$1",
          [id],
        )
      ).rows,
    ).toHaveLength(1);
  });
  it("blocks a walk overlapping a consultation and leaves no partial walk or private details", async () => {
    const at = start(),
      id = await request();
    await schedule(id, at);
    await expect(walk(plus(at, 30))).rejects.toThrow(
      "Ten czas jest już zajęty",
    );
    expect((await db.query("select * from public.walks")).rows).toHaveLength(0);
    expect(
      (await db.query("select * from public.walk_private_details")).rows,
    ).toHaveLength(0);
  });
  it("blocks overlapping walks and accepts exact adjacency", async () => {
    const at = start();
    await walk(at);
    await expect(walk(plus(at, 59))).rejects.toThrow(
      "Ten czas jest już zajęty",
    );
    await walk(plus(at, 60));
    expect((await agenda(at)).filter((x) => x.kind === "walk")).toHaveLength(2);
  });
  it("protects an existing slot when rescheduling into an occupied interval fails", async () => {
    const at = start();
    const wid = await walk(at),
      id = await request();
    await schedule(id, plus(at, 120));
    const previous = (
      await db.query(
        "select occupied::text from public.calendar_slots where consultation_id=$1",
        [id],
      )
    ).rows;
    await expect(schedule(id, at, 2)).rejects.toThrow(
      "Ten czas jest już zajęty",
    );
    expect(
      (
        await db.query(
          "select occupied::text from public.calendar_slots where consultation_id=$1",
          [id],
        )
      ).rows,
    ).toEqual(previous);
    const version = (
      await db.query<{ updated_at: string }>(
        "select updated_at::text from public.walks where id=$1",
        [wid],
      )
    ).rows[0].updated_at;
    await expect(
      asUser(admin, () =>
        db.query("select public.update_walk($1,$2,$3,$4)", [
          wid,
          version,
          payload(plus(at, 120)),
          "Uzgodniona zmiana",
        ]),
      ),
    ).rejects.toThrow("Ten czas jest już zajęty");
    expect((await agenda(at)).find((x) => x.id === wid)).toBeTruthy();
  });
  it("releases cancelled walks and consultations for a new booking", async () => {
    const at = start(),
      wid = await walk(at);
    await asUser(admin, () =>
      db.query("select public.cancel_walk($1,'Zmiana planów')", [wid]),
    );
    const id = await request();
    await schedule(id, at);
    await asUser(owner, () =>
      db.query(
        "select public.change_consultation($1,2,'cancel',null,null,null,null,'Zmiana planów')",
        [id],
      ),
    );
    await walk(at);
    expect(await agenda(at)).toHaveLength(1);
  });
  it("private blocks prevent appointments in both directions", async () => {
    const at = start();
    await block(at, plus(at, 120));
    await expect(walk(at)).rejects.toThrow("Ten czas jest już zajęty");
    const id = await request();
    await expect(schedule(id, plus(at, 90))).rejects.toThrow(
      "Ten czas jest już zajęty",
    );
    await walk(plus(at, 120));
    await expect(block(plus(at, 150), plus(at, 180))).rejects.toThrow(
      "Ten czas jest już zajęty",
    );
  });
  it("retries block creation/edit/removal without duplicates and rejects a stale edit", async () => {
    const at = start(),
      id = await block(at, plus(at, 60));
    await block(at, plus(at, 60), id);
    await block(plus(at, 10), plus(at, 70), id, 1);
    await block(plus(at, 10), plus(at, 70), id, 1);
    await expect(block(at, plus(at, 60), id, 1)).rejects.toThrow(
      "Blokada zmieniła się",
    );
    await asUser(admin, () =>
      db.query("select public.cancel_calendar_block($1,2)", [id]),
    );
    await asUser(admin, () =>
      db.query("select public.cancel_calendar_block($1,2)", [id]),
    );
    expect(await agenda(at)).toHaveLength(0);
    expect(
      (
        await db.query(
          "select * from public.audit_events where entity_id=$1 and event like 'calendar_block_%'",
          [id],
        )
      ).rows,
    ).toHaveLength(3);
    await walk(at);
  });
  it("clients cannot create or inspect private blocks, slot data, or other guardians consultations", async () => {
    const at = start();
    await block(at, plus(at, 60));
    const id = await request();
    await schedule(id, plus(at, 60));
    expect(await agenda(at, stranger)).toEqual([]);
    expect(await agenda(at, owner)).toHaveLength(1);
    expect(
      (
        await asUser(owner, () =>
          db.query("select * from public.calendar_blocks"),
        )
      ).rows,
    ).toEqual([]);
    await expect(
      block(plus(at, 180), plus(at, 240), randomUUID(), 0, owner),
    ).rejects.toThrow("Brak uprawnień");
    for (const user of [owner, admin]) {
      await expect(
        asUser(user, () => db.query("delete from public.calendar_blocks")),
      ).rejects.toThrow("permission denied");
      await expect(
        asUser(user, () => db.query("select * from public.calendar_slots")),
      ).rejects.toThrow("permission denied");
    }
  });
  it("shows only a guardians accepted walks and never exposes their precise meeting point through the calendar", async () => {
    const at = start(),
      wid = await walk(at);
    await db.query("update public.dogs set status='approved' where id=$1", [
      dog,
    ]);
    await asUser(owner, () =>
      db.query("select public.register_dog($1,$2)", [wid, dog]),
    );
    expect(await agenda(at, owner)).toEqual([]);
    const registration = (
      await db.query<{ id: string }>(
        "select id from public.walk_registrations where walk_id=$1",
        [wid],
      )
    ).rows[0].id;
    await asUser(admin, () =>
      db.query(
        "select public.decide_registration($1,'accepted','Potwierdzam')",
        [registration],
      ),
    );
    expect(await agenda(at, owner)).toEqual([
      expect.objectContaining({ id: wid, location: "Park publiczny" }),
    ]);
    expect(JSON.stringify(await agenda(at, owner))).not.toContain("TAJNA");
    expect(await agenda(at, stranger)).toEqual([]);
  });
  it("includes a multi-day block that began before the requested week, and excludes an interval ending exactly at its start", async () => {
    const at = start();
    await block(plus(at, -1440), plus(at, 1440));
    expect(await agenda(at)).toHaveLength(1);
    expect(await agenda(plus(at, 1440))).toHaveLength(0);
  });
  it("validates block lengths, finite dates and range limits even at the RPC boundary", async () => {
    const at = start();
    await expect(block(at, at)).rejects.toThrow("Sprawdź nazwę");
    await expect(block(at, "infinity")).rejects.toThrow("Sprawdź nazwę");
    await expect(block(at, plus(at, 367 * 1440))).rejects.toThrow(
      "Sprawdź nazwę",
    );
    await expect(
      asUser(owner, () =>
        db.query("select * from public.calendar_appointments($1,$2)", [
          at,
          plus(at, 33 * 1440),
        ]),
      ),
    ).rejects.toThrow("Nieprawidłowy zakres");
    expect(
      (
        await db.query<{ allowed: boolean }>(
          "select has_function_privilege('anon','public.calendar_appointments(timestamptz,timestamptz)','execute') allowed",
        )
      ).rows[0].allowed,
    ).toBe(false);
  });
});

describe.sequential("working hours and automatic buffers", () => {
  it.each(["walk", "consultation", "course", "fitness"] as const)(
    "keeps the remaining after-buffer when %s is completed, without extending it on a policy retry",
    async (kind) => {
      await settings(0, 30);
      let id: string, key: string;
      if (kind === "walk") {
        id = await walk();
        key = "walk_id";
        await db.query(
          "update public.walks set starts_at=now()-interval '65 minutes',status='completed' where id=$1",
          [id],
        );
      } else if (kind === "consultation") {
        id = await request();
        key = "consultation_id";
        await schedule(id, start());
        await db.query(
          "update public.consultations set starts_at=now()-interval '65 minutes',status='completed' where id=$1",
          [id],
        );
      } else if (kind === "course") {
        const course = randomUUID();
        key = "course_session_id";
        await asUser(admin, () =>
          db.query(
            "select public.create_course($1,'60000000-0000-4000-8000-000000000001',1,'Kurs przerwy',2,'Próbna okolica','Fikcyjna zbiórka',$2)",
            [
              course,
              Array.from({ length: 5 }, (_, n) => plus(start(), n * 7 * 1440)),
            ],
          ),
        );
        await asUser(admin, () =>
          db.query("select public.change_course($1,1,'publish','')", [course]),
        );
        const sessions = (
          await db.query<{ id: string; ordinal: number }>(
            "select id,ordinal from public.course_sessions where course_id=$1 order by ordinal",
            [course],
          )
        ).rows;
        id = sessions[4].id;
        for (const session of sessions)
          await db.query(
            "update public.course_sessions set starts_at=case when ordinal=5 then now()-make_interval(mins=>duration_minutes+5) else now()-interval '1 year'+make_interval(days=>ordinal) end,status='completed' where id=$1",
            [session.id],
          );
        await asUser(admin, () =>
          db.query(
            "select public.change_course($1,2,'complete','Fikcyjne zakończenie')",
            [course],
          ),
        );
      } else {
        const pack = randomUUID();
        key = "fitness_session_id";
        const terms = (
          await db.query<{ version: number }>(
            "select version from public.services where id='60000000-0000-4000-8000-000000000006'",
          )
        ).rows[0];
        await asUser(owner, () =>
          db.query(
            "select public.request_fitness_package($1,$2,'60000000-0000-4000-8000-000000000006',$3,'Próba przerwy','')",
            [pack, dog, terms.version],
          ),
        );
        await asUser(admin, () =>
          db.query(
            "select public.change_fitness_package($1,1,'accept','',$2)",
            [pack, randomUUID()],
          ),
        );
        const sessions = (
          await db.query<{ id: string; ordinal: number }>(
            "select id,ordinal from public.fitness_sessions where package_id=$1 order by ordinal",
            [pack],
          )
        ).rows;
        id = sessions[3].id;
        for (const session of sessions)
          await db.query(
            "update public.fitness_sessions set starts_at=case when ordinal=4 then now()-make_interval(mins=>duration_minutes+5) else now()-interval '1 year'+make_interval(days=>ordinal) end,status='completed',attendance='present' where id=$1",
            [session.id],
          );
        await asUser(admin, () =>
          db.query(
            "select public.change_fitness_package($1,2,'complete','Fikcyjne zakończenie',$2)",
            [pack, randomUUID()],
          ),
        );
      }
      const slot = (
        await db.query<{ slot: unknown; remaining: boolean; length: number }>(
          `select to_jsonb(s) slot,upper(occupied)>now() remaining,(extract(epoch from upper(occupied)-upper(base_occupied))/60)::integer length from public.calendar_slots s where ${key}=$1`,
          [id],
        )
      ).rows[0];
      expect(slot.remaining).toBe(true);
      expect(slot.length).toBe(30);
      await expect(
        walk(new Date(Date.now() + 60000).toISOString()),
      ).rejects.toThrow("Ten czas jest już zajęty");
      await settings(0, 30, false, fullWeek(), 2);
      expect(
        (
          await db.query(
            `select to_jsonb(s) slot from public.calendar_slots s where ${key}=$1`,
            [id],
          )
        ).rows[0],
      ).toEqual({ slot: slot.slot });
      await walk(new Date(Date.now() + 30 * 60000).toISOString());
    },
  );
  it("reserves buffers without moving the actual appointment and rejects a neighbour within its preparation time", async () => {
    await settings(10, 15);
    const at = "2027-05-10T10:00:00.000Z";
    const id = await walk(at);
    const slot = (
      await db.query<{ occupied: string; base: string }>(
        "select occupied::text occupied,base_occupied::text base from public.calendar_slots where walk_id=$1",
        [id],
      )
    ).rows[0];
    expect(slot.occupied).toContain("09:50:00");
    expect(slot.occupied).toContain("11:15:00");
    expect(slot.base).toContain("10:00:00");
    expect((await agenda(at))[0].id).toBe(id);
    await expect(walk(plus(at, 80))).rejects.toThrow(
      "Ten czas jest już zajęty",
    );
    await walk(plus(at, 85));
    await settings(10, 15, false, fullWeek(), 2);
    expect(
      (
        await db.query(
          "select occupied::text occupied from public.calendar_slots where walk_id=$1",
          [id],
        )
      ).rows[0],
    ).toEqual({ occupied: slot.occupied });
  });
  it("rolls back every policy, interval and audit change when a new buffer collides", async () => {
    const at = "2027-05-10T10:00:00.000Z";
    await walk(at);
    await walk(plus(at, 60));
    const before = (
      await db.query(
        "select to_jsonb(s) s from public.calendar_slots s order by occupied",
      )
    ).rows;
    const audits = (
      await db.query(
        "select count(*) n from public.audit_events where event='calendar_settings_saved'",
      )
    ).rows;
    await expect(settings(0, 1)).rejects.toThrow(
      "Nowe przerwy powodują kolizję",
    );
    expect(
      (
        await db.query(
          "select version,after_minutes from public.calendar_settings",
        )
      ).rows[0],
    ).toEqual({ version: 1, after_minutes: 0 });
    expect(
      (
        await db.query(
          "select to_jsonb(s) s from public.calendar_slots s order by occupied",
        )
      ).rows,
    ).toEqual(before);
    expect(
      (
        await db.query(
          "select count(*) n from public.audit_events where event='calendar_settings_saved'",
        )
      ).rows,
    ).toEqual(audits);
  });
  it("recalculates all buffers atomically even when an intermediate interval would overlap the old neighbouring buffer", async () => {
    await settings(15, 0);
    const at = "2027-05-10T10:00:00.000Z";
    await walk(at);
    await walk(plus(at, 75));
    expect(await settings(0, 15, false, fullWeek(), 2)).toBe(3);
    expect(
      (
        await db.query<{ n: number }>(
          "select count(*) n from public.calendar_slots a join public.calendar_slots b on a.walk_id<b.walk_id and a.occupied && b.occupied",
        )
      ).rows[0].n,
    ).toBe(0);
  });
  it("uses the Polish weekly window including buffers, and leaves private holiday blocks independent of working hours", async () => {
    const week = fullWeek().map((d) => ({
      ...d,
      enabled: d.weekday <= 5,
      start_minute: 540,
      end_minute: 1020,
    }));
    await settings(15, 15, true, week);
    await expect(walk("2027-05-10T07:00:00Z")).rejects.toThrow(
      "wykracza poza godziny pracy",
    );
    await walk("2027-05-10T07:15:00Z");
    await expect(walk("2027-05-15T10:00:00Z")).rejects.toThrow(
      "wykracza poza godziny pracy",
    );
    await block("2027-05-15T00:00:00Z", "2027-05-17T00:00:00Z");
    const id = await request();
    await expect(schedule(id, "2027-05-10T15:00:00Z")).rejects.toThrow(
      "wykracza poza godziny pracy",
    );
    expect(
      (
        await db.query(
          "select status,version from public.consultations where id=$1",
          [id],
        )
      ).rows[0],
    ).toEqual({ status: "requested", version: 1 });
  });
  it("rejects enabling hours around an already booked outside-hours appointment without modifying the booking", async () => {
    const id = await walk("2027-05-15T10:00:00Z");
    const week = fullWeek().map((d) => ({ ...d, enabled: d.weekday <= 5 }));
    await expect(settings(0, 0, true, week)).rejects.toThrow(
      "wykracza poza godziny pracy",
    );
    expect(
      (
        await db.query(
          "select hours_enabled,version from public.calendar_settings",
        )
      ).rows[0],
    ).toEqual({ hours_enabled: false, version: 1 });
    expect((await agenda("2027-05-15T10:00:00Z"))[0].id).toBe(id);
  });
  it("covers both clock changes and rejects an apparent fit across the repeated hour that actually leaves the allowed window", async () => {
    const week = fullWeek().map((d) => ({
      ...d,
      start_minute: 540,
      end_minute: 1020,
    }));
    await settings(0, 0, true, week);
    await walk("2027-03-28T07:00:00Z");
    await walk("2027-10-31T08:00:00Z");
    await settings(0, 0, true, fullWeek(), 2);
    const id = await request();
    await asUser(admin, () =>
      db.query(
        "select public.change_consultation($1,1,'schedule',$2,15,'online','Próba zmiany czasu','Fikcyjny termin')",
        [id, "2027-10-31T00:40:00Z"],
      ),
    );
    const restricted = fullWeek().map((d) => ({
      ...d,
      start_minute: 150,
      end_minute: 165,
    }));
    await expect(settings(0, 60, true, restricted, 3)).rejects.toThrow(
      "wykracza poza godziny pracy",
    );
    // Use a clean projection to test just the repeated-hour interval itself.
    await db.exec("truncate public.walks,public.consultations cascade;");
    await settings(0, 0, true, restricted, 3);
    await expect(walk("2027-10-31T00:35:00Z")).rejects.toThrow(
      "wykracza poza godziny pracy",
    );
  });
  it("accepts an exact midnight end but rejects a meeting spanning two civil days when hours are enabled", async () => {
    await settings(0, 0, true);
    await walk("2027-05-10T21:00:00Z");
    await expect(walk("2027-05-11T21:30:00Z")).rejects.toThrow(
      "wykracza poza godziny pracy",
    );
  });
  it("preserves versioned retries, rejects another stale editor and denies a client's read or write of private hours", async () => {
    expect(await settings(10, 20)).toBe(2);
    expect(await settings(10, 20)).toBe(2);
    await expect(settings(10, 25)).rejects.toThrow(
      "Ustawienia kalendarza zmieniły się",
    );
    await expect(settings(0, 0, false, fullWeek(), 2, owner)).rejects.toThrow(
      "Brak uprawnień",
    );
    expect(
      (
        await asUser(owner, () =>
          db.query("select * from public.calendar_weekly_hours"),
        )
      ).rows,
    ).toEqual([]);
    expect(
      (
        await asUser(owner, () =>
          db.query("select * from public.calendar_settings"),
        )
      ).rows,
    ).toEqual([]);
    expect(
      (
        await db.query<{ allowed: boolean }>(
          "select has_function_privilege('anon','public.save_calendar_settings(integer,boolean,integer,integer,jsonb)','execute') allowed",
        )
      ).rows[0].allowed,
    ).toBe(false);
  });
  it.each([
    null,
    {},
    [],
    fullWeek().map(() => fullWeek()[0]),
    fullWeek().map((d) => ({ ...d, start_minute: "0" })),
    fullWeek().map((d) => ({ ...d, end_minute: 1500 })),
    fullWeek().map((d) => ({ ...d, enabled: null })),
  ])(
    "validates the complete weekly structure at the RPC boundary (%j)",
    async (week) => {
      await expect(
        asUser(admin, () =>
          db.query("select public.save_calendar_settings(1,false,0,0,$1)", [
            week,
          ]),
        ),
      ).rejects.toThrow("Sprawdź godziny pracy");
      expect(
        (
          await db.query<{ version: number }>(
            "select version from public.calendar_settings",
          )
        ).rows[0].version,
      ).toBe(1);
    },
  );
});
