import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
let db: PGlite;
const admin = "84000000-0000-4000-8000-000000000001",
  owner = "84000000-0000-4000-8000-000000000002",
  other = "84000000-0000-4000-8000-000000000003";
const dog = "85000000-0000-4000-8000-000000000001",
  otherDog = "85000000-0000-4000-8000-000000000002";
const service = "60000000-0000-4000-8000-000000000003",
  catalogue = "86000000-0000-4000-8000-000000000001";
async function user<T>(id: string, run: () => Promise<T>) {
  await db.exec("begin;set local role authenticated;");
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
async function request(
  id: string = randomUUID(),
  actor = owner,
  dogId = dog,
  serviceId = service,
  message = "Prywatna prośba opiekuna",
) {
  return (
    await user(actor, () =>
      db.query<{ id: string }>(
        "select public.request_service_date($1,$2,$3,$4,'Wtorki po 17') id",
        [id, serviceId, dogId, message],
      ),
    )
  ).rows[0].id;
}
async function change(
  id: string,
  actor = admin,
  action = "handled",
  version = 1,
  note = "Uzgodniono dalsze kroki w aplikacji",
) {
  return (
    await user(actor, () =>
      db.query<{ version: number }>(
        "select public.change_service_request($1,$2,$3,$4) version",
        [id, version, action, note],
      ),
    )
  ).rows[0].version;
}
async function rows(actor = owner) {
  return (
    await user(actor, () =>
      db.query<Record<string, unknown>>(
        "select * from public.service_requests order by created_at",
      ),
    )
  ).rows;
}
async function events(actor = owner) {
  return (
    await user(actor, () =>
      db.query<Record<string, unknown>>(
        "select * from public.service_request_history order by created_at",
      ),
    )
  ).rows;
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
    .filter(
      (file) =>
        file.endsWith(".sql") &&
        (file <= "202610100001_calendar_team.sql" ||
          file === "202610130004_service_requests.sql"),
    )
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
  await db.query(
    "insert into public.dogs(id,guardian_id,name) values($1,$2,'Figa'),($3,$4,'Cudzy pies')",
    [dog, owner, otherDog, other],
  );
  await db.query(
    "insert into public.services(id,practice_id,name,kind,booking_flow,price_cents,price_unit,source_url) select $1,practice_id,'Usługa indywidualna','individual','catalogue',price_cents,price_unit,source_url from public.services where id=$2",
    [catalogue, service],
  );
}, 60000);
beforeEach(async () => {
  await db.exec(
    "truncate public.service_request_receipts,public.service_request_history,public.service_requests,public.courses cascade;",
  );
  await db.query("update public.services set active=true where id in ($1,$2)", [
    service,
    catalogue,
  ]);
  await db.query("update public.dogs set guardian_id=$1 where id=$2", [
    owner,
    dog,
  ]);
});
afterAll(async () => {
  await db?.close();
});
describe.sequential("private requests to arrange an individual service", () => {
  it("isolates guardian data/history, enforces ownership and denies direct writes", async () => {
    const id = await request();
    expect(await rows()).toHaveLength(1);
    expect(await rows(other)).toEqual([]);
    expect(await rows(admin)).toHaveLength(1);
    expect(await events(other)).toEqual([]);
    await expect(request(randomUUID(), other, dog)).rejects.toThrow(
      "swojego psa",
    );
    await expect(change(id, other, "cancelled")).rejects.toThrow(
      "Nie znaleziono",
    );
    await expect(
      user(owner, () =>
        db.query(
          "update public.service_requests set status='handled' where id=$1",
          [id],
        ),
      ),
    ).rejects.toThrow("permission denied");
    await expect(
      user(owner, () =>
        db.query("select * from public.service_request_receipts"),
      ),
    ).rejects.toThrow("permission denied");
  });
  it("makes UUID retries and two separate forms return one request without replacing its message", async () => {
    const first = randomUUID(),
      second = randomUUID();
    expect(await request(first)).toBe(first);
    expect(await request(first)).toBe(first);
    expect(
      await request(second, owner, dog, service, "Treść z drugiej karty"),
    ).toBe(first);
    expect((await rows())[0].message).toBe("Prywatna prośba opiekuna");
    expect(await rows()).toHaveLength(1);
    expect(await events()).toHaveLength(1);
    await expect(
      request(first, owner, dog, service, "Inna treść dla tego UUID"),
    ).rejects.toThrow("identyfikator");
    await change(first);
    expect(
      await request(second, owner, dog, service, "Treść z drugiej karty"),
    ).toBe(first);
    const third = await request();
    expect(third).not.toBe(first);
    expect((await rows()).filter((row) => row.status === "open")).toHaveLength(
      1,
    );
  });
  it("requires staff to handle, saves an explicit note and safely retries a status transition", async () => {
    const id = await request();
    await expect(change(id, owner)).rejects.toThrow("Brak uprawnień");
    await expect(change(id, admin, "handled", 1, " ")).rejects.toThrow(
      "notatkę",
    );
    expect(await change(id)).toBe(2);
    expect(await change(id)).toBe(2);
    expect((await rows())[0]).toMatchObject({
      status: "handled",
      version: 2,
      resolution_note: "Uzgodniono dalsze kroki w aplikacji",
      message: "Prywatna prośba opiekuna",
    });
    expect((await events()).map((event) => event.action)).toEqual([
      "requested",
      "handled",
    ]);
    await expect(
      change(id, admin, "handled", 1, "Inna decyzja"),
    ).rejects.toThrow("zmieniło się");
    await expect(change(id, owner, "cancelled", 1)).rejects.toThrow(
      "zmieniło się",
    );
  });
  it("lets the guardian cancel, retains history and allows a fresh request afterwards", async () => {
    const id = await request();
    await expect(change(id, admin, "cancelled")).rejects.toThrow(
      "Brak uprawnień",
    );
    expect(await change(id, owner, "cancelled")).toBe(2);
    expect(await change(id, owner, "cancelled")).toBe(2);
    expect(await request(id)).toBe(id);
    expect(await request()).not.toBe(id);
    expect((await rows()).map((row) => row.status)).toEqual([
      "cancelled",
      "open",
    ]);
    expect((await events()).map((event) => event.action)).toEqual([
      "requested",
      "cancelled",
      "requested",
    ]);
  });
  it("removes both old and new guardian access to earlier private messages after ownership changes", async () => {
    const id = await request();
    await db.query("update public.dogs set guardian_id=$1 where id=$2", [
      other,
      dog,
    ]);
    expect(await rows()).toEqual([]);
    expect(await events()).toEqual([]);
    expect(await rows(other)).toEqual([]);
    await expect(change(id, owner, "cancelled")).rejects.toThrow(
      "Nie znaleziono",
    );
    await expect(request(id, owner, dog)).rejects.toThrow("swojego psa");
    await expect(request(randomUUID(), other, dog)).rejects.toThrow(
      "kontaktu z prowadzącą",
    );
    await change(id);
    await request(randomUUID(), other, dog);
    expect(await rows(other)).toHaveLength(1);
    expect(await rows(admin)).toHaveLength(2);
  });
  it("accepts only appropriate active individual services and never creates a booking, enrollment or price", async () => {
    await request(randomUUID(), owner, dog, catalogue);
    await db.query("update public.services set active=false where id=$1", [
      service,
    ]);
    await expect(request()).rejects.toThrow("nie jest dostępna");
    for (const suffix of ["000001", "000007", "000017"])
      await expect(
        request(
          randomUUID(),
          owner,
          dog,
          `60000000-0000-4000-8000-000000${suffix}`,
        ),
      ).rejects.toThrow("nie jest dostępna");
    expect(
      (await db.query("select id from public.course_enrollments")).rows,
    ).toHaveLength(0);
    expect(
      (await db.query("select walk_id from public.calendar_slots")).rows,
    ).toHaveLength(0);
    expect(
      (await db.query("select id from public.payments")).rows,
    ).toHaveLength(0);
    expect((await rows())[0]).not.toHaveProperty("price_cents");
  });
  it("routes a published future cycle through its existing enrollment and permits a request after its cancellation", async () => {
    const cycle = randomUUID(),
      session = randomUUID();
    await db.query(
      `insert into public.courses(id,practice_id,service_id,service_version,service_name,price_cents,is_test_price,sessions_count,duration_minutes,course_format,title,public_location,capacity,status,created_by,updated_by)
      select $1,practice_id,id,version,name,price_cents,is_test_price,1,60,'individual','Indywidualny kurs','Park',1,'open',$3,$3 from public.services where id=$2`,
      [cycle, service, admin],
    );
    await db.query(
      "insert into public.course_sessions(id,course_id,ordinal,starts_at,duration_minutes,public_location,updated_by) values($1,$2,1,now()+interval '20 days',60,'Park',$3)",
      [session, cycle, admin],
    );
    await expect(request()).rejects.toThrow("opublikowany termin");
    await db.query("update public.courses set status='cancelled' where id=$1", [
      cycle,
    ]);
    expect(await request()).toBeTruthy();
  });
  it("denies anonymous execution and malformed input", async () => {
    await expect(
      request(randomUUID(), owner, dog, service, "x"),
    ).rejects.toThrow("opisz potrzebę");
    await db.exec("begin;set local role anon;");
    await expect(
      db.query("select public.request_service_date($1,$2,$3,'Test','')", [
        randomUUID(),
        service,
        dog,
      ]),
    ).rejects.toThrow("permission denied");
    await db.exec("rollback");
  });
});
