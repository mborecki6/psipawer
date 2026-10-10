import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

let db: PGlite;
const admin = "91000000-0000-4000-8000-000000000001",
  owner = "91000000-0000-4000-8000-000000000002",
  other = "91000000-0000-4000-8000-000000000003",
  colleague = "91000000-0000-4000-8000-000000000004";
const dog = "92000000-0000-4000-8000-000000000001",
  otherDog = "92000000-0000-4000-8000-000000000002";
const service = "60000000-0000-4000-8000-000000000001";
const start = () => new Date(Date.now() + 7 * 86400000).toISOString();
const plus = (s: string, minutes: number) =>
  new Date(Date.parse(s) + minutes * 60000).toISOString();
const times = (s = start()) =>
  Array.from({ length: 5 }, (_, i) => plus(s, i * 7 * 24 * 60));
async function asUser<T>(id: string, run: () => Promise<T>) {
  await db.exec("begin;set local role authenticated");
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
const asAdmin = <T>(run: () => Promise<T>) => asUser(admin, run);
async function create(
  id = randomUUID(),
  starts = times(),
  capacity = 1,
  actor = admin,
) {
  return asUser(actor, () =>
    db.query<{ id: string }>(
      "select public.create_course($1,$2,1,'Pierwszy kurs',$3,'Okolica parku','TAJNA ZBIÓRKA',$4) as id",
      [id, service, capacity, JSON.stringify(starts)],
    ),
  );
}
async function course(capacity = 1) {
  const id = randomUUID();
  await create(id, times(), capacity);
  await change(id, 1, "publish");
  return id;
}
const change = (id: string, version: number, action: string, note = "") =>
  asAdmin(() =>
    db.query<{ version: number }>(
      "select public.change_course($1,$2,$3,$4) as version",
      [id, version, action, note],
    ),
  );
async function enroll(
  id: string,
  dogId = dog,
  actor = owner,
  request = randomUUID(),
  expected = 2,
) {
  await asUser(actor, () =>
    db.query("select public.request_course_enrollment($1,$2,$3,$4)", [
      request,
      id,
      dogId,
      expected,
    ]),
  );
  return request;
}
const decide = (
  id: string,
  version: number,
  action: string,
  note = "",
  actor = admin,
) =>
  asUser(actor, () =>
    db.query<{ version: number }>(
      "select public.change_course_enrollment($1,$2,$3,$4) as version",
      [id, version, action, note],
    ),
  );
const sessions = async (id: string) =>
  (
    await db.query<{ id: string; starts_at: Date; version: number }>(
      "select id,starts_at,version from public.course_sessions where course_id=$1 order by ordinal",
      [id],
    )
  ).rows;
const state = async (id: string) =>
  (
    await db.query<{
      status: string;
      version: number;
      charge_cents: number;
      agreed_price_cents: number;
    }>(
      "select status,version,charge_cents,agreed_price_cents from public.course_enrollments where id=$1",
      [id],
    )
  ).rows[0];

const courseBalance = async (id: string, actor = admin) =>
  (
    await asUser(actor, () =>
      db.query<Record<string, unknown>>(
        "select * from public.course_balances where id=$1",
        [id],
      ),
    )
  ).rows[0];
const coursePay = async (
  id: string,
  amount = 10000,
  key = randomUUID(),
  actor = admin,
  note = "Wpłata za cykl",
) =>
  (
    await asUser(actor, () =>
      db.query<{ id: string }>(
        "select public.record_payment(null,null,$1,'transfer',$2,$3,null,$4) as id",
        [amount, note, key, id],
      ),
    )
  ).rows[0].id;
const courseRefund = async (
  payment: string,
  amount: number,
  key = randomUUID(),
  actor = admin,
  note = "Uzgodniony zwrot",
) =>
  (
    await asUser(actor, () =>
      db.query<{ id: string }>(
        "select public.refund_course_payment($1,$2,$3,$4) as id",
        [payment, amount, note, key],
      ),
    )
  ).rows[0].id;
const courseSettle = async (
  id: string,
  version: number,
  amount: number,
  key = randomUUID(),
  actor = admin,
  note = "Uzgodniono końcową kwotę",
) =>
  (
    await asUser(actor, () =>
      db.query<{ version: number }>(
        "select public.settle_course_enrollment($1,$2,$3,$4,$5) as version",
        [id, version, amount, note, key],
      ),
    )
  ).rows[0].version;
async function acceptedCourse() {
  const cycle = await course(),
    id = await enroll(cycle);
  await decide(id, 1, "accept");
  return { cycle, id };
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
    .filter((file) => file.endsWith(".sql"))
    .sort())
    await db.exec(readFileSync(`supabase/migrations/${file}`, "utf8"));
  await db.query("insert into auth.users(id) values($1),($2),($3),($4)", [
    admin,
    owner,
    other,
    colleague,
  ]);
  await db.query(
    "update public.user_roles set role='admin' where user_id in ($1,$2)",
    [admin, colleague],
  );
  await db.query(
    "insert into public.dogs(id,guardian_id,name) values($1,$2,'Szczeniak'),($3,$4,'Drugi pies')",
    [dog, owner, otherDog, other],
  );
});

describe.sequential(
  "course receipts, explicit settlements and partial refunds",
  () => {
    it("keeps the frozen liability payable after the cycle is completed", async () => {
      const { cycle, id } = await acceptedCourse();
      await db.query(
        "update public.course_sessions set starts_at=now()-interval '1 day',status='completed' where course_id=$1",
        [cycle],
      );
      await change(cycle, 2, "complete");
      expect(await courseBalance(id)).toMatchObject({
        course_status: "completed",
        status: "accepted",
        due_cents: 10000,
        can_pay: true,
      });
      await coursePay(id);
      expect(await courseBalance(id)).toMatchObject({
        paid_cents: 10000,
        due_cents: 0,
      });
    });
    it("charges the whole frozen cycle only after acceptance and preserves partial receipt amounts", async () => {
      const cycle = await course(),
        id = await enroll(cycle);
      expect(await courseBalance(id)).toMatchObject({
        charge_cents: 0,
        due_cents: 0,
        can_pay: false,
      });
      await expect(coursePay(id)).rejects.toThrow("przyjętego");
      await decide(id, 1, "accept");
      await coursePay(id, 4000);
      await db.query(
        "update public.services set price_cents=15000,version=2 where id=$1",
        [service],
      );
      expect(await courseBalance(id)).toMatchObject({
        agreed_price_cents: 10000,
        charge_cents: 10000,
        paid_cents: 4000,
        due_cents: 6000,
        version: 3,
      });
      await coursePay(id, 6000);
      expect(await courseBalance(id)).toMatchObject({
        paid_cents: 10000,
        due_cents: 0,
        version: 4,
      });
      await expect(coursePay(id, 1)).rejects.toThrow("przekracza");
      expect(
        (
          await db.query(
            "select amount_cents from public.payments order by amount_cents",
          )
        ).rows,
      ).toEqual([{ amount_cents: 4000 }, { amount_cents: 6000 }]);
    });
    it("preserves a paid cancellation until staff settle it, without pretending money was returned", async () => {
      const { id } = await acceptedCourse();
      await coursePay(id);
      await decide(id, 3, "cancel", "Rezygnacja opiekuna", owner);
      expect(await courseBalance(id, owner)).toMatchObject({
        status: "cancelled",
        charge_cents: 10000,
        paid_cents: 10000,
        due_cents: 0,
        needs_settlement: true,
        needs_review: true,
        can_pay: false,
      });
      await expect(coursePay(id, 1)).rejects.toThrow("przyjętego");
      await courseSettle(id, 4, 3000);
      expect(await courseBalance(id, owner)).toMatchObject({
        agreed_price_cents: 10000,
        charge_cents: 3000,
        paid_cents: 10000,
        due_cents: 0,
        refund_due_cents: 7000,
        refunded_cents: 0,
        needs_settlement: false,
        needs_review: true,
      });
      expect(
        (await db.query("select amount_cents,status from public.payments"))
          .rows,
      ).toEqual([{ amount_cents: 10000, status: "paid" }]);
      expect(
        (await db.query("select id from public.course_payment_refunds")).rows,
      ).toEqual([]);
    });
    it("settles cancellation without a receipt and accepts only the explicitly agreed retained fee", async () => {
      const { cycle, id } = await acceptedCourse();
      await change(cycle, 2, "cancel", "Odwołany cykl");
      expect(await courseBalance(id)).toMatchObject({
        paid_cents: 0,
        due_cents: 0,
        needs_settlement: true,
      });
      await courseSettle(id, 3, 2500);
      expect(await courseBalance(id)).toMatchObject({
        due_cents: 2500,
        can_pay: true,
      });
      await coursePay(id, 2500);
      expect(await courseBalance(id)).toMatchObject({
        paid_cents: 2500,
        due_cents: 0,
        needs_review: false,
      });
      await expect(coursePay(id, 1)).rejects.toThrow("przekracza");
    });
    it("tracks two partial refunds independently, keeps original receipts and finishes the exact net balance", async () => {
      const { id } = await acceptedCourse();
      const first = await coursePay(id, 4000),
        second = await coursePay(id, 6000);
      await decide(id, 4, "cancel", "Rezygnacja opiekuna", owner);
      await courseSettle(id, 5, 3000);
      await courseRefund(second, 5000);
      expect(await courseBalance(id)).toMatchObject({
        paid_cents: 5000,
        refunded_cents: 5000,
        refund_due_cents: 2000,
        needs_review: true,
      });
      await courseRefund(first, 2000);
      expect(await courseBalance(id, owner)).toMatchObject({
        charge_cents: 3000,
        paid_cents: 3000,
        refunded_cents: 7000,
        refund_due_cents: 0,
        due_cents: 0,
        needs_review: false,
      });
      expect(
        (
          await db.query(
            "select amount_cents,status from public.payments order by amount_cents",
          )
        ).rows,
      ).toEqual([
        { amount_cents: 4000, status: "paid" },
        { amount_cents: 6000, status: "paid" },
      ]);
      expect(
        (
          await db.query(
            "select amount_cents from public.course_payment_refunds order by amount_cents",
          )
        ).rows,
      ).toEqual([{ amount_cents: 2000 }, { amount_cents: 5000 }]);
    });
    it("full reversal after a partial refund returns only the remainder and is safe to retry", async () => {
      const { id } = await acceptedCourse(),
        payment = await coursePay(id);
      await courseRefund(payment, 4000);
      const reverse = () =>
        asAdmin(() =>
          db.query("select public.void_payment($1,'Zwrot reszty wpłaty')", [
            payment,
          ]),
        );
      await reverse();
      await reverse();
      expect(await courseBalance(id)).toMatchObject({
        paid_cents: 0,
        refunded_cents: 10000,
        due_cents: 10000,
      });
      expect(
        (
          await db.query(
            "select amount_cents from public.course_payment_refunds order by amount_cents",
          )
        ).rows,
      ).toEqual([{ amount_cents: 4000 }, { amount_cents: 6000 }]);
      expect(
        (await db.query("select amount_cents,status from public.payments"))
          .rows,
      ).toEqual([{ amount_cents: 10000, status: "refunded" }]);
      expect(
        (
          await db.query(
            "select id from public.audit_events where event='payment_refunded'",
          )
        ).rows,
      ).toHaveLength(2);
    });
    it("retries receipts and partial refunds after cancellation, settlement, later receipts and a full refund", async () => {
      const { id } = await acceptedCourse(),
        receiptKey = randomUUID(),
        refundKey = randomUUID();
      const payment = await coursePay(id, 10000, receiptKey);
      expect(await coursePay(id, 10000, receiptKey)).toBe(payment);
      expect(await courseRefund(payment, 4000, refundKey)).toBe(refundKey);
      await courseRefund(payment, 6000);
      await decide(id, 5, "cancel", "Zakończono udział", owner);
      await courseSettle(id, 6, 0);
      expect(await courseRefund(payment, 4000, refundKey)).toBe(refundKey);
      expect(await coursePay(id, 10000, receiptKey)).toBe(payment);
      await expect(coursePay(id, 9999, receiptKey)).rejects.toThrow(
        "identyfikator wpłaty",
      );
      await expect(courseRefund(payment, 4001, refundKey)).rejects.toThrow(
        "identyfikator zwrotu",
      );
      await expect(
        courseRefund(payment, 4000, refundKey, admin, "Inny powód"),
      ).rejects.toThrow("identyfikator zwrotu");
      expect(
        (await db.query("select id from public.payments")).rows,
      ).toHaveLength(1);
      expect(
        (await db.query("select id from public.course_payment_refunds")).rows,
      ).toHaveLength(2);
    });
    it("preserves exact settlement receipts across later revisions and rejects stale or reused commands", async () => {
      const { id } = await acceptedCourse(),
        key = randomUUID();
      await decide(id, 2, "cancel", "Zakończono udział", owner);
      expect(await courseSettle(id, 3, 2000, key)).toBe(4);
      await coursePay(id, 1000);
      expect(await courseSettle(id, 3, 2000, key)).toBe(4);
      await expect(courseSettle(id, 4, 0)).rejects.toThrow(
        "Zgłoszenie zmieniło się",
      );
      await expect(courseSettle(id, 3, 0, key)).rejects.toThrow(
        "identyfikator rozliczenia",
      );
      await courseSettle(id, 5, 0);
      expect(await courseSettle(id, 3, 2000, key)).toBe(4);
      expect(await courseBalance(id)).toMatchObject({
        charge_cents: 0,
        paid_cents: 1000,
        refund_due_cents: 1000,
        version: 6,
      });
    });
    it("cannot create a fee for a never-accepted request, exceed the frozen quote or settle an active participant", async () => {
      const { id } = await acceptedCourse();
      await expect(courseSettle(id, 2, 0)).rejects.toThrow("po rezygnacji");
      await decide(id, 2, "cancel", "Zakończono udział", owner);
      await expect(courseSettle(id, 3, 10001)).rejects.toThrow(
        "ceny przyjętego",
      );
      await courseSettle(id, 3, 0);
      // The other dog can request this still-open cycle without obtaining a seat.
      const cycle = (await courseBalance(id))!.course_id as string,
        waiting = await enroll(cycle, otherDog, other);
      await decide(waiting, 1, "cancel", "Wycofano prośbę", other);
      expect(await courseBalance(waiting)).toMatchObject({
        due_cents: 0,
        needs_review: false,
      });
      await expect(courseSettle(waiting, 2, 1)).rejects.toThrow(
        "ceny przyjętego",
      );
      await courseSettle(waiting, 2, 0);
    });
    it("limits refunds to the remaining receipt and allows corrected active-course payments", async () => {
      const { id } = await acceptedCourse(),
        payment = await coursePay(id);
      await courseRefund(payment, 7500);
      await expect(courseRefund(payment, 2501)).rejects.toThrow(
        "Zwrot przekracza",
      );
      expect(await courseBalance(id)).toMatchObject({
        paid_cents: 2500,
        due_cents: 7500,
      });
      await coursePay(id, 7500);
      expect(await courseBalance(id)).toMatchObject({
        paid_cents: 10000,
        due_cents: 0,
      });
      await expect(coursePay(id, 1)).rejects.toThrow("Wpłata przekracza");
    });
    it("retains the enrollment guardian for balances, receipts and refunds if dog ownership later changes", async () => {
      const { id } = await acceptedCourse();
      await db.query("update public.dogs set guardian_id=$1 where id=$2", [
        other,
        dog,
      ]);
      try {
        const payment = await coursePay(id, 4000);
        await courseRefund(payment, 1000);
        expect(await courseBalance(id, owner)).toMatchObject({
          guardian_id: owner,
          paid_cents: 3000,
        });
        expect(await courseBalance(id, other)).toBeUndefined();
        expect(
          (
            await asUser(other, () =>
              db.query("select id from public.payments"),
            )
          ).rows,
        ).toEqual([]);
        expect(
          (
            await asUser(other, () =>
              db.query("select id from public.course_payment_refunds"),
            )
          ).rows,
        ).toEqual([]);
        expect(
          (
            await asUser(owner, () =>
              db.query("select guardian_id from public.course_payment_refunds"),
            )
          ).rows,
        ).toEqual([{ guardian_id: owner }]);
      } finally {
        await db.query("update public.dogs set guardian_id=$1 where id=$2", [
          owner,
          dog,
        ]);
      }
    });
    it("keeps financial history private to staff and the enrollment guardian and denies direct writes", async () => {
      const { id } = await acceptedCourse(),
        payment = await coursePay(id);
      await courseRefund(payment, 1000);
      await decide(id, 4, "cancel", "Rezygnacja", owner);
      await courseSettle(id, 5, 2000);
      expect(
        (
          await asUser(owner, () =>
            db.query("select id from public.course_payment_refunds"),
          )
        ).rows,
      ).toHaveLength(1);
      expect(
        (
          await asUser(other, () =>
            db.query("select id from public.course_payment_refunds"),
          )
        ).rows,
      ).toEqual([]);
      expect(
        (
          await asUser(owner, () =>
            db.query(
              "select request_id from public.course_settlement_receipts",
            ),
          )
        ).rows,
      ).toEqual([]);
      expect(
        (
          await asUser(other, () =>
            db.query(
              "select id from public.course_history where action in ('settled','payment_recorded','payment_refunded')",
            ),
          )
        ).rows,
      ).toEqual([]);
      for (const table of [
        "course_payment_refunds",
        "course_settlement_receipts",
        "course_enrollments",
        "payments",
        "course_balances",
      ])
        await expect(
          asAdmin(() => db.query(`delete from public.${table}`)),
        ).rejects.toThrow();
      for (const actor of [owner, other]) {
        await expect(coursePay(id, 1, randomUUID(), actor)).rejects.toThrow(
          "Brak uprawnień",
        );
        await expect(
          courseRefund(payment, 1, randomUUID(), actor),
        ).rejects.toThrow("Brak uprawnień");
        await expect(
          courseSettle(id, 6, 0, randomUUID(), actor),
        ).rejects.toThrow("Brak uprawnień");
      }
      expect(
        (
          await db.query<{ count: number }>(
            "select count(*)::int as count from public.course_history where action in ('settled','payment_recorded','payment_refunded')",
          )
        ).rows[0].count,
      ).toBe(3);
    });
    it("revokes anonymous financial reads and calls and validates money and the fourth target at SQL boundary", async () => {
      const { id } = await acceptedCourse(),
        payment = await coursePay(id, 1000);
      for (const table of [
        "course_balances",
        "course_payment_refunds",
        "course_settlement_receipts",
      ])
        expect(
          (
            await db.query<{ allowed: boolean }>(
              "select has_table_privilege('anon',$1,'select') as allowed",
              [`public.${table}`],
            )
          ).rows[0].allowed,
        ).toBe(false);
      for (const signature of [
        "public.settle_course_enrollment(uuid,integer,integer,text,uuid)",
        "public.refund_course_payment(uuid,integer,text,uuid)",
        "public.record_payment(uuid,uuid,integer,text,text,uuid,uuid,uuid)",
      ])
        expect(
          (
            await db.query<{ allowed: boolean }>(
              "select has_function_privilege('anon',$1,'execute') as allowed",
              [signature],
            )
          ).rows[0].allowed,
        ).toBe(false);
      for (const amount of [0, -1, 1000001]) {
        await expect(coursePay(id, amount)).rejects.toThrow("poprawną kwotę");
        await expect(courseRefund(payment, amount)).rejects.toThrow(
          "kwotę i powód",
        );
      }
      await expect(
        asAdmin(() =>
          db.query(
            "select public.record_payment(null,$1,1,'cash','',$2,null,$3)",
            [randomUUID(), randomUUID(), id],
          ),
        ),
      ).rejects.toThrow("jedno rozliczenie");
      await expect(
        db.query(
          "insert into public.payments(guardian_id,dog_id,package_id,course_enrollment_id,amount_cents,method,author_id) values($1,$2,$3,$4,1,'cash',$5)",
          [owner, dog, randomUUID(), id, admin],
        ),
      ).rejects.toThrow("payment_single_target");
    });
    it("rolls back each financial mutation, its receipt, version and history when auditing fails", async () => {
      const { id } = await acceptedCourse(),
        payment = await coursePay(id, 4000);
      await db.exec(
        "create function public.fail_course_finance() returns trigger language plpgsql as $$begin if new.event in ('payment_recorded','payment_refunded','course_enrollment_settled') then raise exception 'finance audit failure';end if;return new;end$$;create trigger fail_course_finance before insert on public.audit_events for each row execute function public.fail_course_finance();",
      );
      try {
        await expect(coursePay(id, 6000)).rejects.toThrow(
          "finance audit failure",
        );
        await expect(courseRefund(payment, 1000)).rejects.toThrow(
          "finance audit failure",
        );
        expect(await courseBalance(id)).toMatchObject({
          version: 3,
          paid_cents: 4000,
          refunded_cents: 0,
          due_cents: 6000,
        });
        await decide(id, 3, "cancel", "Rezygnacja", owner);
        await expect(courseSettle(id, 4, 0)).rejects.toThrow(
          "finance audit failure",
        );
        expect(await courseBalance(id)).toMatchObject({
          version: 4,
          charge_cents: 10000,
          needs_settlement: true,
        });
        expect(
          (await db.query("select id from public.payments")).rows,
        ).toHaveLength(1);
        expect(
          (await db.query("select id from public.course_payment_refunds")).rows,
        ).toEqual([]);
        expect(
          (
            await db.query(
              "select request_id from public.course_settlement_receipts",
            )
          ).rows,
        ).toEqual([]);
        expect(
          (
            await db.query(
              "select id from public.course_history where action in ('settled','payment_recorded','payment_refunded')",
            )
          ).rows,
        ).toHaveLength(1);
      } finally {
        await db.exec(
          "drop trigger fail_course_finance on public.audit_events;drop function public.fail_course_finance();",
        );
      }
    });
  },
);
beforeEach(async () => {
  await db.exec(
    "truncate public.courses cascade;truncate public.care_events cascade;truncate public.calendar_blocks cascade;delete from public.audit_events;",
  );
  await db.query(
    "update public.services set version=1,price_cents=10000,active=true,is_test_price=true where id=$1",
    [service],
  );
  await db.exec(
    "drop trigger if exists course_notice_test_failure on public.notifications;",
  );
  await db.query(
    "update public.dogs set guardian_id=$1,name='Szczeniak' where id=$2",
    [owner, dog],
  );
  await db.query(
    "update public.user_roles set role='client' where user_id=$1",
    [owner],
  );
});
afterAll(async () => {
  await db?.close();
});

const editSettings = async (
  cycle: string,
  version: number,
  capacity = 3,
  key = randomUUID(),
  title = "Nowa nazwa kursu",
  note = "Zmiana ustawień grupy",
  actor = admin,
) =>
  (
    await asUser(actor, () =>
      db.query<{ version: number }>(
        "select public.edit_course($1,$2,$3,$4,$5,$6) as version",
        [cycle, version, title, capacity, note, key],
      ),
    )
  ).rows[0].version;
const correctAttendance = async (
  session: string,
  enrollment: string,
  version = 1,
  attendance = "excused",
  note = "Usprawiedliwiona nieobecność",
  actor = admin,
) =>
  (
    await asUser(actor, () =>
      db.query<{ version: number }>(
        "select public.correct_course_attendance($1,$2,$3,$4,$5) as version",
        [session, enrollment, version, attendance, note],
      ),
    )
  ).rows[0].version;
async function completedAttendance() {
  const { cycle, id } = await acceptedCourse(),
    session = (await sessions(cycle))[0].id;
  await db.query(
    "update public.course_sessions set starts_at=now()-interval '2 hours' where id=$1",
    [session],
  );
  await asAdmin(() =>
    db.query("select public.record_course_attendance($1,$2,0,'present')", [
      session,
      id,
    ]),
  );
  await db.query(
    "update public.course_sessions set status='completed' where id=$1",
    [session],
  );
  return { cycle, id, session };
}
describe.sequential(
  "course settings and historical attendance corrections",
  () => {
    it("edits name/capacity while preserving frozen quotes, calendar, enrollments and reminder generations", async () => {
      const { cycle, id } = await acceptedCourse(),
        balance = await courseBalance(id),
        jobs = await courseJobs(),
        meetings = await sessions(cycle);
      await db.query(
        "update public.services set price_cents=15000,version=2 where id=$1",
        [service],
      );
      expect(await editSettings(cycle, 2, 3)).toBe(3);
      expect(await courseBalance(id)).toEqual({
        ...balance,
        course_title: "Nowa nazwa kursu",
      });
      expect(await courseJobs()).toEqual(jobs);
      expect(await sessions(cycle)).toEqual(meetings);
      expect(
        (
          await db.query(
            "select title,capacity,price_cents from public.courses where id=$1",
            [cycle],
          )
        ).rows[0],
      ).toEqual({ title: "Nowa nazwa kursu", capacity: 3, price_cents: 10000 });
      expect(
        (await courseNotices(owner)).filter((n) => n.kind === "course_updated"),
      ).toHaveLength(1);
    });
    it("rejects capacity below accepted count and never promotes the reserve", async () => {
      const cycle = await course(2),
        id = await enroll(cycle),
        second = await enroll(cycle, otherDog, other);
      await decide(id, 1, "accept");
      await decide(second, 1, "accept");
      await expect(editSettings(cycle, 2, 1)).rejects.toThrow(
        "liczby przyjętych",
      );
      await decide(second, 2, "cancel", "Rezygnacja", other);
      const reserveDog = randomUUID();
      await db.query(
        "insert into public.dogs(id,guardian_id,name) values($1,$2,'Rezerwa ustawień')",
        [reserveDog, other],
      );
      try {
        const third = await enroll(cycle, reserveDog, other);
        await decide(third, 1, "waitlist");
        expect(await editSettings(cycle, 2, 3)).toBe(3);
        expect((await state(id)).status).toBe("accepted");
        expect((await state(third)).status).toBe("waitlisted");
      } finally {
        await db.query("delete from public.courses where id=$1", [cycle]);
        await db.query("delete from public.dogs where id=$1", [reserveDog]);
      }
    });
    it("retains an exact settings receipt after later changes and rejects key reuse by another payload or author", async () => {
      const cycle = await course(),
        key = randomUUID();
      expect(await editSettings(cycle, 2, 3, key)).toBe(3);
      expect(await editSettings(cycle, 3, 4)).toBe(4);
      expect(await editSettings(cycle, 2, 3, key)).toBe(3);
      await expect(editSettings(cycle, 2, 4, key)).rejects.toThrow(
        "zapis ustawień",
      );
      await expect(
        editSettings(
          cycle,
          2,
          3,
          key,
          "Nowa nazwa kursu",
          "Zmiana ustawień grupy",
          colleague,
        ),
      ).rejects.toThrow("zapis ustawień");
      await change(cycle, 4, "cancel", "Odwołanie po zmianach");
      expect(await editSettings(cycle, 2, 3, key)).toBe(3);
      expect(
        (
          await db.query(
            "select id from public.course_history where action='settings'",
          )
        ).rows,
      ).toHaveLength(2);
    });
    it("rejects stale/closed-cycle settings, client mutations and direct receipt writes", async () => {
      const cycle = await course();
      await editSettings(cycle, 2, 3);
      await expect(editSettings(cycle, 2, 4)).rejects.toThrow(
        "Kurs zmienił się",
      );
      await expect(
        editSettings(
          cycle,
          3,
          3,
          randomUUID(),
          "Nowa nazwa kursu",
          "Zmiana ustawień grupy",
          owner,
        ),
      ).rejects.toThrow("Brak uprawnień");
      await change(cycle, 3, "cancel", "Odwołany cykl");
      await expect(editSettings(cycle, 4, 3)).rejects.toThrow(
        "szkicu lub trwającym",
      );
      await expect(
        asUser(owner, () =>
          db.query("delete from public.course_settings_receipts"),
        ),
      ).rejects.toThrow("permission denied");
    });
    it("keeps a no-op settings receipt without history and preserves the individual course limit", async () => {
      const cycle = await course(),
        key = randomUUID();
      expect(await editSettings(cycle, 2, 1, key, "Pierwszy kurs")).toBe(2);
      expect(await editSettings(cycle, 2, 1, key, "Pierwszy kurs")).toBe(2);
      expect(
        (
          await db.query(
            "select id from public.course_history where action='settings'",
          )
        ).rows,
      ).toEqual([]);
      await db.query(
        "update public.courses set course_format='individual' where id=$1",
        [cycle],
      );
      await expect(editSettings(cycle, 2, 2)).rejects.toThrow("jednego psa");
    });
    it("rejects reusing a settings receipt for another course after the original cycle is cancelled", async () => {
      const first = await course(),
        key = randomUUID();
      await editSettings(first, 2, 3, key);
      await change(first, 3, "cancel", "Zamknięcie pierwszej próby");
      const second = await course();
      await expect(editSettings(second, 2, 3, key)).rejects.toThrow(
        "zapis ustawień",
      );
      expect(
        (
          await db.query<{ version: number }>(
            "select version from public.courses where id=$1",
            [second],
          )
        ).rows[0].version,
      ).toBe(2);
    });
    it("rolls back settings, receipt, history and notices if notification delivery fails", async () => {
      const { cycle } = await acceptedCourse();
      await db.exec(
        "create or replace function public.course_edit_fail() returns trigger language plpgsql as $$begin raise exception 'edit failure';end$$;create trigger course_notice_test_failure before insert on public.notifications for each row when(new.kind='course_updated') execute function public.course_edit_fail();",
      );
      await expect(editSettings(cycle, 2)).rejects.toThrow("edit failure");
      expect(
        (
          await db.query<{ version: number }>(
            "select version from public.courses where id=$1",
            [cycle],
          )
        ).rows[0].version,
      ).toBe(2);
      expect(
        (await db.query("select id from public.course_settings_receipts")).rows,
      ).toEqual([]);
      expect(
        (
          await db.query(
            "select id from public.course_history where action='settings'",
          )
        ).rows,
      ).toEqual([]);
    });
    it("corrects a completed meeting with immutable earlier values, a guardian notice and no balance/job changes", async () => {
      const { cycle, id, session } = await completedAttendance(),
        balance = await courseBalance(id),
        jobs = await courseJobs();
      expect(await correctAttendance(session, id)).toBe(2);
      expect(await courseBalance(id)).toEqual(balance);
      expect(await courseJobs()).toEqual(jobs);
      expect(
        (
          await db.query(
            "select attendance,version from public.course_attendance where session_id=$1",
            [session],
          )
        ).rows[0],
      ).toEqual({ attendance: "excused", version: 2 });
      expect(
        (
          await asUser(owner, () =>
            db.query(
              "select previous_attendance,attendance,note from public.course_attendance_corrections",
            ),
          )
        ).rows[0],
      ).toEqual({
        previous_attendance: "present",
        attendance: "excused",
        note: "Usprawiedliwiona nieobecność",
      });
      expect(
        (await courseNotices(owner)).filter(
          (n) => n.kind === "course_attendance_recorded",
        ),
      ).toHaveLength(2);
      expect(
        (
          await db.query<{ version: number }>(
            "select version from public.courses where id=$1",
            [cycle],
          )
        ).rows[0].version,
      ).toBe(2);
    });
    it("permits correction after the whole cycle completes, and retries an earlier correction after a later one", async () => {
      const { cycle, id, session } = await completedAttendance();
      await db.query(
        "update public.course_sessions set status='cancelled' where course_id=$1 and id<>$2",
        [cycle, session],
      );
      await change(cycle, 2, "complete");
      expect(await correctAttendance(session, id)).toBe(2);
      expect(
        await correctAttendance(
          session,
          id,
          2,
          "absent",
          "Kolejne sprawdzenie obecności",
        ),
      ).toBe(3);
      expect(await correctAttendance(session, id)).toBe(2);
      await expect(correctAttendance(session, id, 1, "absent")).rejects.toThrow(
        "Obecność zmieniła się",
      );
      expect(
        (await db.query("select * from public.course_attendance_corrections"))
          .rows,
      ).toHaveLength(2);
    });
    it("rejects correction without a completed meeting, an existing record, an actual change or an explanatory reason", async () => {
      const { cycle, id, session } = await completedAttendance(),
        next = (await sessions(cycle))[1].id;
      await expect(correctAttendance(next, id)).rejects.toThrow(
        "zakończonym spotkaniu",
      );
      await expect(
        correctAttendance(session, id, 1, "present"),
      ).rejects.toThrow("inną obecność");
      await expect(
        correctAttendance(session, id, 1, "excused", ""),
      ).rejects.toThrow("powód korekty");
      await expect(
        correctAttendance(session, id, 1, "excused", "Powód", owner),
      ).rejects.toThrow("Brak uprawnień");
      await expect(
        asUser(owner, () =>
          db.query(
            "update public.course_attendance_corrections set note='Fałsz'",
          ),
        ),
      ).rejects.toThrow("permission denied");
    });
    it("rolls back correction, historical receipt and notice when the notification trigger fails", async () => {
      const { id, session } = await completedAttendance();
      await db.exec(
        "create or replace function public.course_edit_fail() returns trigger language plpgsql as $$begin raise exception 'correction failure';end$$;create trigger course_notice_test_failure before insert on public.notifications for each row when(new.kind='course_attendance_recorded') execute function public.course_edit_fail();",
      );
      await expect(correctAttendance(session, id)).rejects.toThrow(
        "correction failure",
      );
      expect(
        (
          await db.query(
            "select attendance,version from public.course_attendance where session_id=$1",
            [session],
          )
        ).rows[0],
      ).toEqual({ attendance: "present", version: 1 });
      expect(
        (
          await db.query(
            "select source_version from public.course_attendance_corrections",
          )
        ).rows,
      ).toEqual([]);
      expect(
        (await courseNotices(owner)).filter(
          (n) => n.kind === "course_attendance_recorded",
        ),
      ).toHaveLength(1);
    });
    it("preserves the original applicant's correction history after dog transfer", async () => {
      const { id, session } = await completedAttendance();
      await correctAttendance(session, id);
      await db.query("update public.dogs set guardian_id=$1 where id=$2", [
        other,
        dog,
      ]);
      expect(
        (
          await asUser(owner, () =>
            db.query("select note from public.course_attendance_corrections"),
          )
        ).rows,
      ).toHaveLength(1);
      expect(
        (
          await asUser(other, () =>
            db.query("select note from public.course_attendance_corrections"),
          )
        ).rows,
      ).toEqual([]);
    });
  },
);

type CourseNotice = {
  id: string;
  kind: string;
  recipient_id: string;
  entity_id: string;
  dog_name?: string;
  course_enrollment_id: string;
  course_session_id: string | null;
  source_key: string;
};
const coursePlan = async (
  enrollment: string | null,
  session: string | null = null,
  version = 0,
  publish = true,
  dogId = dog,
  followUp: string | null = null,
) =>
  (
    await asAdmin(() =>
      db.query<{ result: { version: number; published_id: string | null } }>(
        "select public.save_care_plan($1,$2,'Plan pracy kursowej','Prywatne zalecenia tego uczestnika',$3,$4,null,$5,$6) as result",
        [dogId, version, followUp, publish, enrollment, session],
      ),
    )
  ).rows[0].result;
const careFeed = async (
  cycle: string,
  ids: string[],
  actor = admin,
  offset = 0,
) =>
  (
    await asUser(actor, () =>
      db.query<{
        enrollment_id: string;
        plans: { id: string; course_session_id: string | null }[];
        has_draft: boolean;
      }>("select * from public.course_care_feed($1,$2,$3)", [
        cycle,
        ids,
        offset,
      ]),
    )
  ).rows;
describe.sequential("course care association, publication and privacy", () => {
  it("publishes a whole-course plan during the cycle without changing money, participation or reminders", async () => {
    const { cycle, id } = await acceptedCourse(),
      balance = await courseBalance(id),
      jobs = await courseJobs();
    const plan = await coursePlan(id);
    expect(plan.version).toBe(1);
    expect((await careFeed(cycle, [id], owner))[0]).toMatchObject({
      has_draft: false,
      plans: [{ id: plan.published_id, course_session_id: null }],
    });
    expect(
      (
        await db.query(
          "select course_id,course_enrollment_id,course_session_id,consultation_id from public.care_plan_versions",
        )
      ).rows,
    ).toEqual([
      {
        course_id: cycle,
        course_enrollment_id: id,
        course_session_id: null,
        consultation_id: null,
      },
    ]);
    expect(await courseBalance(id)).toEqual(balance);
    expect(await courseJobs()).toEqual(jobs);
    expect(
      (
        await db.query(
          "select id from public.notifications where kind='plan_published' and recipient_id=$1",
          [owner],
        )
      ).rows,
    ).toHaveLength(1);
  });
  it("keeps a meeting draft private and requires completion before publishing", async () => {
    const { cycle, id } = await acceptedCourse(),
      meeting = (await sessions(cycle))[0];
    await coursePlan(id, meeting.id, 0, false);
    expect((await careFeed(cycle, [id], admin))[0].has_draft).toBe(true);
    expect((await careFeed(cycle, [id], owner))[0]).toMatchObject({
      has_draft: false,
      plans: [],
    });
    await expect(coursePlan(id, meeting.id, 1)).rejects.toThrow(
      "Najpierw zakończ spotkanie kursu",
    );
    await db.query(
      "update public.course_sessions set starts_at=now()-interval '1 day',status='completed' where id=$1",
      [meeting.id],
    );
    const publication = await coursePlan(id, meeting.id, 1);
    expect((await careFeed(cycle, [id], owner))[0].plans).toEqual([
      expect.objectContaining({
        id: publication.published_id,
        course_session_id: meeting.id,
      }),
    ]);
  });
  it("retains each publication's source and replays an earlier publication after later changes and cancellation", async () => {
    const { cycle, id } = await acceptedCourse(),
      first = await coursePlan(id);
    await coursePlan(id, null, 1);
    await decide(id, 2, "cancel", "Rezygnacja z kursu", owner);
    expect(await coursePlan(id)).toEqual(first);
    expect((await careFeed(cycle, [id], owner))[0].plans).toHaveLength(2);
    await expect(coursePlan(id, null, 2)).rejects.toThrow(
      "przyjęte zgłoszenie",
    );
    expect(
      (await db.query("select id from public.care_plan_versions")).rows,
    ).toHaveLength(2);
  });
  it("rejects another dog's enrollment, another cycle's meeting and a meeting without enrollment", async () => {
    const { id } = await acceptedCourse();
    await expect(coursePlan(id, null, 0, true, otherDog)).rejects.toThrow(
      "zgłoszenie tego psa",
    );
    const otherCycle = randomUUID();
    await create(otherCycle, times(plus(start(), 90)));
    await expect(
      coursePlan(id, (await sessions(otherCycle))[0].id),
    ).rejects.toThrow("spotkanie tego kursu");
    await expect(
      coursePlan(null, (await sessions(otherCycle))[0].id),
    ).rejects.toThrow("jedno powiązanie");
    expect(
      (await db.query("select id from public.care_plan_versions")).rows,
    ).toEqual([]);
  });
  it("rejects waiting or cancelled participation, cancelled meetings and changed guardians while retaining draft text", async () => {
    const cycle = await course(),
      id = await enroll(cycle);
    await decide(id, 1, "waitlist");
    await expect(coursePlan(id)).rejects.toThrow("przyjęte zgłoszenie");
    await decide(id, 2, "accept");
    const meeting = (await sessions(cycle))[0];
    await coursePlan(id, meeting.id, 0, false);
    await asAdmin(() =>
      db.query(
        "select public.change_course_session($1,1,'cancel','Odwołane spotkanie')",
        [meeting.id],
      ),
    );
    await expect(coursePlan(id, meeting.id, 1, false)).rejects.toThrow(
      "spotkanie kursu jest odwołane",
    );
    await db.query("update public.dogs set guardian_id=$1 where id=$2", [
      other,
      dog,
    ]);
    await expect(coursePlan(id, null, 1)).rejects.toThrow(
      "aktualnego opiekuna",
    );
    expect(
      (await db.query("select body,course_session_id from public.care_drafts"))
        .rows,
    ).toEqual([
      {
        body: "Prywatne zalecenia tego uczestnika",
        course_session_id: meeting.id,
      },
    ]);
  });
  it("paginates each participant separately and never exposes another participant's plans or draft existence", async () => {
    const cycle = await course(2),
      first = await enroll(cycle),
      second = await enroll(cycle, otherDog, other);
    await decide(first, 1, "accept");
    await decide(second, 1, "accept");
    for (let version = 0; version < 7; version++)
      await coursePlan(first, null, version);
    const secondPlan = await coursePlan(second, null, 0, true, otherDog);
    const adminPage = await careFeed(cycle, [first, second]);
    expect(
      adminPage.find((e) => e.enrollment_id === first)?.plans,
    ).toHaveLength(6);
    expect(
      adminPage.find((e) => e.enrollment_id === second)?.plans,
    ).toHaveLength(1);
    expect(
      (await careFeed(cycle, [first, second], owner)).map(
        (e) => e.enrollment_id,
      ),
    ).toEqual([first]);
    expect((await careFeed(cycle, [first, second], other))[0].plans[0].id).toBe(
      secondPlan.published_id,
    );
    expect((await careFeed(cycle, [first], owner, 5))[0].plans).toHaveLength(2);
    expect(JSON.stringify(adminPage)).not.toContain("Prywatne zalecenia");
  });
  it("keeps existing current-dog ownership rules for advice without granting course ownership through a publication", async () => {
    const { cycle, id } = await acceptedCourse(),
      publication = await coursePlan(id);
    await db.query("update public.dogs set guardian_id=$1 where id=$2", [
      other,
      dog,
    ]);
    expect(
      (
        await asUser(owner, () =>
          db.query("select id from public.care_plan_versions where id=$1", [
            publication.published_id,
          ]),
        )
      ).rows,
    ).toEqual([]);
    expect(
      (
        await asUser(other, () =>
          db.query("select id from public.care_plan_versions where id=$1", [
            publication.published_id,
          ]),
        )
      ).rows,
    ).toHaveLength(1);
    expect((await careFeed(cycle, [id], owner))[0].plans).toEqual([]);
    expect(await careFeed(cycle, [id], other)).toEqual([]);
  });
  it("rolls back publication, association, follow-up and notification if the message fails", async () => {
    const { id } = await acceptedCourse();
    await db.exec(`create or replace function public.course_care_test_failure() returns trigger language plpgsql as $$
      begin if new.kind='plan_published' then raise exception 'Synthetic care notification failure';end if;return new;end $$;
      create trigger course_care_test_failure before insert on public.notifications for each row execute function public.course_care_test_failure();`);
    try {
      await expect(
        coursePlan(id, null, 0, true, dog, "2035-01-12"),
      ).rejects.toThrow("Synthetic care notification failure");
      for (const table of [
        "care_drafts",
        "care_plan_versions",
        "care_follow_ups",
        "care_events",
      ])
        expect((await db.query(`select * from public.${table}`)).rows).toEqual(
          [],
        );
    } finally {
      await db.exec(
        "drop trigger course_care_test_failure on public.notifications",
      );
    }
    expect((await coursePlan(id)).published_id).toBeTruthy();
  });
  it("denies direct writes and forged simultaneous consultation/course sources", async () => {
    const { cycle, id } = await acceptedCourse();
    await expect(
      asAdmin(() =>
        db.query(
          "select public.save_care_plan($1,0,'Plan','Treść',null,true,$2,$3,null)",
          [dog, randomUUID(), id],
        ),
      ),
    ).rejects.toThrow("jedno powiązanie");
    await expect(
      asUser(owner, () =>
        db.query(
          "select public.save_care_plan($1,0,'Plan','Treść',null,true,null,$2,null)",
          [dog, id],
        ),
      ),
    ).rejects.toThrow("Brak uprawnień");
    await coursePlan(id);
    await expect(
      asUser(owner, () =>
        db.query(
          "update public.care_drafts set course_id=null where dog_id=$1",
          [dog],
        ),
      ),
    ).rejects.toThrow("permission denied");
    await expect(
      db.query(
        "update public.care_plan_versions set dog_id=$1 where course_id=$2",
        [otherDog, cycle],
      ),
    ).rejects.toThrow(/foreign key/);
  });
});
type CourseJob = {
  id: string;
  status: string;
  source_id: string;
  source_token: string;
  generation: number;
  attempts: number;
  course_enrollment_id: string;
  course_session_id: string;
};
const courseNotices = async (recipient?: string) =>
  (
    await db.query<CourseNotice>(
      "select * from public.notifications where kind like 'course_%' and ($1::uuid is null or recipient_id=$1) order by created_at,id",
      [recipient ?? null],
    )
  ).rows;
const courseJobs = async () =>
  (
    await db.query<CourseJob>(
      "select * from public.reminder_jobs where kind='course' order by course_session_id,generation,id",
    )
  ).rows;
const deliverCourses = async () =>
  (
    await asAdmin(() =>
      db.query<{ result: { sent: number; cancelled: number; failed: number } }>(
        "select public.process_due_reminders(100) as result",
      ),
    )
  ).rows[0].result;
async function imminentCourse() {
  const cycle = randomUUID();
  await create(
    cycle,
    times(new Date(Date.now() + 3 * 3600000).toISOString()),
    2,
  );
  await change(cycle, 1, "publish");
  const id = await enroll(cycle);
  await decide(id, 1, "accept");
  return { cycle, id, meeting: (await sessions(cycle))[0] };
}
async function rescheduleMeeting(
  meeting: { id: string; version: number; starts_at: Date },
  note = "Zmiana miejsca i godziny",
) {
  return asAdmin(() =>
    db.query(
      "select public.reschedule_course_session($1,$2,$3,$4,'Inny park','NOWA TAJNA ZBIÓRKA')",
      [
        meeting.id,
        meeting.version,
        plus(meeting.starts_at.toISOString(), 60),
        note,
      ],
    ),
  );
}
describe.sequential(
  "course inbox, per-meeting reminders and frozen recipients",
  () => {
    it("keeps all 250 jobs for 50 participants, respects delivery batch limits and never duplicates a shared guardian", async () => {
      const cycle = randomUUID();
      await create(
        cycle,
        times(new Date(Date.now() + 3 * 3600000).toISOString()),
        50,
      );
      await change(cycle, 1, "publish");
      const dogIds = Array.from({ length: 50 }, () => randomUUID());
      try {
        for (const dogId of dogIds) {
          await db.query(
            "insert into public.dogs(id,guardian_id,name) values($1,$2,'Uczestnik próbny')",
            [dogId, owner],
          );
          const id = await enroll(cycle, dogId);
          await decide(id, 1, "accept");
        }
        expect(await courseJobs()).toHaveLength(250);
        const process = async (limit: number) =>
          (
            await asAdmin(() =>
              db.query<{ result: { sent: number } }>(
                "select public.process_due_reminders($1) as result",
                [limit],
              ),
            )
          ).rows[0].result.sent;
        expect(await process(13)).toBe(13);
        expect(await process(13)).toBe(13);
        expect(await process(100)).toBe(24);
        expect(await process(100)).toBe(0);
        const messages = (await courseNotices(owner)).filter(
          (n) => n.kind === "course_reminder",
        );
        expect(messages).toHaveLength(50);
        expect(new Set(messages.map((n) => n.course_enrollment_id)).size).toBe(
          50,
        );
        expect(
          (await courseJobs()).filter((j) => j.status === "pending"),
        ).toHaveLength(200);
        expect(
          (await courseJobs())
            .filter((j) => j.status === "sent")
            .every((j) => j.attempts === 1),
        ).toBe(true);
      } finally {
        await db.query("delete from public.courses where id=$1", [cycle]);
        await db.query("delete from public.dogs where id=any($1)", [dogIds]);
      }
    });
    it("notifies staff of each request and excludes the actor, including identical request retries", async () => {
      const cycle = await course(),
        key = randomUUID();
      await enroll(cycle, dog, owner, key);
      await enroll(cycle, dog, owner, key);
      expect(await courseNotices()).toHaveLength(2);
      expect((await courseNotices()).map((n) => n.recipient_id).sort()).toEqual(
        [admin, colleague].sort(),
      );
      expect(await courseNotices(owner)).toEqual([]);
      await decide(key, 1, "accept");
      await decide(key, 1, "accept");
      expect((await courseNotices(owner)).map((n) => n.kind).sort()).toEqual(
        ["course_enrollment_accepted"].sort(),
      );
      expect((await courseNotices(admin)).map((n) => n.kind).sort()).toEqual(
        ["course_enrollment_requested"].sort(),
      );
      expect(
        (await courseNotices(colleague)).map((n) => n.kind).sort(),
      ).toEqual(
        ["course_enrollment_requested", "course_enrollment_accepted"].sort(),
      );
      expect(await courseJobs()).toHaveLength(5);
    });
    it("creates no reminder for a requested, waitlisted or rejected applicant", async () => {
      const cycle = await course(),
        id = await enroll(cycle);
      expect(await courseJobs()).toEqual([]);
      await decide(id, 1, "waitlist");
      expect(await courseJobs()).toEqual([]);
      await decide(id, 2, "reject", "Brak miejsca w grupie");
      expect(await courseJobs()).toEqual([]);
      expect((await courseNotices(owner)).map((n) => n.kind).sort()).toEqual([
        "course_enrollment_rejected",
        "course_enrollment_waitlisted",
      ]);
    });
    it("replaces only the rescheduled meeting, retains other jobs and stores no private text", async () => {
      const { cycle, id } = await acceptedCourse(),
        before = await courseJobs(),
        meeting = (await sessions(cycle))[0];
      await rescheduleMeeting(meeting);
      await rescheduleMeeting(meeting);
      const after = await courseJobs();
      expect(after).toHaveLength(6);
      expect(after.filter((j) => j.course_session_id !== meeting.id)).toEqual(
        before.filter((j) => j.course_session_id !== meeting.id),
      );
      expect(
        after
          .filter((j) => j.course_session_id === meeting.id)
          .map((j) => [j.generation, j.status]),
      ).toEqual([
        [1, "cancelled"],
        [2, "pending"],
      ]);
      const notices = (await courseNotices(owner)).filter(
        (n) => n.kind === "course_session_rescheduled",
      );
      expect(notices).toHaveLength(1);
      expect(notices[0]).toMatchObject({
        entity_id: cycle,
        course_enrollment_id: id,
        course_session_id: meeting.id,
      });
      expect(JSON.stringify([...notices, ...after])).not.toMatch(
        /TAJNA|Zmiana miejsca|Inny park/,
      );
    });
    it("does not create a new reminder on closing/reopening enrollment or recording financial events", async () => {
      const { cycle, id } = await acceptedCourse(),
        before = await courseJobs();
      await change(cycle, 2, "close");
      await change(cycle, 3, "reopen");
      const receipt = await coursePay(id, 4000),
        key = randomUUID();
      await courseRefund(receipt, 1000, key);
      await courseRefund(receipt, 1000, key);
      expect(await courseJobs()).toEqual(before);
      expect((await courseNotices(owner)).map((n) => n.kind).sort()).toEqual(
        [
          "course_enrollment_accepted",
          "course_payment_recorded",
          "course_payment_refunded",
        ].sort(),
      );
      expect(
        (
          await db.query(
            "select id from public.notifications where kind in ('payment_recorded','payment_refunded')",
          )
        ).rows,
      ).toEqual([]);
    });
    it("withdraws every future reminder on guardian cancellation and notifies only the staff", async () => {
      const { id } = await acceptedCourse();
      const before = (await courseNotices(owner)).length;
      await decide(id, 2, "cancel", "Nie możemy uczestniczyć", owner);
      await decide(id, 2, "cancel", "Nie możemy uczestniczyć", owner);
      expect((await courseJobs()).every((j) => j.status === "cancelled")).toBe(
        true,
      );
      expect((await courseNotices(owner)).length).toBe(before);
      expect(
        (await courseNotices())
          .filter((n) => n.kind === "course_enrollment_cancelled")
          .map((n) => n.recipient_id)
          .sort(),
      ).toEqual([admin, colleague].sort());
      expect((await deliverCourses()).sent).toBe(0);
    });
    it("bulk cancellation gives each active enrollment one message, without duplicate meeting cancellations", async () => {
      const cycle = await course(2),
        first = await enroll(cycle),
        second = await enroll(cycle, otherDog, other);
      await decide(first, 1, "accept");
      await decide(second, 1, "waitlist");
      await change(cycle, 2, "cancel", "Organizatorka odwołuje cykl");
      for (const recipient of [owner, other]) {
        expect(
          (await courseNotices(recipient)).filter(
            (n) => n.kind === "course_cancelled",
          ),
        ).toHaveLength(1);
        expect(
          (await courseNotices(recipient)).filter(
            (n) => n.kind === "course_session_cancelled",
          ),
        ).toHaveLength(0);
      }
      expect((await courseJobs()).every((j) => j.status === "cancelled")).toBe(
        true,
      );
    });
    it("notifies active applicants of a meeting change, but reminds only accepted participants", async () => {
      const cycle = await course(2),
        first = await enroll(cycle),
        second = await enroll(cycle, otherDog, other);
      await decide(first, 1, "accept");
      await decide(second, 1, "waitlist");
      await rescheduleMeeting((await sessions(cycle))[0]);
      expect(
        (await courseNotices(other)).filter(
          (n) => n.kind === "course_session_rescheduled",
        ),
      ).toHaveLength(1);
      expect(
        (await courseJobs()).every((j) => j.course_enrollment_id === first),
      ).toBe(true);
      expect((await deliverCourses()).sent).toBe(0);
    });
    it("delivers one imminent meeting once, with its exact course and enrollment context", async () => {
      const { cycle, id, meeting } = await imminentCourse();
      expect((await deliverCourses()).sent).toBe(1);
      expect((await deliverCourses()).sent).toBe(0);
      const notices = (await courseNotices()).filter(
        (n) => n.kind === "course_reminder",
      );
      expect(notices).toHaveLength(1);
      expect(notices[0]).toMatchObject({
        recipient_id: owner,
        entity_id: cycle,
        course_enrollment_id: id,
        course_session_id: meeting.id,
      });
      expect(
        (await courseJobs()).filter((j) => j.status === "sent")[0].attempts,
      ).toBe(1);
    });
    it("preserves frozen-guardian messages after dog transfer without exposing the new profile", async () => {
      const { id } = await imminentCourse();
      await db.query(
        "update public.dogs set guardian_id=$1,name='PRYWATNA NOWA NAZWA' where id=$2",
        [other, dog],
      );
      await coursePay(id, 4000);
      expect((await deliverCourses()).sent).toBe(1);
      const inbox = (
        await asUser(owner, () =>
          db.query<CourseNotice>(
            "select * from public.notification_feed('all',null)",
          ),
        )
      ).rows;
      expect(inbox).toHaveLength(3);
      expect(inbox.every((n) => n.dog_name === "Pies zgłoszenia")).toBe(true);
      expect(inbox.map((n) => n.kind).sort()).toEqual(
        [
          "course_enrollment_accepted",
          "course_payment_recorded",
          "course_reminder",
        ].sort(),
      );
      expect(
        (
          await asUser(other, () =>
            db.query("select * from public.notification_feed('all',null)"),
          )
        ).rows,
      ).toEqual([]);
      expect(
        (
          await asUser(owner, () =>
            db.query<{ n: number }>(
              "select public.read_notifications($1) as n",
              [inbox.map((n) => n.id)],
            ),
          )
        ).rows[0].n,
      ).toBe(3);
    });
    it("uses the same access rule for unread counts, feed, read marking and current role", async () => {
      await imminentCourse();
      const notice = (await courseNotices(owner))[0];
      await expect(
        asUser(other, () =>
          db.query("select public.read_notifications($1)", [[notice.id]]),
        ),
      ).rejects.toThrow("Twoich powiadomień");
      await db.query("delete from public.user_roles where user_id=$1", [owner]);
      expect(
        (
          await asUser(owner, () =>
            db.query("select * from public.notifications"),
          )
        ).rows,
      ).toEqual([]);
      await expect(
        asUser(owner, () =>
          db.query("select public.read_notifications($1)", [[notice.id]]),
        ),
      ).rejects.toThrow("Twoich powiadomień");
      await db.query(
        "insert into public.user_roles(user_id,role) values($1,'client')",
        [owner],
      );
      expect(
        (
          await asUser(owner, () =>
            db.query("select * from public.notifications"),
          )
        ).rows,
      ).toHaveLength(1);
    });
    it("retries a missing recipient safely, and cancels the retry when the course is cancelled", async () => {
      const { cycle } = await imminentCourse();
      await db.query("delete from public.user_roles where user_id=$1", [owner]);
      expect((await deliverCourses()).failed).toBe(1);
      expect(
        (await courseNotices()).filter((n) => n.kind === "course_reminder"),
      ).toEqual([]);
      const failed = (await courseJobs()).find((j) => j.status === "retry")!;
      expect(failed.attempts).toBe(1);
      await db.query(
        "insert into public.user_roles(user_id,role) values($1,'client')",
        [owner],
      );
      await change(cycle, 2, "cancel", "Odwołany cykl kursu");
      expect((await courseJobs()).every((j) => j.status === "cancelled")).toBe(
        true,
      );
      expect((await deliverCourses()).sent).toBe(0);
    });
    it("rolls back a changed meeting, new reminder generation and all recipients if fan-out fails", async () => {
      const cycle = await course(2),
        first = await enroll(cycle),
        second = await enroll(cycle, otherDog, other);
      await decide(first, 1, "accept");
      await decide(second, 1, "accept");
      const before = {
        jobs: await courseJobs(),
        notices: await courseNotices(),
        sessions: await sessions(cycle),
      };
      await db.exec(`create or replace function public.course_notice_test_failure() returns trigger language plpgsql as $$
      begin if new.recipient_id='${other}' and new.kind='course_session_rescheduled' then raise exception 'Synthetic recipient failure'; end if; return new; end $$;
      create trigger course_notice_test_failure before insert on public.notifications for each row execute function public.course_notice_test_failure();`);
      await expect(rescheduleMeeting(before.sessions[0])).rejects.toThrow(
        "Synthetic recipient failure",
      );
      expect({
        jobs: await courseJobs(),
        notices: await courseNotices(),
        sessions: await sessions(cycle),
      }).toEqual(before);
      await db.exec(
        "drop trigger course_notice_test_failure on public.notifications",
      );
      await rescheduleMeeting(before.sessions[0]);
      expect(
        (await courseNotices()).filter(
          (n) => n.kind === "course_session_rescheduled",
        ),
      ).toHaveLength(2);
    });
    it("opens settlement/refund messages on the immutable enrollment and keeps retries single", async () => {
      const { cycle, id } = await acceptedCourse(),
        receipt = await coursePay(id);
      await decide(id, 3, "cancel", "Zmiana planów", owner);
      const key = randomUUID();
      await courseSettle(id, 4, 3000, key);
      await courseSettle(id, 4, 3000, key);
      await courseRefund(receipt, 7000);
      for (const kind of ["course_settled", "course_payment_refunded"]) {
        const notices = (await courseNotices(owner)).filter(
          (n) => n.kind === kind,
        );
        expect(notices).toHaveLength(1);
        expect(notices[0]).toMatchObject({
          entity_id: cycle,
          course_enrollment_id: id,
          course_session_id: null,
        });
      }
      expect((await courseJobs()).every((j) => j.status === "cancelled")).toBe(
        true,
      );
    });
    it("keeps reminder sources and delivery internals inaccessible even to staff", async () => {
      const { id } = await imminentCourse();
      for (const actor of [owner, admin]) {
        await expect(
          asUser(actor, () =>
            db.query("select * from public.course_reminder_sources"),
          ),
        ).rejects.toThrow("permission denied");
        await expect(
          asUser(actor, () =>
            db.query("select public.sync_course_reminders($1)", [id]),
          ),
        ).rejects.toThrow("permission denied");
        await expect(
          asUser(actor, () =>
            db.query("select public.reminder_source('course',$1)", [id]),
          ),
        ).rejects.toThrow("permission denied");
        await expect(
          asUser(actor, () =>
            db.query(
              "select public.add_course_notification($1,null,$2,null,'course_reminder','forged')",
              [owner, id],
            ),
          ),
        ).rejects.toThrow("permission denied");
      }
      expect(
        (
          await asUser(owner, () =>
            db.query("select * from public.reminder_jobs"),
          )
        ).rows,
      ).toEqual([]);
    });
  },
);

describe.sequential("course cycle, enrollment and calendar domain", () => {
  it("projects each meeting once for staff and accepted guardians, with RLS-protected meeting points", async () => {
    const id = await course(2),
      own = await enroll(id),
      waiting = await enroll(id, otherDog, other);
    const rows = await sessions(id),
      from = plus(rows[0].starts_at.toISOString(), -60),
      to = plus(from, 31 * 24 * 60);
    const calendar = (actor: string) =>
      asUser(actor, () =>
        db.query<{
          id: string;
          kind: string;
          location: string;
          starts_at: Date;
        }>(
          "select * from public.calendar_appointments($1,$2) where kind='course'",
          [from, to],
        ),
      );
    expect((await calendar(owner)).rows).toEqual([]);
    expect((await calendar(other)).rows).toEqual([]);
    await decide(own, 1, "accept");
    await decide(waiting, 1, "waitlist");
    const mine = (await calendar(owner)).rows;
    expect(mine).toHaveLength(5);
    expect(new Set(mine.map((r) => r.starts_at.toISOString())).size).toBe(5);
    expect(
      mine.every((r) => r.id === id && r.location === "TAJNA ZBIÓRKA"),
    ).toBe(true);
    expect((await calendar(admin)).rows).toHaveLength(5);
    expect((await calendar(other)).rows).toEqual([]);
    await decide(own, 2, "cancel", "Zmiana planów", owner);
    expect((await calendar(owner)).rows).toEqual([]);
    expect((await calendar(admin)).rows).toHaveLength(5);
  });
  it("moves only one calendar appointment and removes cancelled meetings, including overlap across midnight", async () => {
    const id = await course(),
      own = await enroll(id);
    await decide(own, 1, "accept");
    const rows = await sessions(id),
      moved = new Date(rows[0].starts_at.getTime() + 24 * 3600000);
    moved.setUTCHours(23, 30, 0, 0);
    await asAdmin(() =>
      db.query(
        "select public.reschedule_course_session($1,1,$2,'Uzgodniona zmiana','Druga okolica','DRUGA TAJNA ZBIÓRKA')",
        [rows[0].id, moved.toISOString()],
      ),
    );
    const boundary = new Date(moved.getTime() + 30 * 60000).toISOString();
    const calendar = () =>
      asUser(owner, () =>
        db.query<{ location: string; starts_at: Date }>(
          "select * from public.calendar_appointments($1,$2) where kind='course'",
          [boundary, plus(boundary, 60)],
        ),
      );
    expect((await calendar()).rows[0]?.location).toBe("DRUGA TAJNA ZBIÓRKA");
    await asAdmin(() =>
      db.query(
        "select public.change_course_session($1,2,'cancel','Uzgodnione odwołanie')",
        [rows[0].id],
      ),
    );
    expect((await calendar()).rows).toEqual([]);
    expect((await sessions(id))[1].starts_at).toEqual(rows[1].starts_at);
    await expect(
      asUser(owner, () =>
        db.query("select * from public.calendar_appointments($1,$2)", [
          boundary,
          plus(boundary, 44 * 24 * 60),
        ]),
      ),
    ).rejects.toThrow("zakres kalendarza");
  });
  it("creates a private draft with five dates and one frozen catalogue price", async () => {
    const id = randomUUID(),
      starts = times();
    await create(id, starts);
    const saved = (
      await db.query<{
        price_cents: number;
        status: string;
        sessions_count: number;
      }>(
        "select price_cents,status,sessions_count from public.courses where id=$1",
        [id],
      )
    ).rows[0];
    expect(saved).toEqual({
      price_cents: 10000,
      status: "draft",
      sessions_count: 5,
    });
    expect(await sessions(id)).toHaveLength(5);
    expect(
      (
        await db.query(
          "select * from public.calendar_slots where course_session_id is not null",
        )
      ).rows,
    ).toEqual([]);
    expect(
      (await asUser(owner, () => db.query("select * from public.courses")))
        .rows,
    ).toEqual([]);
    expect(
      (
        await asUser(owner, () =>
          db.query("select * from public.course_creation_receipts"),
        )
      ).rows,
    ).toEqual([]);
    await create(id, starts);
    expect(
      (
        await db.query(
          "select * from public.course_history where course_id=$1",
          [id],
        )
      ).rows,
    ).toHaveLength(1);
    await db.query(
      "update public.services set price_cents=15000,version=2 where id=$1",
      [service],
    );
    await create(id, starts); // The original request survives later catalogue changes.
    expect(
      (
        await db.query<{ price_cents: number }>(
          "select price_cents from public.courses where id=$1",
          [id],
        )
      ).rows[0].price_cents,
    ).toBe(10000);
  });
  it("requires staff, an active course service and every future ordered date", async () => {
    await expect(create(randomUUID(), times(), 1, owner)).rejects.toThrow(
      "Brak uprawnień",
    );
    await expect(create(randomUUID(), times().slice(0, 4))).rejects.toThrow(
      "każdego spotkania",
    );
    const s = times();
    await expect(
      create(randomUUID(), [s[1], s[0], ...s.slice(2)]),
    ).rejects.toThrow("uporządkowane");
    await expect(
      create(randomUUID(), [s[0], plus(s[0], 30), ...s.slice(2)]),
    ).rejects.toThrow("nakładać");
    await expect(
      create(randomUUID(), ["infinity", ...s.slice(1)]),
    ).rejects.toThrow("wszystkie terminy");
    await db.query("update public.services set active=false where id=$1", [
      service,
    ]);
    await expect(create()).rejects.toThrow("nie jest dostępna");
    expect((await db.query("select * from public.courses")).rows).toEqual([]);
  });
  it("publishes every slot atomically and rejects conflicts with private calendar blocks", async () => {
    const id = randomUUID(),
      starts = times();
    await create(id, starts);
    await asAdmin(() =>
      db.query("select public.save_calendar_block($1,0,'Zajęty czas',$2,$3)", [
        randomUUID(),
        starts[2],
        plus(starts[2], 60),
      ]),
    );
    await expect(change(id, 1, "publish")).rejects.toThrow("nakłada się");
    expect(
      (
        await db.query<{ status: string }>(
          "select status from public.courses where id=$1",
          [id],
        )
      ).rows[0].status,
    ).toBe("draft");
    expect(
      (
        await db.query(
          "select * from public.calendar_slots where course_session_id is not null",
        )
      ).rows,
    ).toEqual([]);
    await db.exec("delete from public.calendar_blocks");
    await change(id, 1, "publish");
    expect(
      (
        await db.query(
          "select * from public.calendar_slots where course_session_id is not null",
        )
      ).rows,
    ).toHaveLength(5);
    await change(id, 1, "publish"); // Same successful operation, no second version.
    await expect(change(id, 1, "close")).rejects.toThrow("Kurs zmienił się");
    await expect(
      asAdmin(() =>
        db.query(
          "select public.save_calendar_block($1,0,'Druga blokada',$2,$3)",
          [randomUUID(), starts[0], plus(starts[0], 60)],
        ),
      ),
    ).rejects.toThrow("czas jest już zajęty");
  });
  it("keeps participant details private and freezes the price for enrollment", async () => {
    const id = await course(),
      request = await enroll(id);
    await expect(enroll(id, dog, other)).rejects.toThrow("swojego psa");
    expect(
      (
        await asUser(owner, () =>
          db.query("select * from public.course_private_details"),
        )
      ).rows,
    ).toEqual([]);
    expect(
      (
        await asUser(other, () =>
          db.query("select * from public.course_enrollments"),
        )
      ).rows,
    ).toEqual([]);
    await db.query(
      "update public.services set price_cents=15000,version=2 where id=$1",
      [service],
    );
    await decide(request, 1, "accept");
    expect(await state(request)).toMatchObject({
      status: "accepted",
      agreed_price_cents: 10000,
      charge_cents: 10000,
    });
    expect(
      (
        await asUser(owner, () =>
          db.query("select exact_location from public.course_private_details"),
        )
      ).rows,
    ).toEqual([{ exact_location: "TAJNA ZBIÓRKA" }]);
    expect(
      (
        await asUser(other, () =>
          db.query("select * from public.course_private_details"),
        )
      ).rows,
    ).toEqual([]);
    expect(
      (
        await asUser(other, () =>
          db.query(
            "select * from public.course_history where enrollment_id=$1",
            [request],
          ),
        )
      ).rows,
    ).toEqual([]);
  });
  it("keeps individual courses limited to one dog regardless of a forged capacity", async () => {
    const individual = "60000000-0000-4000-8000-000000000003";
    const make = (capacity: number) =>
      asAdmin(() =>
        db.query(
          "select public.create_course($1,$2,1,'Kurs indywidualny',$3,'Okolica parku','Dokładne miejsce',$4)",
          [randomUUID(), individual, capacity, JSON.stringify(times())],
        ),
      );
    await expect(make(2)).rejects.toThrow("jednego psa");
    await make(1);
    expect(
      (
        await db.query<{ course_format: string; capacity: number }>(
          "select course_format,capacity from public.courses",
        )
      ).rows,
    ).toEqual([{ course_format: "individual", capacity: 1 }]);
  });
  it("serializes seat decisions, permits waitlist promotion and rejects client decisions", async () => {
    const id = await course(),
      first = await enroll(id),
      second = await enroll(id, otherDog, other);
    await expect(decide(first, 1, "accept", "", owner)).rejects.toThrow(
      "Brak dostępu",
    );
    await decide(first, 1, "accept");
    await decide(first, 1, "accept");
    await expect(decide(second, 1, "accept")).rejects.toThrow(
      "Brak wolnych miejsc",
    );
    await decide(second, 1, "waitlist");
    await decide(first, 2, "cancel", "Rezygnuję", owner);
    expect((await state(first)).charge_cents).toBe(10000); // Explicit settlement is a separate operation.
    await decide(second, 2, "accept");
    expect((await state(second)).status).toBe("accepted");
    await expect(decide(second, 2, "reject", "Inna decyzja")).rejects.toThrow(
      "Zgłoszenie zmieniło się",
    );
  });
  it("replays only the same enrollment request after close and never invents another charge", async () => {
    const id = await course(),
      request = await enroll(id);
    await change(id, 2, "close");
    expect(await enroll(id, dog, owner, request, 2)).toBe(request);
    await expect(enroll(id, dog, owner, request, 3)).rejects.toThrow(
      "identyfikator zgłoszenia",
    );
    await expect(enroll(id, otherDog, other, randomUUID(), 3)).rejects.toThrow(
      "zamknięte",
    );
    expect(await state(request)).toMatchObject({
      status: "requested",
      charge_cents: 0,
    });
    await change(id, 3, "reopen");
    await expect(enroll(id, otherDog, other, randomUUID(), 2)).rejects.toThrow(
      "Kurs zmienił się",
    );
  });
  it("reschedules one session with stale-version and order protection without touching the quote", async () => {
    const id = await course(),
      row = (await sessions(id))[1],
      newTime = plus(row.starts_at.toISOString(), 60);
    const move = (expected: number, at: string) =>
      asAdmin(() =>
        db.query(
          "select public.reschedule_course_session($1,$2,$3,'Zmiana godziny')",
          [row.id, expected, at],
        ),
      );
    await move(1, newTime);
    await move(1, newTime);
    await expect(move(1, plus(newTime, 60))).rejects.toThrow(
      "Spotkanie zmieniło się",
    );
    await expect(
      move(2, plus((await sessions(id))[0].starts_at.toISOString(), 30)),
    ).rejects.toThrow("kolejność");
    await expect(enroll(id, dog, owner, randomUUID(), 2)).rejects.toThrow(
      "Kurs zmienił się",
    );
    expect(
      (
        await db.query<{ price_cents: number; version: number }>(
          "select price_cents,version from public.courses where id=$1",
          [id],
        )
      ).rows[0],
    ).toEqual({ price_cents: 10000, version: 3 });
    expect(
      (
        await db.query(
          "select * from public.calendar_slots where course_session_id is not null",
        )
      ).rows,
    ).toHaveLength(5);
  });
  it("supports different meeting places per session without disclosing private addresses to unaccepted guardians", async () => {
    const id = await course(),
      request = await enroll(id),
      row = (await sessions(id))[1];
    const move = (publicPlace: string, exact: string, version = 1) =>
      asAdmin(() =>
        db.query(
          "select public.reschedule_course_session($1,$2,$3,'Kolejne spotkanie w innym miejscu',$4,$5)",
          [row.id, version, row.starts_at.toISOString(), publicPlace, exact],
        ),
      );
    await move("Rynek miasta", "TAJNY PUNKT NA RYNKU");
    await move("Rynek miasta", "TAJNY PUNKT NA RYNKU");
    await expect(move("Inne miejsce", "Inny punkt")).rejects.toThrow(
      "Spotkanie zmieniło się",
    );
    expect(
      (
        await asUser(owner, () =>
          db.query("select * from public.course_session_private_details"),
        )
      ).rows,
    ).toEqual([]);
    await decide(request, 1, "accept");
    expect(
      (
        await asUser(owner, () =>
          db.query(
            "select exact_location from public.course_session_private_details where session_id=$1",
            [row.id],
          ),
        )
      ).rows,
    ).toEqual([{ exact_location: "TAJNY PUNKT NA RYNKU" }]);
    expect(
      (
        await asUser(other, () =>
          db.query("select * from public.course_session_private_details"),
        )
      ).rows,
    ).toEqual([]);
    expect(
      (
        await asUser(other, () =>
          db.query(
            "select public_location from public.course_sessions where id=$1",
            [row.id],
          ),
        )
      ).rows,
    ).toEqual([{ public_location: "Rynek miasta" }]);
    expect(
      (
        await db.query<{ exact_location: string }>(
          "select exact_location from public.course_session_private_details where session_id=$1",
          [(await sessions(id))[0].id],
        )
      ).rows[0].exact_location,
    ).toBe("TAJNA ZBIÓRKA");
  });
  it("retains cancellation history and settlement amount while freeing every occupied slot", async () => {
    const id = await course(),
      request = await enroll(id);
    await decide(request, 1, "accept");
    await change(id, 2, "cancel", "Odwołanie całego cyklu");
    await change(id, 2, "cancel", "Odwołanie całego cyklu");
    expect(await state(request)).toMatchObject({
      status: "cancelled",
      charge_cents: 10000,
      version: 3,
    });
    expect(
      (
        await db.query(
          "select * from public.calendar_slots where course_session_id is not null",
        )
      ).rows,
    ).toEqual([]);
    expect(
      (
        await asUser(owner, () =>
          db.query("select * from public.course_private_details"),
        )
      ).rows,
    ).toEqual([]);
    expect(
      (
        await asUser(owner, () =>
          db.query(
            "select action from public.course_history where enrollment_id=$1",
            [request],
          ),
        )
      ).rows,
    ).toHaveLength(3);
    await expect(change(id, 3, "reopen")).rejects.toThrow("nie jest dostępna");
  });
  it("requires accepted participants and observed session time, preserves attendance versions and completes the cycle", async () => {
    const id = await course(),
      request = await enroll(id);
    await decide(request, 1, "accept");
    const rows = await sessions(id),
      row = rows[0];
    const attendance = (v: number, value: string) =>
      asAdmin(() =>
        db.query("select public.record_course_attendance($1,$2,$3,$4)", [
          row.id,
          request,
          v,
          value,
        ]),
      );
    const finish = (session: string, v = 1) =>
      asAdmin(() =>
        db.query("select public.change_course_session($1,$2,'complete','')", [
          session,
          v,
        ]),
      );
    await expect(attendance(0, "present")).rejects.toThrow("po rozpoczęciu");
    await expect(change(id, 2, "complete")).rejects.toThrow("Najpierw zakończ");
    // Fixture clock shift affects only this isolated database and cycle.
    await db.query(
      "update public.course_sessions set starts_at=clock_timestamp()-interval '2 hours' where id=$1",
      [row.id],
    );
    await expect(finish(row.id)).rejects.toThrow("uzupełnij obecności");
    await attendance(0, "present");
    await attendance(0, "present");
    await attendance(1, "excused");
    await expect(attendance(1, "absent")).rejects.toThrow(
      "Obecność zmieniła się",
    );
    await finish(row.id);
    await finish(row.id);
    for (const session of rows.slice(1))
      await asAdmin(() =>
        db.query(
          "select public.change_course_session($1,1,'cancel','Pozostałe terminy odwołane')",
          [session.id],
        ),
      );
    const current = (
      await db.query<{ version: number }>(
        "select version from public.courses where id=$1",
        [id],
      )
    ).rows[0].version;
    await change(id, current, "complete");
    expect(
      (
        await db.query<{ status: string }>(
          "select status from public.courses where id=$1",
          [id],
        )
      ).rows[0].status,
    ).toBe("completed");
    expect(
      (
        await asUser(owner, () =>
          db.query("select attendance,version from public.course_attendance"),
        )
      ).rows,
    ).toEqual([{ attendance: "excused", version: 2 }]);
    expect(
      (
        await asUser(other, () =>
          db.query("select * from public.course_attendance"),
        )
      ).rows,
    ).toEqual([]);
  });
  it("rolls back publication, history and slots if auditing fails", async () => {
    const id = randomUUID();
    await create(id);
    await db.exec(
      "create function public.fail_course_audit() returns trigger language plpgsql as $$begin if new.event='course_changed' then raise exception 'fixture audit failure'; end if;return new;end$$;create trigger fail_course_audit before insert on public.audit_events for each row execute function public.fail_course_audit();",
    );
    try {
      await expect(change(id, 1, "publish")).rejects.toThrow(
        "fixture audit failure",
      );
      expect(
        (
          await db.query<{ status: string; version: number }>(
            "select status,version from public.courses where id=$1",
            [id],
          )
        ).rows[0],
      ).toEqual({ status: "draft", version: 1 });
      expect(
        (
          await db.query(
            "select * from public.calendar_slots where course_session_id is not null",
          )
        ).rows,
      ).toEqual([]);
      expect(
        (
          await db.query(
            "select * from public.course_history where course_id=$1",
            [id],
          )
        ).rows,
      ).toHaveLength(1);
    } finally {
      await db.exec(
        "drop trigger fail_course_audit on public.audit_events;drop function public.fail_course_audit();",
      );
    }
  });
  it("denies direct mutations and anonymous access to every course operation", async () => {
    await expect(
      asUser(owner, () => db.query("delete from public.courses")),
    ).rejects.toThrow("permission denied");
    await expect(
      asUser(owner, () =>
        db.query("update public.course_enrollments set status='accepted'"),
      ),
    ).rejects.toThrow("permission denied");
    expect(
      (
        await db.query<{ allowed: boolean }>(
          "select has_function_privilege('anon','public.create_course(uuid,uuid,integer,text,integer,text,text,jsonb)','execute') as allowed",
        )
      ).rows[0].allowed,
    ).toBe(false);
    expect(
      (
        await db.query<{ allowed: boolean }>(
          "select has_function_privilege('authenticated','public.sync_course_calendar(uuid)','execute') as allowed",
        )
      ).rows[0].allowed,
    ).toBe(false);
  });
});

const reopenEnrollment = async (
  id: string,
  version: number,
  action: string,
  note = "Powrót uzgodniony z opiekunem",
  actor = admin,
) =>
  (
    await asUser(actor, () =>
      db.query<{ version: number }>(
        "select public.reopen_course_enrollment($1,$2,$3,$4) as version",
        [id, version, action, note],
      ),
    )
  ).rows[0].version;

describe.sequential("explicit course reconsideration and restoration", () => {
  it("returns a refusal to staff decision without a reserved seat, new quote or charge", async () => {
    const cycle = await course(),
      id = await enroll(cycle);
    await decide(id, 1, "reject", "Potrzebna rozmowa");
    await db.query(
      "update public.services set price_cents=15000,version=2 where id=$1",
      [service],
    );
    expect(await reopenEnrollment(id, 2, "reconsider")).toBe(3);
    expect(await state(id)).toMatchObject({
      status: "requested",
      version: 3,
      charge_cents: 0,
      agreed_price_cents: 10000,
    });
    expect(await courseBalance(id)).toMatchObject({
      due_cents: 0,
      can_pay: false,
    });
    expect(
      (
        await db.query(
          "select id from public.reminder_jobs where course_enrollment_id=$1",
          [id],
        )
      ).rows,
    ).toEqual([]);
    await decide(id, 3, "waitlist");
    await decide(id, 4, "accept");
    expect(await state(id)).toMatchObject({
      status: "accepted",
      charge_cents: 10000,
      version: 5,
    });
    expect(
      (
        await db.query(
          "select id from public.course_enrollments where course_id=$1",
          [cycle],
        )
      ).rows,
    ).toHaveLength(1);
  });
  it("restores the original full-cycle charge while preserving settlement, receipts, refunds and care", async () => {
    const { cycle, id } = await acceptedCourse();
    const publication = await coursePlan(id),
      payment = await coursePay(id);
    await decide(id, 3, "cancel", "Pierwsza rezygnacja", owner);
    await courseSettle(id, 4, 3000);
    await courseRefund(payment, 7000);
    const settlements = (
      await db.query("select * from public.course_settlement_receipts")
    ).rows;
    const plans = (await db.query("select * from public.care_plan_versions"))
      .rows;
    const receipts = (await db.query("select * from public.payments")).rows;
    const refunds = (
      await db.query("select * from public.course_payment_refunds")
    ).rows;
    const calendar = (
      await db.query(
        "select * from public.calendar_slots order by course_session_id",
      )
    ).rows;
    await db.query(
      "update public.services set price_cents=15000,version=2 where id=$1",
      [service],
    );
    expect(await reopenEnrollment(id, 6, "restore")).toBe(7);
    expect(await courseBalance(id, owner)).toMatchObject({
      status: "accepted",
      agreed_price_cents: 10000,
      charge_cents: 10000,
      paid_cents: 3000,
      refunded_cents: 7000,
      due_cents: 7000,
      refund_due_cents: 0,
      needs_review: false,
      can_pay: true,
    });
    for (const [table, expected] of [
      ["course_settlement_receipts", settlements],
      ["care_plan_versions", plans],
      ["payments", receipts],
      ["course_payment_refunds", refunds],
    ] as const)
      expect((await db.query(`select * from public.${table}`)).rows).toEqual(
        expected,
      );
    expect(
      (
        await db.query(
          "select * from public.calendar_slots order by course_session_id",
        )
      ).rows,
    ).toEqual(calendar);
    expect(
      (
        await db.query<{ version: number }>(
          "select version from public.courses where id=$1",
          [cycle],
        )
      ).rows[0].version,
    ).toBe(2);
    expect(
      (
        await db.query(
          "select settled_at,settled_by from public.course_enrollments where id=$1",
          [id],
        )
      ).rows,
    ).toEqual([{ settled_at: null, settled_by: null }]);
    expect(
      (
        await db.query(
          "select previous_status,previous_charge_cents,previous_settled_at is not null as settled from public.course_reopening_receipts",
        )
      ).rows,
    ).toEqual([
      {
        previous_status: "cancelled",
        previous_charge_cents: 3000,
        settled: true,
      },
    ]);
    expect(
      (
        await db.query<{ details: Record<string, unknown> }>(
          "select details from public.course_history where enrollment_id=$1 and action='restore'",
          [id],
        )
      ).rows[0].details,
    ).toMatchObject({
      previous_status: "cancelled",
      previous_charge_cents: 3000,
      charge_cents: 10000,
      agreed_price_cents: 10000,
    });
    expect(
      (await careFeed(cycle, [id], owner))[0].plans.map((p) => p.id),
    ).toContain(publication.published_id);
    expect(
      (
        await db.query(
          "select id from public.reminder_jobs where course_enrollment_id=$1 and status='pending'",
          [id],
        )
      ).rows,
    ).toHaveLength(5);
    await coursePay(id, 7000);
    expect(await courseBalance(id)).toMatchObject({
      due_cents: 0,
      paid_cents: 10000,
      refunded_cents: 7000,
    });
  });
  it("allows an explicitly restored request to be settled after a later cancellation even without an earlier accept action", async () => {
    const cycle = await course(),
      id = await enroll(cycle);
    await decide(id, 1, "cancel", "Rezygnacja przed decyzją", owner);
    await reopenEnrollment(id, 2, "restore");
    await decide(id, 3, "cancel", "Kolejna rezygnacja", owner);
    await courseSettle(id, 4, 4000);
    expect(await courseBalance(id)).toMatchObject({
      charge_cents: 4000,
      due_cents: 4000,
      can_pay: true,
    });
  });
  it("retries an earlier identical restoration after payment and whole-course cancellation without changing any state", async () => {
    const { cycle, id } = await acceptedCourse();
    await decide(id, 2, "cancel", "Rezygnacja", owner);
    expect(await reopenEnrollment(id, 3, "restore")).toBe(4);
    await coursePay(id, 4000);
    await change(cycle, 2, "cancel", "Odwołany cały cykl");
    const before = await state(id),
      history = (
        await db.query("select * from public.course_history order by id")
      ).rows;
    expect(await reopenEnrollment(id, 3, "restore")).toBe(4);
    expect(await state(id)).toEqual(before);
    expect(
      (await db.query("select * from public.course_history order by id")).rows,
    ).toEqual(history);
    await expect(
      reopenEnrollment(id, 3, "restore", "Inny powód"),
    ).rejects.toThrow("Zgłoszenie zmieniło");
    await expect(
      reopenEnrollment(id, 3, "restore", undefined, colleague),
    ).rejects.toThrow("Zgłoszenie zmieniło");
  });
  it("keeps distinct receipts for successive reconsiderations and confirms the older one without overwriting the newer state", async () => {
    const cycle = await course(),
      id = await enroll(cycle);
    await decide(id, 1, "reject", "Pierwsza odmowa");
    await reopenEnrollment(id, 2, "reconsider");
    await decide(id, 3, "reject", "Druga odmowa");
    await reopenEnrollment(id, 4, "reconsider", "Drugi powrót");
    expect(await reopenEnrollment(id, 2, "reconsider")).toBe(3);
    expect(await state(id)).toMatchObject({ status: "requested", version: 5 });
    expect(
      (
        await db.query(
          "select source_version,result_version from public.course_reopening_receipts order by source_version",
        )
      ).rows,
    ).toEqual([
      { source_version: 2, result_version: 3 },
      { source_version: 4, result_version: 5 },
    ]);
  });
  it("refuses restoration into a full course atomically, then permits it when a place actually becomes free", async () => {
    const { cycle, id } = await acceptedCourse();
    await decide(id, 2, "cancel", "Zwolnienie miejsca", owner);
    const otherId = await enroll(cycle, otherDog, other);
    await decide(otherId, 1, "accept");
    await expect(reopenEnrollment(id, 3, "restore")).rejects.toThrow(
      "Brak wolnych miejsc",
    );
    expect(await state(id)).toMatchObject({ status: "cancelled", version: 3 });
    expect(
      (await db.query("select * from public.course_reopening_receipts")).rows,
    ).toEqual([]);
    await decide(otherId, 2, "cancel", "Zwolnienie miejsca", other);
    await reopenEnrollment(id, 3, "restore");
    expect(await state(id)).toMatchObject({ status: "accepted", version: 4 });
  });
  it("permits a staff return while public signups are closed but refuses after the first meeting starts", async () => {
    const { cycle, id } = await acceptedCourse();
    await decide(id, 2, "cancel", "Rezygnacja", owner);
    await change(cycle, 2, "close");
    await reopenEnrollment(id, 3, "restore");
    await decide(id, 4, "cancel", "Kolejna rezygnacja", owner);
    await db.query(
      "update public.course_sessions set starts_at=now()-interval '1 day' where course_id=$1 and ordinal=1",
      [cycle],
    );
    await expect(reopenEnrollment(id, 5, "restore")).rejects.toThrow(
      "przed pierwszym",
    );
  });
  it("refuses reopening a cancelled cycle without resetting its enrollment or liability", async () => {
    const { cycle, id } = await acceptedCourse();
    await change(cycle, 2, "cancel", "Odwołanie kursu");
    await expect(reopenEnrollment(id, 3, "restore")).rejects.toThrow(
      "przed pierwszym",
    );
    expect(await state(id)).toMatchObject({
      status: "cancelled",
      charge_cents: 10000,
      version: 3,
    });
  });
  it("denies direct writes, non-staff reopening, stale versions, missing reasons and wrong source status", async () => {
    const { id } = await acceptedCourse();
    await expect(reopenEnrollment(id, 2, "restore")).rejects.toThrow(
      "Ta zmiana",
    );
    await decide(id, 2, "cancel", "Rezygnacja", owner);
    await expect(reopenEnrollment(id, 3, "restore", "", admin)).rejects.toThrow(
      "powód",
    );
    await expect(reopenEnrollment(id, 2, "restore")).rejects.toThrow(
      "Zgłoszenie zmieniło",
    );
    await expect(
      reopenEnrollment(id, 3, "restore", undefined, owner),
    ).rejects.toThrow("Brak uprawnień");
    await expect(
      reopenEnrollment(id, 3, "restore", undefined, other),
    ).rejects.toThrow("Brak uprawnień");
    await expect(reopenEnrollment(id, 3, "reconsider")).rejects.toThrow(
      "Ta zmiana",
    );
    await reopenEnrollment(id, 3, "restore");
    expect(
      (
        await asUser(owner, () =>
          db.query("select * from public.course_reopening_receipts"),
        )
      ).rows,
    ).toEqual([]);
    await expect(
      asAdmin(() => db.query("delete from public.course_reopening_receipts")),
    ).rejects.toThrow("permission denied");
    await expect(
      asAdmin(() =>
        db.query(
          "update public.course_enrollments set status='accepted' where id=$1",
          [id],
        ),
      ),
    ).rejects.toThrow("permission denied");
  });
  it("does not reopen the old guardian participation after transfer or a role change", async () => {
    const { id } = await acceptedCourse();
    await decide(id, 2, "cancel", "Rezygnacja", owner);
    await db.query("update public.dogs set guardian_id=$1 where id=$2", [
      other,
      dog,
    ]);
    await expect(reopenEnrollment(id, 3, "restore")).rejects.toThrow(
      "Opiekun psa zmienił",
    );
    await db.query("update public.dogs set guardian_id=$1 where id=$2", [
      owner,
      dog,
    ]);
    await db.query(
      "update public.user_roles set role='admin' where user_id=$1",
      [owner],
    );
    await expect(reopenEnrollment(id, 3, "restore")).rejects.toThrow(
      "Opiekun psa zmienił",
    );
    expect(await state(id)).toMatchObject({ status: "cancelled", version: 3 });
  });
  it("rolls back charge, status, receipt, reminders and the earlier guardian notice when another recipient fails", async () => {
    const { id } = await acceptedCourse();
    await decide(id, 2, "cancel", "Rezygnacja", owner);
    const before = await state(id),
      jobs = await courseJobs();
    await db.exec(`create or replace function public.course_edit_fail() returns trigger language plpgsql as $$begin raise exception 'reopening notice failure';end$$;
      create trigger course_notice_test_failure before insert on public.notifications for each row
      when(new.kind='course_enrollment_reopened' and new.recipient_id='${colleague}') execute function public.course_edit_fail();`);
    await expect(reopenEnrollment(id, 3, "restore")).rejects.toThrow(
      "reopening notice failure",
    );
    expect(await state(id)).toEqual(before);
    expect(await courseJobs()).toEqual(jobs);
    expect(
      (await db.query("select * from public.course_reopening_receipts")).rows,
    ).toEqual([]);
    expect(
      (
        await db.query(
          "select id from public.course_history where action='restore'",
        )
      ).rows,
    ).toEqual([]);
    expect(
      (
        await db.query(
          "select id from public.notifications where kind='course_enrollment_reopened'",
        )
      ).rows,
    ).toEqual([]);
    expect(
      (
        await db.query(
          "select id from public.audit_events where event='course_enrollment_reopened'",
        )
      ).rows,
    ).toEqual([]);
  });
});
