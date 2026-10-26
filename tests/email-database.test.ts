import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { configureCalendarPrimary } from "./helpers/calendar-primary.mjs";

let db: PGlite;
const owner = "a3000000-0000-4000-8000-000000000001";
const admin = "a3000000-0000-4000-8000-000000000002";
const other = "a3000000-0000-4000-8000-000000000003";
const dog = "a4000000-0000-4000-8000-000000000001";
const service = "60000000-0000-4000-8000-000000000011";
type Claim = { id: string; claim_token: string };
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
const enable = () =>
  db.exec("update public.business_email_settings set enabled=true");
async function claim(limit = 1) {
  return (
    await db.query<Claim>(
      "select * from public.worker_claim_business_email($1)",
      [limit],
    )
  ).rows;
}
async function prepare(job: Claim) {
  return (
    await db.query<{ recipient: string; kind: string }>(
      "select * from public.worker_prepare_business_email($1,$2)",
      [job.id, job.claim_token],
    )
  ).rows;
}
async function finish(job: Claim, outcome = "accepted") {
  return (
    await db.query<{ done: boolean }>(
      "select public.worker_finish_business_email($1,$2,$3) done",
      [job.id, job.claim_token, outcome],
    )
  ).rows[0].done;
}
async function sourceCurrent(job: Pick<Claim, "id">) {
  return (
    await db.query<{ current: boolean }>(
      "select public.business_email_source_current($1) current",
      [job.id],
    )
  ).rows[0].current;
}
const queue = async () =>
  (
    await db.query<{ status: string; kind: string; attempts: number }>(
      "select status,kind,attempts from public.business_email_outbox order by created_at,id",
    )
  ).rows;
async function consultation(at = "2035-01-01 10:00+00") {
  const id = randomUUID();
  await asUser(owner, () =>
    db.query(
      "select public.request_consultation($1,$2,'Poufny temat zdrowotny','',$3,1)",
      [id, dog, service],
    ),
  );
  await asUser(admin, () =>
    db.query(
      "select public.change_consultation($1,1,'schedule',$2,60,'online','Poufny link','Poufna notatka')",
      [id, at],
    ),
  );
  return id;
}
async function payment() {
  const id = randomUUID();
  let consultationId = (
    await db.query<{ id: string }>(
      "select id from public.consultations where dog_id=$1",
      [dog],
    )
  ).rows[0]?.id;
  if (!consultationId) {
    consultationId = randomUUID();
    await asUser(owner, () =>
      db.query(
        "select public.request_consultation($1,$2,'Syntetyczna usługa','',$3,1)",
        [consultationId, dog, service],
      ),
    );
  }
  await db.query(
    "insert into public.payments(id,guardian_id,dog_id,consultation_id,amount_cents,method,status,paid_at,note,author_id) values($1,$2,$3,$4,100,'cash','paid',now(),'Poufna notatka płatności',$5)",
    [id, owner, dog, consultationId, admin],
  );
  return id;
}
async function fitnessPackage(accept = true) {
  const product = (
    await db.query<{ id: string; version: number }>(
      "select id,version from public.services where booking_flow='fitness' and active order by id limit 1",
    )
  ).rows[0];
  const id = randomUUID();
  await asUser(owner, () =>
    db.query(
      "select public.request_fitness_package($1,$2,$3,$4,'Cel syntetyczny','')",
      [id, dog, product.id, product.version],
    ),
  );
  if (accept)
    await asUser(admin, () =>
      db.query("select public.change_fitness_package($1,1,'accept','',$2)", [
        id,
        randomUUID(),
      ]),
    );
  return id;
}
beforeAll(async () => {
  db = new PGlite();
  // Intentionally minimal Auth schema: the migration remains compatible with
  // existing database suites while actual Auth supplies email/ban metadata.
  await db.exec(`create role anon; create role authenticated; create role service_role; create schema auth;
    create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,encrypted_password text);
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    grant usage on schema public,auth to anon,authenticated,service_role;
    grant execute on function auth.uid() to anon,authenticated;
    create schema storage; create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
    create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text);
    alter table storage.objects enable row level security;
    create function storage.foldername(name text) returns text[] language sql as $$select string_to_array(name,'/')$$;
    grant usage on schema storage to authenticated; grant select,insert,delete on storage.objects to authenticated;`);
  for (const name of readdirSync("supabase/migrations")
    .filter((n) => n.endsWith(".sql"))
    .sort())
    await db.exec(readFileSync(`supabase/migrations/${name}`, "utf8"));
  await db.query(
    "insert into auth.users(id,email) values($1,'owner@example.test'),($2,'admin@example.test'),($3,'other@example.test')",
    [owner, admin, other],
  );
  await db.query("update public.user_roles set role='admin' where user_id=$1", [
    admin,
  ]);
  await configureCalendarPrimary(db, admin);
  await db.query(
    "insert into public.dogs(id,guardian_id,name,status) values($1,$2,'Syntetyczny pies','approved')",
    [dog, owner],
  );
});
beforeEach(async () => {
  await db.exec(`update public.business_email_settings set enabled=false;
    truncate public.notifications,public.calendar_slots,public.payments,public.consultation_events,public.consultation_history,public.courses,public.fitness_packages,
      public.consultations,public.walk_registrations,public.walk_private_details,public.walks,public.audit_events cascade;`);
  await db.query(
    "update public.user_roles set role='client' where user_id in ($1,$2)",
    [owner, other],
  );
  await db.query(
    "update public.dogs set guardian_id=$1,status='approved' where id=$2",
    [owner, dog],
  );
  await db.query("update public.dogs set status='approved' where id=$1", [dog]);
  await db.query(
    "update auth.users set email='owner@example.test' where id=$1",
    [owner],
  );
});
afterAll(async () => {
  await db?.close();
});

describe.sequential(
  "independent business email outbox with actual domain sources",
  () => {
    it("is disabled by default and enabling never replays historic events", async () => {
      await consultation();
      await payment();
      expect(await queue()).toEqual([]);
      await enable();
      expect(await claim()).toEqual([]);
      expect(await queue()).toEqual([]);
    });
    it("queues only selected schedule events, with no advice or private fields", async () => {
      await enable();
      await consultation();
      const rows = await db.query<{
        kind: string;
        source_token: string;
        [key: string]: unknown;
      }>("select * from public.business_email_outbox");
      expect(rows.rows.map((r) => r.kind)).toEqual(["consultation_scheduled"]);
      expect(JSON.stringify(rows.rows)).not.toMatch(
        /Poufn|zdrowotny|owner@example/,
      );
      const [job] = await claim();
      expect(await prepare(job)).toMatchObject([
        { recipient: "owner@example.test", kind: "consultation_scheduled" },
      ]);
      expect(await finish(job)).toBe(true);
      expect(await finish(job)).toBe(false);
      expect(await claim()).toEqual([]);
      expect((await queue())[0].status).toBe("accepted");
    });
    it("records one confirmed payment independently from inbox and SMTP, preserving it on failure", async () => {
      await enable();
      const id = await payment();
      await db.query(
        "update public.payments set note='Inny prywatny tekst' where id=$1",
        [id],
      );
      expect((await queue()).map((r) => r.kind)).toEqual(["payment_confirmed"]);
      const [job] = await claim();
      await prepare(job);
      await finish(job, "failed");
      expect(
        (
          await db.query(
            "select status,amount_cents from public.payments where id=$1",
            [id],
          )
        ).rows,
      ).toEqual([{ status: "paid", amount_cents: 100 }]);
      expect((await queue())[0].status).toBe("failed");
    });
    it("cancels an old scheduled event after rescheduling, including between claim and prepare", async () => {
      await enable();
      const id = await consultation();
      const [old] = await claim();
      await asUser(admin, () =>
        db.query(
          "select public.change_consultation($1,2,'schedule','2035-01-02 10:00+00',60,'online','Nowy poufny link','Zmiana terminu')",
          [id],
        ),
      );
      expect(await prepare(old)).toEqual([]);
      const [fresh] = await claim();
      expect(await prepare(fresh)).toMatchObject([
        { kind: "consultation_rescheduled" },
      ]);
      expect((await queue()).map((r) => r.status)).toEqual([
        "cancelled",
        "sending",
      ]);
    });
    it("cancels a scheduled event after cancellation and retains only the current cancellation", async () => {
      await enable();
      const id = await consultation();
      await asUser(admin, () =>
        db.query(
          "select public.change_consultation($1,2,'cancel',null,null,null,'','Odwołanie spotkania')",
          [id],
        ),
      );
      const [job] = await claim();
      expect(await prepare(job)).toMatchObject([
        { kind: "consultation_cancelled" },
      ]);
      expect((await queue()).map((r) => r.status)).toEqual([
        "cancelled",
        "sending",
      ]);
    });
    it("uses the current Auth mailbox and rechecks current role/ownership before transport", async () => {
      await enable();
      await consultation();
      const [job] = await claim();
      await db.query(
        "update auth.users set email='new-owner@example.test' where id=$1",
        [owner],
      );
      expect(await prepare(job)).toMatchObject([
        { recipient: "new-owner@example.test" },
      ]);
      await finish(job);
      await payment();
      const [financial] = await claim();
      await db.query(
        "update public.user_roles set role='admin' where user_id=$1",
        [owner],
      );
      expect(await prepare(financial)).toEqual([]);
    });
    it("does not email a former guardian about a transferred dog's schedule", async () => {
      await enable();
      await consultation();
      const [job] = await claim();
      await db.query("update public.dogs set guardian_id=$1 where id=$2", [
        other,
        dog,
      ]);
      expect(await prepare(job)).toEqual([]);
      expect((await queue())[0].status).toBe("cancelled");
    });
    it("persists uncertain after a lost post-DATA result and never automatically reclaims it", async () => {
      await enable();
      await payment();
      const [job] = await claim();
      await prepare(job);
      await db.query(
        "update public.business_email_outbox set claimed_at=now()-interval '91 seconds' where id=$1",
        [job.id],
      );
      expect(await claim()).toEqual([]);
      expect(await finish(job)).toBe(false);
      expect((await queue())[0].status).toBe("uncertain");
      expect(await claim()).toEqual([]);
    });
    it("safely reclaims an abandoned claim before SMTP and applies bounded backoff to safe retries", async () => {
      await enable();
      await payment();
      const [abandoned] = await claim();
      await db.query(
        "update public.business_email_outbox set claimed_at=now()-interval '91 seconds' where id=$1",
        [abandoned.id],
      );
      expect(await claim()).toEqual([]);
      expect((await queue())[0].status).toBe("retry");
      for (let attempt = 2; attempt <= 5; attempt++) {
        await db.query(
          "update public.business_email_outbox set next_attempt_at=now()-interval '1 second' where id=$1",
          [abandoned.id],
        );
        const [job] = await claim();
        expect(await prepare(job)).toHaveLength(1);
        expect(await finish(job, "retry")).toBe(true);
        const row = (await queue())[0];
        expect(row.attempts).toBe(attempt);
        expect(row.status).toBe(attempt === 5 ? "failed" : "retry");
        expect(await claim()).toEqual([]);
      }
    });
    it("disabling cancels waiting mail and retains delivery history, without replay after re-enable", async () => {
      await enable();
      await payment();
      const [job] = await claim();
      await prepare(job);
      await finish(job);
      await payment();
      await db.exec("update public.business_email_settings set enabled=false");
      await payment();
      await enable();
      expect(await claim()).toEqual([]);
      expect((await queue()).map((r) => r.status)).toEqual([
        "accepted",
        "cancelled",
      ]);
    });
    it("denies raw data and all worker functions to normal users and exposes only admin status counts", async () => {
      await enable();
      await payment();
      for (const user of [owner, other, admin])
        for (const sql of [
          "select * from public.business_email_outbox",
          "select * from public.business_email_settings",
          "select * from public.worker_claim_business_email(1)",
          `select * from public.worker_prepare_business_email('${randomUUID()}','${randomUUID()}')`,
          `select public.worker_finish_business_email('${randomUUID()}','${randomUUID()}','accepted')`,
        ])
          await expect(asUser(user, () => db.exec(sql))).rejects.toThrow(
            /permission denied/,
          );
      await expect(
        asUser(owner, () => db.exec("select public.business_email_status()")),
      ).rejects.toThrow("Brak uprawnień");
      const status = await asUser(admin, () =>
        db.query<{ result: unknown }>(
          "select public.business_email_status() result",
        ),
      );
      expect(status.rows[0].result).toEqual({
        enabled: true,
        counts: { pending: 1 },
      });
    });
    it("enforces small batches and fixture deletion cascades only through owned source IDs", async () => {
      await enable();
      const first = await payment();
      await payment();
      await expect(claim(3)).rejects.toThrow("Invalid email batch");
      const jobs = await claim(2);
      expect(jobs).toHaveLength(2);
      expect(await claim()).toEqual([]);
      await db.query("delete from public.payments where id=$1", [first]);
      expect(await queue()).toHaveLength(1);
    });
    it("drains 50 synthetic jobs through overlapping claim requests without duplicate claims", async () => {
      await enable();
      for (let n = 0; n < 50; n++) await payment();
      const started = performance.now();
      const ids: string[] = [];
      for (let batch = 0; batch < 10; batch++) {
        // PGlite serializes its connection: this tests overlapping worker calls,
        // not independent PostgreSQL sessions or real hosted capacity.
        const groups = await Promise.all(
          Array.from({ length: 5 }, () => claim()),
        );
        for (const [job] of groups) {
          ids.push(job.id);
          expect(await prepare(job)).toHaveLength(1);
          expect(await finish(job)).toBe(true);
        }
      }
      expect(new Set(ids).size).toBe(50);
      expect(
        (await queue()).every(
          (row) => row.status === "accepted" && row.attempts === 1,
        ),
      ).toBe(true);
      expect(await claim()).toEqual([]);
      console.info(
        "Synthetic email queue 50: claims=50 accepted=50 duplicates=0 elapsedMs=" +
          Math.ceil(performance.now() - started),
      );
    });
    it("queues a scheduled reminder once and withdraws it when its source changes before SMTP", async () => {
      await enable();
      const id = await consultation(
        new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
      );
      const [confirmation] = await claim();
      await prepare(confirmation);
      await finish(confirmation);
      await db.exec("select public.worker_process_due_reminders(10)");
      expect((await queue()).map((r) => r.kind)).toEqual([
        "consultation_scheduled",
        "consultation_reminder",
      ]);
      await db.exec("select public.worker_process_due_reminders(10)");
      const [reminder] = await claim();
      await asUser(admin, () =>
        db.query(
          "select public.change_consultation($1,2,'schedule','2035-01-02 10:00+00',60,'online','Aktualny link','Zmiana terminu')",
          [id],
        ),
      );
      expect(await prepare(reminder)).toEqual([]);
      expect(
        (await queue()).filter((row) => row.kind === "consultation_reminder"),
      ).toHaveLength(1);
    });
    it("queues accepted walk participation and invalidates it when the walk moves", async () => {
      const walk = (
        await db.query<{ id: string }>(
          "insert into public.walks(starts_at,type,public_location,price_cents,capacity) values('2036-01-01 10:00+00','Spacer','Park',10000,4) returning id",
        )
      ).rows[0].id;
      const registration = (
        await asUser(owner, () =>
          db.query<{ id: string }>("select public.register_dog($1,$2) id", [
            walk,
            dog,
          ]),
        )
      ).rows[0].id;
      await enable();
      await asUser(admin, () =>
        db.query("select public.decide_registration($1,'accepted','')", [
          registration,
        ]),
      );
      expect((await queue()).map((r) => r.kind)).toEqual([
        "registration_changed",
      ]);
      const [job] = await claim();
      await db.query(
        "update public.walks set starts_at='2036-01-02 10:00+00',updated_at=clock_timestamp() where id=$1",
        [walk],
      );
      expect(await prepare(job)).toEqual([]);
    });
    it("keeps course confirmation and per-session changes separate and withdraws a stale confirmation", async () => {
      const product = (
        await db.query<{ id: string; version: number; sessions_count: number }>(
          "select id,version,sessions_count from public.services where kind='course' and active order by id limit 1",
        )
      ).rows[0];
      const course = randomUUID();
      const enrollment = randomUUID();
      const dates = Array.from({ length: product.sessions_count }, (_, n) =>
        new Date(Date.UTC(2036, 2, n + 1, 10)).toISOString(),
      );
      await asUser(admin, () =>
        db.query(
          "select public.create_course($1,$2,$3,'Syntetyczny kurs',4,'Park','Poufne miejsce',$4::jsonb)",
          [course, product.id, product.version, JSON.stringify(dates)],
        ),
      );
      await asUser(admin, () =>
        db.query("select public.change_course($1,1,'publish','')", [course]),
      );
      await asUser(owner, () =>
        db.query("select public.request_course_enrollment($1,$2,$3,2)", [
          enrollment,
          course,
          dog,
        ]),
      );
      await enable();
      await asUser(admin, () =>
        db.query("select public.change_course_enrollment($1,1,'accept','')", [
          enrollment,
        ]),
      );
      const [confirmation] = await claim();
      const session = (
        await db.query<{ id: string }>(
          "select id from public.course_sessions where course_id=$1 order by ordinal limit 1",
          [course],
        )
      ).rows[0].id;
      await asUser(admin, () =>
        db.query(
          "select public.reschedule_course_session($1,1,'2036-02-20 10:00+00','Inny park','Poufne miejsce','Zmiana terminu')",
          [session],
        ),
      );
      expect(await prepare(confirmation)).toEqual([]);
      const [change] = await claim();
      expect(await prepare(change)).toMatchObject([
        { kind: "course_session_rescheduled" },
      ]);
    });
    it("queues fitness session scheduling and cancels stale messages when the meeting is withdrawn", async () => {
      const product = (
        await db.query<{ id: string; version: number }>(
          "select id,version from public.services where booking_flow='fitness' and active order by id limit 1",
        )
      ).rows[0];
      const entitlement = randomUUID();
      await asUser(owner, () =>
        db.query(
          "select public.request_fitness_package($1,$2,$3,$4,'Cel syntetyczny','')",
          [entitlement, dog, product.id, product.version],
        ),
      );
      await asUser(admin, () =>
        db.query("select public.change_fitness_package($1,1,'accept','',$2)", [
          entitlement,
          randomUUID(),
        ]),
      );
      const session = (
        await db.query<{ id: string }>(
          "select id from public.fitness_sessions where package_id=$1 order by ordinal limit 1",
          [entitlement],
        )
      ).rows[0].id;
      await enable();
      await asUser(admin, () =>
        db.query(
          "select public.save_fitness_session($1,1,'2036-04-01 10:00+00','Poufne miejsce','',$2)",
          [session, randomUUID()],
        ),
      );
      const [confirmation] = await claim();
      await asUser(admin, () =>
        db.query(
          "select public.change_fitness_session($1,2,'cancel',null,'Odwołane spotkanie',$2)",
          [session, randomUUID()],
        ),
      );
      expect(await prepare(confirmation)).toEqual([]);
      const [cancellation] = await claim();
      expect(await prepare(cancellation)).toMatchObject([
        { kind: "fitness_session_cancelled" },
      ]);
    });
    it("queues one package cancellation email after the public RPC withdraws all fitness meetings", async () => {
      const entitlement = await fitnessPackage();
      const session = (
        await db.query<{ id: string }>(
          "select id from public.fitness_sessions where package_id=$1 order by ordinal limit 1",
          [entitlement],
        )
      ).rows[0].id;
      await enable();
      await asUser(admin, () =>
        db.query(
          "select public.save_fitness_session($1,1,'2037-04-01 10:00+00','Poufne miejsce','',$2)",
          [session, randomUUID()],
        ),
      );
      const requestId = randomUUID();
      const cancel = () =>
        asUser(admin, () =>
          db.query(
            "select public.change_fitness_package($1,3,'cancel','Poufny powód rezygnacji',$2)",
            [entitlement, requestId],
          ),
        );
      await cancel();
      await cancel();
      const sessions = (
        await db.query<{ status: string }>(
          "select status from public.fitness_sessions where package_id=$1",
          [entitlement],
        )
      ).rows;
      expect(sessions.length).toBeGreaterThan(0);
      expect(sessions.every((row) => row.status === "cancelled")).toBe(true);
      const cancellationRows = (await queue()).filter(
        (row) => row.kind === "fitness_cancelled",
      );
      expect(cancellationRows).toHaveLength(1);
      const [cancellation] = await claim();
      expect(await prepare(cancellation)).toMatchObject([
        { recipient: "owner@example.test", kind: "fitness_cancelled" },
      ]);
      expect(await finish(cancellation)).toBe(true);
      expect(await claim()).toEqual([]);
      expect(JSON.stringify(await queue())).not.toContain("Poufny");
    });
    it("withdraws a claimed package cancellation email after the public restore RPC reactivates the package", async () => {
      const entitlement = await fitnessPackage();
      await enable();
      await asUser(admin, () =>
        db.query(
          "select public.change_fitness_package($1,2,'cancel','Rezygnacja przed terminem',$2)",
          [entitlement, randomUUID()],
        ),
      );
      const [cancellation] = await claim();
      expect(cancellation).toBeDefined();
      await asUser(admin, () =>
        db.query(
          "select public.change_fitness_package($1,3,'restore','Przywrócenie pakietu',$2)",
          [entitlement, randomUUID()],
        ),
      );
      expect(await prepare(cancellation)).toEqual([]);
      expect(
        (await queue()).filter((row) => row.kind === "fitness_cancelled"),
      ).toMatchObject([{ status: "cancelled" }]);
      expect(
        (
          await db.query<{ status: string }>(
            "select status from public.fitness_packages where id=$1",
            [entitlement],
          )
        ).rows[0].status,
      ).toBe("active");
      expect(await claim()).toEqual([]);
    });
    it("never revalidates an earlier cancellation after reconsidering and cancelling a pending package again", async () => {
      const entitlement = await fitnessPackage(false);
      await enable();
      await asUser(admin, () =>
        db.query(
          "select public.change_fitness_package($1,1,'cancel','Pierwsza rezygnacja',$2)",
          [entitlement, randomUUID()],
        ),
      );
      const [old] = await claim();
      expect(old).toBeDefined();
      await asUser(admin, () =>
        db.query(
          "select public.change_fitness_package($1,2,'reconsider','Ponowne rozpatrzenie',$2)",
          [entitlement, randomUUID()],
        ),
      );
      await asUser(admin, () =>
        db.query(
          "select public.change_fitness_package($1,3,'cancel','Druga rezygnacja',$2)",
          [entitlement, randomUUID()],
        ),
      );
      expect(await prepare(old)).toEqual([]);
      const [current] = await claim();
      expect(await prepare(current)).toMatchObject([
        { kind: "fitness_cancelled" },
      ]);
      expect(
        (await queue())
          .filter((row) => row.kind === "fitness_cancelled")
          .map((row) => row.status),
      ).toEqual(["cancelled", "sending"]);
    });
    it.each([0, 100])(
      "keeps a package cancellation current after settlement of %i cents and any remaining manual payment",
      async (amount) => {
        const entitlement = await fitnessPackage();
        await enable();
        await asUser(admin, () =>
          db.query(
            "select public.change_fitness_package($1,2,'cancel','Odwołanie pakietu',$2)",
            [entitlement, randomUUID()],
          ),
        );
        const [cancellation] = await claim();
        expect(await sourceCurrent(cancellation)).toBe(true);
        await asUser(admin, () =>
          db.query(
            "select public.settle_fitness_package($1,3,$2,'Uzgodniona należność po odwołaniu',$3)",
            [entitlement, amount, randomUUID()],
          ),
        );
        expect(await sourceCurrent(cancellation)).toBe(true);
        if (amount) {
          await asUser(admin, () =>
            db.query(
              "select public.record_fitness_payment($1,$2,'cash','Wpłata po odwołaniu',$3)",
              [entitlement, amount, randomUUID()],
            ),
          );
          expect(await sourceCurrent(cancellation)).toBe(true);
        }
        const current = (
          await db.query<{ status: string; version: number }>(
            "select status,version from public.fitness_packages where id=$1",
            [entitlement],
          )
        ).rows[0];
        expect(current.status).toBe("cancelled");
        expect(current.version).toBe(amount ? 5 : 4);
        expect(await prepare(cancellation)).toMatchObject([
          { kind: "fitness_cancelled" },
        ]);
        expect(await finish(cancellation)).toBe(true);
        expect(
          (await queue()).filter((row) => row.kind === "fitness_cancelled"),
        ).toMatchObject([{ status: "accepted" }]);
      },
    );
    it("migrates only current unsent cancellation identities from 64 without changing leases, attempts or historical outcomes", async () => {
      const migration64 = readFileSync(
        "supabase/migrations/202610230003_fitness_cancel_email.sql",
        "utf8",
      );
      const migration65 = readFileSync(
        "supabase/migrations/202610230004_fitness_cancel_identity.sql",
        "utf8",
      );
      type Snapshot = {
        id: string;
        status: string;
        source_token: string;
        [key: string]: unknown;
      };
      const snapshot = async () =>
        (
          await db.query<{ row: Snapshot }>(
            "select to_jsonb(o) row from public.business_email_outbox o order by o.id",
          )
        ).rows.map(({ row }) => row);
      const makeCancelled = async () => {
        const entitlement = await fitnessPackage();
        await asUser(admin, () =>
          db.query(
            "select public.change_fitness_package($1,2,'cancel','Odwołanie pakietu',$2)",
            [entitlement, randomUUID()],
          ),
        );
        const job = (
          await db.query<{ id: string }>(
            "select o.id from public.business_email_outbox o join public.notifications n on n.id=o.notification_id where n.entity_id=$1 and o.kind='fitness_cancelled'",
            [entitlement],
          )
        ).rows[0];
        return { entitlement, id: job.id };
      };
      await db.exec(migration64);
      try {
        await enable();
        const accepted = await makeCancelled();
        const [acceptedClaim] = await claim();
        expect(acceptedClaim.id).toBe(accepted.id);
        await prepare(acceptedClaim);
        await finish(acceptedClaim);
        const uncertain = await makeCancelled();
        const [uncertainClaim] = await claim();
        expect(uncertainClaim.id).toBe(uncertain.id);
        await prepare(uncertainClaim);
        await finish(uncertainClaim, "uncertain");
        const sending = await makeCancelled();
        const [sendingClaim] = await claim();
        expect(sendingClaim.id).toBe(sending.id);
        await prepare(sendingClaim);
        const retry = await makeCancelled();
        const [retryClaim] = await claim();
        expect(retryClaim.id).toBe(retry.id);
        await prepare(retryClaim);
        await finish(retryClaim, "retry");
        const claimed = await makeCancelled();
        const [originalClaim] = await claim();
        expect(originalClaim.id).toBe(claimed.id);
        const pending = await makeCancelled();
        await asUser(admin, () =>
          db.query(
            "select public.settle_fitness_package($1,3,0,'Rozliczenie przed migracją',$2)",
            [pending.entitlement, randomUUID()],
          ),
        );
        expect(await sourceCurrent(pending)).toBe(false);
        const oldCycle = await makeCancelled();
        await asUser(admin, () =>
          db.query(
            "select public.change_fitness_package($1,3,'restore','Przywrócenie pakietu',$2)",
            [oldCycle.entitlement, randomUUID()],
          ),
        );
        await asUser(admin, () =>
          db.query(
            "select public.change_fitness_package($1,4,'cancel','Nowe odwołanie pakietu',$2)",
            [oldCycle.entitlement, randomUUID()],
          ),
        );
        const currentCycle = (
          await db.query<{ id: string }>(
            "select o.id from public.business_email_outbox o join public.notifications n on n.id=o.notification_id where n.entity_id=$1 and o.kind='fitness_cancelled' and o.id<>$2",
            [oldCycle.entitlement, oldCycle.id],
          )
        ).rows[0];
        const before = await snapshot();
        await db.exec(migration65);
        const after = await snapshot();
        expect(after).toHaveLength(before.length);
        const changed = new Set([
          retry.id,
          claimed.id,
          pending.id,
          currentCycle.id,
        ]);
        for (const previous of before) {
          const current = after.find((row) => row.id === previous.id)!;
          if (changed.has(previous.id)) {
            expect(current.source_token).not.toBe(previous.source_token);
            expect({ ...current, source_token: previous.source_token }).toEqual(
              previous,
            );
          } else expect(current).toEqual(previous);
        }
        expect(await sourceCurrent(originalClaim)).toBe(true);
        expect(await sourceCurrent(pending)).toBe(true);
        expect(await prepare(originalClaim)).toMatchObject([
          { kind: "fitness_cancelled" },
        ]);
        expect(await finish(originalClaim)).toBe(true);
        expect(
          (
            await db.query<{ current: boolean }>(
              "select public.business_email_source_current($1) current",
              [oldCycle.id],
            )
          ).rows[0].current,
        ).toBe(false);
      } finally {
        await db.exec(migration65);
      }
    });
  },
);
