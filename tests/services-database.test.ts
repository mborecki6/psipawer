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
  // Reset dependent care records now that publications can reference meetings.
  await db.exec(`truncate public.payments,public.calendar_slots,public.consultation_events,public.consultation_history,public.consultations cascade;
    delete from public.service_revisions where version>1;
    update public.services s set name=r.name,price_cents=r.price_cents,price_unit=r.price_unit,
      active=r.active,is_test_price=r.is_test_price,version=1,updated_by=null
      from public.service_revisions r where r.service_id=s.id and r.version=1;`);
});
afterAll(async () => {
  await db?.close();
});
const service = "60000000-0000-4000-8000-000000000011";
async function change(
  options: {
    user?: string;
    version?: number;
    price?: number;
    active?: boolean;
    name?: string;
  } = {},
) {
  const {
    user = admin,
    version = 1,
    price = 17550,
    active = true,
    name = "Konsultacja online — nowa nazwa",
  } = options;
  return asUser(user, () =>
    db.query<{ version: number }>(
      "select public.update_service($1,$2,$3,'Opis', $4,'za spotkanie',90,1,$5,false) version",
      [service, version, name, price, active],
    ),
  );
}
async function request(
  options: {
    id?: string;
    user?: string;
    dogId?: string;
    serviceId?: string;
    version?: number;
  } = {},
) {
  const {
    id = randomUUID(),
    user = owner,
    dogId = dog,
    serviceId = service,
    version = 1,
  } = options;
  await asUser(user, () =>
    db.query(
      "select public.request_consultation($1,$2,'Pomoc podczas spacerów','Popołudnia',$3,$4)",
      [id, dogId, serviceId, version],
    ),
  );
  return id;
}
async function quote(id: string) {
  return (
    await asUser(owner, () =>
      db.query<Record<string, unknown>>(
        "select service_name,agreed_price_cents,service_version,is_test_price from public.consultations where id=$1",
        [id],
      ),
    )
  ).rows[0];
}
describe.sequential(
  "service catalogue: prices, access and frozen terms in PostgreSQL",
  () => {
    it("imports 17 distinct variants at 100 PLN, including the verified CITY CHALLENGE course", async () => {
      const { rows } = await asUser(owner, () =>
        db.query<{
          name: string;
          price_cents: number;
          is_test_price: boolean;
          duration_minutes: number | null;
          sessions_count: number | null;
          price_unit: string;
        }>("select * from public.services"),
      );
      expect(rows).toHaveLength(17);
      expect(
        rows.every((s) => s.price_cents === 10000 && s.is_test_price),
      ).toBe(true);
      expect(rows.find((s) => s.name === "CITY CHALLENGE")).toMatchObject({
        duration_minutes: 60,
        sessions_count: 5,
        price_unit: "za cały kurs",
      });
      expect(
        rows.find((s) => s.name === "Psie Przedszkole — grupowe")?.price_unit,
      ).toBe("za cały kurs");
    });
    it("only staff can change prices, and neither staff nor clients can write tables directly", async () => {
      await expect(change({ user: owner })).rejects.toThrow("Brak uprawnień");
      for (const user of [owner, admin])
        for (const table of ["services", "service_revisions"]) {
          await expect(
            asUser(user, () => db.query(`delete from public.${table}`)),
          ).rejects.toThrow("permission denied");
        }
      const grants = await db.query<{ allowed: boolean }>(
        "select has_function_privilege('anon','public.update_service(uuid,integer,text,text,integer,text,integer,integer,boolean,boolean)','execute') allowed",
      );
      expect(grants.rows[0].allowed).toBe(false);
    });
    it("versions each price change and hides its history from clients", async () => {
      expect((await change()).rows[0].version).toBe(2);
      const { rows } = await asUser(admin, () =>
        db.query<{ price_cents: number; changed_by: string | null }>(
          "select * from public.service_revisions where service_id=$1 order by version",
          [service],
        ),
      );
      expect(rows.map((r) => r.price_cents)).toEqual([10000, 17550]);
      expect(rows[1].changed_by).toBe(admin);
      expect(
        (
          await asUser(owner, () =>
            db.query("select * from public.service_revisions"),
          )
        ).rows,
      ).toEqual([]);
    });
    it("hides inactive offers only from clients", async () => {
      await change({ active: false });
      expect(
        (
          await asUser(owner, () =>
            db.query("select * from public.services where id=$1", [service]),
          )
        ).rows,
      ).toEqual([]);
      expect(
        (
          await asUser(admin, () =>
            db.query("select * from public.services where id=$1", [service]),
          )
        ).rows,
      ).toHaveLength(1);
    });
    it("retries an acknowledged change once without duplicate revisions and blocks a conflicting stale edit", async () => {
      await change();
      expect((await change()).rows[0].version).toBe(2);
      await expect(change({ price: 20000 })).rejects.toThrow("zmieniła się");
      expect(
        (
          await db.query(
            "select * from public.service_revisions where service_id=$1",
            [service],
          )
        ).rows,
      ).toHaveLength(2);
    });
    it("freezes a request's original name, price and test label while new requests take new terms", async () => {
      const id = await request();
      const before = await quote(id);
      await change();
      expect(await quote(id)).toEqual(before);
      expect(before).toMatchObject({
        agreed_price_cents: 10000,
        service_version: 1,
        is_test_price: true,
      });
      const newer = await request({
        user: stranger,
        dogId: otherDog,
        version: 2,
      });
      const { rows } = await asUser(stranger, () =>
        db.query("select * from public.consultations where id=$1", [newer]),
      );
      expect(rows[0]).toMatchObject({
        service_name: "Konsultacja online — nowa nazwa",
        agreed_price_cents: 17550,
        service_version: 2,
        is_test_price: false,
      });
    });
    it("requires clients with an old open form to review the changed offer before submitting", async () => {
      await change();
      await expect(request()).rejects.toThrow("Oferta zmieniła się");
      expect(
        (await db.query("select * from public.consultations")).rows,
      ).toHaveLength(0);
    });
    it("can safely retry a previously accepted request after its service changes or is hidden", async () => {
      const id = await request();
      await change({ active: false });
      expect(await request({ id })).toBe(id);
      expect(await quote(id)).toMatchObject({
        agreed_price_cents: 10000,
        service_version: 1,
      });
      expect(
        (await db.query("select * from public.consultation_history")).rows,
      ).toHaveLength(1);
    });
    it("does not accept hidden services or courses through the single-session request flow", async () => {
      await change({ active: false });
      await expect(request({ version: 2 })).rejects.toThrow(
        "nie jest dostępna",
      );
      await expect(
        request({ serviceId: "60000000-0000-4000-8000-000000000001" }),
      ).rejects.toThrow("nie jest dostępna");
    });
    it("keeps agreed terms when scheduling after a price change and rejects a different service mode", async () => {
      const id = await request();
      const before = await quote(id);
      await change();
      const start = new Date(Date.now() + 7 * 86400000).toISOString();
      const schedule = (mode: string) =>
        asUser(admin, () =>
          db.query(
            "select public.change_consultation($1,1,'schedule',$2,90,$3,'Instrukcja połączenia','')",
            [id, start, mode],
          ),
        );
      await expect(schedule("in_person")).rejects.toThrow("Forma spotkania");
      await schedule("online");
      expect(await quote(id)).toEqual(before);
    });
    it.each([0, -100, 1000001])(
      "rejects invalid prices even through direct RPC (%s)",
      async (price) => {
        await expect(change({ price })).rejects.toThrow("Sprawdź dane");
      },
    );
    it("atomically rolls back a price edit when history cannot be saved", async () => {
      await db.exec(`create function public.fail_service_revision() returns trigger language plpgsql as $$begin raise exception 'test failure'; end$$;
      create trigger fail_revision before insert on public.service_revisions for each row execute function public.fail_service_revision();`);
      try {
        await expect(change()).rejects.toThrow("test failure");
        const { rows } = await db.query(
          "select price_cents,version from public.services where id=$1",
          [service],
        );
        expect(rows[0]).toMatchObject({ price_cents: 10000, version: 1 });
      } finally {
        await db.exec(
          "drop trigger fail_revision on public.service_revisions; drop function public.fail_service_revision();",
        );
      }
    });
  },
);
