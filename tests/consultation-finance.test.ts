import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { beforeAll, beforeEach, afterAll, describe, expect, it } from "vitest";
import type { ConsultationBalance } from "../src/lib/finance";

let db: PGlite;
const admin = "11000000-0000-4000-8000-000000000001";
const owner = "11000000-0000-4000-8000-000000000002";
const stranger = "11000000-0000-4000-8000-000000000003";
const dog = "21000000-0000-4000-8000-000000000001";
const service = "60000000-0000-4000-8000-000000000011";

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
    grant usage on schema public,auth to anon,authenticated;
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
  await db.query("insert into auth.users(id) values($1),($2),($3)", [
    admin,
    owner,
    stranger,
  ]);
  await db.query("update public.user_roles set role='admin' where user_id=$1", [
    admin,
  ]);
  await db.query(
    "insert into public.dogs(id,guardian_id,name) values($1,$2,'Figa')",
    [dog, owner],
  );
});
beforeEach(async () => {
  // Reset dependent care records now that publications can reference meetings.
  await db.exec(`truncate public.payments,public.calendar_slots,public.consultation_events,public.consultation_history,public.consultations,public.audit_events,public.notifications cascade;
    delete from public.service_revisions where version>1;
    update public.services set price_cents=10000,version=1,updated_by=null;`);
});
afterAll(async () => {
  await db?.close();
});

async function request() {
  const id = randomUUID();
  await asUser(owner, () =>
    db.query(
      "select public.request_consultation($1,$2,'Wspólny spacer','',$3,1)",
      [id, dog, service],
    ),
  );
  return id;
}
async function schedule(id: string, version = 1, days = 10) {
  return asUser(admin, () =>
    db.query(
      "select public.change_consultation($1,$2,'schedule',now()+make_interval(days=>$3),90,'online','Wideorozmowa','Uzgodniony termin')",
      [id, version, days],
    ),
  );
}
async function cancel(id: string, user = admin, version = 2) {
  return asUser(user, () =>
    db.query(
      "select public.change_consultation($1,$2,'cancel',null,null,null,null,'Zmiana planów')",
      [id, version],
    ),
  );
}
async function balance(id: string, user = owner) {
  return (
    await asUser(user, () =>
      db.query<ConsultationBalance>(
        "select * from public.consultation_balances where id=$1",
        [id],
      ),
    )
  ).rows[0];
}
async function pay(
  id: string,
  amount = 10000,
  key = randomUUID(),
  user = admin,
  method = "transfer",
  note = "Wpłata testowa",
) {
  return (
    await asUser(user, () =>
      db.query<{ id: string }>(
        "select public.record_payment(null,null,$1,$2,$3,$4,$5) id",
        [amount, method, note, key, id],
      ),
    )
  ).rows[0].id;
}
async function refund(id: string, user = admin) {
  return asUser(user, () =>
    db.query("select public.void_payment($1,'Rozliczono zwrot')", [id]),
  );
}
async function legacy(status = "requested") {
  const id = randomUUID();
  await db.query(
    "insert into public.consultations(id,practice_id,dog_id,requested_by,topic) values($1,'00000000-0000-4000-8000-000000000001',$2,$3,'Starsze spotkanie bez ceny')",
    [id, dog, owner],
  );
  await db.query(
    "insert into public.consultation_history(consultation_id,version,action,author_id) values($1,1,'requested',$2)",
    [id, owner],
  );
  if (status === "scheduled") await schedule(id);
  else if (status === "completed")
    await db.query(
      "update public.consultations set status='completed',starts_at=now()-interval '1 day',duration_minutes=60,meeting_mode='online',location='Dawna rozmowa' where id=$1",
      [id],
    );
  return id;
}
async function agree(
  id: string,
  amount = 17550,
  version = 1,
  key = randomUUID(),
  user = admin,
  testPrice = false,
  note = "Kwota uzgodniona z opiekunem",
) {
  return (
    await asUser(user, () =>
      db.query<{ version: number }>(
        "select public.agree_consultation_price($1,$2,$3,$4,$5,$6) version",
        [id, version, amount, testPrice, note, key],
      ),
    )
  ).rows[0].version;
}

describe.sequential("historical consultation price agreement", () => {
  it.each(["requested", "scheduled", "completed"])(
    "sets the explicitly agreed price of a %s legacy meeting without inventing catalogue terms",
    async (status) => {
      const id = await legacy(status),
        version = status === "scheduled" ? 2 : 1;
      expect(await agree(id, 17550, version)).toBe(version + 1);
      expect(await balance(id)).toMatchObject({
        agreed_price_cents: 17550,
        paid_cents: 0,
        due_cents: status === "requested" ? 0 : 17550,
        is_test_price: false,
      });
      expect(
        (
          await db.query(
            "select service_id,service_name,service_version,service_duration_minutes,service_meeting_mode from public.consultations where id=$1",
            [id],
          )
        ).rows[0],
      ).toEqual({
        service_id: null,
        service_name: null,
        service_version: null,
        service_duration_minutes: null,
        service_meeting_mode: null,
      });
      const history = await asUser(owner, () =>
        db.query(
          "select action,agreed_price_cents,is_test_price,note,author_id from public.consultation_history where consultation_id=$1 and action='price_agreed'",
          [id],
        ),
      );
      expect(history.rows).toEqual([
        {
          action: "price_agreed",
          agreed_price_cents: 17550,
          is_test_price: false,
          note: "Kwota uzgodniona z opiekunem",
          author_id: admin,
        },
      ]);
      expect(
        (
          await asUser(stranger, () =>
            db.query(
              "select id from public.consultation_history where consultation_id=$1",
              [id],
            ),
          )
        ).rows,
      ).toEqual([]);
      expect(
        (
          await db.query(
            "select recipient_id from public.notifications where entity_id=$1 and kind='consultation_price_agreed'",
            [id],
          )
        ).rows,
      ).toEqual([{ recipient_id: owner }]);
      if (status === "requested") await schedule(id, version + 1);
      await pay(id, 5550);
      expect(await balance(id)).toMatchObject({
        agreed_price_cents: 17550,
        paid_cents: 5550,
        due_cents: 12000,
      });
    },
  );
  it("makes exact retries a no-op even after the meeting changes and rejects key reuse", async () => {
    const id = await legacy(),
      key = randomUUID();
    await agree(id, 10000, 1, key, admin, true);
    await schedule(id, 2);
    expect(await agree(id, 10000, 1, key, admin, true)).toBe(2);
    await expect(agree(id, 10001, 1, key, admin, true)).rejects.toThrow(
      "identyfikator",
    );
    await expect(agree(id, 10000, 1, key, admin, false)).rejects.toThrow(
      "identyfikator",
    );
    await expect(
      agree(id, 10000, 1, key, admin, true, "Inne uzasadnienie"),
    ).rejects.toThrow("identyfikator");
    await expect(agree(id, 10000, 2, key, admin, true)).rejects.toThrow(
      "identyfikator",
    );
    expect(
      (
        await db.query(
          "select id from public.consultation_history where action='price_agreed'",
        )
      ).rows,
    ).toHaveLength(1);
    expect(
      (
        await db.query(
          "select id from public.audit_events where event='consultation_price_agreed'",
        )
      ).rows,
    ).toHaveLength(1);
    expect(
      (
        await db.query(
          "select id from public.notifications where kind='consultation_price_agreed'",
        )
      ).rows,
    ).toHaveLength(1);
    expect(
      (
        await db.query("select version from public.consultations where id=$1", [
          id,
        ])
      ).rows[0],
    ).toEqual({ version: 3 });
  });
  it("preserves catalogue prices and prevents replacing a manual agreement", async () => {
    const current = await request();
    await expect(agree(current)).rejects.toThrow("już ustaloną cenę");
    await cancel(current, owner, 1);
    const id = await legacy();
    await agree(id);
    await expect(agree(id, 10000, 2)).rejects.toThrow("już ustaloną cenę");
    expect(await balance(current)).toMatchObject({ agreed_price_cents: 10000 });
    expect(await balance(id)).toMatchObject({ agreed_price_cents: 17550 });
  });
  it("rejects stale scheduling and cancellation drafts after a price agreement", async () => {
    const id = await legacy();
    await agree(id);
    await expect(schedule(id, 1)).rejects.toThrow("zmieniła się");
    await expect(cancel(id, owner, 1)).rejects.toThrow("zmieniła się");
    expect(await balance(id)).toMatchObject({
      status: "requested",
      due_cents: 0,
    });
  });
  it("does not establish a debt after cancellation", async () => {
    const id = await legacy();
    await cancel(id, owner, 1);
    await expect(agree(id, 10000, 2)).rejects.toThrow("Odwołane spotkanie");
    expect(await balance(id)).toMatchObject({
      agreed_price_cents: null,
      due_cents: 0,
    });
  });
  it("requires staff in the database and denies direct price and history writes", async () => {
    const id = await legacy();
    for (const user of [owner, stranger])
      await expect(agree(id, 10000, 1, randomUUID(), user)).rejects.toThrow(
        "Brak uprawnień",
      );
    await expect(
      asUser(admin, () =>
        db.query(
          "update public.consultations set agreed_price_cents=1,is_test_price=true where id=$1",
          [id],
        ),
      ),
    ).rejects.toThrow("permission denied");
    await expect(
      asUser(owner, () =>
        db.query(
          "update public.consultation_history set note='Zmiana' where consultation_id=$1",
          [id],
        ),
      ),
    ).rejects.toThrow("permission denied");
    await db.exec("begin; set local role anon");
    try {
      await expect(
        db.query(
          "select public.agree_consultation_price($1,1,10000,true,'Próba',$2)",
          [id, randomUUID()],
        ),
      ).rejects.toThrow("permission denied");
    } finally {
      await db.exec("rollback");
    }
    expect(await balance(id)).toMatchObject({ agreed_price_cents: null });
  });
  it("validates monetary limits and refuses an amount below existing historical receipts", async () => {
    const id = await legacy("completed");
    for (const amount of [null, 0, -1, 1000001])
      await expect(agree(id, amount as number)).rejects.toThrow(
        "Podaj uzgodnioną",
      );
    await expect(agree(id, 10000, 0)).rejects.toThrow("Podaj uzgodnioną");
    await expect(
      agree(id, 10000, 1, randomUUID(), admin, true, " "),
    ).rejects.toThrow("Podaj uzgodnioną");
    // An imported receipt must never become an overpayment after assigning the
    // missing amount; ordinary receipt RPCs already refuse an unpriced meeting.
    await db.query(
      "insert into public.payments(guardian_id,dog_id,consultation_id,amount_cents,method,status,author_id) values($1,$2,$3,5000,'cash','paid',$4)",
      [owner, dog, id, admin],
    );
    await expect(agree(id, 4999)).rejects.toThrow("niższa od zapisanych wpłat");
    await agree(id, 5000);
    expect(await balance(id)).toMatchObject({
      due_cents: 0,
      paid_cents: 5000,
      agreed_price_cents: 5000,
    });
  });
  it.each(["history", "notification", "audit"])(
    "rolls back the amount and all side effects when %s writing fails",
    async (target) => {
      const id = await legacy();
      const table = {
        history: "consultation_history",
        notification: "notifications",
        audit: "audit_events",
      }[target]!;
      await db.exec(
        `create function public.fail_price_write() returns trigger language plpgsql as $$begin raise exception 'price side effect failed'; end$$; create trigger fail_price_write before insert on public.${table} for each row execute function public.fail_price_write();`,
      );
      try {
        await expect(agree(id)).rejects.toThrow("price side effect failed");
        expect(await balance(id)).toMatchObject({
          agreed_price_cents: null,
          due_cents: 0,
        });
        expect(
          (
            await db.query(
              "select version from public.consultations where id=$1",
              [id],
            )
          ).rows[0],
        ).toEqual({ version: 1 });
        expect(
          (
            await db.query(
              "select id from public.consultation_history where action='price_agreed'",
            )
          ).rows,
        ).toEqual([]);
        expect(
          (
            await db.query(
              "select id from public.audit_events where event='consultation_price_agreed'",
            )
          ).rows,
        ).toEqual([]);
        expect(
          (
            await db.query(
              "select id from public.notifications where kind='consultation_price_agreed'",
            )
          ).rows,
        ).toEqual([]);
      } finally {
        await db.exec(
          `drop trigger fail_price_write on public.${table}; drop function public.fail_price_write()`,
        );
      }
    },
  );
});

describe.sequential(
  "consultation receivables and receipts in PostgreSQL",
  () => {
    it("starts charging only when scheduled, retaining the agreed price after a catalogue edit and reschedule", async () => {
      const id = await request();
      expect(await balance(id)).toMatchObject({
        due_cents: 0,
        paid_cents: 0,
        agreed_price_cents: 10000,
      });
      await asUser(admin, () =>
        db.query(
          "select public.update_service($1,1,'Nowa oferta','',17550,'za spotkanie',90,1,true,false)",
          [service],
        ),
      );
      await schedule(id);
      expect(await balance(id)).toMatchObject({
        status: "scheduled",
        due_cents: 10000,
        paid_cents: 0,
      });
      await pay(id, 3000);
      await schedule(id, 2, 12);
      expect(await balance(id)).toMatchObject({
        due_cents: 7000,
        paid_cents: 3000,
        agreed_price_cents: 10000,
      });
    });
    it("applies partial payments exactly once and rejects overpayment", async () => {
      const id = await request();
      await schedule(id);
      const key = randomUUID();
      const receipt = await pay(id, 4000, key);
      expect(await pay(id, 4000, key)).toBe(receipt);
      expect(await balance(id)).toMatchObject({
        due_cents: 6000,
        paid_cents: 4000,
      });
      await expect(pay(id, 6001)).rejects.toThrow("przekracza");
      await pay(id, 6000);
      expect(await balance(id)).toMatchObject({
        due_cents: 0,
        paid_cents: 10000,
      });
      await expect(pay(id, 1)).rejects.toThrow("przekracza");
      expect(
        (await db.query("select id from public.payments")).rows,
      ).toHaveLength(2);
      expect(
        (
          await db.query(
            "select id from public.audit_events where event='payment_recorded'",
          )
        ).rows,
      ).toHaveLength(2);
    });
    it("rejects a reused key with changed amount, method, note or target", async () => {
      const id = await request();
      await schedule(id);
      const key = randomUUID();
      await pay(id, 2000, key);
      await expect(pay(id, 2001, key)).rejects.toThrow("identyfikator");
      await expect(pay(id, 2000, key, admin, "cash")).rejects.toThrow(
        "identyfikator",
      );
      await expect(
        pay(id, 2000, key, admin, "transfer", "Inny opis"),
      ).rejects.toThrow("identyfikator");
      await cancel(id);
      const another = await request();
      await schedule(another);
      await expect(pay(another, 2000, key)).rejects.toThrow("identyfikator");
      const pack = (
        await asUser(admin, () =>
          db.query<{ id: string }>(
            "select public.purchase_package($1,'Pakiet',4,10000,null,'') id",
            [dog],
          ),
        )
      ).rows[0].id;
      await expect(
        asUser(admin, () =>
          db.query(
            "select public.record_payment(null,$1,2000,'transfer','Wpłata testowa',$2)",
            [pack, key],
          ),
        ),
      ).rejects.toThrow("identyfikator");
      expect(
        (await db.query("select id from public.payments")).rows,
      ).toHaveLength(1);
    });
    it("releases cancelled debt but preserves receipts and marks them for review until an explicit refund", async () => {
      const id = await request();
      await schedule(id);
      const key = randomUUID();
      const receipt = await pay(id, 4000, key);
      await cancel(id, owner);
      expect(await balance(id)).toMatchObject({
        due_cents: 0,
        paid_cents: 4000,
        needs_review: true,
      });
      await expect(pay(id, 6000)).rejects.toThrow("umówionej lub zakończonej");
      expect(await pay(id, 4000, key)).toBe(receipt);
      await refund(receipt);
      expect(await balance(id)).toMatchObject({
        due_cents: 0,
        paid_cents: 0,
        needs_review: false,
      });
      expect(await pay(id, 4000, key)).toBe(receipt);
      await refund(receipt);
      const row = (
        await db.query(
          "select status,refund_note,refunded_by from public.payments where id=$1",
          [receipt],
        )
      ).rows[0];
      expect(row).toMatchObject({
        status: "refunded",
        refund_note: "Rozliczono zwrot",
        refunded_by: admin,
      });
      expect(
        (
          await db.query(
            "select id from public.audit_events where event='payment_refunded'",
          )
        ).rows,
      ).toHaveLength(1);
    });
    it("reopens the correct balance after correcting a receipt for an active consultation", async () => {
      const id = await request();
      await schedule(id);
      const first = await pay(id, 4000);
      await pay(id, 6000);
      await refund(first);
      expect(await balance(id)).toMatchObject({
        due_cents: 4000,
        paid_cents: 6000,
      });
      await pay(id, 4000);
      expect(await balance(id)).toMatchObject({
        due_cents: 0,
        paid_cents: 10000,
      });
    });
    it("keeps the debt after completion and accepts a receipt after the meeting", async () => {
      const id = await request();
      await schedule(id);
      await db.query(
        "update public.consultations set starts_at=now()-interval '1 day' where id=$1",
        [id],
      );
      await asUser(admin, () =>
        db.query(
          "select public.change_consultation($1,2,'complete',null,null,null,null,'Omówiono plan')",
          [id],
        ),
      );
      expect(await balance(id)).toMatchObject({
        status: "completed",
        due_cents: 10000,
      });
      await pay(id);
      expect(await balance(id)).toMatchObject({
        due_cents: 0,
        paid_cents: 10000,
      });
    });
    it("rejects collecting money for an unconfirmed request or one without a historical price", async () => {
      const id = await request();
      await expect(pay(id)).rejects.toThrow("umówionej lub zakończonej");
      await cancel(id, owner, 1);
      const legacy = randomUUID();
      await db.query(
        "insert into public.consultations(id,practice_id,dog_id,requested_by,topic) values($1,'00000000-0000-4000-8000-000000000001',$2,$3,'Starsze zgłoszenie')",
        [legacy, dog, owner],
      );
      await schedule(legacy);
      expect(await balance(legacy)).toMatchObject({
        agreed_price_cents: null,
        due_cents: 0,
      });
      await expect(pay(legacy)).rejects.toThrow("nie ma ustalonej ceny");
    });
    it("exposes balances and receipt history only to staff and the correct guardian, not another guardian", async () => {
      const id = await request();
      await schedule(id);
      await pay(id, 4000);
      expect(await balance(id, admin)).toMatchObject({ due_cents: 6000 });
      expect(await balance(id, owner)).toMatchObject({ due_cents: 6000 });
      expect(await balance(id, stranger)).toBeUndefined();
      expect(
        (
          await asUser(stranger, () =>
            db.query("select id from public.payments"),
          )
        ).rows,
      ).toEqual([]);
      const receipt = (
        await asUser(owner, () =>
          db.query(
            "select guardian_id,dog_id,author_id,consultation_id from public.payments",
          ),
        )
      ).rows[0];
      expect(receipt).toMatchObject({
        guardian_id: owner,
        dog_id: dog,
        author_id: admin,
        consultation_id: id,
      });
    });
    it("requires staff for recording or reversing money and denies direct table and view writes", async () => {
      const id = await request();
      await schedule(id);
      for (const user of [owner, stranger])
        await expect(pay(id, 1000, randomUUID(), user)).rejects.toThrow(
          "Brak uprawnień",
        );
      const receipt = await pay(id, 4000);
      await expect(refund(receipt, owner)).rejects.toThrow("Brak uprawnień");
      await expect(
        asUser(owner, () =>
          db.query("update public.payments set amount_cents=1 where id=$1", [
            receipt,
          ]),
        ),
      ).rejects.toThrow("permission denied");
      await expect(
        asUser(admin, () =>
          db.query(
            "update public.consultation_balances set agreed_price_cents=1 where id=$1",
            [id],
          ),
        ),
      ).rejects.toThrow();
      expect(await balance(id)).toMatchObject({
        due_cents: 6000,
        paid_cents: 4000,
      });
    });
    it("denies anonymous reading and execution", async () => {
      await db.exec("begin; set local role anon");
      try {
        await expect(
          db.query("select * from public.consultation_balances"),
        ).rejects.toThrow("permission denied");
      } finally {
        await db.exec("rollback");
      }
      await db.exec("begin; set local role anon");
      try {
        await expect(
          db.query(
            "select public.record_payment(null,null,1,'cash','',$1,$2)",
            [randomUUID(), randomUUID()],
          ),
        ).rejects.toThrow("permission denied");
      } finally {
        await db.exec("rollback");
      }
    });
    it("rejects invalid target combinations and monetary input in SQL", async () => {
      const id = await request();
      await schedule(id);
      for (const amount of [0, -1, 1000001])
        await expect(pay(id, amount)).rejects.toThrow("poprawną kwotę");
      await expect(
        pay(id, 1000, randomUUID(), admin, "bitcoin"),
      ).rejects.toThrow("poprawną kwotę");
      await expect(
        asUser(admin, () =>
          db.query(
            "select public.record_payment(null,$1,1000,'cash','',$2,$3)",
            [randomUUID(), randomUUID(), id],
          ),
        ),
      ).rejects.toThrow("jedno rozliczenie");
      await expect(
        db.query(
          "insert into public.payments(guardian_id,dog_id,consultation_id,amount_cents,method,author_id) values($1,$2,null,1,'cash',$3)",
          [owner, dog, admin],
        ),
      ).rejects.toThrow("payment_single_target");
    });
    it("rolls back a receipt and a refund if the audit fails", async () => {
      const id = await request();
      await schedule(id);
      const receipt = await pay(id, 4000);
      await db.exec(`create function public.fail_finance_audit() returns trigger language plpgsql as $$begin if new.event in ('payment_recorded','payment_refunded') then raise exception 'audit failed'; end if; return new; end$$;
      create trigger fail_finance_audit before insert on public.audit_events for each row execute function public.fail_finance_audit();`);
      try {
        await expect(pay(id, 6000)).rejects.toThrow("audit failed");
        await expect(refund(receipt)).rejects.toThrow("audit failed");
        expect(await balance(id)).toMatchObject({
          due_cents: 6000,
          paid_cents: 4000,
        });
        expect(
          (await db.query("select id from public.payments")).rows,
        ).toHaveLength(1);
      } finally {
        await db.exec(
          "drop trigger fail_finance_audit on public.audit_events; drop function public.fail_finance_audit()",
        );
      }
    });
    it("creates no debt when scheduling fails to write its history", async () => {
      const id = await request();
      await db.exec(`create function public.fail_schedule_history() returns trigger language plpgsql as $$begin raise exception 'history failed'; end$$;
      create trigger fail_schedule_history before insert on public.consultation_history for each row execute function public.fail_schedule_history();`);
      try {
        await expect(schedule(id)).rejects.toThrow("history failed");
        expect(await balance(id)).toMatchObject({
          status: "requested",
          due_cents: 0,
        });
      } finally {
        await db.exec(
          "drop trigger fail_schedule_history on public.consultation_history; drop function public.fail_schedule_history()",
        );
      }
    });
  },
);
