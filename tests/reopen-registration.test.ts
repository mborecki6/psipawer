import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

let db: PGlite;
const admin = "71000000-0000-4000-8000-000000000001";
const owner = "71000000-0000-4000-8000-000000000002";

async function asUser<T>(id: string, run: () => Promise<T>) {
  await db.exec("begin; set local role authenticated");
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

async function fixture(
  status = "cancelled_on_time",
  hours = 100,
  walkStatus = "open",
) {
  const dog = (
    await db.query<{ id: string }>(
      "insert into public.dogs(guardian_id,name) values($1,'Pies testowy') returning id",
      [owner],
    )
  ).rows[0].id;
  await db.query("update public.dogs set status='approved' where id=$1", [dog]);
  const walk = (
    await db.query<{ id: string }>(
      `insert into public.walks(starts_at,public_location,type,price_cents,capacity,status)
     values(now()+make_interval(hours=>$1),'Park testowy','Spacer',6000,1,$2::public.walk_status) returning id`,
      [hours, walkStatus],
    )
  ).rows[0].id;
  const id = (
    await db.query<{ id: string }>(
      `insert into public.walk_registrations(walk_id,dog_id,status,payment_status,cancelled_at,decision_note,cancellation_free_until)
     values($1,$2,$3::public.registration_status,'none',now(),'Poprzednia decyzja',now()+interval '10 hours') returning id`,
      [walk, dog, status],
    )
  ).rows[0].id;
  await db.query(
    "insert into public.walk_private_details(walk_id,exact_location) values($1,'Prywatne miejsce')",
    [walk],
  );
  return { id, dog, walk };
}

async function reopen(id: string) {
  return asAdmin(() =>
    db.query(
      "select public.reopen_registration($1,'Prośba opiekuna o ponowny zapis')",
      [id],
    ),
  );
}
async function accept(id: string) {
  return asAdmin(() =>
    db.query(
      "select public.decide_registration($1,'accepted','Nowa akceptacja')",
      [id],
    ),
  );
}
async function purchase(dog: string) {
  return (
    await asAdmin(() =>
      db.query<{ id: string }>(
        "select public.purchase_package($1,'Pakiet testowy',1,6000,null,'') as id",
        [dog],
      ),
    )
  ).rows[0].id;
}
async function assign(id: string, packageId: string) {
  return asAdmin(() =>
    db.query("select public.use_package($1,$2,'Przypisanie')", [id, packageId]),
  );
}
async function cancel(id: string) {
  return asUser(owner, () =>
    db.query("select public.cancel_registration($1)", [id]),
  );
}

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated;
    create schema auth; create table auth.users(id uuid primary key,email text);
    create function auth.uid() returns uuid language sql stable as
      $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    grant usage on schema public,auth to anon,authenticated;
    grant execute on function auth.uid() to anon,authenticated;
    create schema storage;
    create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
    create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text);
    alter table storage.objects enable row level security;
    create function storage.foldername(name text) returns text[] language sql as $$select string_to_array(name,'/')$$;
    grant usage on schema storage to authenticated;
    grant select,insert,delete on storage.objects to authenticated;
  `);
  for (const migration of readdirSync("supabase/migrations")
    .filter((f) => f.endsWith(".sql"))
    .sort()) {
    await db.exec(readFileSync(`supabase/migrations/${migration}`, "utf8"));
  }
  await db.query("insert into auth.users(id) values($1),($2)", [admin, owner]);
  await db.query("update public.user_roles set role='admin' where user_id=$1", [
    admin,
  ]);
});
afterAll(async () => {
  await db?.close();
});

describe.sequential("reopening cancelled or withdrawn applications", () => {
  it("requires admin and a reason, restores the same record to pending once, and preserves previous decisions in audit", async () => {
    const f = await fixture("withdrawn");
    const original = (
      await db.query<{ cancelled_at: Date; cancellation_free_until: Date }>(
        "select cancelled_at,cancellation_free_until from public.walk_registrations where id=$1",
        [f.id],
      )
    ).rows[0];
    await expect(
      asUser(owner, () =>
        db.query("select public.reopen_registration($1,'Prośba opiekuna')", [
          f.id,
        ]),
      ),
    ).rejects.toThrow("Brak uprawnień");
    await expect(
      asAdmin(() =>
        db.query("select public.reopen_registration($1,'')", [f.id]),
      ),
    ).rejects.toThrow("Podaj powód");
    await reopen(f.id);
    await reopen(f.id);
    expect(
      (
        await db.query(
          "select id,status,cancelled_at,cancellation_free_until,decided_by,decision_note from public.walk_registrations where walk_id=$1",
          [f.walk],
        )
      ).rows,
    ).toEqual([
      {
        id: f.id,
        status: "pending",
        cancelled_at: null,
        cancellation_free_until: null,
        decided_by: admin,
        decision_note: "Prośba opiekuna o ponowny zapis",
      },
    ]);
    const audit = (
      await db.query<{
        details: {
          previous_status: string;
          previous_cancelled_at: string;
          previous_cancellation_free_until: string;
          previous_decision_note: string;
        };
      }>(
        "select details from public.audit_events where event='registration_reopened' and entity_id=$1",
        [f.id],
      )
    ).rows;
    expect(audit).toHaveLength(1);
    expect(audit[0].details).toMatchObject({
      previous_status: "withdrawn",
      previous_decision_note: "Poprzednia decyzja",
    });
    expect(new Date(audit[0].details.previous_cancelled_at)).toEqual(
      original.cancelled_at,
    );
    expect(new Date(audit[0].details.previous_cancellation_free_until)).toEqual(
      original.cancellation_free_until,
    );
    expect(
      (
        await asUser(owner, () =>
          db.query(
            "select exact_location from public.walk_private_details where walk_id=$1",
            [f.walk],
          ),
        )
      ).rows,
    ).toHaveLength(0);
  });

  it("preserves unpaid, partial and full receipts and recalculates the remaining debt only on acceptance", async () => {
    for (const amount of [0, 2000, 6000]) {
      const f = await fixture("accepted");
      let receipt: string | null = null;
      if (amount)
        receipt = (
          await asAdmin(() =>
            db.query<{ id: string }>(
              "select public.record_payment($1,null,$2,'cash','Wpłata',$3) as id",
              [f.id, amount, randomUUID()],
            ),
          )
        ).rows[0].id;
      await cancel(f.id);
      await reopen(f.id);
      const receipts = (
        await db.query(
          "select id,amount_cents,status from public.payments where registration_id=$1",
          [f.id],
        )
      ).rows;
      expect(receipts).toEqual(
        amount ? [{ id: receipt, amount_cents: amount, status: "paid" }] : [],
      );
      expect(
        (
          await db.query(
            "select status from public.walk_registrations where id=$1",
            [f.id],
          )
        ).rows,
      ).toEqual([{ status: "pending" }]);
      await accept(f.id);
      expect(
        (
          await db.query(
            "select status,payment_status from public.walk_registrations where id=$1",
            [f.id],
          )
        ).rows,
      ).toEqual([
        {
          status: "accepted",
          payment_status: amount === 6000 ? "paid" : "due",
        },
      ]);
      expect(
        (
          await db.query(
            "select id,amount_cents,status from public.payments where registration_id=$1",
            [f.id],
          )
        ).rows,
      ).toEqual(receipts);
    }
  });

  it("detaches a returned historical package and allows one fresh reservation even if the original package was cancelled", async () => {
    const f = await fixture("accepted");
    const oldPackage = await purchase(f.dog);
    await assign(f.id, oldPackage);
    await cancel(f.id);
    await asAdmin(() =>
      db.query(
        "select public.cancel_package($1,'Zakończenie nieużytego pakietu')",
        [oldPackage],
      ),
    );
    const oldLedger = (
      await db.query(
        "select id from public.package_transactions where package_id=$1 order by id",
        [oldPackage],
      )
    ).rows;
    await reopen(f.id);
    expect(
      (
        await db.query(
          "select status,package_id from public.walk_registrations where id=$1",
          [f.id],
        )
      ).rows,
    ).toEqual([{ status: "pending", package_id: null }]);
    expect(
      (
        await db.query(
          "select id from public.package_transactions where package_id=$1 order by id",
          [oldPackage],
        )
      ).rows,
    ).toEqual(oldLedger);
    await accept(f.id);
    const newPackage = await purchase(f.dog);
    await assign(f.id, newPackage);
    await assign(f.id, newPackage);
    expect(
      (
        await db.query(
          "select sum(available_delta)::int as available,sum(reserved_delta)::int as reserved,sum(used_delta)::int as used from public.package_transactions where package_id=$1",
          [newPackage],
        )
      ).rows,
    ).toEqual([{ available: 0, reserved: 1, used: 0 }]);
    expect(
      (
        await db.query(
          "select details->>'previous_package_id' as package from public.audit_events where event='registration_reopened' and entity_id=$1",
          [f.id],
        )
      ).rows,
    ).toEqual([{ package: oldPackage }]);
    expect(
      (
        await db.query(
          "select count(*)::int as count from public.walk_registrations where walk_id=$1 and dog_id=$2",
          [f.walk, f.dog],
        )
      ).rows,
    ).toEqual([{ count: 1 }]);
  });

  it("refuses to detach an unsettled reservation or consumed entry and leaves history unchanged", async () => {
    for (const [reserved, used] of [
      [1, 0],
      [0, 1],
    ]) {
      const f = await fixture("accepted");
      const packageId = await purchase(f.dog);
      await assign(f.id, packageId);
      await cancel(f.id);
      // Simulate an imported or incorrectly adjusted legacy ledger. The API
      // must require reconciliation rather than silently hiding this allocation.
      await db.query(
        `insert into public.package_transactions(package_id,registration_id,available_delta,reserved_delta,used_delta,reason,author_id)
         values($1,$2,-1,$3,$4,'Wpis historyczny',$5)`,
        [packageId, f.id, reserved, used, admin],
      );
      await expect(reopen(f.id)).rejects.toThrow("wymaga rozliczenia");
      expect(
        (
          await db.query(
            "select status,package_id from public.walk_registrations where id=$1",
            [f.id],
          )
        ).rows,
      ).toEqual([{ status: "cancelled_on_time", package_id: packageId }]);
      expect(
        (
          await db.query(
            "select id from public.audit_events where event='registration_reopened' and entity_id=$1",
            [f.id],
          )
        ).rows,
      ).toHaveLength(0);
    }
  });

  it("blocks past or inactive walks and late cancellations", async () => {
    for (const [hours, status] of [
      [-1, "open"],
      [100, "closed"],
      [100, "cancelled"],
      [100, "completed"],
      [100, "draft"],
    ] as const) {
      const f = await fixture("cancelled_on_time", hours, status);
      await expect(reopen(f.id)).rejects.toThrow(
        "nieaktywny lub rozpoczęty spacer",
      );
    }
    for (const status of [
      "cancelled_late",
      "accepted",
      "waitlisted",
      "rejected",
    ]) {
      const f = await fixture(status);
      await expect(reopen(f.id)).rejects.toThrow(
        "tylko wycofane lub odwołane w terminie",
      );
    }
  });

  it("does not bypass capacity or dog qualification when the restored application is later accepted", async () => {
    const f = await fixture("cancelled_on_time", 100, "full");
    const secondDog = (
      await db.query<{ id: string }>(
        "insert into public.dogs(guardian_id,name) values($1,'Drugi pies') returning id",
        [owner],
      )
    ).rows[0].id;
    await db.query("update public.dogs set status='approved' where id=$1", [
      secondDog,
    ]);
    await db.query(
      "insert into public.walk_registrations(walk_id,dog_id,status) values($1,$2,'accepted')",
      [f.walk, secondDog],
    );
    await reopen(f.id);
    await expect(accept(f.id)).rejects.toThrow("Brak wolnych miejsc");
    expect(
      (
        await db.query(
          "select status from public.walk_registrations where id=$1",
          [f.id],
        )
      ).rows,
    ).toEqual([{ status: "pending" }]);
    const needsReview = await fixture("withdrawn");
    await db.query("update public.dogs set status='needs_review' where id=$1", [
      needsReview.dog,
    ]);
    await reopen(needsReview.id);
    await expect(accept(needsReview.id)).rejects.toThrow(
      "Najpierw zakwalifikuj psa",
    );
  });
});
