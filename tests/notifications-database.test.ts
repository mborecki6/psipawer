import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { beforeAll, beforeEach, afterAll, describe, it, expect } from "vitest";

let db: PGlite;
const admin = "12000000-0000-4000-8000-000000000001";
const owner = "12000000-0000-4000-8000-000000000002";
const stranger = "12000000-0000-4000-8000-000000000003";
const colleague = "12000000-0000-4000-8000-000000000004";
const dog = "22000000-0000-4000-8000-000000000001";
const otherDog = "22000000-0000-4000-8000-000000000002";
const service = "60000000-0000-4000-8000-000000000011";
type Notice = {
  id: string;
  kind: string;
  dog_id: string;
  entity_id: string;
  read_at: string | null;
  source_key?: string;
};

async function asUser<T>(id: string, fn: () => Promise<T>) {
  await db.exec("begin; set local role authenticated");
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
    grant usage on schema public,auth to anon,authenticated; grant execute on function auth.uid() to anon,authenticated;
    create schema storage; create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
    create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text);
    alter table storage.objects enable row level security;
    create function storage.foldername(name text) returns text[] language sql as $$select string_to_array(name,'/')$$;
    grant usage on schema storage to authenticated; grant select,insert,delete on storage.objects to authenticated;`);
  for (const name of readdirSync("supabase/migrations")
    .filter((n) => n.endsWith(".sql"))
    .sort())
    await db.exec(readFileSync(`supabase/migrations/${name}`, "utf8"));
  await db.query("insert into auth.users(id) values($1),($2),($3),($4)", [
    admin,
    owner,
    stranger,
    colleague,
  ]);
  await db.query(
    "update public.user_roles set role='admin' where user_id in ($1,$2)",
    [admin, colleague],
  );
  await db.query(
    "insert into public.dogs(id,guardian_id,name,status) values($1,$2,'Figa','approved'),($3,$4,'Rufi','approved')",
    [dog, owner, otherDog, stranger],
  );
});
beforeEach(async () => {
  await db.exec(`truncate public.notifications,public.calendar_slots,public.payments,public.consultation_events,public.consultation_history,
    public.consultations,public.care_follow_up_history,public.care_follow_ups,public.care_events,public.care_progress,
    public.care_plan_versions,public.care_drafts,public.walk_registrations,public.walk_private_details,public.walks,public.audit_events cascade;
    update public.dogs set status='approved';`);
});
afterAll(async () => {
  await db?.close();
});

async function inbox(
  user = owner,
  filter = "all",
  before: string | null = null,
) {
  return (
    await asUser(user, () =>
      db.query<Notice>("select * from public.notification_feed($1,$2)", [
        filter,
        before,
      ]),
    )
  ).rows;
}
async function read(ids: string[], user = owner) {
  return (
    await asUser(user, () =>
      db.query<{ n: number }>("select public.read_notifications($1) n", [ids]),
    )
  ).rows[0].n;
}
async function plan(publish = true, version = 0, date: string | null = null) {
  return (
    await asUser(admin, () =>
      db.query<{ result: { version: number; published_id: string } }>(
        "select public.save_care_plan($1,$2,'Plan poufny','Treść zaleceń niewidoczna w powiadomieniu',$3,$4) result",
        [dog, version, date, publish],
      ),
    )
  ).rows[0].result;
}
async function request() {
  const id = randomUUID();
  await asUser(owner, () =>
    db.query(
      "select public.request_consultation($1,$2,'Prywatne zgłoszenie','',$3,1)",
      [id, dog, service],
    ),
  );
  return id;
}
async function schedule(
  id: string,
  version = 1,
  date = "2030-10-10 10:00:00+00",
) {
  return asUser(admin, () =>
    db.query(
      "select public.change_consultation($1,$2,'schedule',$3,90,'online','Prywatny link do rozmowy','Opis zmiany')",
      [id, version, date],
    ),
  );
}
async function makeWalk() {
  return (
    await db.query<{ id: string }>(
      "insert into public.walks(starts_at,type,public_location,price_cents,capacity) values(now()+interval '100 days','Spacer','Park',10000,4) returning id",
    )
  ).rows[0].id;
}
async function register(walk: string, guardian = owner, dogId = dog) {
  return (
    await asUser(guardian, () =>
      db.query<{ id: string }>("select public.register_dog($1,$2) id", [
        walk,
        dogId,
      ]),
    )
  ).rows[0].id;
}

describe.sequential("durable personal inbox", () => {
  it("does not notify about drafts, publishes once to the guardian and never copies plan content", async () => {
    await plan(false);
    expect(await inbox()).toEqual([]);
    await plan(true, 1);
    await plan(true, 1);
    const items = await inbox();
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ kind: "plan_published", dog_id: dog });
    expect(await inbox(stranger)).toEqual([]);
    expect(await inbox(admin)).toEqual([]);
    const raw = await db.query("select * from public.notifications");
    expect(JSON.stringify(raw.rows)).not.toContain("Treść zaleceń");
    expect(JSON.stringify(raw.rows)).not.toContain("Plan poufny");
  });
  it("fans progress out to staff, keeps reading separate from reviewing and acknowledges an explicit review once", async () => {
    const p = await plan();
    const id = randomUUID();
    const send = () =>
      asUser(owner, () =>
        db.query(
          "select public.submit_care_progress($1,$2,'Opis postępów','Sukces','Trudność')",
          [id, p.published_id],
        ),
      );
    await send();
    await send();
    for (const staff of [admin, colleague]) {
      const items = await inbox(staff);
      expect(items).toHaveLength(1);
      expect(items[0]).toMatchObject({
        kind: "progress_submitted",
        entity_id: id,
      });
    }
    const notification = (await inbox(admin))[0];
    await read([notification.id], admin);
    expect(
      (
        await db.query<{ reviewed_at: string | null }>(
          "select reviewed_at from public.care_progress where id=$1",
          [id],
        )
      ).rows[0].reviewed_at,
    ).toBeNull();
    await asUser(admin, () =>
      db.query("select public.review_care_progress($1)", [id]),
    );
    await asUser(admin, () =>
      db.query("select public.review_care_progress($1)", [id]),
    );
    expect(
      (await inbox()).filter((n) => n.kind === "progress_reviewed"),
    ).toHaveLength(1);
  });
  it("routes consultation events to the guardian and other staff, excludes the author and deduplicates retries", async () => {
    const id = await request();
    expect(await inbox()).toEqual([]);
    expect((await inbox(admin))[0]).toMatchObject({
      kind: "consultation_requested",
      entity_id: id,
    });
    await schedule(id);
    await schedule(id);
    expect((await inbox()).map((n) => n.kind)).toEqual([
      "consultation_scheduled",
    ]);
    expect((await inbox(admin)).map((n) => n.kind)).toEqual([
      "consultation_requested",
    ]);
    expect((await inbox(colleague)).map((n) => n.kind)).toEqual([
      "consultation_scheduled",
      "consultation_requested",
    ]);
    await schedule(id, 2, "2030-10-11 10:00:00+00");
    await asUser(owner, () =>
      db.query(
        "select public.change_consultation($1,3,'cancel',null,null,null,null,'Moja rezygnacja')",
        [id],
      ),
    );
    expect((await inbox())[0].kind).toBe("consultation_rescheduled");
    expect((await inbox(admin))[0].kind).toBe("consultation_cancelled");
    expect(
      JSON.stringify(
        (await db.query("select * from public.notifications")).rows,
      ),
    ).not.toContain("Prywatny");
  });
  it("notifies the guardian about changed follow-up dates without exposing the staff note", async () => {
    const p = await plan(true, 0, "2030-10-10");
    const f = (
      await db.query<{ id: string }>(
        "select id from public.care_follow_ups where plan_id=$1",
        [p.published_id],
      )
    ).rows[0].id;
    const change = () =>
      asUser(admin, () =>
        db.query(
          "select public.change_care_follow_up($1,1,'rescheduled','2030-10-11','PRYWATNA NOTATKA PROWADZĄCEJ')",
          [f],
        ),
      );
    await change();
    await change();
    const items = await inbox();
    expect(items.map((n) => n.kind)).toEqual([
      "follow_up_changed",
      "plan_published",
    ]);
    expect(
      JSON.stringify(
        (await db.query("select * from public.notifications")).rows,
      ),
    ).not.toContain("PRYWATNA");
  });
  it("notifies staff of a registration and the guardian of the decision, only once", async () => {
    const walk = await makeWalk();
    const id = await register(walk);
    expect((await inbox(admin))[0]).toMatchObject({
      kind: "registration_created",
      entity_id: walk,
    });
    expect(await inbox()).toEqual([]);
    await asUser(admin, () =>
      db.query(
        "select public.decide_registration($1,'accepted','Zapraszamy')",
        [id],
      ),
    );
    await asUser(admin, () =>
      db.query(
        "select public.decide_registration($1,'accepted','Zapraszamy')",
        [id],
      ),
    );
    expect((await inbox()).map((n) => n.kind)).toEqual([
      "registration_changed",
    ]);
    await asUser(owner, () =>
      db.query("select public.cancel_registration($1)", [id]),
    );
    expect((await inbox(admin))[0].kind).toBe("registration_cancelled");
  });
  it("notifies all affected guardians after a walk cancellation and does not duplicate a repeated cancellation", async () => {
    const walk = await makeWalk();
    await register(walk);
    await register(walk, stranger, otherDog);
    const cancel = () =>
      asUser(admin, () =>
        db.query("select public.cancel_walk($1,'Zła pogoda')", [walk]),
      );
    await cancel();
    await cancel();
    for (const guardian of [owner, stranger]) {
      const items = await inbox(guardian);
      expect(items).toHaveLength(1);
      expect(items[0]).toMatchObject({
        kind: "walk_cancelled",
        entity_id: walk,
      });
    }
  });
  it("notifies only active registrations after a walk edit without copying private directions or change notes", async () => {
    const walk = await makeWalk();
    await register(walk);
    const rejected = await register(walk, stranger, otherDog);
    await asUser(admin, () =>
      db.query("select public.decide_registration($1,'rejected','Decyzja')", [
        rejected,
      ]),
    );
    await asUser(admin, () =>
      db.query(
        `select public.update_walk($1,(select updated_at from public.walks where id=$1),
      jsonb_build_object('starts_at',now()+interval '101 days','duration_minutes',60,'public_location','Park Miejski',
        'type','Spacer','price_cents',10000,'capacity',4,'booking_mode','approval','info','Informacja',
        'exact_location','PRYWATNY PUNKT','map_url','','instructions','POUFNE WSKAZÓWKI','cancellation_deadline_hours',24),
      'SZCZEGÓŁOWY OPIS ZMIANY')`,
        [walk],
      ),
    );
    expect(
      (await inbox()).filter((n) => n.kind === "walk_changed"),
    ).toHaveLength(1);
    expect(
      (await inbox(stranger)).filter((n) => n.kind === "walk_changed"),
    ).toEqual([]);
    const raw = JSON.stringify(
      (await db.query("select * from public.notifications")).rows,
    );
    expect(raw).not.toContain("PRYWATNY");
    expect(raw).not.toContain("POUFNE");
    expect(raw).not.toContain("SZCZEGÓŁOWY");
  });
  it("notifies an invitation recipient and records no notification for private internal note events", async () => {
    const walk = await makeWalk();
    await asUser(admin, () =>
      db.query("select public.invite_dog($1,$2)", [walk, dog]),
    );
    await db.query(
      "insert into public.audit_events(actor_id,event,entity_id,details) values($1,'private_note_added',$2,'{\"note\":\"tajemnica\"}')",
      [admin, dog],
    );
    expect((await inbox()).map((n) => n.kind)).toEqual(["walk_invitation"]);
  });
  it("announces recorded and reversed consultation receipts exactly once", async () => {
    const id = await request();
    await schedule(id);
    const key = randomUUID();
    const pay = () =>
      asUser(admin, () =>
        db.query<{ id: string }>(
          "select public.record_payment(null,null,4000,'transfer','Opis wpłaty',$1,$2) id",
          [key, id],
        ),
      );
    const payment = (await pay()).rows[0].id;
    await pay();
    await asUser(admin, () =>
      db.query("select public.void_payment($1,'Zwrot uzgodniony')", [payment]),
    );
    await asUser(admin, () =>
      db.query("select public.void_payment($1,'Zwrot uzgodniony')", [payment]),
    );
    expect(
      (await inbox())
        .filter((n) => n.kind.startsWith("payment_"))
        .map((n) => n.kind),
    ).toEqual(["payment_refunded", "payment_recorded"]);
    expect(
      JSON.stringify(
        (await db.query("select * from public.notifications")).rows,
      ),
    ).not.toContain("Opis wpłaty");
  });
  it("isolates inboxes even between administrators and denies direct edits or calls to private fan-out", async () => {
    await plan();
    await request();
    const ownerNotice = (await inbox())[0];
    const adminNotice = (await inbox(admin))[0];
    expect(
      (
        await asUser(admin, () =>
          db.query("select id from public.notifications where id=$1", [
            ownerNotice.id,
          ]),
        )
      ).rows,
    ).toEqual([]);
    await expect(read([ownerNotice.id], admin)).rejects.toThrow(
      "Twoich powiadomień",
    );
    await expect(read([adminNotice.id], colleague)).rejects.toThrow(
      "Twoich powiadomień",
    );
    await expect(
      asUser(owner, () =>
        db.query("update public.notifications set read_at=now()"),
      ),
    ).rejects.toThrow("permission denied");
    await expect(
      asUser(admin, () => db.query("delete from public.notifications")),
    ).rejects.toThrow("permission denied");
    await expect(
      asUser(owner, () =>
        db.query(
          "select public.add_in_app_notification($1,null,$2,$2,'plan_published','forged')",
          [stranger, dog],
        ),
      ),
    ).rejects.toThrow("permission denied");
  });
  it("withdraws access to staff notifications on demotion and to guardian notifications after ownership changes", async () => {
    await request();
    await plan();
    const staffNotice = (await inbox(colleague))[0];
    const ownerNotice = (await inbox())[0];
    await db.query(
      "update public.user_roles set role='client' where user_id=$1",
      [colleague],
    );
    try {
      expect(await inbox(colleague)).toEqual([]);
      await expect(read([staffNotice.id], colleague)).rejects.toThrow(
        "Twoich powiadomień",
      );
    } finally {
      await db.query(
        "update public.user_roles set role='admin' where user_id=$1",
        [colleague],
      );
    }
    await db.query("update public.dogs set guardian_id=$1 where id=$2", [
      stranger,
      dog,
    ]);
    try {
      expect(await inbox()).toEqual([]);
      await expect(read([ownerNotice.id])).rejects.toThrow(
        "Twoich powiadomień",
      );
    } finally {
      await db.query("update public.dogs set guardian_id=$1 where id=$2", [
        owner,
        dog,
      ]);
    }
  });
  it("marks only explicit visible IDs, preserving first read time and rejecting mixed-owner batches atomically", async () => {
    await plan();
    const id = await request();
    await schedule(id);
    const items = await inbox();
    const staffNotice = (await inbox(admin))[0];
    await expect(read([items[0].id, staffNotice.id])).rejects.toThrow(
      "Twoich powiadomień",
    );
    expect(await inbox(owner, "unread")).toHaveLength(2);
    expect(await read([items[0].id])).toBe(1);
    const firstRead = (await inbox())[0].read_at;
    expect(await read([items[0].id])).toBe(0);
    expect((await inbox())[0].read_at).toEqual(firstRead);
    expect(await inbox(owner, "unread")).toHaveLength(1);
    await expect(read([])).rejects.toThrow("od 1 do 20");
    await expect(read([items[1].id, items[1].id])).rejects.toThrow(
      "Nie powtarzaj",
    );
    await expect(
      read(Array.from({ length: 21 }, () => randomUUID())),
    ).rejects.toThrow("od 1 do 20");
  });
  it("paginates a long inbox stably when a newer event arrives, and counts all unread records", async () => {
    await db.query(
      `insert into public.notifications(recipient_id,recipient_role,dog_id,entity_id,kind,source_key,created_at)
      select $1,'client',$2,$2,'plan_published','fixture:'||n,now()-interval '1 day' from generate_series(1,1005) n`,
      [owner, dog],
    );
    const first = await inbox();
    expect(first).toHaveLength(21);
    const before = first[19].id;
    await plan();
    const next = await inbox(owner, "all", before);
    expect(next).toHaveLength(21);
    expect(next[0].id).toBe(first[20].id);
    expect(
      next.some((n) => first.slice(0, 20).some((p) => p.id === n.id)),
    ).toBe(false);
    const count = () =>
      asUser(owner, () =>
        db.query<{ n: number }>(
          "select count(*)::int n from public.notifications where read_at is null",
        ),
      );
    expect((await count()).rows[0].n).toBe(1006);
    await read(first.slice(0, 20).map((n) => n.id));
    expect((await count()).rows[0].n).toBe(986);
    expect((await inbox())[0].read_at).toBeNull();
  });
  it("rejects foreign or missing cursors with the same message and does not expose rows to anonymous calls", async () => {
    await plan();
    const notice = (await inbox())[0];
    await expect(inbox(stranger, "all", notice.id)).rejects.toThrow(
      "Wróć do początku",
    );
    await expect(inbox(owner, "all", randomUUID())).rejects.toThrow(
      "Wróć do początku",
    );
    for (const sql of [
      "select * from public.notifications",
      "select * from public.notification_feed()",
      "select public.read_notifications(array[]::uuid[])",
    ]) {
      await db.exec("begin; set local role anon");
      try {
        await expect(db.query(sql)).rejects.toThrow("permission denied");
      } finally {
        await db.exec("rollback");
      }
    }
  });
  it("rolls back the whole publication if notification persistence fails", async () => {
    await db.exec(`create function public.fail_notification() returns trigger language plpgsql as $$begin raise exception 'notification failed';end$$;
      create trigger fail_notification before insert on public.notifications for each row execute function public.fail_notification();`);
    try {
      await expect(plan()).rejects.toThrow("notification failed");
      expect(
        (await db.query("select * from public.care_plan_versions")).rows,
      ).toHaveLength(0);
      expect(
        (await db.query("select * from public.care_events")).rows,
      ).toHaveLength(0);
    } finally {
      await db.exec(
        "drop trigger fail_notification on public.notifications;drop function public.fail_notification()",
      );
    }
  });
});
