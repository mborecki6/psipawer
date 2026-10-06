import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { beforeAll, beforeEach, afterAll, describe, it, expect } from "vitest";

let db: PGlite;
const admin = "14000000-0000-4000-8000-000000000001";
const owner = "14000000-0000-4000-8000-000000000002";
const colleague = "14000000-0000-4000-8000-000000000003";
const dog = "24000000-0000-4000-8000-000000000001";
const service = "60000000-0000-4000-8000-000000000011";
type Job = {
  id: string;
  status: string;
  kind: string;
  attempts: number;
  cycle_attempts: number;
  due_at: string;
  target_at: string;
  source_id: string;
  generation: number;
  last_error_code: string | null;
  next_attempt_at: string;
};
async function asUser<T>(id: string, fn: () => Promise<T>) {
  await db.exec("begin; set local role authenticated");
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
  await db.exec(`create role anon; create role authenticated; create role service_role; create schema auth;
    create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,encrypted_password text);
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    grant usage on schema public,auth to anon,authenticated,service_role; grant execute on function auth.uid() to anon,authenticated;
    create schema storage; create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
    create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text);
    alter table storage.objects enable row level security;
    create function storage.foldername(name text) returns text[] language sql as $$select string_to_array(name,'/')$$;
    grant usage on schema storage to authenticated; grant select,insert,delete on storage.objects to authenticated;`);
  for (const name of readdirSync("supabase/migrations")
    .filter((n) => n.endsWith(".sql"))
    .sort())
    await db.exec(readFileSync(`supabase/migrations/${name}`, "utf8"));
  await db.query("insert into auth.users(id) values($1),($2),($3)", [
    admin,
    owner,
    colleague,
  ]);
  await db.query(
    "update public.user_roles set role='admin' where user_id in ($1,$2)",
    [admin, colleague],
  );
  await db.query(
    "insert into public.dogs(id,guardian_id,name,status) values($1,$2,'Figa','approved')",
    [dog, owner],
  );
});
beforeEach(async () => {
  await db.exec(`truncate public.reminder_jobs,public.reminder_worker_state,public.notifications,public.calendar_slots,public.payments,public.consultation_events,public.consultation_history,
    public.consultations,public.care_follow_up_history,public.care_follow_ups,public.care_events,public.care_progress,
    public.care_plan_versions,public.care_drafts,public.walk_registrations,public.walk_private_details,public.walks,public.audit_events cascade;
    drop trigger if exists reminder_test_failure on public.notifications;
    update public.dogs set status='approved';`);
});
afterAll(async () => {
  await db?.close();
});
async function jobs() {
  return (
    await db.query<Job>(
      "select * from public.reminder_jobs order by generation,id",
    )
  ).rows;
}
async function process(limit = 50) {
  return (
    await asUser(admin, () =>
      db.query<{
        result: {
          sent: number;
          failed: number;
          cancelled: number;
          skipped: number;
        };
      }>("select public.process_due_reminders($1) result", [limit]),
    )
  ).rows[0].result;
}
async function notices() {
  return (
    await db.query<{ kind: string; recipient_id: string; source_key: string }>(
      "select kind,recipient_id,source_key from public.notifications where source_key like 'reminder:%' order by recipient_id",
    )
  ).rows;
}
async function consultation(hours = 3) {
  const id = randomUUID();
  await asUser(owner, () =>
    db.query(
      "select public.request_consultation($1,$2,'Prywatny temat','',$3,1)",
      [id, dog, service],
    ),
  );
  await asUser(admin, () =>
    db.query(
      "select public.change_consultation($1,1,'schedule',now()+make_interval(hours=>$2),60,'online','Prywatny adres','')",
      [id, hours],
    ),
  );
  return id;
}
async function followUp(date = "2030-01-10") {
  await asUser(admin, () =>
    db.query(
      "select public.save_care_plan($1,0,'Plan ćwiczeń','Prywatne zalecenia',$2,true)",
      [dog, date],
    ),
  );
  return (
    await db.query<{ id: string }>("select id from public.care_follow_ups")
  ).rows[0].id;
}
async function makeFailure() {
  await db.exec(`create or replace function public.test_reminder_failure() returns trigger language plpgsql as $$ begin
    if new.kind like '%_reminder' then raise exception 'SECRET private advice'; end if; return new; end $$;
    create trigger reminder_test_failure before insert on public.notifications for each row execute function public.test_reminder_failure();`);
}
async function makeDue() {
  await db.exec(
    "update public.reminder_jobs set next_attempt_at=now()-interval '1 second' where status in ('pending','retry')",
  );
}

describe.sequential("timed in-app reminder queue", () => {
  it("queues only confirmed appointments, preserves the 24 hour due time, and never delivers early", async () => {
    await consultation(48);
    const [j] = await jobs();
    expect(Date.parse(j.target_at) - Date.parse(j.due_at)).toBe(24 * 3600000);
    expect(await process()).toEqual({
      sent: 0,
      failed: 0,
      cancelled: 0,
      skipped: 0,
    });
    expect(await notices()).toEqual([]);
  });
  it("catches late bookings before their start exactly once, with atomic attempt history", async () => {
    await consultation();
    expect((await process()).sent).toBe(1);
    expect((await process()).sent).toBe(0);
    expect(await notices()).toMatchObject([
      { kind: "consultation_reminder", recipient_id: owner },
    ]);
    expect(await jobs()).toMatchObject([{ status: "sent", attempts: 1 }]);
    expect(
      (await db.query("select outcome,attempt from public.reminder_attempts"))
        .rows,
    ).toEqual([{ outcome: "sent", attempt: 1 }]);
  });
  it("rescheduling cancels the old job and gives the new time its own generation", async () => {
    const id = await consultation();
    await asUser(admin, () =>
      db.query(
        "select public.change_consultation($1,2,'schedule',now()+interval '2 days',60,'online','Nowy link','Przełożenie')",
        [id],
      ),
    );
    expect(await jobs()).toMatchObject([
      { status: "cancelled", generation: 1 },
      { status: "pending", generation: 2 },
    ]);
    expect((await process()).sent).toBe(0);
  });
  it("keeps delivery history when a delivered meeting is rescheduled and sends once for the new time", async () => {
    const id = await consultation();
    await process();
    await asUser(admin, () =>
      db.query(
        "select public.change_consultation($1,2,'schedule',now()+interval '5 hours',60,'online','Nowy link','Przełożenie')",
        [id],
      ),
    );
    await process();
    await process();
    expect(await notices()).toHaveLength(2);
    expect(await jobs()).toMatchObject([
      { status: "sent", generation: 1 },
      { status: "sent", generation: 2 },
    ]);
  });
  it("does not send for cancelled or already-started appointments", async () => {
    const id = await consultation();
    await asUser(owner, () =>
      db.query(
        "select public.change_consultation($1,2,'cancel',null,null,null,null,'Rezygnacja')",
        [id],
      ),
    );
    expect((await jobs())[0].status).toBe("cancelled");
    expect((await process()).sent).toBe(0);
    await db.exec(
      "truncate public.consultations cascade; truncate public.reminder_jobs cascade",
    );
    const past = await consultation();
    // Simulate a worker waking after the start, without running source triggers.
    await db.exec(
      "alter table public.consultations disable trigger consultation_reminder_sync",
    );
    await db.query(
      "update public.consultations set starts_at=now()-interval '2 hours' where id=$1",
      [past],
    );
    await db.exec(
      "alter table public.consultations enable trigger consultation_reminder_sync",
    );
    expect((await process()).cancelled).toBe(1);
    expect(await notices()).toHaveLength(0);
  });
  it("plans only accepted walk registrations and retracts them on cancellation", async () => {
    const walk = (
      await db.query<{ id: string }>(
        "insert into public.walks(starts_at,type,public_location,price_cents,capacity) values(now()+interval '4 hours','Spacer','Park',10000,4) returning id",
      )
    ).rows[0].id;
    const r = (
      await asUser(owner, () =>
        db.query<{ id: string }>("select public.register_dog($1,$2) id", [
          walk,
          dog,
        ]),
      )
    ).rows[0].id;
    expect(await jobs()).toHaveLength(0);
    await asUser(admin, () =>
      db.query("select public.decide_registration($1,'accepted','')", [r]),
    );
    expect(await jobs()).toHaveLength(1);
    await db.query(
      "update public.walk_registrations set attendance='pending' where id=$1",
      [r],
    );
    expect(await jobs()).toHaveLength(1);
    await db.query(
      "update public.walks set starts_at=now()+interval '2 days' where id=$1",
      [walk],
    );
    expect(await jobs()).toMatchObject([
      { status: "cancelled" },
      { status: "pending" },
    ]);
    await asUser(owner, () =>
      db.query("select public.cancel_registration($1)", [r]),
    );
    expect((await jobs()).every((j) => j.status === "cancelled")).toBe(true);
    expect((await process()).sent).toBe(0);
  });
  it("delivers accepted walk reminders to the guardian, with the walk as destination", async () => {
    const walk = (
      await db.query<{ id: string }>(
        "insert into public.walks(starts_at,type,public_location,price_cents,capacity,booking_mode) values(now()+interval '4 hours','Spacer','Park',10000,4,'automatic') returning id",
      )
    ).rows[0].id;
    await asUser(owner, () =>
      db.query("select public.register_dog($1,$2)", [walk, dog]),
    );
    expect((await process()).sent).toBe(1);
    expect(await notices()).toMatchObject([
      { kind: "walk_reminder", recipient_id: owner },
    ]);
    expect(
      (
        await db.query<{ entity_id: string }>(
          "select entity_id from public.notifications where kind='walk_reminder'",
        )
      ).rows[0].entity_id,
    ).toBe(walk);
  });
  it.each([
    ["2030-01-10", "08:00:00.000Z"],
    ["2030-07-10", "07:00:00.000Z"],
  ])("uses Warsaw 09:00 on %s for follow-ups", async (date, hour) => {
    await followUp(date);
    expect(new Date((await jobs())[0].due_at).toISOString()).toBe(
      `${date}T${hour}`,
    );
  });
  it("catches overdue open follow-ups for all staff, without notifying guardians or copying private notes", async () => {
    await followUp("2020-01-01");
    expect((await process()).sent).toBe(1);
    expect(await notices()).toMatchObject([
      { recipient_id: admin, kind: "follow_up_reminder" },
      { recipient_id: colleague, kind: "follow_up_reminder" },
    ]);
    expect(
      JSON.stringify(
        (await db.query("select * from public.reminder_jobs")).rows,
      ),
    ).not.toContain("Prywatne");
  });
  it("withdraws contact reminders after completion or a new published plan", async () => {
    const id = await followUp("2020-01-01");
    await asUser(admin, () =>
      db.query(
        "select public.change_care_follow_up($1,1,'completed',null,'Rozmowa odbyta')",
        [id],
      ),
    );
    expect((await jobs())[0].status).toBe("cancelled");
    await asUser(admin, () =>
      db.query(
        "select public.save_care_plan($1,1,'Nowy plan','Nowa treść','2020-01-02',true)",
        [dog],
      ),
    );
    await asUser(admin, () =>
      db.query(
        "select public.save_care_plan($1,2,'Następny plan','Treść bez kontaktu',null,true)",
        [dog],
      ),
    );
    expect((await jobs()).every((j) => j.status === "cancelled")).toBe(true);
    expect((await process()).sent).toBe(0);
  });
  it("retries with backoff, stops after five failures, sanitizes errors and supports audited manual retry", async () => {
    await consultation();
    await makeFailure();
    const mins = [1, 5, 15, 60, 60];
    for (let i = 0; i < 5; i++) {
      await makeDue();
      const before = Date.now();
      expect((await process()).failed).toBe(1);
      const [j] = await jobs();
      expect(j.attempts).toBe(i + 1);
      expect(j.cycle_attempts).toBe(i + 1);
      expect(Date.parse(j.next_attempt_at) - before).toBeGreaterThanOrEqual(
        mins[i] * 60000 - 1000,
      );
      expect(j.status).toBe(i === 4 ? "failed" : "retry");
    }
    const [j] = await jobs();
    expect((await process()).failed).toBe(0);
    expect(
      JSON.stringify(
        (await db.query("select * from public.reminder_attempts")).rows,
      ),
    ).not.toContain("SECRET");
    const retry = () =>
      asUser(admin, () =>
        db.query<{ value: boolean }>(
          "select public.retry_reminder($1,5) value",
          [j.id],
        ),
      );
    expect((await retry()).rows[0].value).toBe(true);
    expect((await retry()).rows[0].value).toBe(false);
    await db.exec("drop trigger reminder_test_failure on public.notifications");
    expect((await process()).sent).toBe(1);
    expect(await notices()).toHaveLength(1);
    expect((await jobs())[0].attempts).toBe(6);
    expect(
      (
        await db.query(
          "select * from public.audit_events where event='reminder_retried'",
        )
      ).rows,
    ).toHaveLength(1);
  });
  it("rolls back all recipient deliveries when a later staff recipient fails", async () => {
    await followUp("2020-01-01");
    await db.exec(`create or replace function public.test_reminder_failure() returns trigger language plpgsql as $$ begin
      if new.kind='follow_up_reminder' and new.recipient_id='${colleague}' then raise exception 'private'; end if; return new; end $$;
      create trigger reminder_test_failure before insert on public.notifications for each row execute function public.test_reminder_failure();`);
    expect((await process()).failed).toBe(1);
    expect(await notices()).toHaveLength(0);
    await db.exec("drop trigger reminder_test_failure on public.notifications");
    await makeDue();
    expect((await process()).sent).toBe(1);
    expect(await notices()).toHaveLength(2);
  });
  it("prevents direct writes and private function access, and gives only staff queue visibility", async () => {
    await consultation();
    expect(
      (
        await asUser(owner, () =>
          db.query("select * from public.reminder_jobs"),
        )
      ).rows,
    ).toHaveLength(0);
    expect(
      (
        await asUser(admin, () =>
          db.query("select * from public.reminder_jobs"),
        )
      ).rows,
    ).toHaveLength(1);
    for (const user of [admin, owner]) {
      for (const sql of [
        "update public.reminder_jobs set status='sent'",
        "select public.dispatch_due_reminders(50)",
        "select public.worker_process_due_reminders(50)",
        `select public.sync_reminder('consultation','${randomUUID()}')`,
      ]) {
        await expect(asUser(user, () => db.exec(sql))).rejects.toThrow(
          /permission denied/,
        );
      }
    }
    await expect(
      asUser(owner, () => db.exec("select public.process_due_reminders()")),
    ).rejects.toThrow("Brak uprawnień");
    const jobId = (await jobs())[0].id;
    await expect(
      asUser(owner, () =>
        db.query("select public.retry_reminder($1,1)", [jobId]),
      ),
    ).rejects.toThrow("Brak uprawnień");
    await db.exec("set role service_role");
    try {
      expect(
        (
          await db.query<{ n: { sent: number } }>(
            "select public.worker_process_due_reminders() n",
          )
        ).rows[0].n.sent,
      ).toBe(1);
    } finally {
      await db.exec("reset role");
    }
  });
  it("bounds batches and records an honest last-run timestamp, including empty runs", async () => {
    await consultation();
    await followUp("2020-01-01");
    expect((await process(1)).sent).toBe(1);
    expect((await process(1)).sent).toBe(1);
    expect((await process(1)).sent).toBe(0);
    expect(
      (
        await db.query(
          "select last_run_at,result from public.reminder_worker_state",
        )
      ).rows,
    ).toHaveLength(1);
    await expect(process(101)).rejects.toThrow("wielkość partii");
  });
  it("cancels jobs whose source disappeared, and refuses stale manual retries", async () => {
    await consultation();
    await db.exec("truncate public.consultations cascade");
    expect((await process()).cancelled).toBe(1);
    const jobId = (await jobs())[0].id;
    await expect(
      asUser(admin, () =>
        db.query("select public.retry_reminder($1,1)", [jobId]),
      ),
    ).rejects.toThrow("Odśwież kolejkę");
  });
});
