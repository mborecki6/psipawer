import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { beforeAll, afterAll, describe, it, expect } from "vitest";
let db: PGlite;
const admin = "10000000-0000-4000-8000-000000000001",
  owner = "10000000-0000-4000-8000-000000000002",
  stranger = "10000000-0000-4000-8000-000000000003";
const dog = "20000000-0000-4000-8000-000000000001",
  otherDog = "20000000-0000-4000-8000-000000000002",
  walk = "30000000-0000-4000-8000-000000000001",
  invite = "30000000-0000-4000-8000-000000000002";
async function asUser<T>(id: string, fn: () => Promise<T>) {
  await db.exec("begin; set local role authenticated;");
  await db.query("select set_config('request.jwt.claim.sub',$1,true)", [id]);
  try {
    const result = await fn();
    await db.exec("commit");
    return result;
  } catch (e) {
    await db.exec("rollback");
    throw e;
  }
}
beforeAll(async () => {
  db = new PGlite();
  await db.exec(`create role anon;create role authenticated;create schema auth;create table auth.users(id uuid primary key,email text);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema public,auth to anon,authenticated;grant execute on function auth.uid() to anon,authenticated;
 create schema storage;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text);alter table storage.objects enable row level security;create function storage.foldername(name text) returns text[] language sql as $$select string_to_array(name,'/')$$;grant usage on schema storage to authenticated;grant select,insert,delete on storage.objects to authenticated;`);
  for (const f of [
    "202609050001_foundation.sql",
    "202609050002_operations.sql",
    "202609050003_future_modules.sql",
    "202609050004_storage.sql",
  ])
    await db.exec(readFileSync(`supabase/migrations/${f}`, "utf8"));
  await db.exec(
    `insert into auth.users(id) values('${admin}'),('${owner}'),('${stranger}');update public.user_roles set role='admin' where user_id='${admin}';insert into public.dogs(id,guardian_id,name) values('${dog}','${owner}','Kluska'),('${otherDog}','${stranger}','Borys');update public.dogs set status='approved';insert into public.walks(id,starts_at,public_location,type,price_cents,capacity,booking_mode) values('${walk}',now()+interval '10 days','Park','Spacer',6000,1,'approval'),('${invite}',now()+interval '10 days','Park','Duet',6000,2,'invite');insert into public.walk_private_details(walk_id,exact_location) values('${walk}','TAJNE MIEJSCE');insert into public.dog_notes(dog_id,author_id,body,visibility) values('${dog}','${admin}','TYLKO ADMIN','admin_only'),('${dog}','${admin}','Zalecenie dla opiekuna','client_visible');`,
  );
});
afterAll(async () => {
  await db?.close();
});
describe.sequential("PostgreSQL migrations and actual RLS", () => {
  it("creates client role regardless of registration metadata", async () => {
    const r = await db.query<{ role: string }>(
      "select role from public.user_roles where user_id=$1",
      [owner],
    );
    expect(r.rows[0].role).toBe("client");
  });
  it("owner sees only own dogs", async () => {
    const r = await asUser(owner, () => db.query("select id from public.dogs"));
    expect(r.rows).toEqual([{ id: dog }]);
  });
  it("cannot read another guardian contact", async () => {
    const r = await asUser(owner, () =>
      db.query("select id from public.profiles"),
    );
    expect(r.rows).toEqual([{ id: owner }]);
  });
  it("cannot promote own account", async () => {
    await expect(
      asUser(owner, () =>
        db.query("update public.user_roles set role='admin' where user_id=$1", [
          owner,
        ]),
      ),
    ).rejects.toThrow(/permission denied/);
  });
  it("cannot self-approve dog or transfer ownership", async () => {
    await expect(
      asUser(owner, () =>
        db.query("update public.dogs set status='approved' where id=$1", [dog]),
      ),
    ).rejects.toThrow(/permission denied/);
    await expect(
      asUser(owner, () =>
        db.query("update public.dogs set guardian_id=$1 where id=$2", [
          stranger,
          dog,
        ]),
      ),
    ).rejects.toThrow(/permission denied/);
  });
  it("hides private notes and precise meeting location", async () => {
    const notes = await asUser(owner, () =>
      db.query<{ body: string }>("select body from public.dog_notes"),
    );
    expect(notes.rows).toEqual([{ body: "Zalecenie dla opiekuna" }]);
    const loc = await asUser(owner, () =>
      db.query("select * from public.walk_private_details"),
    );
    expect(loc.rows).toEqual([]);
  });
  it("rejects direct registration bypass", async () => {
    await expect(
      asUser(owner, () =>
        db.query(
          "insert into public.walk_registrations(walk_id,dog_id,status) values($1,$2,'accepted')",
          [walk, dog],
        ),
      ),
    ).rejects.toThrow(/permission denied/);
  });
  it("rejects other dogs and invite self-booking in the database", async () => {
    await expect(
      asUser(owner, () =>
        db.query("select public.register_dog($1,$2)", [walk, otherDog]),
      ),
    ).rejects.toThrow("Twój pies");
    await expect(
      asUser(owner, () =>
        db.query("select public.register_dog($1,$2)", [invite, dog]),
      ),
    ).rejects.toThrow("zaproszenie");
  });
  it("creates pending request and rejects duplicates", async () => {
    await asUser(owner, () =>
      db.query("select public.register_dog($1,$2)", [walk, dog]),
    );
    await expect(
      asUser(owner, () =>
        db.query("select public.register_dog($1,$2)", [walk, dog]),
      ),
    ).rejects.toThrow("już istnieje");
    const r = await asUser(owner, () =>
      db.query<{ status: string }>(
        "select status from public.walk_registrations",
      ),
    );
    expect(r.rows[0].status).toBe("pending");
  });
  it("another owner sees no applicants or private location", async () => {
    const regs = await asUser(stranger, () =>
      db.query("select * from public.walk_registrations"),
    );
    expect(regs.rows).toEqual([]);
    const loc = await asUser(stranger, () =>
      db.query("select * from public.walk_private_details"),
    );
    expect(loc.rows).toEqual([]);
  });
  it("rejects unauthorized approval RPC", async () => {
    const { rows } = await db.query<{ id: string }>(
      "select id from public.walk_registrations where dog_id=$1",
      [dog],
    );
    await expect(
      asUser(owner, () =>
        db.query("select public.decide_registration($1,'accepted','')", [
          rows[0].id,
        ]),
      ),
    ).rejects.toThrow("Brak uprawnień");
  });
  it("admin approval exposes location only to accepted owner", async () => {
    const { rows } = await db.query<{ id: string }>(
      "select id from public.walk_registrations where dog_id=$1",
      [dog],
    );
    await asUser(admin, () =>
      db.query("select public.decide_registration($1,'accepted','OK')", [
        rows[0].id,
      ]),
    );
    expect(
      (
        await asUser(owner, () =>
          db.query<{ exact_location: string }>(
            "select exact_location from public.walk_private_details",
          ),
        )
      ).rows[0].exact_location,
    ).toBe("TAJNE MIEJSCE");
    expect(
      (
        await asUser(stranger, () =>
          db.query("select * from public.walk_private_details"),
        )
      ).rows,
    ).toEqual([]);
  });
  it("rejects acceptance over capacity and rolls back state", async () => {
    await asUser(stranger, () =>
      db.query("select public.register_dog($1,$2)", [walk, otherDog]),
    );
    const { rows } = await db.query<{ id: string }>(
      "select id from public.walk_registrations where dog_id=$1",
      [otherDog],
    );
    await expect(
      asUser(admin, () =>
        db.query("select public.decide_registration($1,'accepted','')", [
          rows[0].id,
        ]),
      ),
    ).rejects.toThrow("Brak wolnych miejsc");
    const counts = await db.query<{ count: number }>(
      "select count(*)::int as count from public.walk_registrations where status='accepted'",
    );
    expect(counts.rows[0].count).toBe(1);
  });
  it("critical behavior edit requests review", async () => {
    await asUser(owner, () =>
      db.query(
        "insert into public.dog_behavior_profiles(dog_id,reactions,bite_history) values($1,'Nowa reakcja','Opis')",
        [dog],
      ),
    );
    const r = await db.query<{ status: string }>(
      "select status from public.dogs where id=$1",
      [dog],
    );
    expect(r.rows[0].status).toBe("needs_review");
  });
  it("owner cancellation immediately revokes exact location access", async () => {
    const { rows } = await db.query<{ id: string }>(
      "select id from public.walk_registrations where dog_id=$1",
      [dog],
    );
    await asUser(owner, () =>
      db.query("select public.cancel_registration($1)", [rows[0].id]),
    );
    expect(
      (
        await asUser(owner, () =>
          db.query("select * from public.walk_private_details"),
        )
      ).rows,
    ).toEqual([]);
    expect(
      (
        await db.query<{ status: string }>(
          "select status from public.walk_registrations where id=$1",
          [rows[0].id],
        )
      ).rows[0].status,
    ).toBe("cancelled_on_time");
  });
  it("private Storage separates owners", async () => {
    await db.query(
      "insert into storage.objects(bucket_id,name) values('dog-avatars',$1)",
      [`${owner}/${dog}/photo.jpg`],
    );
    expect(
      (await asUser(owner, () => db.query("select name from storage.objects")))
        .rows,
    ).toHaveLength(1);
    expect(
      (
        await asUser(stranger, () =>
          db.query("select name from storage.objects"),
        )
      ).rows,
    ).toHaveLength(0);
    await expect(
      asUser(stranger, () =>
        db.query(
          "insert into storage.objects(bucket_id,name) values('dog-avatars',$1)",
          [`${owner}/${dog}/bad.jpg`],
        ),
      ),
    ).rejects.toThrow(/row-level security/);
  });
  it("anonymous cannot read personal data", async () => {
    await db.exec("begin;set local role anon");
    try {
      await expect(db.query("select * from public.dogs")).rejects.toThrow(
        /permission denied/,
      );
    } finally {
      await db.exec("rollback");
    }
  });
  it("all public tables have RLS enabled", async () => {
    const r = await db.query(
      "select relname from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' and not c.relrowsecurity",
    );
    expect(r.rows).toEqual([]);
  });
});
