import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

let db: PGlite;
const admin = "61000000-0000-4000-8000-000000000001";
const owner = "61000000-0000-4000-8000-000000000002";
const stranger = "61000000-0000-4000-8000-000000000003";

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
const asAdmin = <T>(run: () => Promise<T>) => asUser(admin, run);

async function makeDog(guardian = owner) {
  const { rows } = await db.query<{ id: string }>(
    "insert into public.dogs(guardian_id,name) values($1,'Pies testowy') returning id",
    [guardian],
  );
  await db.query("update public.dogs set status='approved' where id=$1", [
    rows[0].id,
  ]);
  return rows[0].id;
}

async function makeBooking(dogId?: string, hours = 100, status = "accepted") {
  const dog = dogId || (await makeDog());
  const { rows: walks } = await db.query<{ id: string }>(
    `insert into public.walks(starts_at,public_location,type,price_cents,capacity)
     values(now()+make_interval(hours=>$1),'Park testowy','Spacer',6000,10) returning id`,
    [hours],
  );
  const walk = walks[0].id;
  const { rows } = await db.query<{ id: string }>(
    `insert into public.walk_registrations(walk_id,dog_id,status,payment_status)
     values($1,$2,$3::public.registration_status,'due') returning id`,
    [walk, dog, status],
  );
  return { id: rows[0].id, dog, walk };
}

async function purchase(dog: string, entries = 2, price = 10000) {
  const { rows } = await asAdmin(() =>
    db.query<{ id: string }>(
      "select public.purchase_package($1,'Pakiet testowy',$2,$3,null,'Test księgowania') as id",
      [dog, entries, price],
    ),
  );
  return rows[0].id;
}

async function payment(
  registration: string | null,
  packageId: string | null,
  amount: number,
  request = randomUUID(),
  method = "transfer",
  note = "Wpłata testowa",
) {
  const { rows } = await asAdmin(() =>
    db.query<{ id: string }>(
      "select public.record_payment($1,$2,$3,$4,$5,$6) as id",
      [registration, packageId, amount, method, note, request],
    ),
  );
  return rows[0].id;
}

async function assign(registration: string, packageId: string) {
  return asAdmin(() =>
    db.query("select public.use_package($1,$2,'Rozliczenie pakietem')", [
      registration,
      packageId,
    ]),
  );
}

async function balance(packageId: string) {
  const { rows } = await db.query<{
    available: number;
    reserved: number;
    used: number;
  }>(
    `select coalesce(sum(available_delta),0)::int as available,
     coalesce(sum(reserved_delta),0)::int as reserved,coalesce(sum(used_delta),0)::int as used
     from public.package_transactions where package_id=$1`,
    [packageId],
  );
  return rows[0];
}

async function bookingState(id: string) {
  const { rows } = await db.query<{
    status: string;
    attendance: string;
    payment_status: string;
    package_id: string | null;
  }>(
    "select status,attendance,payment_status,package_id from public.walk_registrations where id=$1",
    [id],
  );
  return rows[0];
}

async function attend(id: string, status: string) {
  return asAdmin(() =>
    db.query("select public.mark_attendance($1,$2::public.attendance_status)", [
      id,
      status,
    ]),
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
    .filter((file) => file.endsWith(".sql"))
    .sort()) {
    await db.exec(readFileSync(`supabase/migrations/${migration}`, "utf8"));
  }
  await db.query("insert into auth.users(id) values($1),($2),($3)", [
    admin,
    owner,
    stranger,
  ]);
  await db.query("update public.user_roles set role='admin' where user_id=$1", [
    admin,
  ]);
});
afterAll(async () => {
  await db?.close();
});

describe.sequential("audited payments and package lifecycle", () => {
  it("bulk cancellation returns only this walk's allocations when several packages are shared with another walk", async () => {
    const firstDog = await makeDog();
    const secondDog = await makeDog();
    const firstPackage = await purchase(firstDog, 2);
    const secondPackage = await purchase(secondDog, 2);
    const firstWalk = await makeBooking(firstDog);
    const secondWalk = await makeBooking(secondDog);
    const extraFirst = (
      await db.query<{ id: string }>(
        "insert into public.walk_registrations(walk_id,dog_id,status,payment_status) values($1,$2,'accepted','due') returning id",
        [firstWalk.walk, secondDog],
      )
    ).rows[0].id;
    const extraSecond = (
      await db.query<{ id: string }>(
        "insert into public.walk_registrations(walk_id,dog_id,status,payment_status) values($1,$2,'accepted','due') returning id",
        [secondWalk.walk, firstDog],
      )
    ).rows[0].id;
    await assign(firstWalk.id, firstPackage);
    await assign(extraFirst, secondPackage);
    await assign(secondWalk.id, secondPackage);
    await assign(extraSecond, firstPackage);
    await asAdmin(() =>
      db.query("select public.cancel_walk($1,'Burza')", [firstWalk.walk]),
    );
    for (const packageId of [firstPackage, secondPackage]) {
      expect(await balance(packageId)).toEqual({
        available: 1,
        reserved: 1,
        used: 0,
      });
    }
    expect((await bookingState(secondWalk.id)).status).toBe("accepted");
    expect((await bookingState(extraSecond)).status).toBe("accepted");
    await asAdmin(() =>
      db.query("select public.cancel_walk($1,'Burza')", [secondWalk.walk]),
    );
    for (const packageId of [firstPackage, secondPackage]) {
      expect(await balance(packageId)).toEqual({
        available: 2,
        reserved: 0,
        used: 0,
      });
    }
  });

  it("releases a mistaken package assignment once, restores cash debt and preserves ledger history", async () => {
    const registration = await makeBooking();
    const packageId = await purchase(registration.dog, 1);
    await assign(registration.id, packageId);
    await expect(
      asUser(owner, () =>
        db.query("select public.release_package($1,'Pomyłka')", [
          registration.id,
        ]),
      ),
    ).rejects.toThrow("Brak uprawnień");
    await expect(
      asAdmin(() =>
        db.query("select public.release_package($1,'')", [registration.id]),
      ),
    ).rejects.toThrow("Podaj powód");
    expect(await balance(packageId)).toEqual({
      available: 0,
      reserved: 1,
      used: 0,
    });
    for (let retry = 0; retry < 2; retry++) {
      await asAdmin(() =>
        db.query("select public.release_package($1,'Wybrano zły pakiet')", [
          registration.id,
        ]),
      );
    }
    expect(await balance(packageId)).toEqual({
      available: 1,
      reserved: 0,
      used: 0,
    });
    expect(await bookingState(registration.id)).toMatchObject({
      package_id: null,
      payment_status: "due",
      status: "accepted",
    });
    expect(
      (
        await db.query(
          "select id from public.package_transactions where package_id=$1 and registration_id=$2",
          [packageId, registration.id],
        )
      ).rows,
    ).toHaveLength(2);
    expect(
      (
        await db.query(
          "select details->>'reason' as reason from public.audit_events where event='package_released' and entity_id=$1",
          [registration.id],
        )
      ).rows,
    ).toEqual([{ reason: "Wybrano zły pakiet" }]);
    const correctPackage = await purchase(registration.dog, 2);
    await assign(registration.id, correctPackage);
    expect(await balance(correctPackage)).toEqual({
      available: 1,
      reserved: 1,
      used: 0,
    });
    expect(await balance(packageId)).toEqual({
      available: 1,
      reserved: 0,
      used: 0,
    });
    await asAdmin(() =>
      db.query("select public.release_package($1,'Rozliczenie pieniężne')", [
        registration.id,
      ]),
    );
    await payment(registration.id, null, 6000);
    expect((await bookingState(registration.id)).payment_status).toBe("paid");
  });

  it("cannot detach an active ledger allocation directly or release an already started booking", async () => {
    const registration = await makeBooking();
    const packageId = await purchase(registration.dog, 1);
    await assign(registration.id, packageId);
    // A privileged SQL update still cannot leave a live allocation orphaned.
    await expect(
      db.query(
        "update public.walk_registrations set package_id=null where id=$1",
        [registration.id],
      ),
    ).rejects.toThrow("bez rozliczenia poprzedniego");
    await db.exec("begin");
    await db.query("select set_config('request.jwt.claim.sub',$1,true)", [
      admin,
    ]);
    try {
      await expect(
        db.query(
          "update public.walk_registrations set package_id=null where id=$1",
          [registration.id],
        ),
      ).rejects.toThrow("Przed odpięciem pakietu");
    } finally {
      await db.exec("rollback");
    }
    const secondPackage = await purchase(registration.dog);
    await expect(
      db.query(
        "update public.walk_registrations set package_id=$2 where id=$1",
        [registration.id, secondPackage],
      ),
    ).rejects.toThrow("bez rozliczenia poprzedniego");
    await db.query(
      "update public.walks set starts_at=now()-interval '2 hours' where id=$1",
      [registration.walk],
    );
    await expect(
      asAdmin(() =>
        db.query("select public.release_package($1,'Pomyłka')", [
          registration.id,
        ]),
      ),
    ).rejects.toThrow("przed rozpoczęciem");
    await attend(registration.id, "present");
    await expect(
      asAdmin(() =>
        db.query("select public.release_package($1,'Pomyłka')", [
          registration.id,
        ]),
      ),
    ).rejects.toThrow("przed rozpoczęciem");
    expect(await balance(packageId)).toEqual({
      available: 0,
      reserved: 0,
      used: 1,
    });
    expect((await bookingState(registration.id)).package_id).toBe(packageId);
  });

  it("cancels an unused package without deleting entries or recording an automatic refund", async () => {
    const dog = await makeDog();
    const packageId = await purchase(dog, 3, 10000);
    const receipt = await payment(null, packageId, 10000);
    await expect(
      asUser(owner, () =>
        db.query("select public.cancel_package($1,'Błędny pakiet')", [
          packageId,
        ]),
      ),
    ).rejects.toThrow("Brak uprawnień");
    await expect(
      asAdmin(() =>
        db.query("select public.cancel_package($1,'')", [packageId]),
      ),
    ).rejects.toThrow("Podaj powód");
    for (let retry = 0; retry < 2; retry++)
      await asAdmin(() =>
        db.query("select public.cancel_package($1,'Błędny pakiet')", [
          packageId,
        ]),
      );
    expect(await balance(packageId)).toEqual({
      available: 0,
      reserved: 0,
      used: 0,
    });
    expect(
      (
        await db.query("select status from public.packages where id=$1", [
          packageId,
        ])
      ).rows,
    ).toEqual([{ status: "cancelled" }]);
    expect(
      (
        await db.query(
          "select available_delta,author_id from public.package_transactions where package_id=$1 order by created_at",
          [packageId],
        )
      ).rows,
    ).toEqual([
      { available_delta: 3, author_id: admin },
      { available_delta: -3, author_id: admin },
    ]);
    expect(
      (
        await db.query("select status from public.payments where id=$1", [
          receipt,
        ])
      ).rows,
    ).toEqual([{ status: "paid" }]);
    expect(
      (
        await db.query(
          "select id from public.audit_events where event='package_cancelled' and entity_id=$1",
          [packageId],
        )
      ).rows,
    ).toHaveLength(1);
    const registration = await makeBooking(dog);
    await expect(assign(registration.id, packageId)).rejects.toThrow(
      "nie jest aktywny",
    );
    await expect(payment(null, packageId, 1000)).rejects.toThrow(
      "Pakiet został anulowany",
    );
    await asAdmin(() =>
      db.query("select public.void_payment($1,'Zwrot za błędny pakiet')", [
        receipt,
      ]),
    );
    expect(
      (
        await db.query("select status from public.payments where id=$1", [
          receipt,
        ])
      ).rows,
    ).toEqual([{ status: "refunded" }]);
  });

  it("rejects package cancellation while entries are reserved or used, then allows cancellation after release", async () => {
    const registration = await makeBooking();
    const packageId = await purchase(registration.dog, 2);
    await assign(registration.id, packageId);
    await expect(
      asAdmin(() =>
        db.query("select public.cancel_package($1,'Pomyłka')", [packageId]),
      ),
    ).rejects.toThrow("zarezerwowane lub wykorzystane");
    expect(
      (
        await db.query("select status from public.packages where id=$1", [
          packageId,
        ])
      ).rows,
    ).toEqual([{ status: "active" }]);
    await asAdmin(() =>
      db.query("select public.release_package($1,'Błędny pakiet')", [
        registration.id,
      ]),
    );
    await asAdmin(() =>
      db.query("select public.cancel_package($1,'Błędny pakiet')", [packageId]),
    );
    expect(await balance(packageId)).toEqual({
      available: 0,
      reserved: 0,
      used: 0,
    });
    const nextPackage = await purchase(registration.dog, 2);
    await assign(registration.id, nextPackage);
    await db.query(
      "update public.walks set starts_at=now()-interval '2 hours' where id=$1",
      [registration.walk],
    );
    await attend(registration.id, "present");
    await expect(
      asAdmin(() =>
        db.query("select public.cancel_package($1,'Pomyłka')", [nextPackage]),
      ),
    ).rejects.toThrow("zarezerwowane lub wykorzystane");
    expect(await balance(nextPackage)).toEqual({
      available: 1,
      reserved: 0,
      used: 1,
    });
  });

  it("grants entries as an audited admin operation without fabricating a cash receipt", async () => {
    const dog = await makeDog();
    await expect(
      asUser(owner, () =>
        db.query(
          "select public.purchase_package($1,'Pakiet',3,10000,null,'')",
          [dog],
        ),
      ),
    ).rejects.toThrow("Brak uprawnień");
    for (const [name, entries, price, expiry] of [
      ["", 2, 10000, null],
      ["Pakiet", 0, 10000, null],
      ["Pakiet", 101, 10000, null],
      ["Pakiet", 2, 0, null],
      ["Pakiet", 2, 1000001, null],
      ["Pakiet", 2, 10000, "2000-01-01T00:00:00Z"],
    ]) {
      await expect(
        asAdmin(() =>
          db.query("select public.purchase_package($1,$2,$3,$4,$5,'')", [
            dog,
            name,
            entries,
            price,
            expiry,
          ]),
        ),
      ).rejects.toThrow("Sprawdź nazwę");
    }
    const packageId = await purchase(dog, 3);
    expect(await balance(packageId)).toEqual({
      available: 3,
      reserved: 0,
      used: 0,
    });
    expect(
      (
        await db.query("select id from public.payments where package_id=$1", [
          packageId,
        ])
      ).rows,
    ).toHaveLength(0);
    expect(
      (
        await db.query(
          "select actor_id from public.audit_events where event='package_purchased' and entity_id=$1",
          [packageId],
        )
      ).rows,
    ).toEqual([{ actor_id: admin }]);
  });

  it("supports partial receipts, exact final settlement and rejects overpayment", async () => {
    const registration = await makeBooking();
    await payment(registration.id, null, 2000);
    expect((await bookingState(registration.id)).payment_status).toBe("due");
    await expect(payment(registration.id, null, 4001)).rejects.toThrow(
      "przekracza",
    );
    await payment(registration.id, null, 4000);
    expect((await bookingState(registration.id)).payment_status).toBe("paid");
    await expect(payment(registration.id, null, 1)).rejects.toThrow(
      "przekracza",
    );
    expect(
      (
        await db.query(
          "select guardian_id,dog_id,amount_cents,author_id from public.payments where registration_id=$1 order by amount_cents",
          [registration.id],
        )
      ).rows,
    ).toEqual([
      {
        guardian_id: owner,
        dog_id: registration.dog,
        amount_cents: 2000,
        author_id: admin,
      },
      {
        guardian_id: owner,
        dog_id: registration.dog,
        amount_cents: 4000,
        author_id: admin,
      },
    ]);
  });

  it("deduplicates matching request IDs and rejects changed amount, method, note or target", async () => {
    const registration = await makeBooking();
    const key = randomUUID();
    const id = await payment(registration.id, null, 1000, key);
    expect(await payment(registration.id, null, 1000, key)).toBe(id);
    for (const [amount, method, note] of [
      [1001, "transfer", "Wpłata testowa"],
      [1000, "cash", "Wpłata testowa"],
      [1000, "transfer", "Inna notatka"],
    ] as const) {
      await expect(
        payment(registration.id, null, amount, key, method, note),
      ).rejects.toThrow("identyfikator wpłaty");
    }
    const other = await makeBooking();
    await expect(payment(other.id, null, 1000, key)).rejects.toThrow(
      "identyfikator wpłaty",
    );
    expect(
      (
        await db.query("select id from public.payments where request_id=$1", [
          key,
        ])
      ).rows,
    ).toHaveLength(1);
    expect(
      (
        await db.query(
          "select id from public.audit_events where event='payment_recorded' and entity_id=$1",
          [id],
        )
      ).rows,
    ).toHaveLength(1);
  });

  it("validates payment authority, target, method and amounts", async () => {
    const registration = await makeBooking();
    const packageId = await purchase(registration.dog);
    await expect(
      asUser(owner, () =>
        db.query("select public.record_payment($1,null,100,'cash','',$2)", [
          registration.id,
          randomUUID(),
        ]),
      ),
    ).rejects.toThrow("Brak uprawnień");
    for (const [reg, pkg, amount, method, key] of [
      [null, null, 100, "cash", randomUUID()],
      [registration.id, packageId, 100, "cash", randomUUID()],
      [registration.id, null, 0, "cash", randomUUID()],
      [registration.id, null, -1, "cash", randomUUID()],
      [registration.id, null, 100, "gift", randomUUID()],
      [registration.id, null, 100, "cash", null],
    ]) {
      await expect(
        asAdmin(() =>
          db.query("select public.record_payment($1,$2,$3,$4,'',$5)", [
            reg,
            pkg,
            amount,
            method,
            key,
          ]),
        ),
      ).rejects.toThrow("Wybierz jedno rozliczenie");
    }
  });

  it("allows late-cancellation debt but blocks receipts for ineligible registrations", async () => {
    for (const status of [
      "pending",
      "waitlisted",
      "rejected",
      "withdrawn",
      "cancelled_on_time",
    ]) {
      const registration = await makeBooking(undefined, 100, status);
      await expect(payment(registration.id, null, 100)).rejects.toThrow(
        "nie wymaga wpłaty",
      );
    }
    const late = await makeBooking(undefined, 1);
    await asUser(owner, () =>
      db.query("select public.cancel_registration($1)", [late.id]),
    );
    await payment(late.id, null, 6000);
    expect((await bookingState(late.id)).payment_status).toBe("paid");
    await asAdmin(() =>
      db.query("select public.cancel_walk($1,'Burza')", [late.walk]),
    );
    await expect(payment(late.id, null, 100)).rejects.toThrow(
      "nie wymaga wpłaty",
    );
  });

  it("settles packages separately using their price and inferred owner", async () => {
    const dog = await makeDog();
    const packageId = await purchase(dog, 2, 10000);
    await payment(null, packageId, 3000);
    await expect(payment(null, packageId, 7001)).rejects.toThrow("przekracza");
    await payment(null, packageId, 7000);
    expect(
      (
        await db.query(
          "select sum(amount_cents)::int as paid from public.payments where package_id=$1 and status='paid'",
          [packageId],
        )
      ).rows,
    ).toEqual([{ paid: 10000 }]);
    expect(await balance(packageId)).toEqual({
      available: 2,
      reserved: 0,
      used: 0,
    });
  });

  it("corrects a receipt without deleting history and reopens only the unpaid balance", async () => {
    const registration = await makeBooking();
    const first = await payment(registration.id, null, 2000);
    await payment(registration.id, null, 4000);
    const original = (
      await db.query<{ amount_cents: number; paid_at: Date }>(
        "select amount_cents,paid_at from public.payments where id=$1",
        [first],
      )
    ).rows[0];
    await expect(
      asUser(owner, () =>
        db.query("select public.void_payment($1,'Błędna wpłata')", [first]),
      ),
    ).rejects.toThrow("Brak uprawnień");
    await expect(
      asAdmin(() => db.query("select public.void_payment($1,'')", [first])),
    ).rejects.toThrow("Podaj powód");
    for (let retry = 0; retry < 2; retry++)
      await asAdmin(() =>
        db.query("select public.void_payment($1,'Błędna kwota')", [first]),
      );
    expect((await bookingState(registration.id)).payment_status).toBe("due");
    expect(
      (
        await db.query(
          "select amount_cents,paid_at,status,refund_note,refunded_by from public.payments where id=$1",
          [first],
        )
      ).rows,
    ).toEqual([
      {
        ...original,
        status: "refunded",
        refund_note: "Błędna kwota",
        refunded_by: admin,
      },
    ]);
    expect(
      (
        await db.query(
          "select id from public.audit_events where event='payment_refunded' and entity_id=$1",
          [first],
        )
      ).rows,
    ).toHaveLength(1);
    await payment(registration.id, null, 2000);
    expect((await bookingState(registration.id)).payment_status).toBe("paid");
  });

  it("reserves the correct dog's package once and prevents duplicate cash or partial-cash settlement", async () => {
    const registration = await makeBooking();
    const wrong = await purchase(await makeDog());
    await expect(assign(registration.id, wrong)).rejects.toThrow("do tego psa");
    const packageId = await purchase(registration.dog);
    await assign(registration.id, packageId);
    await assign(registration.id, packageId);
    expect(await balance(packageId)).toEqual({
      available: 1,
      reserved: 1,
      used: 0,
    });
    expect(await bookingState(registration.id)).toMatchObject({
      package_id: packageId,
      payment_status: "none",
    });
    await expect(payment(registration.id, null, 1000)).rejects.toThrow(
      "rozliczane pakietem",
    );
    const partial = await makeBooking();
    const otherPackage = await purchase(partial.dog);
    const cash = await payment(partial.id, null, 1000);
    await expect(assign(partial.id, otherPackage)).rejects.toThrow(
      "ma już wpłatę",
    );
    expect(await balance(otherPackage)).toEqual({
      available: 2,
      reserved: 0,
      used: 0,
    });
    await asAdmin(() =>
      db.query(
        "select public.void_payment($1,'Wpłata oddana, rozliczenie pakietem')",
        [cash],
      ),
    );
    await assign(partial.id, otherPackage);
    expect(await balance(otherPackage)).toEqual({
      available: 1,
      reserved: 1,
      used: 0,
    });
  });

  it("rejects inactive/expired/exhausted package allocation and direct client manipulation", async () => {
    const registration = await makeBooking();
    const packageId = await purchase(registration.dog, 1);
    await expect(
      asUser(owner, () =>
        db.query("select public.use_package($1,$2,'')", [
          registration.id,
          packageId,
        ]),
      ),
    ).rejects.toThrow("Brak uprawnień");
    for (const sql of [
      "update public.walk_registrations set package_id=$2 where id=$1",
      "update public.walk_registrations set attendance='present' where id=$1 and $2::uuid is not null",
    ])
      await expect(
        asUser(owner, () => db.query(sql, [registration.id, packageId])),
      ).rejects.toThrow("permission denied");
    await db.query(
      "update public.packages set expires_at=now()-interval '1 day' where id=$1",
      [packageId],
    );
    await expect(assign(registration.id, packageId)).rejects.toThrow(
      "utracił ważność",
    );
    await db.query(
      "update public.packages set expires_at=null,status='cancelled' where id=$1",
      [packageId],
    );
    await expect(assign(registration.id, packageId)).rejects.toThrow(
      "nie jest aktywny",
    );
    await db.query("update public.packages set status='active' where id=$1", [
      packageId,
    ]);
    await assign(registration.id, packageId);
    const second = await makeBooking(registration.dog);
    await expect(assign(second.id, packageId)).rejects.toThrow(
      "Brak dostępnych wejść",
    );
    expect((await bookingState(second.id)).package_id).toBeNull();
    expect(await balance(packageId)).toEqual({
      available: 0,
      reserved: 1,
      used: 0,
    });
  });

  it("returns timely cancellations and charges late cancellation, then returns the consumed entry if organizer cancels", async () => {
    const timely = await makeBooking();
    const packageId = await purchase(timely.dog, 1);
    await assign(timely.id, packageId);
    await asUser(owner, () =>
      db.query("select public.cancel_registration($1)", [timely.id]),
    );
    expect(await balance(packageId)).toEqual({
      available: 1,
      reserved: 0,
      used: 0,
    });
    const late = await makeBooking(timely.dog, 1);
    await assign(late.id, packageId);
    await asUser(owner, () =>
      db.query("select public.cancel_registration($1)", [late.id]),
    );
    expect(await balance(packageId)).toEqual({
      available: 0,
      reserved: 0,
      used: 1,
    });
    expect((await bookingState(late.id)).payment_status).toBe("none");
    for (let retry = 0; retry < 2; retry++)
      await asAdmin(() =>
        db.query("select public.cancel_walk($1,'Burza')", [late.walk]),
      );
    expect(await balance(packageId)).toEqual({
      available: 1,
      reserved: 0,
      used: 0,
    });
    expect((await bookingState(late.id)).status).toBe("cancelled_on_time");
  });

  it("returns organizer-cancelled reservations exactly once alongside the previous cancellation loop", async () => {
    const registration = await makeBooking();
    const packageId = await purchase(registration.dog, 1);
    await assign(registration.id, packageId);
    for (let retry = 0; retry < 2; retry++)
      await asAdmin(() =>
        db.query("select public.cancel_walk($1,'Burza')", [registration.walk]),
      );
    expect(await balance(packageId)).toEqual({
      available: 1,
      reserved: 0,
      used: 0,
    });
    expect(
      (
        await db.query(
          "select id from public.package_transactions where package_id=$1 and registration_id=$2",
          [packageId, registration.id],
        )
      ).rows,
    ).toHaveLength(2);
  });

  it("reconciles admin decisions between accepted, waitlist, rejected and pending", async () => {
    const registration = await makeBooking();
    const packageId = await purchase(registration.dog, 1);
    await assign(registration.id, packageId);
    for (const [status, reserved] of [
      ["waitlisted", 0],
      ["accepted", 1],
      ["rejected", 0],
      ["pending", 0],
      ["accepted", 1],
      ["cancelled_late", 0],
    ] as const) {
      await asAdmin(() =>
        db.query(
          "select public.decide_registration($1,$2::public.registration_status,'Decyzja')",
          [registration.id, status],
        ),
      );
      expect(await balance(packageId)).toEqual({
        available: status === "cancelled_late" ? 0 : 1 - reserved,
        reserved,
        used: status === "cancelled_late" ? 1 : 0,
      });
      expect((await bookingState(registration.id)).payment_status).toBe("none");
    }
  });

  it("settles attendance and corrects it reversibly without duplicate consumption", async () => {
    const registration = await makeBooking();
    const packageId = await purchase(registration.dog, 1);
    await assign(registration.id, packageId);
    await db.query(
      "update public.walks set starts_at=now()-interval '2 hours' where id=$1",
      [registration.walk],
    );
    for (const [attendance, expected] of [
      ["present", { available: 0, reserved: 0, used: 1 }],
      ["present", { available: 0, reserved: 0, used: 1 }],
      ["absent", { available: 1, reserved: 0, used: 0 }],
      ["present", { available: 0, reserved: 0, used: 1 }],
      ["pending", { available: 0, reserved: 1, used: 0 }],
      ["no_show", { available: 0, reserved: 0, used: 1 }],
    ] as const) {
      await attend(registration.id, attendance);
      expect(await balance(packageId)).toEqual(expected);
    }
  });

  it("excuses cash charges on absence and reinstates them when attendance is corrected", async () => {
    const registration = await makeBooking(undefined, -2);
    await attend(registration.id, "absent");
    expect((await bookingState(registration.id)).payment_status).toBe("none");
    await expect(payment(registration.id, null, 1000)).rejects.toThrow(
      "nie wymaga wpłaty",
    );
    for (const attendance of ["pending", "present", "no_show"]) {
      await attend(registration.id, attendance);
      expect((await bookingState(registration.id)).payment_status).toBe("due");
    }
    await attend(registration.id, "absent");
    expect((await bookingState(registration.id)).payment_status).toBe("none");
  });

  it("keeps actual partial receipts for refund review when attendance is excused", async () => {
    const registration = await makeBooking(undefined, -2);
    const receipt = await payment(registration.id, null, 2000);
    await attend(registration.id, "absent");
    expect((await bookingState(registration.id)).payment_status).toBe("paid");
    expect(
      (
        await db.query(
          "select status,amount_cents from public.payments where id=$1",
          [receipt],
        )
      ).rows,
    ).toEqual([{ status: "paid", amount_cents: 2000 }]);
    await attend(registration.id, "present");
    expect((await bookingState(registration.id)).payment_status).toBe("due");
    await attend(registration.id, "absent");
    await asAdmin(() =>
      db.query("select public.void_payment($1,'Zwrot po usprawiedliwieniu')", [
        receipt,
      ]),
    );
    expect((await bookingState(registration.id)).payment_status).toBe(
      "refunded",
    );
    expect(
      (
        await db.query("select status from public.payments where id=$1", [
          receipt,
        ])
      ).rows,
    ).toEqual([{ status: "refunded" }]);
  });

  it("does not resurrect a refunded receipt on request retry and allows correcting package receipts", async () => {
    const dog = await makeDog();
    const packageId = await purchase(dog);
    const key = randomUUID();
    const receipt = await payment(null, packageId, 10000, key);
    await asAdmin(() =>
      db.query("select public.void_payment($1,'Korekta pomyłki')", [receipt]),
    );
    expect(await payment(null, packageId, 10000, key)).toBe(receipt);
    expect(
      (
        await db.query("select status from public.payments where id=$1", [
          receipt,
        ])
      ).rows,
    ).toEqual([{ status: "refunded" }]);
    await payment(null, packageId, 10000);
    expect(
      (
        await db.query(
          "select sum(amount_cents)::int as paid from public.payments where package_id=$1 and status='paid'",
          [packageId],
        )
      ).rows,
    ).toEqual([{ paid: 10000 }]);
    expect(await balance(packageId)).toEqual({
      available: 2,
      reserved: 0,
      used: 0,
    });
  });

  it("rolls back an attendance correction if its returned entry has already been allocated elsewhere", async () => {
    const old = await makeBooking();
    const packageId = await purchase(old.dog, 1);
    await assign(old.id, packageId);
    await db.query(
      "update public.walks set starts_at=now()-interval '2 hours' where id=$1",
      [old.walk],
    );
    await attend(old.id, "absent");
    const next = await makeBooking(old.dog);
    await assign(next.id, packageId);
    await expect(attend(old.id, "present")).rejects.toThrow(
      "Brak dostępnych wejść",
    );
    expect((await bookingState(old.id)).attendance).toBe("absent");
    expect(await balance(packageId)).toEqual({
      available: 0,
      reserved: 1,
      used: 0,
    });
    expect(
      (
        await db.query(
          "select id from public.audit_events where event='attendance_changed' and entity_id=$1",
          [old.id],
        )
      ).rows,
    ).toHaveLength(1);
  });

  it("honors an already reserved entry after package expiry and permits its return", async () => {
    const registration = await makeBooking();
    const packageId = await purchase(registration.dog, 1);
    await assign(registration.id, packageId);
    await db.query(
      "update public.packages set expires_at=now()-interval '1 hour' where id=$1",
      [packageId],
    );
    await db.query(
      "update public.walks set starts_at=now()-interval '2 hours' where id=$1",
      [registration.walk],
    );
    await attend(registration.id, "present");
    await attend(registration.id, "pending");
    await attend(registration.id, "absent");
    expect(await balance(packageId)).toEqual({
      available: 1,
      reserved: 0,
      used: 0,
    });
  });

  it("keeps financial rows readable only by their owner and admin and blocks direct client writes", async () => {
    const dog = await makeDog(stranger);
    const packageId = await purchase(dog);
    await payment(null, packageId, 1000);
    expect(
      (
        await asUser(owner, () =>
          db.query("select id from public.packages where id=$1", [packageId]),
        )
      ).rows,
    ).toHaveLength(0);
    expect(
      (
        await asUser(owner, () =>
          db.query(
            "select id from public.package_transactions where package_id=$1",
            [packageId],
          ),
        )
      ).rows,
    ).toHaveLength(0);
    expect(
      (
        await asUser(owner, () =>
          db.query("select id from public.payments where package_id=$1", [
            packageId,
          ]),
        )
      ).rows,
    ).toHaveLength(0);
    expect(
      (
        await asUser(stranger, () =>
          db.query("select id from public.payments where package_id=$1", [
            packageId,
          ]),
        )
      ).rows,
    ).toHaveLength(1);
    await expect(
      asUser(stranger, () =>
        db.query(
          "update public.payments set amount_cents=1 where package_id=$1",
          [packageId],
        ),
      ),
    ).rejects.toThrow("permission denied");
    await expect(
      asUser(stranger, () =>
        db.query(
          "delete from public.package_transactions where package_id=$1",
          [packageId],
        ),
      ),
    ).rejects.toThrow("permission denied");
  });
});
