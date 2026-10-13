import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { beforeAll, beforeEach, afterAll, expect, it } from "vitest";
let db: PGlite;
const admin = "10000000-0000-4000-8000-000000000001";
const owner = "10000000-0000-4000-8000-000000000002";
const stranger = "10000000-0000-4000-8000-000000000003";
const dog = "20000000-0000-4000-8000-000000000001";
const otherDog = "20000000-0000-4000-8000-000000000002";
const meeting = "80000000-0000-4000-8000-000000000001";
const another = "80000000-0000-4000-8000-000000000002";
const migration = "202610130001_care_contexts.sql";
type Saved = { version: number; published_id: string | null };
let before: Record<string, unknown[]>;
let after: Record<string, unknown[]>;
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
async function save(
  association: string | null = null,
  version = 0,
  publish = true,
  body = "Ogólny tekst planu",
  due = "2099-01-01",
) {
  return (
    await asUser(admin, () =>
      db.query<{ result: Saved }>(
        "select public.save_care_plan($1,$2,'Tytuł planu',$3,$4,$5,$6) result",
        [dog, version, body, due, publish, association],
      ),
    )
  ).rows[0].result;
}
async function snapshot() {
  const tables = [
    "care_drafts",
    "care_plan_versions",
    "care_progress",
    "care_follow_ups",
    "care_follow_up_history",
    "care_events",
    "notifications",
  ];
  return Object.fromEntries(
    await Promise.all(
      tables.map(async (table) => [
        table,
        (
          await db.query<{ row: unknown }>(
            `select to_jsonb(t) - 'context_key' - case when '${table}'='care_drafts' then 'id' else '_unused' end row from public.${table} t order by to_jsonb(t)::text`,
          )
        ).rows.map((r) => r.row),
      ]),
    ),
  ) as Record<string, unknown[]>;
}
async function meetings() {
  await db.query(
    `insert into public.consultations(id,practice_id,dog_id,requested_by,topic,status,starts_at,duration_minutes,meeting_mode,location)
    values($1,'00000000-0000-4000-8000-000000000001',$3,$4,'Spotkanie A','completed',now()-interval '2 days',60,'in_person','Miejsce'),
    ($2,'00000000-0000-4000-8000-000000000001',$3,$4,'Spotkanie B','completed',now()-interval '1 day',60,'in_person','Miejsce')`,
    [meeting, another, dog, owner],
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
    .filter((name) => name.endsWith(".sql"))
    .sort();
  for (const name of names.filter((name) => name < migration))
    await db.exec(readFileSync(`supabase/migrations/${name}`, "utf8"));
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
  await meetings();
  const first = await save(meeting, 0, true, "Historyczna konsultacja A");
  await save(another, 1, true, "Historyczna konsultacja B");
  await save(another, 2, false, "Prywatne zmiany bieżącego szkicu");
  await asUser(owner, () =>
    db.query(
      "select public.submit_care_progress($1,$2,'Odpowiedź historyczna','','')",
      [randomUUID(), first.published_id],
    ),
  );
  before = await snapshot();
  await db.exec(readFileSync(`supabase/migrations/${migration}`, "utf8"));
  after = await snapshot();
  for (const name of names.filter((name) => name > migration))
    await db.exec(readFileSync(`supabase/migrations/${name}`, "utf8"));
});
beforeEach(async () => {
  await db.exec(
    "truncate public.consultations,public.care_drafts,public.care_plan_versions,public.care_events,public.care_progress,public.care_follow_ups,public.care_follow_up_history cascade; delete from public.notifications; delete from public.audit_events;",
  );
  await meetings();
});
afterAll(async () => {
  await db?.close();
});
it("migrates immutable evidence and restores only absent context drafts without events", () => {
  for (const table of Object.keys(before).filter(
    (table) => table !== "care_drafts",
  ))
    expect(after[table]).toEqual(before[table]);
  expect(after.care_drafts).toHaveLength(2);
  expect(after.care_drafts).toEqual(expect.arrayContaining(before.care_drafts));
  expect(after.care_drafts).toContainEqual(
    expect.objectContaining({
      consultation_id: meeting,
      body: "Historyczna konsultacja A",
      version: 1,
      updated_by: admin,
      updated_at: (
        before.care_plan_versions.find(
          (row) =>
            (row as { consultation_id: string }).consultation_id === meeting,
        ) as { published_at: string }
      ).published_at,
    }),
  );
});
it("keeps independent drafts, conflicts and publication retries for equal source versions", async () => {
  await save(meeting, 0, false, "Treść pierwszej konsultacji");
  await save(another, 0, false, "Treść drugiej konsultacji");
  await save(null, 0, false, "Treść ogólnego planu");
  const original = await snapshot();
  await expect(save(meeting, 0, false, "Nieaktualny zapis")).rejects.toThrow(
    "Plan zmienił się",
  );
  expect(await snapshot()).toEqual(original);
  const a = await save(meeting, 1, true, "Treść pierwszej konsultacji");
  const b = await save(another, 1, true, "Treść drugiej konsultacji");
  const g = await save(null, 1, true, "Treść ogólnego planu");
  expect(new Set([a.published_id, b.published_id, g.published_id]).size).toBe(
    3,
  );
  const once = await snapshot();
  expect(await save(meeting, 1, true, "Treść pierwszej konsultacji")).toEqual(
    a,
  );
  expect(await save(another, 1, true, "Treść drugiej konsultacji")).toEqual(b);
  expect(await snapshot()).toEqual(once);
  expect(
    (
      await db.query(
        "select revision from public.care_plan_versions order by revision",
      )
    ).rows,
  ).toEqual([{ revision: 1 }, { revision: 2 }, { revision: 3 }]);
});
it("supersedes only the selected context and keeps another context actionable", async () => {
  const a = await save(meeting, 0, true, "Pierwsza konsultacja");
  const b = await save(another, 0, true, "Druga konsultacja");
  await save(meeting, 1, true, "Nowa wersja pierwszej konsultacji");
  expect(
    (
      await db.query(
        "select plan_id,status from public.care_follow_ups where plan_id in ($1,$2) order by plan_id",
        [a.published_id, b.published_id],
      )
    ).rows,
  ).toEqual(
    expect.arrayContaining([
      { plan_id: a.published_id, status: "superseded" },
      { plan_id: b.published_id, status: "open" },
    ]),
  );
  const contact = (
    await db.query<{ id: string }>(
      "select id from public.care_follow_ups where plan_id=$1",
      [b.published_id],
    )
  ).rows[0];
  await asUser(admin, () =>
    db.query(
      "select public.change_care_follow_up($1,1,'completed',null,'Kontrola zakończona')",
      [contact.id],
    ),
  );
  await asUser(admin, () =>
    db.query(
      "select public.change_care_follow_up($1,2,'reopened','2099-01-03','Ponowna kontrola')",
      [contact.id],
    ),
  );
  expect(
    (
      await db.query(
        "select status,version from public.care_follow_ups where id=$1",
        [contact.id],
      )
    ).rows,
  ).toEqual([{ status: "open", version: 3 }]);
});
it("exposes each current context and scopes unread counts and client draft privacy", async () => {
  const a = await save(meeting, 0, true, "Pierwsza konsultacja");
  await save(another, 0, true, "Druga konsultacja");
  await save(null, 0, false, "Prywatny ogólny szkic");
  await asUser(owner, () =>
    db.query(
      "select public.submit_care_progress($1,$2,'Nasze postępy','','')",
      [randomUUID(), a.published_id],
    ),
  );
  const staff = (
    await asUser(admin, () =>
      db.query<{ context_key: string; has_draft: boolean }>(
        "select * from public.dog_care_contexts($1)",
        [dog],
      ),
    )
  ).rows;
  expect(staff).toHaveLength(3);
  expect(staff.every((row) => row.has_draft)).toBe(true);
  const own = (
    await asUser(owner, () =>
      db.query<{ has_draft: boolean }>(
        "select * from public.dog_care_contexts($1)",
        [dog],
      ),
    )
  ).rows;
  expect(own).toHaveLength(2);
  expect(own.every((row) => !row.has_draft)).toBe(true);
  expect(
    (
      await asUser(stranger, () =>
        db.query("select * from public.dog_care_contexts($1)", [dog]),
      )
    ).rows,
  ).toEqual([]);
  const summaries = (
    await asUser(admin, () =>
      db.query<{ id: string; unread_count: number }>(
        "select * from public.care_plan_summaries()",
      ),
    )
  ).rows;
  expect(summaries).toHaveLength(2);
  expect(
    Number(summaries.find((row) => row.id === a.published_id)?.unread_count),
  ).toBe(1);
  expect(
    Number(summaries.find((row) => row.id !== a.published_id)?.unread_count),
  ).toBe(0);
});

it("keeps one unambiguous follow-up publication relationship with dog and context integrity", async () => {
  const keys = (
    await db.query<{
      columns: string[];
    }>(`select array_agg(a.attname order by k.ordinality) columns
    from pg_constraint c join unnest(c.conkey) with ordinality k(attnum,ordinality) on true
    join pg_attribute a on a.attrelid=c.conrelid and a.attnum=k.attnum
    where c.contype='f' and c.conrelid='public.care_follow_ups'::regclass and c.confrelid='public.care_plan_versions'::regclass
    group by c.oid`)
  ).rows;
  expect(keys).toEqual([
    { columns: ["plan_id", "dog_id", "practice_id", "context_key"] },
  ]);
});
