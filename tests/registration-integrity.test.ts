import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

let db: PGlite;
const admin = "51000000-0000-4000-8000-000000000001";
const owner = "51000000-0000-4000-8000-000000000002";

async function asUser<T>(id: string, run: () => Promise<T>) {
  await db.exec("begin; set local role authenticated");
  await db.query("select set_config('request.jwt.claim.sub',$1,true)", [id]);
  try {
    const value = await run();
    await db.exec("commit");
    return value;
  } catch (error) {
    await db.exec("rollback");
    throw error;
  }
}

async function makeWalk(started = false, status = "open") {
  const { rows } = await db.query<{ id: string }>(
    `insert into public.walks(starts_at,public_location,type,price_cents,capacity,status)
     values(now()+make_interval(hours=>$1),'Park testowy','Spacer',6000,10,$2::public.walk_status)
     returning id`,
    [started ? -2 : 2, status],
  );
  await db.query(
    "insert into public.walk_private_details(walk_id,exact_location) values($1,'Prywatna zbiórka')",
    [rows[0].id],
  );
  return rows[0].id;
}

async function makeRegistration(walkId: string, payment = "due") {
  const { rows: dogs } = await db.query<{ id: string }>(
    "insert into public.dogs(guardian_id,name) values($1,'Pies testowy') returning id",
    [owner],
  );
  const dogId = dogs[0].id;
  await db.query("update public.dogs set status='approved' where id=$1", [
    dogId,
  ]);
  const { rows } = await db.query<{ id: string }>(
    `insert into public.walk_registrations(walk_id,dog_id,status,payment_status)
     values($1,$2,'accepted',$3::public.payment_status) returning id`,
    [walkId, dogId, payment],
  );
  return { id: rows[0].id, dogId };
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
    create function storage.foldername(name text) returns text[] language sql as
      $$select string_to_array(name,'/')$$;
    grant usage on schema storage to authenticated;
    grant select,insert,delete on storage.objects to authenticated;
  `);
  for (const migration of readdirSync("supabase/migrations")
    .filter((file) => file.endsWith(".sql"))
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

describe.sequential("registration history and organizer cancellation", () => {
  it("cannot erase a started walk's attendance or receivable through a booking decision", async () => {
    const walkId = await makeWalk(true);
    const registration = await makeRegistration(walkId);
    await asUser(admin, () =>
      db.query("select public.mark_attendance($1,'present')", [
        registration.id,
      ]),
    );
    for (const status of [
      "rejected",
      "waitlisted",
      "cancelled_on_time",
      "cancelled_late",
    ]) {
      await expect(
        asUser(admin, () =>
          db.query(
            "select public.decide_registration($1,$2::public.registration_status,'')",
            [registration.id, status],
          ),
        ),
      ).rejects.toThrow("po rozpoczęciu lub odwołaniu spaceru");
    }
    const { rows } = await db.query(
      "select status,payment_status,attendance from public.walk_registrations where id=$1",
      [registration.id],
    );
    expect(rows).toEqual([
      { status: "accepted", payment_status: "due", attendance: "present" },
    ]);
    expect(
      (
        await db.query(
          "select id from public.audit_events where entity_id=$1 and event='registration_decided'",
          [registration.id],
        )
      ).rows,
    ).toHaveLength(0);
    // A retried decision for the same status is harmless even after the start.
    await asUser(admin, () =>
      db.query("select public.decide_registration($1,'accepted','')", [
        registration.id,
      ]),
    );
  });

  it("also rejects decisions on explicitly completed and cancelled future walks", async () => {
    for (const status of ["completed", "cancelled"]) {
      const walkId = await makeWalk(false, status);
      const registration = await makeRegistration(walkId);
      await expect(
        asUser(admin, () =>
          db.query("select public.decide_registration($1,'rejected','')", [
            registration.id,
          ]),
        ),
      ).rejects.toThrow("po rozpoczęciu lub odwołaniu spaceru");
    }
  });

  it("keeps attendance correctable on completed walks without changing the booking or charge", async () => {
    const walkId = await makeWalk(true, "completed");
    const registration = await makeRegistration(walkId);
    for (const attendance of ["absent", "present", "present"]) {
      await asUser(admin, () =>
        db.query(
          "select public.mark_attendance($1,$2::public.attendance_status)",
          [registration.id, attendance],
        ),
      );
    }
    expect(
      (
        await db.query(
          "select status,payment_status,attendance from public.walk_registrations where id=$1",
          [registration.id],
        )
      ).rows,
    ).toEqual([
      { status: "accepted", payment_status: "due", attendance: "present" },
    ]);
    expect(
      (
        await db.query(
          "select details->>'from' as previous,details->>'to' as next from public.audit_events where entity_id=$1 and event='attendance_changed' order by created_at",
          [registration.id],
        )
      ).rows,
    ).toEqual([
      { previous: "pending", next: "absent" },
      { previous: "absent", next: "present" },
    ]);
  });

  it("does not allow owner attendance edits, pre-start attendance, or attendance on cancelled walks", async () => {
    const future = await makeWalk();
    const registration = await makeRegistration(future);
    await expect(
      asUser(owner, () =>
        db.query("select public.mark_attendance($1,'present')", [
          registration.id,
        ]),
      ),
    ).rejects.toThrow("Brak uprawnień");
    await expect(
      asUser(admin, () =>
        db.query("select public.mark_attendance($1,'present')", [
          registration.id,
        ]),
      ),
    ).rejects.toThrow("jeszcze się nie rozpoczął");
    const cancelled = await makeWalk(true, "cancelled");
    const cancelledRegistration = await makeRegistration(cancelled);
    await expect(
      asUser(admin, () =>
        db.query("select public.mark_attendance($1,'present')", [
          cancelledRegistration.id,
        ]),
      ),
    ).rejects.toThrow("Obecność dotyczy zaakceptowanych psów");
  });

  it("removes a late-withdrawal fee if the organizer subsequently cancels, preserving the withdrawal time", async () => {
    const walkId = await makeWalk();
    const registration = await makeRegistration(walkId);
    await asUser(owner, () =>
      db.query("select public.cancel_registration($1)", [registration.id]),
    );
    const before = (
      await db.query<{
        status: string;
        payment_status: string;
        cancelled_at: Date;
      }>(
        "select status,payment_status,cancelled_at from public.walk_registrations where id=$1",
        [registration.id],
      )
    ).rows[0];
    expect(before).toMatchObject({
      status: "cancelled_late",
      payment_status: "due",
    });
    await asUser(admin, () =>
      db.query("select public.cancel_walk($1,'Burza w parku')", [walkId]),
    );
    expect(
      (
        await db.query(
          "select status,payment_status,cancelled_at,decision_note from public.walk_registrations where id=$1",
          [registration.id],
        )
      ).rows,
    ).toEqual([
      {
        status: "cancelled_on_time",
        payment_status: "none",
        cancelled_at: before.cancelled_at,
        decision_note: "Burza w parku",
      },
    ]);
  });

  it("preserves paid/refunded history and revokes the exact location on organizer cancellation", async () => {
    const walkId = await makeWalk();
    const paid = await makeRegistration(walkId, "paid");
    const refunded = await makeRegistration(walkId, "refunded");
    expect(
      (
        await asUser(owner, () =>
          db.query(
            "select exact_location from public.walk_private_details where walk_id=$1",
            [walkId],
          ),
        )
      ).rows,
    ).toHaveLength(1);
    await expect(
      asUser(owner, () =>
        db.query("select public.cancel_walk($1,'Burza w parku')", [walkId]),
      ),
    ).rejects.toThrow("Brak uprawnień");
    await asUser(admin, () =>
      db.query("select public.cancel_walk($1,'Burza w parku')", [walkId]),
    );
    const { rows } = await db.query<{
      id: string;
      status: string;
      payment_status: string;
    }>(
      "select id,status,payment_status from public.walk_registrations where walk_id=$1",
      [walkId],
    );
    expect(rows.find((r) => r.id === paid.id)).toMatchObject({
      status: "cancelled_on_time",
      payment_status: "paid",
    });
    expect(rows.find((r) => r.id === refunded.id)).toMatchObject({
      status: "cancelled_on_time",
      payment_status: "refunded",
    });
    expect(
      (
        await asUser(owner, () =>
          db.query(
            "select exact_location from public.walk_private_details where walk_id=$1",
            [walkId],
          ),
        )
      ).rows,
    ).toHaveLength(0);
  });

  it("returns only outstanding package reservations and does not duplicate a prior return or a retry", async () => {
    const walkId = await makeWalk();
    const registrations = [
      await makeRegistration(walkId),
      await makeRegistration(walkId),
    ];
    const packageIds: string[] = [];
    for (const [index, registration] of registrations.entries()) {
      const { rows } = await db.query<{ id: string }>(
        "insert into public.packages(dog_id,name,price_cents) values($1,'Pakiet testowy',6000) returning id",
        [registration.dogId],
      );
      const packageId = rows[0].id;
      packageIds.push(packageId);
      await db.query(
        `insert into public.package_transactions(package_id,registration_id,available_delta,reserved_delta,reason,author_id)
         values($1,null,1,0,'Zakup',$3),($1,$2,-1,1,'Rezerwacja',$3)`,
        [packageId, registration.id, admin],
      );
      if (index === 1) {
        await db.query(
          `insert into public.package_transactions(package_id,registration_id,available_delta,reserved_delta,reason,author_id)
           values($1,$2,1,-1,'Wcześniejszy zwrot',$3)`,
          [packageId, registration.id, admin],
        );
      }
    }
    await asUser(owner, () =>
      db.query("select public.cancel_registration($1)", [registrations[0].id]),
    );
    for (let retry = 0; retry < 2; retry++) {
      await asUser(admin, () =>
        db.query("select public.cancel_walk($1,'Burza w parku')", [walkId]),
      );
    }
    for (const packageId of packageIds) {
      expect(
        (
          await db.query(
            "select sum(available_delta)::int as available,sum(reserved_delta)::int as reserved from public.package_transactions where package_id=$1",
            [packageId],
          )
        ).rows,
      ).toEqual([{ available: 1, reserved: 0 }]);
    }
    expect(
      (
        await db.query(
          "select id from public.package_transactions where package_id=any($1::uuid[]) and reason='Odwołanie spaceru przez organizatora'",
          [packageIds],
        )
      ).rows,
    ).toHaveLength(1);
    expect(
      (
        await db.query(
          "select details->>'registrations_closed' as closed from public.audit_events where entity_id=$1 and event='walk_cancelled'",
          [walkId],
        )
      ).rows,
    ).toEqual([{ closed: "2" }]);
  });

  it("rolls back registration changes if a package return fails", async () => {
    const walkId = await makeWalk();
    const registration = await makeRegistration(walkId);
    const { rows } = await db.query<{ id: string }>(
      "insert into public.packages(dog_id,name,price_cents) values($1,'Pakiet testowy',6000) returning id",
      [registration.dogId],
    );
    await db.query(
      `insert into public.package_transactions(package_id,registration_id,reserved_delta,reason,author_id)
       values($1,$2,1,'Rezerwacja',$3)`,
      [rows[0].id, registration.id, admin],
    );
    await db.exec(`
      create function public.test_reject_package_return() returns trigger language plpgsql as $$
      begin raise exception 'Test: ledger unavailable'; end $$;
      create trigger test_reject_package_return before insert on public.package_transactions
        for each row execute function public.test_reject_package_return();
    `);
    try {
      await expect(
        asUser(admin, () =>
          db.query("select public.cancel_walk($1,'Burza w parku')", [walkId]),
        ),
      ).rejects.toThrow("ledger unavailable");
    } finally {
      await db.exec(
        "drop trigger test_reject_package_return on public.package_transactions; drop function public.test_reject_package_return()",
      );
    }
    expect(
      (await db.query("select status from public.walks where id=$1", [walkId]))
        .rows,
    ).toEqual([{ status: "open" }]);
    expect(
      (
        await db.query(
          "select status,payment_status from public.walk_registrations where id=$1",
          [registration.id],
        )
      ).rows,
    ).toEqual([{ status: "accepted", payment_status: "due" }]);
    expect(
      (
        await db.query(
          "select id from public.audit_events where event='walk_cancelled' and entity_id=$1",
          [walkId],
        )
      ).rows,
    ).toHaveLength(0);
  });
});
