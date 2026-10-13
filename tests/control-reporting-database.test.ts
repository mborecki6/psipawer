import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { beforeAll, beforeEach, afterAll, expect, it } from "vitest";
let db: PGlite;
const admin = "10000000-0000-4000-8000-000000000001",
  owner = "10000000-0000-4000-8000-000000000002",
  stranger = "10000000-0000-4000-8000-000000000003";
const dog = "20000000-0000-4000-8000-000000000001",
  otherDog = "20000000-0000-4000-8000-000000000002";
const service = "60000000-0000-4000-8000-000000000099",
  practice = "00000000-0000-4000-8000-000000000001";
let legacy: Record<string, unknown>;
let noBackfill: unknown[];
async function asUser<T>(id: string, run: () => Promise<T>): Promise<T> {
  await db.exec("begin; set local role authenticated");
  await db.query("select set_config('request.jwt.claim.sub',$1,true)", [id]);
  try {
    const result = await run();
    await db.exec("commit");
    return result;
  } catch (error) {
    await db.exec("rollback");
    throw error;
  }
}
async function rpc<T = unknown>(
  user: string,
  sql: string,
  params: unknown[] = [],
): Promise<T> {
  return (
    await asUser(user, () =>
      db.query<{ result: T }>(`select ${sql} result`, params),
    )
  ).rows[0].result;
}
async function publish(
  consultation: string | null = null,
  version = 0,
  invite: string | null = null,
  context: {
    enrollment?: string;
    session?: string;
    fitness?: string;
    fitnessSession?: string;
  } = {},
) {
  return rpc<{ version: number; published_id: string }>(
    admin,
    "public.save_care_plan($1,$2,'Plan pracy','Treść zaleceń',$3,true,$4,$5,$6,$7,$8,$9)",
    [
      dog,
      version,
      "2099-01-01",
      consultation,
      context.enrollment || null,
      context.session || null,
      context.fitness || null,
      context.fitnessSession || null,
      invite,
    ],
  );
}
async function rows(sql: string, params: unknown[] = []) {
  return (await db.query<Record<string, unknown>>(sql, params)).rows;
}
async function invitation(plan: string) {
  return (
    await db.query<{ id: string; version: number }>(
      "select id,version from public.care_control_invitations where plan_id=$1",
      [plan],
    )
  ).rows[0];
}
async function completeMeeting(id: string) {
  await db.query(
    "update public.consultations set status='completed',starts_at=now()-interval '1 day',duration_minutes=60,meeting_mode='in_person',location='Miejsce testowe' where id=$1",
    [id],
  );
}
async function request(id = randomUUID(), forDog = dog, user = owner) {
  const s = (
    await db.query<{ version: number }>(
      "select version from public.services where id=$1",
      [service],
    )
  ).rows[0];
  return rpc<string>(
    user,
    "public.request_consultation($1,$2,'Cel konsultacji','',$3,$4)",
    [id, forDog, service, s.version],
  );
}
async function policy(included: boolean, days: number | null) {
  const s = (
    await db.query<{ version: number }>(
      "select version from public.services where id=$1",
      [service],
    )
  ).rows[0];
  return rpc<number>(
    admin,
    "public.set_service_reporting($1,$2,$3,$4,'Świadoma zmiana zakresu')",
    [service, s.version, included, days],
  );
}
async function access(plan: string, user = owner) {
  return rpc<{
    id: string;
    included: boolean;
    allowed: boolean;
    starts_at: string | null;
    expires_at: string | null;
    version: number;
    snapshot_days: number | null;
  }>(user, "public.care_reporting_access($1)", [plan]);
}
async function seed() {
  await db.query(
    "insert into public.dogs(id,guardian_id,name) values($1,$2,'Kluska'),($3,$4,'Borys')",
    [dog, owner, otherDog, stranger],
  );
  await db.query(
    "insert into public.services(id,practice_id,name,kind,booking_flow,meeting_mode,price_cents,price_unit,duration_minutes,sessions_count,source_url) values($1,$2,'Konsultacja testowa','individual','consultation','in_person',10000,'za spotkanie',60,1,'https://www.psipawer.pl/test')",
    [service, practice],
  );
}
beforeAll(async () => {
  db = new PGlite();
  await db.exec(`create role service_role; create role anon; create role authenticated; create schema auth;
    create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,encrypted_password text);
    create table auth.sessions(id uuid primary key,user_id uuid references auth.users);
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    grant usage on schema public,auth to anon,authenticated;
    grant execute on function auth.uid() to anon,authenticated;
    create schema storage; create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
    create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text);
    alter table storage.objects enable row level security;
    create function storage.foldername(name text) returns text[] language sql as $$select string_to_array(name,'/')$$;
    grant usage on schema storage to authenticated; grant select,insert,delete on storage.objects to authenticated;`);
  const names = readdirSync("supabase/migrations")
    .filter((n) => n.endsWith(".sql"))
    .sort();
  for (const name of names.filter((n) => n < "202610130005"))
    await db.exec(readFileSync(`supabase/migrations/${name}`, "utf8"));
  await db.query("insert into auth.users(id) values($1),($2),($3)", [
    admin,
    owner,
    stranger,
  ]);
  await db.query("update public.user_roles set role='admin' where user_id=$1", [
    admin,
  ]);
  await seed();
  const old = await request();
  await completeMeeting(old);
  const oldPlan = await rpc<{ published_id: string }>(
    admin,
    "public.save_care_plan($1,0,'Dawny plan','Dawna treść','2099-01-01',true,$2)",
    [dog, old],
  );
  const beforeCounts = await rows(
    "select (select count(*) from public.notifications) notices,(select count(*) from public.reminder_jobs) jobs",
  );
  for (const name of names.filter((n) => n >= "202610130005"))
    await db.exec(readFileSync(`supabase/migrations/${name}`, "utf8"));
  legacy = await access(oldPlan.published_id);
  noBackfill = [
    beforeCounts,
    await rows(
      "select (select count(*) from public.notifications) notices,(select count(*) from public.reminder_jobs) jobs",
    ),
    await rows("select * from public.care_control_invitations"),
  ];
});
beforeEach(async () => {
  await db.exec(
    "truncate public.dogs,public.services cascade; delete from public.audit_events;",
  );
  await seed();
});
afterAll(async () => {
  await db?.close();
});

it("keeps historic reporting unlimited and creates no invitation or reminder backfill", () => {
  expect(legacy).toMatchObject({
    included: true,
    allowed: true,
    snapshot_days: null,
    expires_at: null,
  });
  expect(noBackfill[1]).toEqual(noBackfill[0]);
  expect(noBackfill[2]).toEqual([]);
});
it("publishes the independent invitation once and rejects a retry with a different invitation date", async () => {
  const plan = await publish(null, 0, "2099-02-01");
  const original = await invitation(plan.published_id);
  expect(await publish(null, 0, "2099-02-01")).toEqual(plan);
  await expect(publish(null, 0, "2099-02-02")).rejects.toThrow(
    "Plan zmienił się",
  );
  expect(
    await rows("select due_on::text from public.care_control_invitations"),
  ).toEqual([{ due_on: "2099-02-01" }]);
  expect(await rows("select due_on::text from public.care_follow_ups")).toEqual(
    [{ due_on: "2099-01-01" }],
  );
  expect(
    await rows(
      "select source_id from public.reminder_jobs where kind='control_invitation'",
    ),
  ).toEqual([{ source_id: original.id }]);
  expect(
    await rows(
      "select id from public.notifications where kind='control_invitation_due'",
    ),
  ).toHaveLength(0);
});
it("delivers once at due time, replaces the date, and withdraws stale inbox and jobs", async () => {
  const p = await publish(null, 0, "2099-02-01"),
    i = await invitation(p.published_id);
  await db.query(
    "update public.care_control_invitations set due_on=current_date-1,version=version+1 where id=$1",
    [i.id],
  );
  const oldDate = (
    await rows(
      "select due_on::text from public.care_control_invitations where id=$1",
      [i.id],
    )
  )[0].due_on;
  expect(await rpc(admin, "public.process_due_reminders(50)")).toMatchObject({
    sent: 1,
  });
  expect(await rpc(admin, "public.process_due_reminders(50)")).toMatchObject({
    sent: 0,
  });
  expect(
    await rows(
      "select recipient_id,entity_id,invitation_id from public.notifications where kind='control_invitation_due'",
    ),
  ).toEqual([{ recipient_id: owner, entity_id: i.id, invitation_id: i.id }]);
  expect(oldDate).not.toBe("2099-02-03");
  await rpc(
    admin,
    "public.change_control_invitation($1,2,'2099-02-03','Zmiana wskazanego dnia')",
    [i.id],
  );
  expect(
    await rows(
      "select id from public.notifications where kind='control_invitation_due'",
    ),
  ).toHaveLength(0);
  expect(
    await rows(
      "select source_token from public.reminder_jobs where kind='control_invitation' and status='pending'",
    ),
  ).toEqual([{ source_token: "3" }]);
  await rpc(
    admin,
    "public.change_control_invitation($1,3,null,'Wycofanie zaproszenia')",
    [i.id],
  );
  expect(
    await rows(
      "select id from public.reminder_jobs where kind='control_invitation' and status in ('pending','retry')",
    ),
  ).toHaveLength(0);
  expect(
    await rows(
      "select action from public.care_control_invitation_history where invitation_id=$1 order by version",
      [i.id],
    ),
  ).toEqual([
    { action: "created" },
    { action: "rescheduled" },
    { action: "cancelled" },
  ]);
});
it("supersedes only the exact context and blocks withdrawn deep-link submissions", async () => {
  const meeting = await request();
  await completeMeeting(meeting);
  const a = await publish(null, 0, "2099-03-01"),
    b = await publish(meeting, 0, "2099-03-02");
  const ai = await invitation(a.published_id),
    bi = await invitation(b.published_id);
  await publish(null, 1, null);
  expect(
    await rows(
      "select id,status from public.care_control_invitations order by due_on",
    ),
  ).toEqual([
    { id: ai.id, status: "superseded" },
    { id: bi.id, status: "open" },
  ]);
  await expect(
    rpc(
      owner,
      "public.request_control_consultation($1,$2,$3,'Kontrola','',$4,1)",
      [ai.id, randomUUID(), dog, service],
    ),
  ).rejects.toThrow("wycofane");
  expect(
    await rows("select status from public.care_follow_ups where plan_id=$1", [
      b.published_id,
    ]),
  ).toEqual([{ status: "open" }]);
});
it("isolates guardians and makes two control forms return the same ordinary consultation", async () => {
  const p = await publish(null, 0, "2099-03-01"),
    i = await invitation(p.published_id);
  expect(
    (
      await asUser(stranger, () =>
        db.query("select id from public.care_control_invitations"),
      )
    ).rows,
  ).toEqual([]);
  await expect(
    rpc(
      stranger,
      "public.request_control_consultation($1,$2,$3,'Kontrola','',$4,1)",
      [i.id, randomUUID(), otherDog, service],
    ),
  ).rejects.toThrow("Twojego psa");
  const first = await rpc<string>(
    owner,
    "public.request_control_consultation($1,$2,$3,'Kontrola postępów','Popołudnia',$4,1)",
    [i.id, randomUUID(), dog, service],
  );
  const second = await rpc<string>(
    owner,
    "public.request_control_consultation($1,$2,$3,'Druga otwarta karta','Inny wpis',$4,1)",
    [i.id, randomUUID(), dog, service],
  );
  expect(second).toBe(first);
  expect(
    await rows("select id,status,starts_at from public.consultations"),
  ).toEqual([{ id: first, status: "requested", starts_at: null }]);
  expect(await rows("select status from public.care_follow_ups")).toEqual([
    { status: "open" },
  ]);
  expect(
    await rows("select status from public.care_control_invitations"),
  ).toEqual([{ status: "requested" }]);
});
it("cancels open invitations on guardian transfer without moving invitations to a new owner", async () => {
  const p = await publish(null, 0, "2099-03-01"),
    i = await invitation(p.published_id);
  await db.query("update public.dogs set guardian_id=$1 where id=$2", [
    stranger,
    dog,
  ]);
  expect(
    await rows("select status from public.care_control_invitations"),
  ).toEqual([{ status: "cancelled" }]);
  await expect(
    rpc(
      owner,
      "public.request_control_consultation($1,$2,$3,'Kontrola','',$4,1)",
      [i.id, randomUUID(), dog, service],
    ),
  ).rejects.toThrow("Twojego psa");
  await expect(
    rpc(
      stranger,
      "public.request_control_consultation($1,$2,$3,'Kontrola','',$4,1)",
      [i.id, randomUUID(), dog, service],
    ),
  ).rejects.toThrow("Twojego psa");
});
it("snapshots purchase rules without starting the clock before publication or changing its quote", async () => {
  await policy(true, 14);
  const meeting = await request();
  expect(
    await rows(
      "select included,snapshot_days,starts_at,expires_at from public.care_reporting_entitlements where consultation_id=$1",
      [meeting],
    ),
  ).toEqual([
    { included: true, snapshot_days: 14, starts_at: null, expires_at: null },
  ]);
  await policy(false, null);
  await completeMeeting(meeting);
  const p = await publish(meeting);
  const first = await access(p.published_id);
  expect(first).toMatchObject({
    included: true,
    allowed: true,
    snapshot_days: 14,
  });
  expect(first.starts_at).not.toBeNull();
  expect(first.expires_at).not.toBeNull();
  expect(
    await rows(
      "select agreed_price_cents,service_version from public.consultations where id=$1",
      [meeting],
    ),
  ).toEqual([{ agreed_price_cents: 10000, service_version: 2 }]);
  const next = await publish(meeting, 1);
  expect(await access(next.published_id)).toEqual(first);
  const other = await request();
  await completeMeeting(other);
  const newer = await publish(other);
  expect(await access(newer.published_id)).toMatchObject({
    included: false,
    allowed: false,
  });
  expect(await access(p.published_id)).toEqual(first);
});
it("enforces expiry on stale forms, preserves exact retry and history, and supports audited exceptions", async () => {
  const meeting = await request();
  await completeMeeting(meeting);
  const p = await publish(meeting);
  const a = await access(p.published_id),
    report = randomUUID();
  await rpc(
    owner,
    "public.submit_care_progress($1,$2,'Pierwsza odpowiedź','','')",
    [report, p.published_id],
  );
  await rpc(
    admin,
    "public.change_care_reporting($1,$2,true,'2000-01-01','Zakończenie okresu raportowania')",
    [a.id, a.version],
  );
  expect(await access(p.published_id)).toMatchObject({
    included: true,
    allowed: false,
  });
  await expect(
    rpc(
      owner,
      "public.submit_care_progress($1,$2,'Nowy wpis ze starej karty','','')",
      [randomUUID(), p.published_id],
    ),
  ).rejects.toThrow("Raportowanie dla tej usługi");
  await rpc(
    owner,
    "public.submit_care_progress($1,$2,'Pierwsza odpowiedź','','')",
    [report, p.published_id],
  );
  expect(
    (
      await asUser(owner, () =>
        db.query("select body from public.care_plan_versions where id=$1", [
          p.published_id,
        ]),
      )
    ).rows,
  ).toEqual([{ body: "Treść zaleceń" }]);
  expect(
    (
      await asUser(owner, () =>
        db.query("select attempted from public.care_progress where id=$1", [
          report,
        ]),
      )
    ).rows,
  ).toEqual([{ attempted: "Pierwsza odpowiedź" }]);
  await rpc(admin, "public.review_care_progress($1)", [report]);
  await expect(
    rpc(stranger, "public.care_reporting_access($1)", [p.published_id]),
  ).rejects.toThrow("Twojego psa");
  await expect(
    rpc(
      owner,
      "public.change_care_reporting($1,2,true,null,'Próba opiekuna')",
      [a.id],
    ),
  ).rejects.toThrow("uprawnień");
  await rpc(
    admin,
    "public.change_care_reporting($1,2,true,null,'Świadome przedłużenie dostępu')",
    [a.id],
  );
  await rpc(
    owner,
    "public.submit_care_progress($1,$2,'Dostęp przywrócony','','')",
    [randomUUID(), p.published_id],
  );
  expect(
    await rows(
      "select version,included from public.care_reporting_history where entitlement_id=$1 order by version",
      [a.id],
    ),
  ).toEqual([
    { version: 2, included: true },
    { version: 3, included: true },
  ]);
});
it("does not unlock an expired context when another service has active reporting", async () => {
  const old = await request();
  await completeMeeting(old);
  const p = await publish(old);
  const a = await access(p.published_id);
  await rpc(
    admin,
    "public.change_care_reporting($1,1,false,null,'Zamknięte raportowanie usługi')",
    [a.id],
  );
  const current = await request();
  await completeMeeting(current);
  const q = await publish(current);
  expect(await access(q.published_id)).toMatchObject({ allowed: true });
  await expect(
    rpc(
      owner,
      "public.submit_care_progress($1,$2,'Próba na starym zakupie','','')",
      [randomUUID(), p.published_id],
    ),
  ).rejects.toThrow("Raportowanie dla tej usługi");
});
it("shares one reporting period across package meetings without touching another assignment", async () => {
  await db.query(
    "update public.services set kind='package',booking_flow='fitness',sessions_count=2 where id=$1",
    [service],
  );
  await policy(true, 30);
  const pack = randomUUID();
  await rpc(
    owner,
    "public.request_fitness_package($1,$2,$3,2,'Cel fitness','')",
    [pack, dog, service],
  );
  await rpc(admin, "public.change_fitness_package($1,1,'accept','',$2)", [
    pack,
    randomUUID(),
  ]);
  const sessions = await db.query<{ id: string }>(
    "update public.fitness_sessions set status='completed',starts_at=now()-interval '1 day',attendance='present' where package_id=$1 returning id",
    [pack],
  );
  const whole = await publish(null, 0, null, { fitness: pack });
  const first = await access(whole.published_id);
  const individual = await publish(null, 0, null, {
    fitness: pack,
    fitnessSession: sessions.rows[0].id,
  });
  expect(await access(individual.published_id)).toEqual(first);
  await rpc(
    admin,
    "public.change_care_reporting($1,1,false,null,'Wyłączenie całego przypisania')",
    [first.id],
  );
  expect(await access(whole.published_id)).toMatchObject({ allowed: false });
  expect(await access(individual.published_id)).toMatchObject({
    allowed: false,
  });
  const general = await publish();
  expect(await access(general.published_id)).toMatchObject({
    allowed: true,
    snapshot_days: null,
  });
});
