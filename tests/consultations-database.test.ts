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
  await db.exec(
    "truncate public.payments,public.calendar_slots,public.consultation_events,public.consultation_history,public.consultations cascade;",
  );
});
afterAll(async () => {
  await db?.close();
});
const future = () => new Date(Date.now() + 7 * 86400000).toISOString();
async function request(
  id = randomUUID(),
  user = owner,
  dogId = dog,
  topic = "Potrzebuję konsultacji testowej",
) {
  await asUser(user, () =>
    db.query(
      "select public.request_consultation($1,$2,$3,'Po południu','60000000-0000-4000-8000-000000000011',1)",
      [id, dogId, topic],
    ),
  );
  return id;
}
async function change(
  id: string,
  options: {
    user?: string;
    version?: number;
    action?: string;
    start?: string;
    duration?: number;
    mode?: string;
    location?: string;
    note?: string;
  } = {},
) {
  const {
    user = admin,
    version = 1,
    action = "schedule",
    start = future(),
    duration = 60,
    mode = "online",
    location = "Instrukcja testowa",
    note = "",
  } = options;
  const result = await asUser(user, () =>
    db.query<{ version: number }>(
      "select public.change_consultation($1,$2,$3,$4,$5,$6,$7,$8) version",
      [
        id,
        version,
        action,
        action === "schedule" ? start : null,
        action === "schedule" ? duration : null,
        action === "schedule" ? mode : null,
        action === "schedule" ? location : null,
        note,
      ],
    ),
  );
  return result.rows[0].version;
}
async function rows(table: string, user = admin) {
  return (
    await asUser(user, () =>
      db.query<Record<string, unknown>>(`select * from public.${table}`),
    )
  ).rows;
}
describe.sequential(
  "consultations: actual PostgreSQL lifecycle and access",
  () => {
    it("derives the requester and hides another guardian's request and history", async () => {
      await request();
      const own = await rows("consultations", owner);
      expect(own).toHaveLength(1);
      expect(own[0].requested_by).toBe(owner);
      expect(await rows("consultation_history", owner)).toHaveLength(1);
      expect(await rows("consultations", stranger)).toEqual([]);
      expect(await rows("consultation_history", stranger)).toEqual([]);
      await expect(request(randomUUID(), stranger, dog)).rejects.toThrow(
        "Twojego psa",
      );
    });
    it("retries a request without duplicates and rejects altered content", async () => {
      const id = await request();
      await request(id);
      expect(await rows("consultations")).toHaveLength(1);
      expect(await rows("consultation_history")).toHaveLength(1);
      await expect(request(id, owner, dog, "Inna treść")).rejects.toThrow(
        "już zapisane",
      );
      expect(
        (await db.query("select * from public.consultation_events")).rows,
      ).toHaveLength(1);
    });
    it("permits one active consultation per dog and allows a new one after cancellation", async () => {
      const id = await request();
      await expect(request()).rejects.toThrow("już otwarte");
      await change(id, {
        user: owner,
        action: "cancel",
        note: "Zmiana planów",
      });
      await request();
      expect(await rows("consultations", owner)).toHaveLength(2);
    });
    it("blocks scheduling and closing by a guardian, and cancellation by a stranger", async () => {
      const id = await request();
      await expect(change(id, { user: owner })).rejects.toThrow(
        "Brak uprawnień",
      );
      await expect(
        change(id, { user: owner, action: "complete" }),
      ).rejects.toThrow("Brak uprawnień");
      await expect(
        change(id, {
          user: stranger,
          action: "cancel",
          note: "Próba odwołania",
        }),
      ).rejects.toThrow("Nie znaleziono");
    });
    it("rejects all direct table writes and anonymous RPC access", async () => {
      for (const table of [
        "consultations",
        "consultation_history",
        "consultation_events",
      ])
        await expect(
          asUser(admin, () => db.query(`delete from public.${table}`)),
        ).rejects.toThrow("permission denied");
      const grants = await db.query<{ allowed: boolean }>(
        "select has_function_privilege('anon','public.request_consultation(uuid,uuid,text,text,uuid,integer)','execute') allowed",
      );
      expect(grants.rows[0].allowed).toBe(false);
      await expect(
        asUser(owner, () =>
          db.query("select * from public.consultation_events"),
        ),
      ).rejects.toThrow("permission denied");
    });
    it("schedules, reschedules and preserves the previously agreed details", async () => {
      const id = await request();
      const start = future();
      expect(await change(id, { start })).toBe(2);
      const next = new Date(Date.parse(start) + 86400000).toISOString();
      await change(id, {
        version: 2,
        start: next,
        location: "Nowe miejsce",
        note: "Uzgodniona zmiana",
      });
      const history = await asUser(owner, () =>
        db.query<{ action: string; location: string }>(
          "select action,location from public.consultation_history order by version",
        ),
      );
      expect(history.rows.map((r) => r.action)).toEqual([
        "requested",
        "scheduled",
        "rescheduled",
      ]);
      expect(history.rows[1].location).toBe("Instrukcja testowa");
      expect(history.rows[2].location).toBe("Nowe miejsce");
    });
    it("makes a lost schedule response safely retryable but rejects a stale edit", async () => {
      const id = await request();
      const start = future();
      await change(id, { start });
      expect(await change(id, { start })).toBe(2);
      await expect(
        change(id, { start, location: "Stary formularz" }),
      ).rejects.toThrow("zmieniła się");
      expect(await rows("consultation_history")).toHaveLength(2);
    });
    it("requires a reason for rescheduling and cancellation", async () => {
      const id = await request();
      await change(id);
      await expect(change(id, { version: 2 })).rejects.toThrow("powód zmiany");
      await expect(
        change(id, { version: 2, action: "cancel" }),
      ).rejects.toThrow("powód odwołania");
    });
    it("rejects overlapping consultation slots and accepts adjacent ones", async () => {
      const first = await request();
      const start = future();
      await change(first, { start });
      const second = await request(randomUUID(), stranger, otherDog);
      await expect(
        change(second, {
          start: new Date(Date.parse(start) + 30 * 60000).toISOString(),
        }),
      ).rejects.toThrow("Ten czas jest już zajęty");
      await change(second, {
        start: new Date(Date.parse(start) + 60 * 60000).toISOString(),
      });
      expect(
        (await rows("consultations")).filter((r) => r.status === "scheduled"),
      ).toHaveLength(2);
    });
    it.each([
      { start: "2000-01-01T00:00:00Z" },
      { start: "infinity" },
      { duration: 0 },
      { duration: 241 },
      { mode: "invalid" },
      { location: "" },
    ])("rejects an invalid meeting: %s", async (options) => {
      const id = await request();
      await expect(change(id, options)).rejects.toThrow();
      expect((await rows("consultations"))[0].status).toBe("requested");
    });
    it("only completes elapsed scheduled consultations and records a shared summary", async () => {
      const id = await request();
      await expect(change(id, { action: "complete" })).rejects.toThrow(
        "dopiero po",
      );
      await change(id);
      await expect(
        change(id, { version: 2, action: "complete" }),
      ).rejects.toThrow("dopiero po");
      await db.query(
        "update public.consultations set starts_at=now()-interval '2 hours' where id=$1",
        [id],
      );
      await change(id, {
        version: 2,
        action: "complete",
        note: "Podsumowanie wspólnej pracy",
      });
      expect((await rows("consultations", owner))[0].status).toBe("completed");
      await expect(
        change(id, { version: 3, action: "schedule" }),
      ).rejects.toThrow("zamknięta");
    });
    it("retains cancelled appointments and makes cancellation retries a no-op", async () => {
      const id = await request();
      await change(id);
      const options = {
        user: owner,
        version: 2,
        action: "cancel",
        note: "Przełożenie na później",
      };
      await change(id, options);
      await change(id, options);
      expect((await rows("consultations", owner))[0].status).toBe("cancelled");
      expect(await rows("consultation_history", owner)).toHaveLength(3);
    });
    it("rejects guardian cancellation once a meeting has started", async () => {
      const id = await request();
      await change(id);
      await db.query(
        "update public.consultations set starts_at=now()-interval '5 minutes' where id=$1",
        [id],
      );
      await expect(
        change(id, {
          user: owner,
          version: 2,
          action: "cancel",
          note: "Powód testowy",
        }),
      ).rejects.toThrow("już się rozpoczął");
      await change(id, {
        version: 2,
        action: "cancel",
        note: "Odwołanie przez prowadzącą",
      });
    });
    it("rolls the entire operation back if durable event insertion fails", async () => {
      const id = await request();
      await db.exec(
        "create function public.reject_consultation_event() returns trigger language plpgsql as $$begin raise exception 'event failure'; end$$; create trigger event_failure before insert on public.consultation_events for each row execute function public.reject_consultation_event();",
      );
      try {
        await expect(change(id)).rejects.toThrow("event failure");
        expect((await rows("consultations"))[0].version).toBe(1);
        expect(await rows("consultation_history")).toHaveLength(1);
      } finally {
        await db.exec(
          "drop trigger event_failure on public.consultation_events; drop function public.reject_consultation_event();",
        );
      }
    });
  },
);
