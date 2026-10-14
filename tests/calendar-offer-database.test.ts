import { configureCalendarPrimary } from "./helpers/calendar-primary.mjs";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

let db: PGlite;
const admin = "81000000-0000-4000-8000-000000000001";
const owner = "81000000-0000-4000-8000-000000000002";
const other = "81000000-0000-4000-8000-000000000003";
const empty = "81000000-0000-4000-8000-000000000004";
const dog = "82000000-0000-4000-8000-000000000001";
const otherDog = "82000000-0000-4000-8000-000000000002";
const base = Date.now() + 3 * 86400000;
let index = 0;
const time = () => new Date(base + index++ * 7200000).toISOString();
const from = new Date(Date.now() - 2 * 86400000).toISOString();
const to = new Date(Date.now() + 30 * 86400000).toISOString();
async function user<T>(id: string, fn: () => Promise<T>) {
  await db.exec("begin;set local role authenticated;");
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
async function offer(actor = owner, start = from, end = to) {
  return (
    await user(actor, () =>
      db.query<Record<string, unknown>>(
        "select * from public.calendar_offer($1,$2) order by starts_at,id",
        [start, end],
      ),
    )
  ).rows;
}
async function walk(
  status = "open",
  mode = "approval",
  starts = time(),
  capacity = 2,
) {
  const id = randomUUID();
  await db.query(
    "insert into public.walks(id,starts_at,duration_minutes,public_location,type,price_cents,capacity,booking_mode,status) values($1,$2,60,'Publiczny park','Spacer',10000,$3,$4,$5)",
    [id, starts, capacity, mode, status],
  );
  await db.query(
    "insert into public.walk_private_details(walk_id,exact_location) values($1,'TAJNE MIEJSCE')",
    [id],
  );
  return id;
}
async function registration(walkId: string, dogId = dog, status = "pending") {
  await db.query(
    "insert into public.walk_registrations(walk_id,dog_id,status) values($1,$2,$3)",
    [walkId, dogId, status],
  );
}
async function course(
  status = "open",
  capacity = 2,
  starts = [time(), time()],
) {
  const id = randomUUID();
  await db.query(
    `insert into public.courses(id,practice_id,service_id,service_version,service_name,price_cents,is_test_price,sessions_count,duration_minutes,course_format,title,public_location,capacity,status,created_by,updated_by)
    select $1,(select id from public.care_practices limit 1),s.id,s.version,s.name,10000,true,$5,60,'group','Kurs testowy','Publiczna okolica',$2,$3,$4,$4 from public.services s where s.kind='course' limit 1`,
    [id, capacity, status, admin, starts.length],
  );
  for (let ordinal = 0; ordinal < starts.length; ordinal++) {
    const session = randomUUID();
    await db.query(
      "insert into public.course_sessions(id,course_id,ordinal,starts_at,duration_minutes,public_location,updated_by) values($1,$2,$3,$4,60,'Publiczna okolica',$5)",
      [session, id, ordinal + 1, starts[ordinal], admin],
    );
    await db.query(
      "insert into public.course_session_private_details(session_id,exact_location) values($1,'TAJNA SALA')",
      [session],
    );
  }
  return id;
}
async function enrollment(
  courseId: string,
  dogId = dog,
  guardian = owner,
  status = "requested",
) {
  await db.query(
    "insert into public.course_enrollments(id,course_id,dog_id,guardian_id,selected_course_version,status,agreed_price_cents,is_test_price,updated_by) values($1,$2,$3,$4,1,$5,10000,true,$6)",
    [randomUUID(), courseId, dogId, guardian, status, admin],
  );
}
beforeAll(async () => {
  db = new PGlite();
  await db.exec(`create role anon;create role authenticated;create schema auth;
    create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,encrypted_password text);
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    grant usage on schema public,auth to anon,authenticated;grant execute on function auth.uid() to anon,authenticated;
    create schema storage;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
    create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text);
    alter table storage.objects enable row level security;
    create function storage.foldername(name text) returns text[] language sql as $$select string_to_array(name,'/')$$;
    grant usage on schema storage to authenticated;grant select,insert,delete on storage.objects to authenticated;`);
  // Freeze the existing foundation plus this feature; parallel features have
  // their own migration tests and are integrated by the full local acceptance.
  for (const file of readdirSync("supabase/migrations")
    .filter(
      (file) =>
        file.endsWith(".sql") &&
        (file <= "202610100001_calendar_team.sql" ||
          file === "202610130003_calendar_offer.sql" || file === "202610140001_single_practitioner.sql"),
    )
    .sort())
    await db.exec(readFileSync(`supabase/migrations/${file}`, "utf8"));
  await db.query("insert into auth.users(id) values($1),($2),($3),($4)", [
    admin,
    owner,
    other,
    empty,
  ]);
  await db.query("update public.user_roles set role='admin' where user_id=$1", [
    admin,
  ]);
  await configureCalendarPrimary(db, admin);
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
    admin,
  ]);
  await db.query(
    "insert into public.dogs(id,guardian_id,name) values($1,$2,'Własny pies'),($3,$4,'CUDZY PIES')",
    [dog, owner, otherDog, other],
  );
}, 60000);
beforeEach(async () => {
  index = 0;
  await db.exec(
    "truncate public.walks,public.courses cascade;update public.dogs set status='new';",
  );
});
afterAll(async () => {
  await db?.close();
});

describe.sequential(
  "calendar offer visibility, capacity and booking boundaries",
  () => {
    it("never broadens actual walk RLS and exposes only the caller's invitations", async () => {
      const publicWalk = await walk();
      const invite = await walk("open", "invite");
      const anotherInvite = await walk("open", "invite");
      await walk("draft");
      await walk("closed");
      await walk("cancelled");
      await registration(invite);
      await registration(anotherInvite, otherDog);
      expect((await offer()).map((row) => row.source_id).sort()).toEqual(
        [publicWalk, invite].sort(),
      );
      expect((await offer(other)).map((row) => row.source_id).sort()).toEqual(
        [publicWalk, anotherInvite].sort(),
      );
      const visible = (
        await user(owner, () =>
          db.query<{ id: string }>("select id from public.walks"),
        )
      ).rows.map((row) => row.id);
      for (const row of await offer()) expect(visible).toContain(row.source_id);
      expect(JSON.stringify(await offer())).not.toMatch(
        /TAJNE|CUDZY|dog_id|guardian_id|exact_location|instructions|map_url/,
      );
      expect(
        (await offer()).find((row) => row.source_id === invite)?.eligibility,
      ).toBe("invitation_only");
    });
    it("counts accepted places hidden by roster RLS and separates full/closed/cancelled/past", async () => {
      const full = await walk("open", "automatic", time(), 1);
      await registration(full, otherDog, "accepted");
      const closed = await walk("closed");
      await registration(closed);
      const cancelled = await walk("cancelled");
      await registration(cancelled);
      const past = await walk(
        "open",
        "approval",
        new Date(Date.now() - 3600000).toISOString(),
      );
      const rows = await offer();
      expect(rows.find((row) => row.source_id === full)?.availability).toBe(
        "full",
      );
      expect(rows.find((row) => row.source_id === closed)?.availability).toBe(
        "closed",
      );
      expect(
        rows.find((row) => row.source_id === cancelled)?.availability,
      ).toBe("cancelled");
      expect(rows.find((row) => row.source_id === past)?.availability).toBe(
        "past",
      );
      expect(
        (
          await user(owner, () =>
            db.query(
              "select id from public.walk_registrations where walk_id=$1",
              [full],
            ),
          )
        ).rows,
      ).toHaveLength(0);
    });
    it("uses existing qualification rules and never asks for a duplicate registration", async () => {
      const automatic = await walk("open", "automatic");
      const approval = await walk();
      expect(
        (await offer()).find((row) => row.source_id === automatic)?.eligibility,
      ).toBe("qualification_required");
      expect(
        (await offer()).find((row) => row.source_id === approval)?.eligibility,
      ).toBe("eligible");
      expect(
        (await offer(empty)).every((row) => row.eligibility === "needs_dog"),
      ).toBe(true);
      await db.query("update public.dogs set status='approved' where id=$1", [
        dog,
      ]);
      expect(
        (await offer()).find((row) => row.source_id === automatic)?.eligibility,
      ).toBe("eligible");
      await registration(automatic);
      expect(
        (await offer()).find((row) => row.source_id === automatic)?.eligibility,
      ).toBe("registered");
      await db.query("update public.dogs set status='suspended' where id=$1", [
        dog,
      ]);
      expect(
        (await offer()).find((row) => row.source_id === approval)?.eligibility,
      ).toBe("qualification_required");
    });
    it("keeps course visibility within its RLS and shows whole-cycle capacity without participants", async () => {
      const full = await course("open", 1);
      await enrollment(full, otherDog, other, "accepted");
      const closed = await course("closed");
      await enrollment(closed);
      const privateCourse = await course("closed");
      await enrollment(privateCourse, otherDog, other);
      await course("draft");
      const rows = await offer();
      expect(new Set(rows.map((row) => row.source_id))).toEqual(
        new Set([full, closed]),
      );
      expect(
        rows
          .filter((row) => row.source_id === full)
          .every((row) => row.availability === "full"),
      ).toBe(true);
      expect(
        rows
          .filter((row) => row.source_id === closed)
          .every((row) => row.availability === "closed"),
      ).toBe(true);
      const visible = (
        await user(owner, () =>
          db.query<{ id: string }>("select id from public.courses"),
        )
      ).rows.map((row) => row.id);
      for (const row of rows) expect(visible).toContain(row.source_id);
      expect(JSON.stringify(rows)).not.toMatch(
        /TAJNA|CUDZY|dog_id|guardian_id|exact_location/,
      );
    });
    it("closes enrollment for a started cycle and labels cancelled sessions", async () => {
      const started = await course("open", 2, [
        new Date(Date.now() - 3600000).toISOString(),
        time(),
      ]);
      const cancelled = await course();
      await db.query(
        "update public.course_sessions set status='cancelled' where course_id=$1",
        [cancelled],
      );
      expect(
        (await offer())
          .filter((row) => row.source_id === started)
          .map((row) => row.availability)
          .sort(),
      ).toEqual(["closed", "past"]);
      expect(
        (await offer())
          .filter((row) => row.source_id === cancelled)
          .every((row) => row.availability === "cancelled"),
      ).toBe(true);
    });
    it("uses a half-open timestamp range and denies anonymous or unbounded requests", async () => {
      const start = time();
      const id = await walk("open", "approval", start);
      const end = new Date(Date.parse(start) + 86400000).toISOString();
      await walk("open", "approval", end);
      expect(
        (await offer(owner, start, end)).map((row) => row.source_id),
      ).toEqual([id]);
      await expect(offer(owner, start, "infinity")).rejects.toThrow(
        "poprawny miesiąc",
      );
      await expect(offer(owner, "2026-01-01", "2027-01-01")).rejects.toThrow(
        "poprawny miesiąc",
      );
      await expect(offer("")).rejects.toThrow("Zaloguj");
      await db.exec("begin;set local role anon");
      await expect(
        db.query("select * from public.calendar_offer($1,$2)", [from, to]),
      ).rejects.toThrow("permission denied");
      await db.exec("rollback");
    });
  },
);
