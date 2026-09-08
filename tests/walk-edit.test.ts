import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { beforeAll, afterAll, expect, it } from "vitest";
let db: PGlite;
const admin = "11000000-0000-4000-8000-000000000001",
  owner = "11000000-0000-4000-8000-000000000002";
const dog = "22000000-0000-4000-8000-000000000001";
async function asUser<T>(id: string, fn: () => Promise<T>) {
  await db.exec("begin;set local role authenticated;");
  await db.query("select set_config('request.jwt.claim.sub',$1,true)", [id]);
  try {
    const r = await fn();
    await db.exec("commit");
    return r;
  } catch (e) {
    await db.exec("rollback");
    throw e;
  }
}
beforeAll(async () => {
  db = new PGlite();
  await db.exec(`create role anon;create role authenticated;create schema auth;create table auth.users(id uuid primary key,email text);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema public,auth to anon,authenticated;grant execute on function auth.uid() to anon,authenticated;
 create schema storage;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text);alter table storage.objects enable row level security;create function storage.foldername(name text) returns text[] language sql as $$select string_to_array(name,'/')$$;grant usage on schema storage to authenticated;grant select,insert,delete on storage.objects to authenticated;`);

  for (const f of readdirSync("supabase/migrations")
    .filter((f) => f.endsWith(".sql"))
    .sort())
    await db.exec(readFileSync(`supabase/migrations/${f}`, "utf8"));
  await db.query("insert into auth.users(id) values($1),($2)", [admin, owner]);
  await db.query("update public.user_roles set role='admin' where user_id=$1", [
    admin,
  ]);
  await db.query(
    "insert into public.dogs(id,guardian_id,name,status) values($1,$2,'Test','approved')",
    [dog, owner],
  );
  await db.query("update public.dogs set status='approved' where id=$1", [dog]);
});
afterAll(async () => {
  await db?.close();
});
const payload = () => ({
  starts_at: new Date(Date.now() + 7 * 86400000).toISOString(),
  duration_minutes: 60,
  public_location: "Park testowy",
  type: "Spacer testowy",
  price_cents: 6000,
  capacity: 4,
  booking_mode: "approval",
  info: "",
  exact_location: "Prywatna zbiórka",
  map_url: "https://example.com/map",
  instructions: "",
  cancellation_deadline_hours: 24,
});
async function fixture() {
  const data = payload();
  const { rows } = await asUser(admin, () =>
    db.query<{ id: string }>("select public.create_walk($1) as id", [data]),
  );
  const id = rows[0].id;
  const version = (
    await db.query<{ version: string }>(
      "select updated_at::text as version from public.walks where id=$1",
      [id],
    )
  ).rows[0].version;
  return { data, id, version };
}
it("only admin can update, and versioning prevents silently overwriting another editor", async () => {
  const f = await fixture();
  await expect(
    asUser(owner, () =>
      db.query("select public.update_walk($1,$2,$3,$4)", [
        f.id,
        f.version,
        f.data,
        "Zmiana",
      ]),
    ),
  ).rejects.toThrow("Brak uprawnień");
  const changed = {
    ...f.data,
    public_location: "Nowy park",
    exact_location: "Nowa prywatna zbiórka",
    capacity: 5,
  };
  await asUser(admin, () =>
    db.query("select public.update_walk($1,$2,$3,$4)", [
      f.id,
      f.version,
      changed,
      "Nowe miejsce spotkania",
    ]),
  );
  expect(
    (
      await db.query(
        "select public_location,capacity,change_note from public.walks where id=$1",
        [f.id],
      )
    ).rows,
  ).toEqual([
    {
      public_location: "Nowy park",
      capacity: 5,
      change_note: "Nowe miejsce spotkania",
    },
  ]);
  await expect(
    asUser(admin, () =>
      db.query("select public.update_walk($1,$2,$3,$4)", [
        f.id,
        f.version,
        f.data,
        "Stara karta",
      ]),
    ),
  ).rejects.toThrow("międzyczasie");
  expect(
    (
      await asUser(owner, () =>
        db.query(
          "select exact_location from public.walk_private_details where walk_id=$1",
          [f.id],
        ),
      )
    ).rows,
  ).toEqual([]);
  expect(
    (
      await db.query(
        "select id from public.audit_events where entity_id=$1 and event='walk_updated'",
        [f.id],
      )
    ).rows,
  ).toHaveLength(1);
});
it("bookings freeze agreed terms and prevent capacity below accepted participants atomically", async () => {
  const f = await fixture();
  await asUser(owner, () =>
    db.query("select public.register_dog($1,$2)", [f.id, dog]),
  );
  const reg = (
    await db.query<{ id: string }>(
      "select id from public.walk_registrations where walk_id=$1",
      [f.id],
    )
  ).rows[0].id;
  await asUser(admin, () =>
    db.query("select public.decide_registration($1,'accepted','')", [reg]),
  );
  for (const changed of [
    { price_cents: 7000 },
    { booking_mode: "automatic" },
    { cancellation_deadline_hours: 48 },
  ]) {
    await expect(
      asUser(admin, () =>
        db.query("select public.update_walk($1,$2,$3,$4)", [
          f.id,
          f.version,
          { ...f.data, ...changed },
          "Zmiana warunków",
        ]),
      ),
    ).rejects.toThrow("Po pierwszym zgłoszeniu");
  }
  // A second accepted dog lets us test the real count constraint with a valid capacity.
  const second = "22000000-0000-4000-8000-000000000002";
  await db.query(
    "insert into public.dogs(id,guardian_id,name) values($1,$2,'Drugi')",
    [second, owner],
  );
  await db.query("update public.dogs set status='approved' where id=$1", [
    second,
  ]);
  await db.query(
    "insert into public.walk_registrations(walk_id,dog_id,status) values($1,$2,'accepted')",
    [f.id, second],
  );
  await expect(
    asUser(admin, () =>
      db.query("select public.update_walk($1,$2,$3,$4)", [
        f.id,
        f.version,
        { ...f.data, capacity: 1, exact_location: "NIE ZAPISUJ" },
        "Za mały limit",
      ]),
    ),
  ).rejects.toThrow("Limit nie może");
  expect(
    (
      await db.query<{ exact_location: string }>(
        "select exact_location from public.walk_private_details where walk_id=$1",
        [f.id],
      )
    ).rows[0].exact_location,
  ).toBe(f.data.exact_location);
});
it("rejects malformed payload and refuses edits to cancelled or started walks", async () => {
  const f = await fixture();
  for (const data of [
    {},
    { ...f.data, map_url: "javascript:alert(1)" },
    { ...f.data, public_location: null },
  ]) {
    await expect(
      asUser(admin, () =>
        db.query("select public.update_walk($1,$2,$3,$4)", [
          f.id,
          f.version,
          data,
          "Zmiana",
        ]),
      ),
    ).rejects.toThrow("Sprawdź dane");
  }
  await asUser(admin, () =>
    db.query("select public.cancel_walk($1,'Burza')", [f.id]),
  );
  await expect(
    asUser(admin, () =>
      db.query("select public.update_walk($1,$2,$3,$4)", [
        f.id,
        f.version,
        f.data,
        "Zmiana",
      ]),
    ),
  ).rejects.toThrow("odwołanego");
  const past = await fixture();
  await db.query(
    "update public.walks set starts_at=now()-interval '1 hour' where id=$1",
    [past.id],
  );
  await expect(
    asUser(admin, () =>
      db.query("select public.update_walk($1,$2,$3,$4)", [
        past.id,
        past.version,
        past.data,
        "Zmiana",
      ]),
    ),
  ).rejects.toThrow("rozpoczętego");
});

it("rescheduling earlier keeps free cancellation for existing accepted clients", async () => {
  const f = await fixture();
  await asUser(owner, () =>
    db.query("select public.register_dog($1,$2)", [f.id, dog]),
  );
  const reg = (
    await db.query<{ id: string }>(
      "select id from public.walk_registrations where walk_id=$1",
      [f.id],
    )
  ).rows[0].id;
  await asUser(admin, () =>
    db.query("select public.decide_registration($1,'accepted','')", [reg]),
  );
  const moved = {
    ...f.data,
    starts_at: new Date(Date.now() + 3600000).toISOString(),
  };
  await asUser(admin, () =>
    db.query("select public.update_walk($1,$2,$3,$4)", [
      f.id,
      f.version,
      moved,
      "Spacer wcześniej",
    ]),
  );
  await asUser(owner, () =>
    db.query("select public.cancel_registration($1)", [reg]),
  );
  expect(
    (
      await db.query(
        "select status,payment_status from public.walk_registrations where id=$1",
        [reg],
      )
    ).rows,
  ).toEqual([{ status: "cancelled_on_time", payment_status: "none" }]);
  const newDog = "22000000-0000-4000-8000-000000000003";
  await db.query(
    "insert into public.dogs(id,guardian_id,name) values($1,$2,'Nowy')",
    [newDog, owner],
  );
  await db.query("update public.dogs set status='approved' where id=$1", [
    newDog,
  ]);
  const nr = (
    await asUser(owner, () =>
      db.query<{ id: string }>("select public.register_dog($1,$2) as id", [
        f.id,
        newDog,
      ]),
    )
  ).rows[0].id;
  await asUser(admin, () =>
    db.query("select public.decide_registration($1,'accepted','')", [nr]),
  );
  await asUser(owner, () =>
    db.query("select public.cancel_registration($1)", [nr]),
  );
  expect(
    (
      await db.query(
        "select status,payment_status from public.walk_registrations where id=$1",
        [nr],
      )
    ).rows,
  ).toEqual([{ status: "cancelled_late", payment_status: "due" }]);
});
