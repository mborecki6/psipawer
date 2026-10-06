import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

let db: PGlite;
const admin = "a1000000-0000-4000-8000-000000000001",
  owner = "a1000000-0000-4000-8000-000000000002",
  other = "a1000000-0000-4000-8000-000000000003",
  colleague = "a1000000-0000-4000-8000-000000000004",
  dog = "a2000000-0000-4000-8000-000000000001",
  otherDog = "a2000000-0000-4000-8000-000000000002",
  service = "60000000-0000-4000-8000-000000000006";
async function asUser<T>(id: string, run: () => Promise<T>) {
  await db.exec("begin;set local role authenticated");
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
async function rpc<T = unknown>(actor: string, name: string, args: unknown[]) {
  return (
    await asUser(actor, () =>
      db.query<{ result: T }>(
        `select public.${name}(${args.map((_, n) => `$${n + 1}`).join(",")}) as result`,
        args,
      ),
    )
  ).rows[0].result;
}
const request = (
  id: string = randomUUID(),
  dogId = dog,
  actor = owner,
  version = 2,
  topic = "Cel indywidualnych spotkań",
) =>
  rpc<string>(actor, "request_fitness_package", [
    id,
    dogId,
    service,
    version,
    topic,
    "Popołudnia",
  ]);
const change = (
  id: string,
  version: number,
  action: string,
  note = "Uzgodniona decyzja",
  key = randomUUID(),
  actor = admin,
) =>
  rpc<number>(actor, "change_fitness_package", [
    id,
    version,
    action,
    note,
    key,
  ]);
async function active(dogId = dog, actor = owner) {
  const id = await request(randomUUID(), dogId, actor);
  await change(id, 1, "accept");
  return id;
}
const future = () => new Date(Date.now() + 7 * 86400000).toISOString();
const schedule = (
  session: string,
  version = 1,
  starts = future(),
  key = randomUUID(),
  location = "PRYWATNY ADRES FITNESS",
  actor = admin,
  note = "Uzgodniony termin",
) =>
  rpc<number>(actor, "save_fitness_session", [
    session,
    version,
    starts,
    location,
    note,
    key,
  ]);
const sessionChange = (
  session: string,
  version: number,
  action: string,
  attendance: string | null = null,
  note = "Uzgodniona zmiana spotkania",
  key = randomUUID(),
  actor = admin,
) =>
  rpc<number>(actor, "change_fitness_session", [
    session,
    version,
    action,
    attendance,
    note,
    key,
  ]);
const pay = (id: string, amount = 10000, key = randomUUID(), actor = admin) =>
  rpc<string>(actor, "record_fitness_payment", [
    id,
    amount,
    "transfer",
    "Zachowana wpłata",
    key,
  ]);
const refund = (
  payment: string,
  amount: number,
  key = randomUUID(),
  actor = admin,
  note = "Uzgodniony rzeczywisty zwrot",
) => rpc<string>(actor, "refund_fitness_payment", [payment, amount, note, key]);
const settle = (
  id: string,
  version: number,
  amount: number,
  key = randomUUID(),
  actor = admin,
) =>
  rpc<number>(actor, "settle_fitness_package", [
    id,
    version,
    amount,
    "Uzgodniona należność po rezygnacji",
    key,
  ]);
const state = async (id: string) =>
  (
    await db.query<{
      version: number;
      status: string;
      charge_cents: number;
      sessions_count: number;
      duration_minutes: number;
      agreed_price_cents: number;
      guardian_id: string;
    }>("select * from public.fitness_packages where id=$1", [id])
  ).rows[0];
const sessions = async (id: string) =>
  (
    await db.query<{
      id: string;
      version: number;
      status: string;
      starts_at: Date | null;
      attendance: string | null;
      duration_minutes: number;
    }>(
      "select * from public.fitness_sessions where package_id=$1 order by ordinal",
      [id],
    )
  ).rows;
const balance = async (id: string, actor = owner) =>
  (
    await asUser(actor, () =>
      db.query<Record<string, unknown>>(
        "select * from public.fitness_balances where id=$1",
        [id],
      ),
    )
  ).rows[0];
const evidence = async () =>
  (
    await db.query(`select jsonb_build_object(
      'packages',(select jsonb_agg(p order by id) from public.fitness_packages p),
      'sessions',(select jsonb_agg(s order by id) from public.fitness_sessions s),
      'locations',(select jsonb_agg(l order by session_id) from public.fitness_session_private_details l),
      'history',(select jsonb_agg(h order by id) from public.fitness_history h),
      'receipts',(select jsonb_agg(r order by id) from public.fitness_receipts r),
      'payments',(select jsonb_agg(p order by id) from public.payments p),
      'refunds',(select jsonb_agg(r order by id) from public.fitness_payment_refunds r),
      'notifications',(select jsonb_agg(n order by id) from public.notifications n),
      'reminders',(select jsonb_agg(j order by id) from public.reminder_jobs j),
      'reminderAttempts',(select jsonb_agg(a order by job_id,attempt) from public.reminder_attempts a),
      'slots',(select jsonb_agg(s order by occupied) from public.calendar_slots s),
      'drafts',(select jsonb_agg(d order by dog_id) from public.care_drafts d),
      'plans',(select jsonb_agg(p order by id) from public.care_plan_versions p),
      'careEvents',(select jsonb_agg(e order by id) from public.care_events e),
      'audit',(select jsonb_agg(a order by id) from public.audit_events a)) as result`)
  ).rows[0];
async function pastMeeting(id: string, ordinal = 0) {
  const s = (await sessions(id))[ordinal];
  await schedule(
    s.id,
    s.version,
    new Date(Date.now() + (7 + ordinal) * 86400000).toISOString(),
  );
  await db.query(
    "update public.fitness_sessions set starts_at=now()-make_interval(hours=>$2) where id=$1",
    [s.id, 2 + ordinal],
  );
  return s.id;
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
  for (const file of readdirSync("supabase/migrations")
    .filter((f) => f.endsWith(".sql"))
    .sort())
    await db.exec(readFileSync(`supabase/migrations/${file}`, "utf8"));
  await db.query("insert into auth.users(id) values($1),($2),($3),($4)", [
    admin,
    owner,
    other,
    colleague,
  ]);
  await db.query(
    "update public.user_roles set role='admin' where user_id in($1,$2)",
    [admin, colleague],
  );
  await db.query(
    "insert into public.dogs(id,guardian_id,name) values($1,$2,'Fikcyjny fitness'),($3,$4,'Drugi fitness')",
    [dog, owner, otherDog, other],
  );
});
beforeEach(async () => {
  await db.exec(
    "truncate public.fitness_packages cascade;truncate public.calendar_blocks cascade;delete from public.audit_events;",
  );
  await db.query(
    "update public.user_roles set role='client' where user_id in($1,$2)",
    [owner, other],
  );
  await db.query(
    "update public.services set active=true,version=2,price_cents=10000,sessions_count=4,duration_minutes=45 where id=$1",
    [service],
  );
  await db.query("update public.dogs set guardian_id=$1 where id=$2", [
    owner,
    dog,
  ]);
});
afterAll(async () => {
  await db?.close();
});

const care = (
  pack: string | null,
  meeting: string | null = null,
  version = 0,
  publish = true,
  actor = admin,
  title = "Plan fitness",
  body = "Własne wskazówki prowadzącej.",
  dogId = dog,
  consultation: string | null = null,
  course: string | null = null,
) =>
  rpc<{ version: number; published_id: string | null }>(
    actor,
    "save_care_plan",
    [
      dogId,
      version,
      title,
      body,
      null,
      publish,
      consultation,
      course,
      null,
      pack,
      meeting,
    ],
  );
const fitnessCare = (pack: string, actor = owner, offset = 0) =>
  asUser(actor, () =>
    db.query<{
      plans: { id: string; fitness_session_id: string | null; title: string }[];
      has_draft: boolean;
      can_prepare: boolean;
    }>("select * from public.fitness_care_feed($1,$2)", [pack, offset]),
  );

describe.sequential("fitness publications and private drafts", () => {
  it("publishes a whole-package plan once and keeps draft state private", async () => {
    const pack = await active();
    const first = await care(pack);
    expect(await care(pack)).toEqual(first);
    const staff = (await fitnessCare(pack, admin)).rows[0];
    expect(staff).toMatchObject({ has_draft: true, can_prepare: true });
    const own = (await fitnessCare(pack)).rows[0];
    expect(own).toMatchObject({ has_draft: false, can_prepare: false });
    expect(own.plans).toEqual([
      expect.objectContaining({
        id: first.published_id,
        fitness_session_id: null,
      }),
    ]);
    expect((await fitnessCare(pack, other)).rows).toEqual([]);
    expect(
      (
        await db.query("select * from public.care_events where dog_id=$1", [
          dog,
        ])
      ).rows,
    ).toHaveLength(1);
  });
  it("keeps a scheduled meeting draft private and permits publication only after completion", async () => {
    const pack = await active(),
      meeting = await pastMeeting(pack);
    await care(pack, meeting, 0, false);
    const before = await evidence();
    await expect(care(pack, meeting, 1)).rejects.toThrow(
      "Najpierw zakończ spotkanie fitness",
    );
    expect(await evidence()).toEqual(before);
    expect((await fitnessCare(pack)).rows[0].plans).toEqual([]);
    expect(
      (
        await asUser(owner, () =>
          db.query("select dog_id from public.care_drafts"),
        )
      ).rows,
    ).toEqual([]);
    await sessionChange(meeting, 2, "complete", "present");
    const publication = await care(pack, meeting, 1);
    expect((await fitnessCare(pack)).rows[0].plans[0]).toMatchObject({
      id: publication.published_id,
      fitness_session_id: meeting,
    });
    expect(
      (
        await db.query(
          "select entity_id from public.notifications where kind='plan_published' and recipient_id=$1",
          [owner],
        )
      ).rows,
    ).toEqual([{ entity_id: publication.published_id }]);
  });
  it("rejects unbooked, cancelled, wrong-package and wrong-dog contexts atomically", async () => {
    const pack = await active(),
      meeting = (await sessions(pack))[0];
    const another = await active(otherDog, other),
      anotherMeeting = (await sessions(another))[0];
    for (const attempt of [
      () => care(pack, meeting.id, 0, false),
      () => care(pack, anotherMeeting.id),
      () =>
        care(
          pack,
          null,
          0,
          true,
          admin,
          "Plan fitness",
          "Treść dla psa.",
          otherDog,
        ),
    ]) {
      const before = await evidence();
      await expect(attempt()).rejects.toThrow(/spotkanie|tego psa/);
      expect(await evidence()).toEqual(before);
    }
    await schedule(meeting.id);
    await sessionChange(meeting.id, 2, "cancel", null);
    await expect(care(pack, meeting.id, 0, false)).rejects.toThrow(
      "umówione lub zakończone",
    );
  });
  it("rejects combined sources, orphan meetings and client writes before changing content", async () => {
    const pack = await active(),
      meeting = (await sessions(pack))[0].id;
    for (const attempt of [
      () => care(pack, null, 0, true, owner),
      () => care(pack, null, 0, true, other),
      () => care(null, meeting),
      () =>
        care(
          pack,
          null,
          0,
          true,
          admin,
          "Plan fitness",
          "Treść własna.",
          dog,
          randomUUID(),
        ),
      () =>
        care(
          pack,
          null,
          0,
          true,
          admin,
          "Plan fitness",
          "Treść własna.",
          dog,
          null,
          randomUUID(),
        ),
    ]) {
      const before = await evidence();
      await expect(attempt()).rejects.toThrow(
        /Brak uprawnień|jedno powiązanie/,
      );
      expect(await evidence()).toEqual(before);
    }
  });
  it("preserves publications and historical retries after withdrawal but refuses a new publication", async () => {
    const pack = await active(),
      published = await care(pack);
    await change(pack, 2, "cancel");
    const before = await evidence();
    expect(await care(pack)).toEqual(published);
    await expect(care(pack, null, 1)).rejects.toThrow(
      "aktywny lub zakończony pakiet",
    );
    await expect(care(pack, null, 0, true, admin, "Inny plan")).rejects.toThrow(
      "Plan zmienił się",
    );
    expect(await evidence()).toEqual(before);
    expect((await fitnessCare(pack)).rows[0].plans).toHaveLength(1);
    expect((await fitnessCare(pack, admin)).rows[0]).toMatchObject({
      has_draft: true,
      can_prepare: false,
    });
  });
  it("does not leak care contents or draft presence through a former guardian's financial package", async () => {
    const pack = await active();
    await care(pack);
    await db.query("update public.dogs set guardian_id=$1 where id=$2", [
      other,
      dog,
    ]);
    expect((await fitnessCare(pack)).rows[0]).toMatchObject({
      plans: [],
      has_draft: false,
      can_prepare: false,
    });
    expect((await fitnessCare(pack, other)).rows).toEqual([]);
    expect((await fitnessCare(pack, admin)).rows[0].can_prepare).toBe(false);
    await expect(care(pack, null, 1)).rejects.toThrow("aktualnego opiekuna");
  });
  it("pages seven publications independently and retains the original context after a general-plan edit", async () => {
    const pack = await active();
    for (let n = 0; n < 7; n++)
      await care(pack, null, n, true, admin, `Plan numer ${n}`);
    const first = (await fitnessCare(pack)).rows[0].plans;
    expect(first).toHaveLength(6);
    expect(first[0].title).toBe("Plan numer 6");
    expect(
      (await fitnessCare(pack, owner, 5)).rows[0].plans.map((p) => p.title),
    ).toEqual(["Plan numer 1", "Plan numer 0"]);
    await care(null, null, 7, true, admin, "Ogólny plan");
    expect((await fitnessCare(pack, admin)).rows[0].has_draft).toBe(false);
    expect((await fitnessCare(pack)).rows[0].plans).toEqual(first);
  });
  it("enforces composite context foreign keys even for direct privileged writes", async () => {
    const pack = await active(),
      another = await active(otherDog, other),
      otherMeeting = (await sessions(another))[0].id;
    await care(pack, null, 0, false);
    await expect(
      db.query(
        "update public.care_drafts set fitness_session_id=$1 where dog_id=$2",
        [otherMeeting, dog],
      ),
    ).rejects.toThrow(/foreign key|constraint/);
    await expect(
      db.query(
        "update public.care_drafts set fitness_package_id=$1 where dog_id=$2",
        [another, dog],
      ),
    ).rejects.toThrow(/foreign key|constraint/);
  });
});

describe.sequential(
  "individual fitness entitlement, schedule and frozen money",
  () => {
    it("imports the separate flow and freezes one price for four 45-minute meetings", async () => {
      expect(
        (
          await db.query(
            "select booking_flow,version from public.services where id=$1",
            [service],
          )
        ).rows,
      ).toEqual([{ booking_flow: "fitness", version: 2 }]);
      const id = await request();
      expect(await state(id)).toMatchObject({
        status: "requested",
        charge_cents: 0,
        agreed_price_cents: 10000,
        sessions_count: 4,
        duration_minutes: 45,
      });
      expect(await sessions(id)).toHaveLength(0);
      expect(await balance(id)).toMatchObject({
        due_cents: 0,
        can_pay: false,
        completed_sessions: 0,
      });
      await change(id, 1, "accept");
      expect(await sessions(id)).toHaveLength(4);
      expect(
        (await sessions(id)).every(
          (s) => s.status === "pending" && s.duration_minutes === 45,
        ),
      ).toBe(true);
      expect(await balance(id)).toMatchObject({
        due_cents: 10000,
        charge_cents: 10000,
        can_pay: true,
      });
    });
    it("keeps the quote and original request after a hidden, more expensive catalogue revision", async () => {
      const id = await request();
      await db.query(
        "update public.services set active=false,version=3,price_cents=20000,sessions_count=6,duration_minutes=60 where id=$1",
        [service],
      );
      expect(await request(id)).toBe(id);
      await expect(request(id, dog, owner, 2, "Inna treść")).rejects.toThrow(
        "identyfikator",
      );
      await change(id, 1, "accept");
      expect(await state(id)).toMatchObject({
        agreed_price_cents: 10000,
        sessions_count: 4,
        duration_minutes: 45,
      });
      expect(await sessions(id)).toHaveLength(4);
      await expect(request(randomUUID(), otherDog, other, 3)).rejects.toThrow(
        "dostępny",
      );
    });
    it("rejects a stale offer, another guardian and a second open entitlement", async () => {
      await expect(request(randomUUID(), dog, owner, 1)).rejects.toThrow(
        "Oferta zmieniła",
      );
      await expect(request(randomUUID(), dog, other)).rejects.toThrow(
        "swojego psa",
      );
      await expect(request(randomUUID(), dog, admin)).rejects.toThrow(
        "konta opiekuna",
      );
      await request();
      await expect(request()).rejects.toThrow("otwarte zgłoszenie");
      expect(
        (await db.query("select id from public.fitness_packages")).rows,
      ).toHaveLength(1);
    });
    it("requires real authority and denies writes, private helpers and anonymous operations", async () => {
      const id = await request();
      await expect(
        change(id, 1, "accept", "", randomUUID(), owner),
      ).rejects.toThrow("Brak dostępu");
      await expect(pay(id, 4000, randomUUID(), owner)).rejects.toThrow(
        "Brak uprawnień",
      );
      await expect(
        asUser(owner, () =>
          db.query(
            "update public.fitness_packages set charge_cents=1 where id=$1",
            [id],
          ),
        ),
      ).rejects.toThrow("permission denied");
      const privileges = (
        await db.query(`select has_function_privilege('anon','public.request_fitness_package(uuid,uuid,uuid,integer,text,text)','execute') as anonymous,
      has_function_privilege('authenticated','public.fitness_previous_result(uuid,uuid,text,jsonb)','execute') as helper,
      has_function_privilege('authenticated','public.void_nonfitness_payment(uuid,text)','execute') as bypass`)
      ).rows[0];
      expect(privileges).toEqual({
        anonymous: false,
        helper: false,
        bypass: false,
      });
    });
    it("isolates the package, public history and balance while keeping receipts private", async () => {
      const id = await active();
      expect(await balance(id, other)).toBeUndefined();
      for (const table of [
        "fitness_packages",
        "fitness_sessions",
        "fitness_history",
        "fitness_receipts",
      ]) {
        const rows = await asUser(other, () =>
          db.query(`select * from public.${table}`),
        );
        expect(rows.rows).toHaveLength(0);
      }
      expect(
        (
          await asUser(owner, () =>
            db.query("select * from public.fitness_receipts"),
          )
        ).rows,
      ).toHaveLength(0);
      expect(
        (
          await asUser(admin, () =>
            db.query("select * from public.fitness_receipts"),
          )
        ).rows,
      ).toHaveLength(1);
    });
    it("reserves the global calendar and refuses a colliding booking atomically", async () => {
      const id = await active(),
        s = (await sessions(id))[0],
        starts = future();
      await rpc(admin, "save_calendar_block", [
        randomUUID(),
        0,
        "Blokada fitness",
        starts,
        new Date(Date.parse(starts) + 3600000).toISOString(),
      ]);
      const before = await evidence();
      await expect(schedule(s.id, 1, starts)).rejects.toThrow(
        "czas jest już zajęty",
      );
      expect(await evidence()).toEqual(before);
      await schedule(
        s.id,
        1,
        new Date(Date.parse(starts) + 3600000).toISOString(),
      );
      expect(
        (
          await db.query<{ duration: string }>(
            "select upper(occupied)-lower(occupied) as duration from public.calendar_slots where fitness_session_id=$1",
            [s.id],
          )
        ).rows[0].duration,
      ).toBe("00:45:00");
    });
    it("shows a scheduled fitness appointment only to its owner and staff", async () => {
      const id = await active(),
        s = (await sessions(id))[0],
        starts = future();
      await schedule(s.id, 1, starts);
      const to = new Date(Date.parse(starts) + 86400000).toISOString();
      for (const actor of [owner, admin])
        expect(
          (
            await asUser(actor, () =>
              db.query("select * from public.calendar_appointments($1,$2)", [
                starts,
                to,
              ]),
            )
          ).rows,
        ).toMatchObject([
          { id, kind: "fitness", location: "PRYWATNY ADRES FITNESS" },
        ]);
      expect(
        (
          await asUser(other, () =>
            db.query("select * from public.calendar_appointments($1,$2)", [
              starts,
              to,
            ]),
          )
        ).rows,
      ).toHaveLength(0);
      expect(
        JSON.stringify(
          (
            await asUser(owner, () =>
              db.query("select * from public.fitness_history"),
            )
          ).rows,
        ),
      ).not.toContain("PRYWATNY ADRES FITNESS");
      expect(
        (
          await asUser(other, () =>
            db.query("select * from public.fitness_session_private_details"),
          )
        ).rows,
      ).toHaveLength(0);
    });
    it("preserves the newer date when an old exact schedule is retried and rejects a mismatched key", async () => {
      const id = await active(),
        s = (await sessions(id))[0],
        starts = future(),
        key = randomUUID();
      expect(await schedule(s.id, 1, starts, key)).toBe(2);
      const later = new Date(Date.parse(starts) + 86400000).toISOString();
      await schedule(s.id, 2, later);
      const before = await evidence();
      expect(await schedule(s.id, 1, starts, key)).toBe(2);
      expect(await evidence()).toEqual(before);
      await expect(schedule(s.id, 1, later, key)).rejects.toThrow(
        "użyty dla innych",
      );
      await expect(
        schedule(s.id, 3, later, key, "PRYWATNY ADRES FITNESS", colleague),
      ).rejects.toThrow("użyty dla innych");
      await expect(schedule(s.id, 1, later)).rejects.toThrow(
        "Spotkanie zmieniło",
      );
      expect(await evidence()).toEqual(before);
    });
    it("returns an individually cancelled meeting to scheduling without changing the whole fee", async () => {
      const id = await active(),
        s = (await sessions(id))[0],
        starts = future(),
        key = randomUUID();
      await schedule(s.id, 1, starts);
      expect(
        await sessionChange(
          s.id,
          2,
          "cancel",
          null,
          "Przełożenie po uzgodnieniu",
          key,
        ),
      ).toBe(3);
      expect((await sessions(id))[0]).toMatchObject({
        status: "pending",
        starts_at: null,
        attendance: null,
      });
      expect(
        (
          await db.query(
            "select * from public.calendar_slots where fitness_session_id=$1",
            [s.id],
          )
        ).rows,
      ).toHaveLength(0);
      expect(
        (
          await asUser(owner, () =>
            db.query("select * from public.fitness_session_private_details"),
          )
        ).rows,
      ).toHaveLength(0);
      await schedule(s.id, 3, starts);
      const before = await evidence();
      expect(
        await sessionChange(
          s.id,
          2,
          "cancel",
          null,
          "Przełożenie po uzgodnieniu",
          key,
        ),
      ).toBe(3);
      expect(await evidence()).toEqual(before);
      expect(await balance(id)).toMatchObject({
        charge_cents: 10000,
        due_cents: 10000,
        completed_sessions: 0,
      });
    });
    it("rejects null, infinite and past dates and premature completion without changing evidence", async () => {
      const id = await active(),
        s = (await sessions(id))[0];
      const before = await evidence();
      for (const date of [
        null,
        "infinity",
        new Date(Date.now() - 86400000).toISOString(),
      ])
        await expect(
          rpc(admin, "save_fitness_session", [
            s.id,
            1,
            date,
            "Adres",
            "",
            randomUUID(),
          ]),
        ).rejects.toThrow();
      expect(await evidence()).toEqual(before);
      await schedule(s.id);
      const scheduled = await evidence();
      await expect(
        sessionChange(s.id, 2, "complete", "present"),
      ).rejects.toThrow("po jego zakończeniu");
      expect(await evidence()).toEqual(scheduled);
    });
    it("keeps attendance corrections, earlier exact receipts and explicit re-opening distinct", async () => {
      const id = await active(),
        s = await pastMeeting(id);
      await sessionChange(s, 2, "complete", "present");
      const key = randomUUID();
      expect(
        await sessionChange(
          s,
          3,
          "correct",
          "excused",
          "Zachowana korekta",
          key,
        ),
      ).toBe(4);
      await sessionChange(s, 4, "correct", "absent");
      const before = await evidence();
      expect(
        await sessionChange(
          s,
          3,
          "correct",
          "excused",
          "Zachowana korekta",
          key,
        ),
      ).toBe(4);
      expect(await evidence()).toEqual(before);
      expect(await balance(id)).toMatchObject({
        completed_sessions: 1,
        charge_cents: 10000,
      });
      await sessionChange(s, 5, "reopen");
      expect(await balance(id)).toMatchObject({
        completed_sessions: 0,
        charge_cents: 10000,
      });
      expect(
        (
          await db.query(
            "select details from public.fitness_history where action='correct' order by created_at",
          )
        ).rows,
      ).toMatchObject([
        { details: { previous_attendance: "present", attendance: "excused" } },
        { details: { previous_attendance: "excused", attendance: "absent" } },
      ]);
    });
    it("completes only a fully processed package and allows a correction without discarding its financial debt", async () => {
      const id = await active();
      await expect(change(id, 2, "complete")).rejects.toThrow(
        "każde spotkanie",
      );
      for (let ordinal = 0; ordinal < 4; ordinal++) {
        const s = await pastMeeting(id, ordinal);
        await sessionChange(
          s,
          2,
          "complete",
          ordinal === 1 ? "absent" : "present",
        );
      }
      const version = (await state(id)).version;
      expect(await change(id, version, "complete")).toBe(version + 1);
      expect(await balance(id)).toMatchObject({
        status: "completed",
        completed_sessions: 4,
        due_cents: 10000,
        can_pay: true,
      });
      const s = (await sessions(id))[0];
      await sessionChange(s.id, 3, "correct", "excused");
      await expect(sessionChange(s.id, 4, "reopen")).rejects.toThrow(
        "nie jest aktywny",
      );
      await change(id, (await state(id)).version, "resume");
      await sessionChange(s.id, 4, "reopen");
      expect(await balance(id)).toMatchObject({
        status: "active",
        completed_sessions: 3,
      });
    });
    it("records partial payments exactly once and blocks overpayment and another author's reuse", async () => {
      const id = await request();
      await expect(pay(id)).rejects.toThrow("Najpierw przyjmij");
      await change(id, 1, "accept");
      const key = randomUUID(),
        payment = await pay(id, 4000, key);
      await pay(id, 6000);
      const before = await evidence();
      expect(await pay(id, 4000, key)).toBe(payment);
      expect(await evidence()).toEqual(before);
      await expect(pay(id, 4000, key, colleague)).rejects.toThrow(
        "identyfikator",
      );
      await expect(pay(id, 1)).rejects.toThrow("przekracza");
      expect(await balance(id)).toMatchObject({
        paid_cents: 10000,
        due_cents: 0,
        version: 4,
      });
      expect(await evidence()).toEqual(before);
    });
    it("blocks a globally reused payment key for another package without a new receipt", async () => {
      const first = await active(),
        second = await active(otherDog, other),
        key = randomUUID();
      await pay(first, 4000, key);
      const before = await evidence();
      await expect(pay(second, 4000, key)).rejects.toThrow("identyfikator");
      expect(await evidence()).toEqual(before);
    });
    it("retains money and completed meetings on whole cancellation pending an explicit settlement", async () => {
      const id = await active(),
        s = await pastMeeting(id);
      await sessionChange(s, 2, "complete", "present");
      const payment = await pay(id);
      await change(
        id,
        (await state(id)).version,
        "cancel",
        "Rezygnacja opiekuna",
        randomUUID(),
        owner,
      );
      expect(await balance(id)).toMatchObject({
        status: "cancelled",
        paid_cents: 10000,
        charge_cents: 10000,
        due_cents: 0,
        needs_settlement: true,
        completed_sessions: 1,
      });
      expect(
        (await sessions(id)).filter((s) => s.status === "cancelled"),
      ).toHaveLength(3);
      expect(
        (
          await db.query("select status from public.payments where id=$1", [
            payment,
          ])
        ).rows,
      ).toEqual([{ status: "paid" }]);
      await expect(pay(id, 1)).rejects.toThrow("uzgodnij");
      await settle(id, (await state(id)).version, 3000);
      expect(await balance(id)).toMatchObject({
        paid_cents: 10000,
        charge_cents: 3000,
        refund_due_cents: 7000,
        needs_settlement: false,
      });
    });
    it("returns only the recorded partial amount and routes a later full void through the refund ledger", async () => {
      const id = await active(),
        payment = await pay(id),
        key = randomUUID();
      expect(await refund(payment, 7000, key)).toBe(key);
      expect(await balance(id)).toMatchObject({
        paid_cents: 3000,
        refunded_cents: 7000,
        due_cents: 7000,
      });
      const before = await evidence();
      await expect(refund(payment, 3001)).rejects.toThrow("przekracza");
      await expect(refund(payment, 7000, key, colleague)).rejects.toThrow(
        "identyfikator",
      );
      expect(await evidence()).toEqual(before);
      expect(
        await rpc(admin, "void_payment", [
          payment,
          "Zwrot pozostałych środków",
        ]),
      ).toBe(payment);
      expect(await balance(id)).toMatchObject({
        paid_cents: 0,
        refunded_cents: 10000,
        due_cents: 10000,
      });
      const after = await evidence();
      expect(await refund(payment, 7000, key)).toBe(key);
      expect(
        await rpc(admin, "void_payment", [
          payment,
          "Zwrot pozostałych środków",
        ]),
      ).toBe(payment);
      expect(await evidence()).toEqual(after);
      expect(
        (
          await db.query(
            "select amount_cents,status from public.payments where id=$1",
            [payment],
          )
        ).rows,
      ).toEqual([{ amount_cents: 10000, status: "refunded" }]);
    });
    it("restores the frozen full package while retaining refunds, completed meetings and old settlement receipts", async () => {
      const id = await active(),
        s = await pastMeeting(id);
      await sessionChange(s, 2, "complete", "present");
      const payment = await pay(id);
      await change(id, (await state(id)).version, "cancel");
      const version = (await state(id)).version,
        key = randomUUID();
      await settle(id, version, 3000, key);
      await refund(payment, 7000);
      await change(id, (await state(id)).version, "restore");
      expect(await balance(id)).toMatchObject({
        status: "active",
        charge_cents: 10000,
        paid_cents: 3000,
        refunded_cents: 7000,
        due_cents: 7000,
        completed_sessions: 1,
        settled_at: null,
      });
      expect(
        (await sessions(id)).filter((s) => s.status === "pending"),
      ).toHaveLength(3);
      const before = await evidence();
      expect(await settle(id, version, 3000, key)).toBe(version + 1);
      expect(await evidence()).toEqual(before);
    });
    it("rejects stale settlement after a refund and forbids charging a never accepted request", async () => {
      const id = await active(),
        payment = await pay(id);
      await change(id, 3, "cancel");
      await refund(payment, 1000);
      const before = await evidence();
      await expect(settle(id, 4, 3000)).rejects.toThrow("Pakiet zmienił");
      expect(await evidence()).toEqual(before);
      await settle(id, 5, 3000);
      const second = await request();
      await change(second, 1, "cancel");
      await expect(settle(second, 2, 1)).rejects.toThrow(
        "wcześniej przyjętego",
      );
      await settle(second, 2, 0);
    });
    it("can reconsider a refusal without creating appointments or liability", async () => {
      const id = await request(),
        key = randomUUID();
      await change(id, 1, "reject");
      await change(id, 2, "reconsider", "Ponowne rozpatrzenie", key);
      expect(await sessions(id)).toHaveLength(0);
      expect(await balance(id)).toMatchObject({
        status: "requested",
        charge_cents: 0,
      });
      await change(id, 3, "accept");
      const before = await evidence();
      expect(
        await change(id, 2, "reconsider", "Ponowne rozpatrzenie", key),
      ).toBe(3);
      expect(await evidence()).toEqual(before);
      expect(await sessions(id)).toHaveLength(4);
    });
    it("refuses restoration into another active entitlement without changing either package", async () => {
      const first = await active();
      await change(first, 2, "cancel");
      const second = await active();
      const before = await evidence();
      await expect(change(first, 3, "restore")).rejects.toThrow("inne otwarte");
      expect(await evidence()).toEqual(before);
      expect(await state(second)).toMatchObject({ status: "active" });
    });
    it("freezes financial ownership and hides private meetings after a dog transfer", async () => {
      const id = await active(),
        s = (await sessions(id))[0];
      await schedule(s.id);
      const payment = await pay(id);
      await db.query("update public.dogs set guardian_id=$1 where id=$2", [
        other,
        dog,
      ]);
      expect(await balance(id, owner)).toMatchObject({
        guardian_id: owner,
        paid_cents: 10000,
      });
      expect(await balance(id, other)).toBeUndefined();
      for (const actor of [owner, other])
        expect(
          (
            await asUser(actor, () =>
              db.query("select * from public.fitness_session_private_details"),
            )
          ).rows,
        ).toHaveLength(0);
      await expect(schedule(s.id, 2)).rejects.toThrow("Opiekun psa zmienił");
      await change(id, (await state(id)).version, "cancel");
      await expect(
        change(id, (await state(id)).version, "restore"),
      ).rejects.toThrow("Opiekun psa zmienił");
      await refund(payment, 2000);
      expect(
        (
          await db.query(
            "select guardian_id from public.fitness_payment_refunds",
          )
        ).rows,
      ).toEqual([{ guardian_id: owner }]);
    });
    it("clears the current settlement when reconsidering a cancelled unaccepted request and retains its receipt", async () => {
      const id = await request();
      await change(id, 1, "cancel");
      const key = randomUUID();
      await settle(id, 2, 0, key);
      expect(await balance(id)).toMatchObject({
        status: "cancelled",
        charge_cents: 0,
      });
      await change(id, 3, "reconsider");
      expect(await balance(id)).toMatchObject({
        status: "requested",
        settled_at: null,
        charge_cents: 0,
      });
      await change(id, 4, "accept");
      expect(await balance(id)).toMatchObject({
        status: "active",
        settled_at: null,
        charge_cents: 10000,
      });
      const before = await evidence();
      expect(await settle(id, 2, 0, key)).toBe(3);
      expect(await evidence()).toEqual(before);
    });
    it("enforces nonnull fitness catalogue terms and matching payment-package refund references", async () => {
      await expect(
        db.query("update public.services set meeting_mode=null where id=$1", [
          service,
        ]),
      ).rejects.toThrow("service_fitness_terms");
      const first = await active(),
        second = await active(otherDog, other),
        payment = await pay(first);
      await expect(
        db.query(
          "insert into public.fitness_payment_refunds(id,payment_id,package_id,guardian_id,author_id,amount_cents,note,package_version) values($1,$2,$3,$4,$5,1,'Powód próby',1)",
          [randomUUID(), payment, second, owner, admin],
        ),
      ).rejects.toThrow("foreign key");
      expect(await balance(first)).toMatchObject({
        paid_cents: 10000,
        refunded_cents: 0,
      });
      expect(await balance(second, other)).toMatchObject({
        paid_cents: 0,
        refunded_cents: 0,
      });
    });
    it("rolls back all appointments, liability and receipts if history fails after acceptance", async () => {
      const id = await request();
      const before = await evidence();
      await db.exec(`create function public.fail_fitness_history() returns trigger language plpgsql as $$begin if new.action='accept' then raise exception 'Próbny błąd historii';end if;return new;end$$;
      create trigger fail_fitness_history before insert on public.fitness_history for each row execute function public.fail_fitness_history();`);
      try {
        await expect(change(id, 1, "accept")).rejects.toThrow(
          "Próbny błąd historii",
        );
        expect(await evidence()).toEqual(before);
      } finally {
        await db.exec(
          "drop trigger fail_fitness_history on public.fitness_history;drop function public.fail_fitness_history();",
        );
      }
    });
    it("rejects malformed money, blank reasons and another guardian's cancellation atomically", async () => {
      const id = await active(),
        before = await evidence();
      for (const amount of [null, 0, -1, 1000001])
        await expect(
          rpc(admin, "record_fitness_payment", [
            id,
            amount,
            "transfer",
            "",
            randomUUID(),
          ]),
        ).rejects.toThrow();
      await expect(change(id, 2, "cancel", "")).rejects.toThrow("powód");
      await expect(
        change(id, 2, "cancel", "Powód", randomUUID(), other),
      ).rejects.toThrow("Brak dostępu");
      await expect(settle(id, 2, 3000)).rejects.toThrow("rezygnacji");
      expect(await evidence()).toEqual(before);
    });
  },
);

type InboxRow = {
  id: string;
  kind: string;
  entity_id: string;
  fitness_package_id: string | null;
  fitness_session_id: string | null;
  dog_name: string;
  read_at: Date | null;
};
const inbox = async (actor: string, before: string | null = null) =>
  (
    await asUser(actor, () =>
      db.query<InboxRow>("select * from public.notification_feed('all',$1)", [
        before,
      ]),
    )
  ).rows;
const work = async (actor = admin) =>
  (
    await asUser(actor, () =>
      db.query<{ id: string; title: string; due_on: Date | null }>(
        "select * from public.staff_work_queue('fitness',0)",
      ),
    )
  ).rows;

describe.sequential("fitness meeting reminders and delivery", () => {
  const jobs = async () =>
    (
      await db.query<Record<string, unknown>>(
        "select * from public.reminder_jobs where kind='fitness' order by source_id,generation",
      )
    ).rows;
  const delivered = async () =>
    (
      await db.query<Record<string, unknown>>(
        "select * from public.notifications where kind='fitness_reminder' order by id",
      )
    ).rows;
  const dispatch = (actor = admin, limit = 50) =>
    rpc<Record<string, number>>(actor, "process_due_reminders", [limit]);
  const soon = () => new Date(Date.now() + 3 * 3600000).toISOString();

  it("creates no job before a confirmed date and preserves an exact scheduling retry", async () => {
    const id = await active(),
      s = (await sessions(id))[0];
    expect(await jobs()).toEqual([]);
    const starts = soon(),
      key = randomUUID();
    await schedule(s.id, 1, starts, key);
    const first = await jobs();
    expect(first).toMatchObject([
      {
        source_id: s.id,
        entity_id: id,
        fitness_package_id: id,
        fitness_session_id: s.id,
        generation: 1,
        status: "pending",
      },
    ]);
    await schedule(s.id, 1, starts, key);
    expect(await jobs()).toEqual(first);
    expect(await delivered()).toEqual([]);
  });

  it("keeps four independent dates and their 24-hour lead times, without early delivery", async () => {
    const id = await active(),
      meetings = await sessions(id);
    for (const [n, s] of meetings.entries())
      await schedule(
        s.id,
        1,
        new Date(Date.now() + (7 + n) * 86400000).toISOString(),
      );
    const rows = await jobs();
    expect(rows).toHaveLength(4);
    for (const row of rows)
      expect(
        new Date(row.target_at as string).getTime() -
          new Date(row.due_at as string).getTime(),
      ).toBe(86400000);
    expect(await dispatch()).toMatchObject({
      sent: 0,
      failed: 0,
      cancelled: 0,
    });
    expect(await delivered()).toEqual([]);
  });

  it("reschedules only the edited meeting and preserves reminders through payment and refund", async () => {
    const id = await active(),
      meetings = await sessions(id);
    await schedule(meetings[0].id);
    await schedule(
      meetings[1].id,
      1,
      new Date(Date.now() + 8 * 86400000).toISOString(),
    );
    const original = await jobs();
    const payment = await pay(id);
    await refund(payment, 2000);
    expect(await jobs()).toEqual(original);
    await schedule(
      meetings[0].id,
      2,
      new Date(Date.now() + 9 * 86400000).toISOString(),
    );
    const rows = await jobs();
    expect(rows.filter((j) => j.source_id === meetings[0].id)).toMatchObject([
      { generation: 1, status: "cancelled" },
      { generation: 2, status: "pending" },
    ]);
    expect(rows.find((j) => j.source_id === meetings[1].id)).toEqual(
      original.find((j) => j.source_id === meetings[1].id),
    );
  });

  it("delivers a late booking once to its frozen client with a safe meeting context", async () => {
    const id = await active(),
      s = (await sessions(id))[0];
    await schedule(s.id, 1, soon());
    expect(await dispatch()).toMatchObject({ sent: 1, failed: 0 });
    const first = await delivered();
    expect(first).toMatchObject([
      {
        recipient_id: owner,
        recipient_role: "client",
        entity_id: id,
        fitness_package_id: id,
        fitness_session_id: s.id,
        source_key: `reminder:${(await jobs())[0].id}`,
      },
    ]);
    expect(JSON.stringify(first)).not.toContain("PRYWATNY ADRES");
    expect(JSON.stringify(first)).not.toContain("Uzgodniony termin");
    expect(await dispatch()).toMatchObject({ sent: 0 });
    expect(await delivered()).toEqual(first);
    expect(await inbox(other)).toEqual([]);
    expect(
      await asUser(owner, () => db.query("select * from public.reminder_jobs")),
    ).toMatchObject({ rows: [] });
  });

  it("retains delivered history when a new date creates another distinct reminder", async () => {
    const id = await active(),
      s = (await sessions(id))[0];
    await schedule(s.id, 1, soon());
    await dispatch();
    const old = (await delivered())[0];
    await schedule(s.id, 2, new Date(Date.now() + 4 * 3600000).toISOString());
    expect(await dispatch()).toMatchObject({ sent: 1 });
    expect(await delivered()).toHaveLength(2);
    expect((await delivered()).find((n) => n.id === old.id)).toEqual(old);
    expect((await jobs()).map((j) => j.status)).toEqual(["sent", "sent"]);
  });

  it("withdraws cancelled dates and package jobs, with no resurrection before a new date", async () => {
    const id = await active(),
      meetings = await sessions(id);
    await schedule(meetings[0].id, 1, soon());
    await schedule(
      meetings[1].id,
      1,
      new Date(Date.now() + 4 * 3600000).toISOString(),
    );
    await sessionChange(meetings[0].id, 2, "cancel");
    expect((await jobs()).filter((j) => j.status === "pending")).toHaveLength(
      1,
    );
    await change(id, (await state(id)).version, "cancel");
    expect((await jobs()).every((j) => j.status === "cancelled")).toBe(true);
    await change(id, (await state(id)).version, "restore");
    expect((await jobs()).every((j) => j.status === "cancelled")).toBe(true);
    expect(await dispatch()).toMatchObject({ sent: 0 });
    const s = (await sessions(id))[0];
    await schedule(s.id, s.version, soon());
    expect(await dispatch()).toMatchObject({ sent: 1 });
  });

  it("withdraws a transfer immediately and never hands reminders to the new guardian", async () => {
    const id = await active(),
      s = (await sessions(id))[0];
    await schedule(s.id, 1, soon());
    await dispatch();
    await schedule(s.id, 2, new Date(Date.now() + 4 * 3600000).toISOString());
    const history = await delivered();
    await db.query("update public.dogs set guardian_id=$1 where id=$2", [
      other,
      dog,
    ]);
    expect((await jobs()).map((j) => j.status)).toEqual(["sent", "cancelled"]);
    expect(await dispatch()).toMatchObject({ sent: 0 });
    expect(await delivered()).toEqual(history);
    expect(
      (await inbox(owner)).filter((n) => n.kind === "fitness_reminder"),
    ).toHaveLength(1);
    expect(await inbox(other)).toEqual([]);
  });

  it("cancels a stale token, expired start and changed client role without an obsolete inbox message", async () => {
    const id = await active(),
      s = (await sessions(id))[0];
    await schedule(s.id, 1, soon());
    await db.exec(
      "update public.reminder_jobs set source_token='stale' where kind='fitness'",
    );
    expect(await dispatch()).toMatchObject({ sent: 0, cancelled: 1 });
    await schedule(s.id, 2, new Date(Date.now() + 4 * 3600000).toISOString());
    await db.query(
      "update public.user_roles set role='admin' where user_id=$1",
      [owner],
    );
    expect(await dispatch()).toMatchObject({ sent: 0, cancelled: 1 });
    await db.query(
      "update public.user_roles set role='client' where user_id=$1",
      [owner],
    );
    await schedule(s.id, 3, new Date(Date.now() + 5 * 3600000).toISOString());
    await db.query(
      "update public.fitness_sessions set starts_at=now()-interval '1 hour' where id=$1",
      [s.id],
    );
    // Recreate the pending state of a paused worker only in this isolated fixture.
    await db.exec(
      "update public.reminder_jobs set status='pending',next_attempt_at=now() where kind='fitness' and generation=3",
    );
    expect(await dispatch()).toMatchObject({ sent: 0, cancelled: 1 });
    expect(await delivered()).toEqual([]);
  });

  it("rolls back a failed delivery, caps retry cycles and delivers once after manual recovery", async () => {
    const id = await active(),
      s = (await sessions(id))[0];
    await schedule(s.id, 1, soon());
    await db.exec(`create function public.fail_fitness_reminder() returns trigger language plpgsql as $$begin if new.kind='fitness_reminder' then raise exception 'PRYWATNY BŁĄD DOSTARCZENIA';end if;return new;end$$;
      create trigger fail_fitness_reminder before insert on public.notifications for each row execute function public.fail_fitness_reminder();`);
    try {
      for (let n = 0; n < 5; n++) {
        await db.exec(
          "update public.reminder_jobs set next_attempt_at=now() where kind='fitness'",
        );
        expect(await dispatch()).toMatchObject({ sent: 0, failed: 1 });
        expect(await delivered()).toEqual([]);
      }
    } finally {
      await db.exec(
        "drop trigger fail_fitness_reminder on public.notifications;drop function public.fail_fitness_reminder()",
      );
    }
    const job = (await jobs())[0];
    expect(job).toMatchObject({
      status: "failed",
      attempts: 5,
      cycle_attempts: 5,
      last_error_code: "delivery_failed",
    });
    const attempts = (
      await db.query("select * from public.reminder_attempts order by attempt")
    ).rows;
    expect(attempts).toHaveLength(5);
    expect(JSON.stringify(attempts)).not.toContain("PRYWATNY");
    expect(await rpc(admin, "retry_reminder", [job.id, 5])).toBe(true);
    expect(await rpc(admin, "retry_reminder", [job.id, 5])).toBe(false);
    expect(await dispatch()).toMatchObject({ sent: 1, failed: 0 });
    expect((await jobs())[0]).toMatchObject({
      status: "sent",
      attempts: 6,
      cycle_attempts: 1,
    });
    expect(await delivered()).toHaveLength(1);
  });

  it("denies clients, direct writes and private helper execution, and rejects mismatched context", async () => {
    const id = await active(),
      s = (await sessions(id))[0];
    await schedule(s.id, 1, soon());
    await expect(dispatch(owner)).rejects.toThrow("Brak uprawnień");
    await expect(
      asUser(admin, () =>
        db.exec("update public.reminder_jobs set status='sent'"),
      ),
    ).rejects.toThrow(/permission denied/);
    await expect(
      asUser(admin, () =>
        db.query("select public.sync_fitness_reminders($1)", [id]),
      ),
    ).rejects.toThrow(/permission denied/);
    await expect(
      db.query(
        "update public.reminder_jobs set entity_id=$1 where kind='fitness'",
        [randomUUID()],
      ),
    ).rejects.toThrow(/reminder_fitness_context/);
    const second = await active(otherDog, other),
      wrong = (await sessions(second))[0];
    await expect(
      db.query(
        "update public.reminder_jobs set fitness_session_id=$1,source_id=$1 where kind='fitness'",
        [wrong.id],
      ),
    ).rejects.toThrow(/reminder_fitness_session/);
    expect(await delivered()).toEqual([]);
  });
});

describe.sequential("fitness work and private transactional inbox", () => {
  it("notifies staff about a request and the guardian about acceptance without self messages or retry duplicates", async () => {
    const id = randomUUID();
    await request(id);
    await request(id);
    expect(await inbox(owner)).toEqual([]);
    for (const staff of [admin, colleague])
      expect(await inbox(staff)).toMatchObject([
        { kind: "fitness_requested", entity_id: id, fitness_package_id: id },
      ]);
    const key = randomUUID();
    await change(id, 1, "accept", "Uzgodnione", key);
    await change(id, 1, "accept", "Uzgodnione", key);
    expect(await inbox(owner)).toMatchObject([{ kind: "fitness_accepted" }]);
    expect(await inbox(admin)).toHaveLength(1);
    expect(await inbox(colleague)).toHaveLength(2);
    expect(await inbox(other)).toEqual([]);
  });

  it("routes meeting changes to the exact session and never stores private notes or places in an inbox row", async () => {
    const id = await active(),
      s = (await sessions(id))[0];
    const key = randomUUID(),
      start = future();
    await schedule(
      s.id,
      1,
      start,
      key,
      "TAJNE MIEJSCE FITNESS",
      admin,
      "PRYWATNA NOTATKA",
    );
    await schedule(
      s.id,
      1,
      start,
      key,
      "TAJNE MIEJSCE FITNESS",
      admin,
      "PRYWATNA NOTATKA",
    );
    await schedule(
      s.id,
      2,
      start,
      randomUUID(),
      "INNE TAJNE MIEJSCE",
      admin,
      "Zmiana miejsca",
    );
    await sessionChange(s.id, 3, "cancel");
    expect((await inbox(owner)).map((n) => n.kind)).toEqual([
      "fitness_session_cancelled",
      "fitness_session_rescheduled",
      "fitness_session_scheduled",
      "fitness_accepted",
    ]);
    expect(
      (await inbox(owner))
        .slice(0, 3)
        .every((n) => n.fitness_session_id === s.id && n.entity_id === id),
    ).toBe(true);
    const stored = JSON.stringify(
      (await db.query("select * from public.notifications")).rows,
    );
    for (const secret of ["TAJNE", "PRYWATNA", "Zmiana miejsca"])
      expect(stored).not.toContain(secret);
  });

  it("publishes attendance completion, correction and explicit replacement as distinct events", async () => {
    const id = await active(),
      session = await pastMeeting(id);
    await sessionChange(session, 2, "complete", "absent");
    await sessionChange(session, 3, "correct", "excused");
    await sessionChange(session, 4, "reopen");
    expect((await inbox(owner)).slice(0, 3).map((n) => n.kind)).toEqual([
      "fitness_session_reopened",
      "fitness_attendance_corrected",
      "fitness_session_completed",
    ]);
    expect(
      (await inbox(owner))
        .slice(0, 3)
        .every((n) => n.fitness_session_id === session),
    ).toBe(true);
  });

  it("delivers each actual payment and partial refund once, with no duplicate legacy cash message", async () => {
    const id = await active(),
      key = randomUUID();
    const payment = await pay(id, 10000, key);
    expect(await pay(id, 10000, key)).toBe(payment);
    await change(id, (await state(id)).version, "cancel");
    await settle(id, (await state(id)).version, 3000);
    const refundKey = randomUUID();
    const first = await refund(payment, 2000, refundKey);
    expect(await refund(payment, 2000, refundKey)).toBe(first);
    await refund(payment, 5000);
    const kinds = (await inbox(owner)).map((n) => n.kind);
    expect(kinds.filter((k) => k === "fitness_payment_recorded")).toHaveLength(
      1,
    );
    expect(kinds.filter((k) => k === "fitness_payment_refunded")).toHaveLength(
      2,
    );
    expect(kinds).toContain("fitness_settled");
    expect(kinds).not.toContain("payment_recorded");
    expect(kinds).not.toContain("payment_refunded");
    expect(await balance(id)).toMatchObject({
      paid_cents: 3000,
      refund_due_cents: 0,
    });
  });

  it("keeps the frozen guardian inbox after transfer without exposing it to the new guardian or letting mixed reads partially commit", async () => {
    const id = await active(),
      notice = (await inbox(owner))[0];
    await db.query("update public.dogs set guardian_id=$1 where id=$2", [
      other,
      dog,
    ]);
    expect(await inbox(other)).toEqual([]);
    expect(await inbox(owner)).toMatchObject([
      { id: notice.id, fitness_package_id: id, dog_name: "Pies zgłoszenia" },
    ]);
    await expect(
      rpc(other, "read_notifications", [[notice.id]]),
    ).rejects.toThrow("Twoich powiadomień");
    const foreign = (await inbox(colleague))[0];
    await expect(
      rpc(owner, "read_notifications", [[notice.id, foreign.id]]),
    ).rejects.toThrow("Twoich powiadomień");
    expect((await inbox(owner))[0].read_at).toBeNull();
    expect(await rpc(owner, "read_notifications", [[notice.id]])).toBe(1);
    expect(await rpc(owner, "read_notifications", [[notice.id]])).toBe(0);
    expect((await inbox(owner))[0].read_at).not.toBeNull();
    await db.query(
      "update public.user_roles set role='admin' where user_id=$1",
      [owner],
    );
    try {
      expect(await inbox(owner)).toEqual([]);
    } finally {
      await db.query(
        "update public.user_roles set role='client' where user_id=$1",
        [owner],
      );
    }
  });

  it("rejects a mismatched session, a missing package context and direct authenticated inbox writes", async () => {
    const id = await active(),
      second = await active(otherDog, other);
    const s = (await sessions(second))[0];
    const insert =
      "insert into public.notifications(recipient_id,recipient_role,dog_id,entity_id,kind,source_key,fitness_package_id,fitness_session_id) values($1,'client',$2,$3,'fitness_session_scheduled',$4,$5,$6)";
    await expect(
      db.query(insert, [owner, dog, id, randomUUID(), id, s.id]),
    ).rejects.toThrow("foreign key");
    await expect(
      db.query(insert, [owner, dog, id, randomUUID(), null, null]),
    ).rejects.toThrow("notification_fitness_context");
    await expect(
      asUser(owner, () =>
        db.query(insert, [owner, dog, id, randomUUID(), id, null]),
      ),
    ).rejects.toThrow("permission denied");
    for (const role of ["anon", "authenticated"])
      expect(
        (
          await db.query(
            "select has_function_privilege($1,'public.add_fitness_notification(uuid,uuid,uuid,uuid,text,text)','execute') allowed",
            [role],
          )
        ).rows,
      ).toEqual([{ allowed: false }]);
  });

  it("paginates the complete fitness inbox and leaves rows beyond the current read page unread", async () => {
    const id = await active();
    for (let n = 0; n < 45; n++) await pay(id, 1);
    const first = await inbox(owner);
    expect(first).toHaveLength(21);
    expect(
      await rpc(owner, "read_notifications", [
        first.slice(0, 20).map((n) => n.id),
      ]),
    ).toBe(20);
    const second = await inbox(owner, first[19].id);
    const third = await inbox(owner, second[19].id);
    const ids = [...first.slice(0, 20), ...second.slice(0, 20), ...third].map(
      (n) => n.id,
    );
    expect(new Set(ids).size).toBe(46);
    expect(
      (
        await asUser(owner, () =>
          db.query(
            "select count(*)::integer total from public.notifications where read_at is null",
          ),
        )
      ).rows,
    ).toEqual([{ total: 26 }]);
  });

  it("queues one package through decision, remaining dates, late attendance and final closure", async () => {
    const id = await request();
    expect(await work()).toMatchObject([
      { id, title: "Rozpatrz zgłoszenie fitness" },
    ]);
    await change(id, 1, "accept");
    expect(await work()).toMatchObject([
      { id, title: "Ustal pozostałe terminy fitness" },
    ]);
    const meetings = await sessions(id);
    for (let n = 0; n < meetings.length; n++)
      await schedule(
        meetings[n].id,
        1,
        new Date(Date.now() + (7 + n) * 86400000).toISOString(),
      );
    expect(await work()).toEqual([]);
    await db.query(
      "update public.fitness_sessions set starts_at=now()-interval '2 days' where id=$1",
      [meetings[0].id],
    );
    expect(await work()).toMatchObject([
      { id, title: "Zapisz obecność zakończonego spotkania fitness" },
    ]);
    expect(
      (
        await asUser(admin, () =>
          db.query(
            "select total::integer,overdue::integer from public.staff_work_counts() where kind='fitness'",
          ),
        )
      ).rows,
    ).toEqual([{ total: 1, overdue: 1 }]);
    for (let n = 0; n < meetings.length; n++) {
      if (n > 0)
        await db.query(
          "update public.fitness_sessions set starts_at=now()-make_interval(days=>$2) where id=$1",
          [meetings[n].id, 2 + n],
        );
      await sessionChange(meetings[n].id, 2, "complete", "present");
    }
    expect(await work()).toMatchObject([
      { id, title: "Zakończ obsłużony pakiet fitness" },
    ]);
    await change(id, (await state(id)).version, "complete");
    expect(await work()).toEqual([]);
    expect(await balance(id)).toMatchObject({ due_cents: 10000 });
  });

  it("keeps cancelled packages actionable until settlement and an actual refund, then returns restored dates to the queue", async () => {
    const id = await active(),
      payment = await pay(id);
    await change(id, (await state(id)).version, "cancel");
    expect(await work()).toMatchObject([
      { id, title: "Uzgodnij należność po rezygnacji z fitness" },
    ]);
    await settle(id, (await state(id)).version, 3000);
    expect(await work()).toMatchObject([
      { id, title: "Odnotuj uzgodniony zwrot za fitness" },
    ]);
    await refund(payment, 7000);
    expect(await work()).toEqual([]);
    await change(id, (await state(id)).version, "restore");
    expect(await work()).toMatchObject([
      { id, title: "Ustal pozostałe terminy fitness" },
    ]);
    expect((await inbox(owner))[0].kind).toBe("fitness_reopened");
    await expect(work(owner)).rejects.toThrow("Brak uprawnień");
  });

  it("rolls back acceptance, meetings, money and receipts when transactional notification delivery fails", async () => {
    const id = await request(),
      before = await evidence();
    await db.exec(`create function public.fail_fitness_notice() returns trigger language plpgsql as $$begin if new.kind='fitness_accepted' then raise exception 'Próbny błąd skrzynki';end if;return new;end$$;
      create trigger fail_fitness_notice before insert on public.notifications for each row execute function public.fail_fitness_notice();`);
    try {
      await expect(change(id, 1, "accept")).rejects.toThrow(
        "Próbny błąd skrzynki",
      );
      expect(await evidence()).toEqual(before);
      expect(await work()).toMatchObject([
        { id, title: "Rozpatrz zgłoszenie fitness" },
      ]);
    } finally {
      await db.exec(
        "drop trigger fail_fitness_notice on public.notifications;drop function public.fail_fitness_notice();",
      );
    }
  });
});
