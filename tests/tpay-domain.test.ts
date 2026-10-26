import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { configureCalendarPrimary } from "./helpers/calendar-primary.mjs";
import { freeFixtureTime } from "./helpers/calendar-fixture";
import type {
  BeginOnlinePaymentResult,
  OnlinePaymentAttempt,
  OnlinePaymentKind,
} from "../src/modules/payments/types";

let db: PGlite;
const admin = "ad180000-0000-4000-8000-000000000001";
const owner = "ad180000-0000-4000-8000-000000000002";
const stranger = "ad180000-0000-4000-8000-000000000003";
const practice = "00000000-0000-4000-8000-000000000001";
const kinds: OnlinePaymentKind[] = [
  "registration",
  "consultation",
  "course",
  "fitness",
];

async function asRole<T>(
  role: "authenticated" | "service_role" | "anon",
  user: string | null,
  run: () => Promise<T>,
) {
  await db.exec(`begin; set local role ${role}`);
  await db.query("select set_config('request.jwt.claim.sub',$1,true)", [
    user || "",
  ]);
  try {
    const result = await run();
    await db.exec("commit");
    return result;
  } catch (error) {
    await db.exec("rollback");
    throw error;
  }
}
const client = <T>(run: () => Promise<T>, user = owner) =>
  asRole("authenticated", user, run);
const service = <T>(run: () => Promise<T>) => asRole("service_role", null, run);
async function scalar<T>(sql: string, args: unknown[] = []) {
  return (await db.query<{ value: T }>(sql, args)).rows[0].value;
}
async function fixture(kind: OnlinePaymentKind) {
  const dog = await scalar<string>(
    "insert into public.dogs(guardian_id,name) values($1,'BLIK test') returning id as value",
    [owner],
  );
  const target = randomUUID();
  let parent: string | null = null;
  if (kind === "registration") {
    parent = await scalar<string>(
      `insert into public.walks(starts_at,public_location,type,price_cents,capacity)
      values($1,'Lokalny park','Test BLIK',6000,10) returning id as value`,
      [await freeFixtureTime(db, 240)],
    );
    await db.query(
      `insert into public.walk_registrations(id,walk_id,dog_id,status,payment_status,decided_by,decided_at)
      values($1,$2,$3,'accepted','due',$4,now())`,
      [target, parent, dog, admin],
    );
  } else if (kind === "consultation") {
    await db.query(
      `insert into public.consultations(id,practice_id,dog_id,requested_by,topic,status,starts_at,duration_minutes,
      meeting_mode,location,agreed_price_cents,is_test_price)
      values($1,$2,$3,$4,'Test płatności','scheduled',$5,60,'in_person','Test lokalny',6000,true)`,
      [target, practice, dog, owner, await freeFixtureTime(db, 240)],
    );
  } else if (kind === "course") {
    parent = randomUUID();
    await db.query(
      `insert into public.courses(id,practice_id,service_id,service_version,service_name,price_cents,is_test_price,
      sessions_count,duration_minutes,course_format,title,public_location,capacity,status,created_by,updated_by)
      select $1,$2,id,version,name,6000,true,2,60,'group','Lokalny kurs BLIK','Park lokalny',5,'open',$3,$3
      from public.services where kind='course' order by id limit 1`,
      [parent, practice, admin],
    );
    await db.query(
      `insert into public.course_enrollments(id,course_id,dog_id,guardian_id,selected_course_version,status,
      agreed_price_cents,is_test_price,charge_cents,updated_by) values($1,$2,$3,$4,1,'accepted',6000,true,6000,$5)`,
      [target, parent, dog, owner, admin],
    );
  } else {
    await db.query(
      `insert into public.fitness_packages(id,practice_id,dog_id,guardian_id,service_id,service_version,service_name,
      sessions_count,duration_minutes,agreed_price_cents,is_test_price,topic,status,charge_cents,accepted_at,updated_by)
      select $1,$2,$3,$4,id,version,name,2,60,6000,true,'Lokalny test BLIK','active',6000,now(),$5
      from public.services where booking_flow='fitness' order by id limit 1`,
      [target, practice, dog, owner, admin],
    );
  }
  return { kind, target, dog, parent };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
const begin = async (
  f: Fixture,
  request = randomUUID(),
  user = owner,
  expected?: number,
) => {
  const amount =
    expected ??
    (await scalar<number>(
      "select (public.lock_online_payment_target($1,$2)->>'due_cents')::integer as value",
      [f.kind, f.target],
    ));
  return service(() =>
    scalar<BeginOnlinePaymentResult>(
      "select public.begin_online_payment($1,$2,$3,$4,'sandbox',$5,'merchant-test') as value",
      [user, f.kind, f.target, request, Math.max(amount || 0, 1)],
    ),
  );
};
const bind = (a: OnlinePaymentAttempt) =>
  service(() =>
    scalar<OnlinePaymentAttempt>(
      "select to_jsonb(public.bind_online_payment($1,$2,$3,'merchant-test',$4)) as value",
      [
        a.id,
        `tx-${a.id}`,
        `title-${a.id}`,
        `https://secure.sandbox.tpay.com/${a.id}`,
      ],
    ),
  );
const outcome = (
  a: OnlinePaymentAttempt,
  changes: Record<string, unknown> = {},
) => {
  const values = {
    environment: a.environment,
    transaction: a.transaction_id,
    merchant: a.merchant_id,
    status: "paid",
    amount: a.amount_cents,
    currency: "PLN",
    title: a.transaction_title,
    reason: null,
    paid: null,
    ...changes,
  };
  return service(() =>
    scalar<OnlinePaymentAttempt>(
      "select to_jsonb(public.record_online_payment_outcome($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)) as value",
      [
        a.id,
        values.environment,
        values.transaction,
        values.merchant,
        values.status,
        values.amount,
        values.currency,
        values.title,
        values.reason,
        values.paid,
      ],
    ),
  );
};
async function manual(f: Fixture, amount: number) {
  return client(
    () =>
      f.kind === "fitness"
        ? scalar<string>(
            "select public.record_fitness_payment($1,$2,'transfer','Test ręczny',$3) as value",
            [f.target, amount, randomUUID()],
          )
        : scalar<string>(
            "select public.record_payment($1,$2,$3,'transfer','Test ręczny',$4,$5,$6) as value",
            [
              f.kind === "registration" ? f.target : null,
              null,
              amount,
              randomUUID(),
              f.kind === "consultation" ? f.target : null,
              f.kind === "course" ? f.target : null,
            ],
          ),
    admin,
  );
}
async function cancel(f: Fixture) {
  const table = {
    registration: "walk_registrations",
    consultation: "consultations",
    course: "course_enrollments",
    fitness: "fitness_packages",
  }[f.kind];
  await db.query(`update public.${table} set status=$1 where id=$2`, [
    f.kind === "registration" ? "cancelled_on_time" : "cancelled",
    f.target,
  ]);
}

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,encrypted_password text);
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    grant usage on schema public,auth to anon,authenticated,service_role;
    grant execute on function auth.uid() to anon,authenticated,service_role;
    create schema storage;
    create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
    create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text);
    alter table storage.objects enable row level security;
    create function storage.foldername(name text) returns text[] language sql as $$select string_to_array(name,'/')$$;
    grant usage on schema storage to authenticated; grant select,insert,delete on storage.objects to authenticated;`);
  for (const file of readdirSync("supabase/migrations")
    .filter((name) => name.endsWith(".sql"))
    .sort())
    await db.exec(readFileSync(`supabase/migrations/${file}`, "utf8"));
  await db.query(
    "insert into auth.users(id,email) values($1,'tpay-admin@example.test'),($2,'tpay-owner@example.test'),($3,'tpay-stranger@example.test')",
    [admin, owner, stranger],
  );
  await db.query("update public.user_roles set role='admin' where user_id=$1", [
    admin,
  ]);
  await configureCalendarPrimary(db, admin);
});
afterAll(async () => {
  await db?.close();
});

describe.sequential("local online-payment accounting", () => {
  it("ships disabled, protects settings, and requires an explicit local fixture opt-in", async () => {
    const f = await fixture("registration");
    await expect(begin(f)).rejects.toThrow("wyłączone");
    await expect(
      client(() =>
        db.exec("update public.online_payment_settings set enabled=true"),
      ),
    ).rejects.toThrow("permission denied");
    await db.exec(
      "update public.online_payment_settings set enabled=true,walk_gate='accepted'",
    );
  });

  it.each(kinds)(
    "%s uses DB ownership and remaining money, then records one system receipt while preserving manual attribution",
    async (kind) => {
      const f = await fixture(kind);
      const manualId = await manual(f, 1250);
      await expect(begin(f, randomUUID(), stranger)).rejects.toThrow(
        "własnej należności",
      );
      await expect(begin(f, randomUUID(), admin)).rejects.toThrow(
        "Brak uprawnień",
      );
      const first = await begin(f);
      expect(first.created).toBe(true);
      expect(first.attempt).toMatchObject({
        amount_cents: 4750,
        guardian_id: owner,
        dog_id: f.dog,
        status: "creating",
      });
      expect((await begin(f)).attempt.id).toBe(first.attempt.id);
      const ready = await bind(first.attempt);
      const paid = await outcome(ready);
      expect(paid.status).toBe("paid");
      expect((await outcome(ready)).payment_id).toBe(paid.payment_id);
      expect((await outcome(ready, { status: "failed" })).status).toBe("paid");
      const receipts = (
        await db.query(
          "select author_id,method,amount_cents from public.payments where id in ($1,$2) order by amount_cents",
          [manualId, paid.payment_id],
        )
      ).rows;
      expect(receipts).toEqual([
        { author_id: admin, method: "transfer", amount_cents: 1250 },
        { author_id: null, method: "tpay_sandbox", amount_cents: 4750 },
      ]);
      expect(
        await scalar<number>(
          "select count(*)::integer as value from public.audit_events where entity_id=$1 and event='online_payment_confirmed' and actor_id is null",
          [ready.id],
        ),
      ).toBe(1);
      await expect(begin(f)).rejects.toThrow("należności do zapłaty");
      await client(
        () =>
          db.query(
            "select public.void_payment($1,'Testowa korekta bez przelewu')",
            [paid.payment_id],
          ),
        admin,
      );
      expect(
        await scalar<string>(
          "select status::text as value from public.payments where id=$1",
          [paid.payment_id],
        ),
      ).toBe("refunded");
    },
  );

  it.each(kinds)(
    "%s rejects unaccepted services through direct RPC",
    async (kind) => {
      const f = await fixture(kind);
      if (kind === "registration")
        await db.query(
          "update public.walk_registrations set status='pending' where id=$1",
          [f.target],
        );
      if (kind === "consultation")
        await db.query(
          "update public.consultations set status='requested' where id=$1",
          [f.target],
        );
      if (kind === "course")
        await db.query(
          "update public.course_enrollments set status='requested' where id=$1",
          [f.target],
        );
      if (kind === "fitness")
        await db.query(
          "update public.fitness_packages set status='requested' where id=$1",
          [f.target],
        );
      await expect(begin(f)).rejects.toThrow("przyjętej należności");
    },
  );

  it.each(kinds)(
    "%s keeps full late money after cancellation without recreating a booking or paid balance",
    async (kind) => {
      const f = await fixture(kind);
      const a = await bind((await begin(f)).attempt);
      await cancel(f);
      const result = await outcome(a);
      expect(result).toMatchObject({
        status: "requires_review",
        review_reason: "no_longer_payable",
        confirmed_amount_cents: 6000,
        payment_id: null,
      });
      expect(
        await scalar<number>(
          "select count(*)::integer as value from public.payments where online_attempt_id=$1",
          [a.id],
        ),
      ).toBe(0);
      expect((await outcome(a)).confirmed_at).toBe(result.confirmed_at);
    },
  );

  it("does not accept unpriced, cancelled, legacy-paid, packaged, or draft-course debt", async () => {
    const consultation = await fixture("consultation");
    await db.query(
      "update public.consultations set agreed_price_cents=null,is_test_price=null where id=$1",
      [consultation.target],
    );
    await expect(begin(consultation)).rejects.toThrow("przyjętej należności");
    const walk = await fixture("registration");
    await db.query(
      "update public.walk_registrations set payment_status='paid' where id=$1",
      [walk.target],
    );
    await expect(begin(walk)).rejects.toThrow("przyjętej należności");
    const packaged = await fixture("registration");
    const packageId = await client(
      () =>
        scalar<string>(
          "select public.purchase_package($1,'Lokalny pakiet',1,6000,null,'Test pakietu') as value",
          [packaged.dog],
        ),
      admin,
    );
    await client(
      () =>
        db.query("select public.use_package($1,$2,'Test pakietu')", [
          packaged.target,
          packageId,
        ]),
      admin,
    );
    await expect(begin(packaged)).rejects.toThrow("przyjętej należności");
    const course = await fixture("course");
    await db.query("update public.courses set status='draft' where id=$1", [
      course.parent,
    ]);
    await expect(begin(course)).rejects.toThrow("przyjętej należności");
    const cancelled = await fixture("fitness");
    await cancel(cancelled);
    await expect(begin(cancelled)).rejects.toThrow("przyjętej należności");
    await expect(
      service(() =>
        scalar(
          "select public.begin_online_payment($1,'package',$2,$3,'sandbox',6000,'merchant-test') as value",
          [owner, randomUUID(), randomUUID()],
        ),
      ),
    ).rejects.toThrow("Niepoprawne dane");
  });

  it("allows automatically accepted walks under the user's explicit existing-acceptance decision", async () => {
    const f = await fixture("registration");
    await db.query(
      "update public.walk_registrations set decided_by=null where id=$1",
      [f.target],
    );
    await db.exec(
      "update public.online_payment_settings set walk_gate='disabled'",
    );
    await expect(begin(f)).rejects.toThrow("przyjętej należności");
    await db.exec(
      "update public.online_payment_settings set walk_gate='accepted'",
    );
    expect((await begin(f)).created).toBe(true);
  });

  it("keeps unknown creation active, permits a retry after definitive failure, and preserves two late receipts without another allocation", async () => {
    const f = await fixture("consultation");
    const first = (await begin(f)).attempt;
    expect(
      (await outcome(first, { status: "uncertain", reason: "create_timeout" }))
        .status,
    ).toBe("uncertain");
    expect((await begin(f)).attempt.id).toBe(first.id);
    const boundFirst = await bind(first);
    await outcome(boundFirst, { status: "failed", reason: "api_rejected" });
    const second = await bind((await begin(f)).attempt);
    expect(second.id).not.toBe(first.id);
    await manual(f, 6000);
    expect((await outcome(boundFirst)).review_reason).toBe("balance_changed");
    expect((await outcome(second)).review_reason).toBe("balance_changed");
    expect(
      await scalar<number>(
        "select count(*)::integer as value from public.payments where consultation_id=$1 and status='paid'",
        [f.target],
      ),
    ).toBe(1);
    expect(
      await scalar<number>(
        "select sum(confirmed_amount_cents)::integer as value from public.online_payment_attempts where target_id=$1",
        [f.target],
      ),
    ).toBe(12000);
  });

  it("rejects mismatched confirmation identity, amount, currency, and environment atomically", async () => {
    const a = await bind((await begin(await fixture("consultation"))).attempt);
    for (const values of [
      { amount: 1 },
      { currency: "EUR" },
      { environment: "live" },
      { merchant: "other" },
      { transaction: "other" },
      { title: "other" },
    ])
      await expect(outcome(a, values)).rejects.toThrow("nie odpowiada");
    expect(
      await scalar<string>(
        "select status as value from public.online_payment_attempts where id=$1",
        [a.id],
      ),
    ).toBe("pending");
    expect(
      await scalar<number>(
        "select count(*)::integer as value from public.payments where online_attempt_id=$1",
        [a.id],
      ),
    ).toBe(0);
    await expect(
      service(() =>
        scalar(
          "select to_jsonb(public.bind_online_payment($1,'forged','forged','merchant-test','https://secure.tpay.com/live')) as value",
          [a.id],
        ),
      ),
    ).rejects.toThrow("adres płatności");
  });

  it("records a signed receipt with an unrecovered create response as review, without guessing the transaction ULID", async () => {
    const f = await fixture("consultation");
    const a = (await begin(f)).attempt;
    const result = await outcome(a, {
      merchant: "merchant-test",
      title: `title-${a.id}`,
    });
    expect(result).toMatchObject({
      status: "requires_review",
      review_reason: "unbound_transaction",
      transaction_id: null,
      confirmed_amount_cents: 6000,
      payment_id: null,
    });
    expect((await begin(f)).created).toBe(false);
    expect((await bind(result)).status).toBe("requires_review");
  });

  it.each([2500, 7250])(
    "preserves an actual received amount of %s without allocating an unexpected amount to debt",
    async (received) => {
      const a = await bind(
        (await begin(await fixture("consultation"))).attempt,
      );
      const result = await outcome(a, { paid: received });
      expect(result).toMatchObject({
        status: "requires_review",
        review_reason: "amount_mismatch",
        confirmed_amount_cents: received,
        amount_cents: 6000,
        payment_id: null,
      });
      expect(
        await scalar<number>(
          "select count(*)::integer as value from public.payments where online_attempt_id=$1",
          [a.id],
        ),
      ).toBe(0);
    },
  );

  it("keeps old attempts private to their original guardian after an owner transfer", async () => {
    const f = await fixture("consultation");
    const a = await bind((await begin(f)).attempt);
    await db.query("update public.dogs set guardian_id=$1 where id=$2", [
      stranger,
      f.dog,
    ]);
    const result = await outcome(a);
    expect(result).toMatchObject({
      status: "requires_review",
      review_reason: "owner_changed",
      guardian_id: owner,
      payment_id: null,
    });
    expect(
      await client(() =>
        scalar<number>(
          "select count(*)::integer as value from public.online_payment_attempts where id=$1",
          [a.id],
        ),
      ),
    ).toBe(1);
    expect(
      await client(
        () =>
          scalar<number>(
            "select count(*)::integer as value from public.online_payment_attempts where id=$1",
            [a.id],
          ),
        stranger,
      ),
    ).toBe(0);
    expect(
      await client(
        () =>
          scalar<number>(
            "select count(*)::integer as value from public.online_payment_attempts where id=$1",
            [a.id],
          ),
        admin,
      ),
    ).toBe(1);
  });

  it("prevents client/anon finalization and direct attempt mutations", async () => {
    const a = (await begin(await fixture("consultation"))).attempt;
    for (const role of ["authenticated", "anon"] as const) {
      await expect(
        asRole(role, owner, () =>
          scalar(
            "select public.record_online_payment_outcome($1,'sandbox',null,null,'paid',6000,'PLN') as value",
            [a.id],
          ),
        ),
      ).rejects.toThrow("permission denied");
      await expect(
        asRole(role, owner, () =>
          db.query(
            "update public.online_payment_attempts set status='paid' where id=$1",
            [a.id],
          ),
        ),
      ).rejects.toThrow("permission denied");
    }
    await expect(
      client(() =>
        scalar(
          "select public.lock_online_payment_target('consultation',$1) as value",
          [a.target_id],
        ),
      ),
    ).rejects.toThrow("permission denied");
    await expect(
      client(
        () =>
          scalar(
            "select public.begin_online_payment($1,'consultation',$2,$3,'simulator',6000,'LOCAL-SIMULATOR') as value",
            [stranger, a.target_id, a.request_id],
          ),
        stranger,
      ),
    ).rejects.toThrow("permission denied");
  });

  it("flags chargeback once without inventing a refund or erasing a confirmed receipt", async () => {
    const a = await bind((await begin(await fixture("consultation"))).attempt);
    const paid = await outcome(a);
    expect((await outcome(a, { status: "chargeback" })).review_reason).toBe(
      "chargeback",
    );
    await outcome(a, { status: "chargeback" });
    expect(
      await scalar<string>(
        "select status::text as value from public.payments where id=$1",
        [paid.payment_id],
      ),
    ).toBe("paid");
    expect(
      await scalar<number>(
        "select count(*)::integer as value from public.audit_events where entity_id=$1 and event='online_payment_chargeback'",
        [a.id],
      ),
    ).toBe(1);
  });

  it("preserves a later larger cumulative receipt for the same transaction without another debt allocation", async () => {
    const a = await bind((await begin(await fixture("consultation"))).attempt);
    const paid = await outcome(a);
    const larger = await outcome(a, { paid: 7250 });
    expect(larger).toMatchObject({
      status: "requires_review",
      review_reason: "amount_mismatch",
      confirmed_amount_cents: 7250,
      payment_id: paid.payment_id,
    });
    expect((await outcome(a, { paid: 7250 })).confirmed_amount_cents).toBe(
      7250,
    );
    expect((await outcome(a, { paid: 6000 })).confirmed_amount_cents).toBe(
      7250,
    );
    expect(
      await scalar<number>(
        "select sum(amount_cents)::integer as value from public.payments where online_attempt_id=$1 and status='paid'",
        [a.id],
      ),
    ).toBe(6000);
    expect(
      await scalar<number>(
        "select count(*)::integer as value from public.audit_events where entity_id=$1 and event='online_payment_amount_increased'",
        [a.id],
      ),
    ).toBe(1);
  });

  it("keeps a partial receipt in review when a larger cumulative amount later reaches the quote", async () => {
    const a = await bind((await begin(await fixture("consultation"))).attempt);
    expect((await outcome(a, { paid: 2500 })).review_reason).toBe(
      "amount_mismatch",
    );
    const full = await outcome(a, { paid: 6000 });
    expect(full).toMatchObject({
      status: "requires_review",
      review_reason: "amount_mismatch",
      confirmed_amount_cents: 6000,
      payment_id: null,
    });
    expect((await outcome(a, { paid: 2500 })).confirmed_amount_cents).toBe(
      6000,
    );
    expect(
      await scalar<number>(
        "select count(*)::integer as value from public.payments where online_attempt_id=$1",
        [a.id],
      ),
    ).toBe(0);
  });

  it("preserves the largest received amount and chargeback marker across reordered confirmations", async () => {
    const a = await bind((await begin(await fixture("consultation"))).attempt);
    const paid = await outcome(a);
    const chargeback = await outcome(a, { status: "chargeback", paid: 7250 });
    expect(chargeback).toMatchObject({
      status: "requires_review",
      review_reason: "chargeback",
      confirmed_amount_cents: 7250,
      payment_id: paid.payment_id,
    });
    expect(await outcome(a, { paid: 8000 })).toMatchObject({
      review_reason: "chargeback",
      confirmed_amount_cents: 8000,
    });
    expect(
      (await outcome(a, { status: "chargeback", paid: 6000 }))
        .confirmed_amount_cents,
    ).toBe(8000);
    expect(
      await scalar<number>(
        "select amount_cents as value from public.payments where id=$1",
        [paid.payment_id],
      ),
    ).toBe(6000);
  });
});

it("rejects a stale expected balance before creating any new attempt, while deriving the actual price in the DB", async () => {
  const f = await fixture("consultation");
  await manual(f, 2000);
  await expect(begin(f, randomUUID(), owner, 6000)).rejects.toThrow(
    "Należność zmieniła się",
  );
  expect(
    await scalar<number>(
      "select count(*)::integer as value from public.online_payment_attempts where target_id=$1",
      [f.target],
    ),
  ).toBe(0);
  expect((await begin(f, randomUUID(), owner, 4000)).attempt.amount_cents).toBe(
    4000,
  );
});

it("keeps settlement and RLS history available after new checkout is disabled", async () => {
  const f = await fixture("consultation");
  const a = await bind((await begin(f)).attempt);
  await db.exec("update public.online_payment_settings set enabled=false");
  try {
    await expect(begin(await fixture("consultation"))).rejects.toThrow(
      "wyłączone",
    );
    expect((await outcome(a)).status).toBe("paid");
    expect(
      await client(() =>
        scalar<number>(
          "select count(*)::integer as value from public.online_payment_attempts where id=$1",
          [a.id],
        ),
      ),
    ).toBe(1);
  } finally {
    await db.exec("update public.online_payment_settings set enabled=true");
  }
});

it("stores one private minimal verified receipt and one allocation across notification retries", async () => {
  const a = await bind((await begin(await fixture("consultation"))).attempt);
  const call = () =>
    service(() =>
      scalar<OnlinePaymentAttempt>(
        "select to_jsonb(public.record_online_payment_notification($1,'sandbox',$2,'merchant-test','paid',6000,'PLN',$3,6000,$4)) as value",
        [a.id, a.transaction_id, a.transaction_title, "a".repeat(64)],
      ),
    );
  const first = await call(),
    again = await call();
  expect(again.payment_id).toBe(first.payment_id);
  expect(
    await scalar<number>(
      "select count(*)::integer as value from public.online_payment_notifications where attempt_id=$1",
      [a.id],
    ),
  ).toBe(1);
  await expect(
    client(() => db.query("select * from public.online_payment_notifications")),
  ).rejects.toThrow("permission denied");
});

it("allows only service-origin starts, so a client cannot lock its debt with a forged environment", async () => {
  const f = await fixture("consultation");
  for (const user of [owner, admin, stranger])
    await expect(
      client(
        () =>
          scalar(
            "select public.begin_online_payment($1,'consultation',$2,$3,'simulator',6000,'LOCAL-SIMULATOR') as value",
            [owner, f.target, randomUUID()],
          ),
        user,
      ),
    ).rejects.toThrow("permission denied");
  expect((await begin(f)).created).toBe(true);
});

it("recovers a verified binding without enabling checkout and never resolves an earlier review automatically", async () => {
  const a = (await begin(await fixture("consultation"))).attempt;
  const reviewed = await outcome(a, {
    merchant: "merchant-test",
    title: `title-${a.id}`,
  });
  await db.exec("update public.online_payment_settings set enabled=false");
  try {
    const recovered = await service(() =>
      scalar<OnlinePaymentAttempt>(
        "select to_jsonb(public.recover_online_payment_binding($1,$2,$3,$4,'merchant-test',null)) as value",
        [a.id, admin, `tx-${a.id}`, `title-${a.id}`],
      ),
    );
    expect(recovered.transaction_id).toBe(`tx-${a.id}`);
    expect((await outcome(recovered)).review_reason).toBe(
      reviewed.review_reason,
    );
    await expect(
      service(() =>
        scalar(
          "select public.recover_online_payment_binding($1,$2,'another','another','merchant-test',null) as value",
          [a.id, admin],
        ),
      ),
    ).rejects.toThrow("nie odpowiada");
  } finally {
    await db.exec("update public.online_payment_settings set enabled=true");
  }
});

it("leases bound reconciliation once, retries failures, and rejects stale acknowledgements", async () => {
  const a = await bind((await begin(await fixture("consultation"))).attempt);
  await db.query(
    "update public.online_payment_attempts set next_check_at=null where id<>$1",
    [a.id],
  );
  const claims = await service(
    async () =>
      (
        await db.query<{ id: string; claim_token: string }>(
          "select * from public.worker_claim_online_payment_checks(3)",
        )
      ).rows,
  );
  expect(claims).toHaveLength(1);
  expect(claims[0].id).toBe(a.id);
  expect(
    await service(
      async () =>
        (
          await db.query(
            "select * from public.worker_claim_online_payment_checks(3)",
          )
        ).rows,
    ),
  ).toHaveLength(0);
  expect(
    await service(() =>
      scalar<boolean>(
        "select public.worker_finish_online_payment_check($1,$2,'unavailable') as value",
        [a.id, randomUUID()],
      ),
    ),
  ).toBe(false);
  expect(
    await service(() =>
      scalar<boolean>(
        "select public.worker_finish_online_payment_check($1,$2,'unavailable') as value",
        [a.id, claims[0].claim_token],
      ),
    ),
  ).toBe(true);
  expect(
    await scalar<number>(
      "select check_failures as value from public.online_payment_attempts where id=$1",
      [a.id],
    ),
  ).toBe(1);
});
