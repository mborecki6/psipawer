import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, it } from "vitest";

const change = "202610020004_pilot_read_policies.sql";
const admin = randomUUID(),
  owner = randomUUID(),
  other = randomUUID();
const dogs = [randomUUID(), randomUUID()];
const tables = [
  "profiles",
  "user_roles",
  "dogs",
  "walk_registrations",
  "walks",
  "walk_private_details",
  "dog_notes",
  "packages",
  "package_transactions",
  "payments",
  "consultations",
  "care_plan_versions",
  "care_progress",
  "care_follow_ups",
  "consultation_balances",
];
let db: PGlite;
const previous = new Map<string, Record<string, unknown[]>>();

async function visibility(user: string) {
  await db.exec("begin; set local role authenticated;");
  await db.query("select set_config('request.jwt.claim.sub',$1,true)", [user]);
  try {
    const result: Record<string, unknown[]> = {};
    for (const table of tables) {
      const column =
        table === "user_roles"
          ? "user_id"
          : table === "walk_private_details"
            ? "walk_id"
            : "id";
      result[table] = (
        await db.query(
          `select ${column} from public.${table} order by ${column}`,
        )
      ).rows;
    }
    await db.exec("commit");
    return result;
  } catch (error) {
    await db.exec("rollback");
    throw error;
  }
}

beforeAll(async () => {
  db = new PGlite();
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
  for (const file of readdirSync("supabase/migrations")
    .filter((f) => f.endsWith(".sql") && f !== change)
    .sort())
    await db.exec(readFileSync(`supabase/migrations/${file}`, "utf8"));
  await db.query("insert into auth.users(id) values($1),($2),($3)", [
    admin,
    owner,
    other,
  ]);
  await db.query("update public.user_roles set role='admin' where user_id=$1", [
    admin,
  ]);
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
    admin,
  ]);
  for (const [i, user] of [owner, other].entries()) {
    await db.query(
      "insert into public.dogs(id,guardian_id,name,status) values($1,$2,'Test prywatności','approved')",
      [dogs[i], user],
    );
    for (const visibility of ["admin_only", "client_visible"])
      await db.query(
        "insert into public.dog_notes(dog_id,author_id,body,visibility) values($1,$2,'Notatka testowa',$3::public.note_visibility)",
        [dogs[i], admin, visibility],
      );
    const pkg = randomUUID();
    await db.query(
      "insert into public.packages(id,dog_id,name,price_cents) values($1,$2,'Pakiet testowy',10000)",
      [pkg, dogs[i]],
    );
    await db.query(
      "insert into public.package_transactions(package_id,available_delta,reason,author_id) values($1,4,'Przyznanie',$2)",
      [pkg, admin],
    );
    await db.query(
      "insert into public.payments(guardian_id,dog_id,package_id,amount_cents,method,status,author_id,request_id) values($1,$2,$3,10000,'transfer','paid',$4,$5)",
      [user, dogs[i], pkg, admin, randomUUID()],
    );
    await db.query(
      "insert into public.consultations(id,practice_id,dog_id,requested_by,topic) values($1,'00000000-0000-4000-8000-000000000001',$2,$3,'Testowa konsultacja')",
      [randomUUID(), dogs[i], user],
    );
    const plan = await db.query<{ id: string }>(
      "insert into public.care_plan_versions(practice_id,dog_id,revision,source_version,title,body,follow_up_on,published_by) values('00000000-0000-4000-8000-000000000001',$1,1,0,'Plan testowy','Fikcyjna treść',current_date+7,$2) returning id",
      [dogs[i], admin],
    );
    await db.query(
      "insert into public.care_progress(id,practice_id,dog_id,plan_id,author_id,attempted) values($1,'00000000-0000-4000-8000-000000000001',$2,$3,$4,'Odpowiedź testowa')",
      [randomUUID(), dogs[i], plan.rows[0].id, user],
    );
  }
  let index = 0;
  for (const status of [
    "draft",
    "open",
    "full",
    "closed",
    "completed",
    "cancelled",
  ])
    for (const mode of ["approval", "automatic", "invite"])
      for (const registration of ["none", "accepted", "withdrawn"]) {
        const walk = randomUUID();
        await db.query(
          "insert into public.walks(id,starts_at,public_location,type,price_cents,capacity,status,booking_mode) values($1,now()+interval '100 days'+$2*interval '3 hours','Park testowy','Spacer',10000,2,$3::public.walk_status,$4::public.booking_mode)",
          [walk, index++, status, mode],
        );
        await db.query(
          "insert into public.walk_private_details(walk_id,exact_location) values($1,'Prywatne miejsce')",
          [walk],
        );
        if (registration !== "none")
          await db.query(
            "insert into public.walk_registrations(walk_id,dog_id,status) values($1,$2,$3::public.registration_status)",
            [walk, dogs[0], registration],
          );
      }
  for (const user of [admin, owner, other])
    previous.set(user, await visibility(user));
  await db.exec(readFileSync(`supabase/migrations/${change}`, "utf8"));
});
afterAll(async () => db?.close());

it.each([admin, owner, other])(
  "preserves the prior visible records for each role and all walk status/mode/registration combinations: %s",
  async (user) => {
    const current = await visibility(user);
    expect(current).toEqual(previous.get(user));
    if (user !== admin) {
      expect(current.dogs).toHaveLength(1);
      expect(current.packages).toHaveLength(1);
      expect(current.payments).toHaveLength(1);
      expect(current.care_plan_versions).toHaveLength(1);
      expect(current.dog_notes).toHaveLength(1);
    }
    if (user === other) expect(current.walk_private_details).toEqual([]);
  },
);
it("still denies all personal records to anonymous requests", async () => {
  await db.exec("begin; set local role anon");
  try {
    await expect(db.query("select * from public.dogs")).rejects.toThrow(
      /permission denied/,
    );
  } finally {
    await db.exec("rollback");
  }
});
