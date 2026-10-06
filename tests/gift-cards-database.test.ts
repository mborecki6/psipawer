import { PGlite } from "@electric-sql/pglite";
import { randomBytes, randomUUID } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";

let db: PGlite;
const admin = "d1000000-0000-4000-8000-000000000001",
  owner = "d1000000-0000-4000-8000-000000000002",
  other = "d1000000-0000-4000-8000-000000000003",
  colleague = "d1000000-0000-4000-8000-000000000004",
  dog = "d2000000-0000-4000-8000-000000000001",
  dog2 = "d2000000-0000-4000-8000-000000000002",
  otherDog = "d2000000-0000-4000-8000-000000000003";
const service = (n: number) =>
  `60000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
async function asUser<T>(actor: string, run: () => Promise<T>) {
  await db.exec("begin;set local role authenticated");
  await db.query("select set_config('request.jwt.claim.sub',$1,true)", [actor]);
  try {
    const value = await run();
    await db.exec("commit");
    return value;
  } catch (error) {
    await db.exec("rollback");
    throw error;
  }
}
async function rpc<T = unknown>(actor: string, name: string, args: unknown[]) {
  return (
    await asUser(actor, () =>
      db.query<{ result: T }>(
        `select public.${name}(${args.map((_, i) => `$${i + 1}`).join(",")}) as result`,
        args,
      ),
    )
  ).rows[0].result;
}
const today = () =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Warsaw" }).format(
    new Date(),
  );
const future = () => new Date(Date.now() + 7 * 86400000).toISOString();
async function terms(id: string) {
  return (
    await db.query<{ version: number; price_cents: number }>(
      "select version,price_cents from public.services where id=$1",
      [id],
    )
  ).rows[0];
}
type Card = { id: string; code: string; args: unknown[] };
async function card(
  options: {
    value?: number;
    beneficiary?: string | null;
    service?: string;
    purchased?: string;
  } = {},
): Promise<Card> {
  const id = randomUUID(),
    code = randomBytes(20).toString("hex").toUpperCase();
  const s = options.service ? await terms(options.service) : null;
  const args = [
    id,
    options.service ?? null,
    s?.version ?? null,
    options.value ?? s?.price_cents ?? 10000,
    options.purchased ?? today(),
    "Darczyńca testowy",
    "Obdarowany testowy",
    "Dobrego wspólnego czasu",
    options.beneficiary === undefined ? owner : options.beneficiary,
    "transfer",
    "Potwierdzona wpłata poza aplikacją",
    code,
  ];
  expect(await rpc(admin, "issue_gift_card", args)).toBe(id);
  return { id, code, args };
}
const balance = async (id: string, actor = owner) =>
  (
    await asUser(actor, () =>
      db.query<Record<string, unknown>>(
        "select * from public.gift_card_balances where id=$1",
        [id],
      ),
    )
  ).rows[0];
const cardVersion = async (id: string) =>
  (
    await db.query<{ version: number }>(
      "select version from public.gift_cards where id=$1",
      [id],
    )
  ).rows[0].version;
const change = async (
  id: string,
  action: string,
  beneficiary: string | null = null,
  key = randomUUID(),
  version?: number,
) =>
  rpc<number>(admin, "change_gift_card", [
    id,
    version ?? (await cardVersion(id)),
    action,
    beneficiary,
    "Jawna decyzja prowadzącej",
    key,
  ]);
const redeem = async (
  id: string,
  target: string,
  amount: number,
  kind = "fitness",
  key = randomUUID(),
  version?: number,
  actor = admin,
  note = "Wykorzystanie karty",
) =>
  rpc<string>(actor, "redeem_gift_card", [
    id,
    version ?? (await cardVersion(id)),
    kind,
    target,
    amount,
    note,
    key,
  ]);
const claim = (code: string, actor = owner) =>
  rpc<{ id?: string; error?: string }>(actor, "claim_gift_card", [code]);
async function fitness(dogId = dog, actor = owner) {
  const id = randomUUID();
  const s = await terms(service(6));
  await rpc(actor, "request_fitness_package", [
    id,
    dogId,
    service(6),
    s.version,
    "Fikcyjny cel",
    "Popołudnia",
  ]);
  await rpc(admin, "change_fitness_package", [
    id,
    1,
    "accept",
    "Fikcyjna decyzja",
    randomUUID(),
  ]);
  return id;
}
async function consultation() {
  const id = randomUUID(),
    s = await terms(service(11));
  await rpc(owner, "request_consultation", [
    id,
    dog,
    "Fikcyjny temat",
    "",
    service(11),
    s.version,
  ]);
  await rpc(admin, "change_consultation", [
    id,
    1,
    "schedule",
    future(),
    90,
    "online",
    "Fikcyjne spotkanie online",
    "Fikcyjny termin",
  ]);
  return id;
}
async function walk() {
  const id = await rpc<string>(admin, "create_walk", [
    {
      starts_at: future(),
      duration_minutes: 60,
      public_location: "Fikcyjne miejsce",
      exact_location: "Fikcyjna zbiórka",
      type: "Fikcyjny spacer",
      price_cents: 10000,
      capacity: 4,
      booking_mode: "approval",
      cancellation_deadline_hours: 24,
    },
  ]);
  const registration = await rpc<string>(owner, "register_dog", [id, dog]);
  await rpc(admin, "decide_registration", [
    registration,
    "accepted",
    "Fikcyjna decyzja",
  ]);
  return registration;
}
async function course() {
  const id = await rpc<string>(admin, "create_course", [
    randomUUID(),
    service(1),
    (await terms(service(1))).version,
    "Fikcyjny kurs",
    4,
    "Fikcyjne miejsce",
    "Fikcyjna zbiórka",
    JSON.stringify(
      [7, 14, 21, 28, 35].map((days) =>
        new Date(Date.now() + days * 86400000).toISOString(),
      ),
    ),
  ]);
  await rpc(admin, "change_course", [id, 1, "publish", "Fikcyjna publikacja"]);
  const enrollment = randomUUID();
  await rpc(owner, "request_course_enrollment", [enrollment, id, dog, 2]);
  await rpc(admin, "change_course_enrollment", [
    enrollment,
    1,
    "accept",
    "Fikcyjna decyzja",
  ]);
  return enrollment;
}
const cashRefund = async (
  id: string,
  amount: number,
  key = randomUUID(),
  version?: number,
  actor = admin,
) =>
  rpc<string>(actor, "refund_gift_card_sale", [
    id,
    version ?? (await cardVersion(id)),
    amount,
    "Potwierdzony zwrot poza aplikacją",
    key,
  ]);
const bind = (
  target: string,
  kind: "registration" | "package",
  id: string,
  version = 0,
  actor = admin,
) =>
  rpc<string>(actor, "bind_gift_card_service", [
    kind === "registration" ? target : null,
    kind === "package" ? target : null,
    id,
    version,
    "Jawne powiązanie z ofertą",
  ]);
const packageFixture = () =>
  rpc<string>(admin, "purchase_package", [
    dog,
    "Fikcyjny pakiet spacerów",
    4,
    10000,
    null,
    "Fikcyjne przyznanie",
  ]);
async function evidence() {
  return (
    await db.query<{ result: unknown }>(`select jsonb_build_object(
    'cards',(select jsonb_agg(c order by id) from public.gift_cards c),
    'ledger',(select jsonb_agg(l order by id) from public.gift_card_ledger l),
    'sales',(select jsonb_agg(s order by card_id) from public.gift_card_sales s),
    'history',(select jsonb_agg(h order by id) from public.gift_card_history h),
    'receipts',(select jsonb_agg(r order by request_id) from public.gift_card_command_receipts r),
    'payments',(select jsonb_agg(p order by id) from public.payments p),
    'fitness',(select jsonb_agg(f order by id) from public.fitness_packages f),
    'fitness_refunds',(select jsonb_agg(f order by id) from public.fitness_payment_refunds f),
    'fitness_history',(select jsonb_agg(f order by id) from public.fitness_history f),
    'course_refunds',(select jsonb_agg(f order by id) from public.course_payment_refunds f),
    'course_enrollments',(select jsonb_agg(f order by id) from public.course_enrollments f),
    'consultations',(select jsonb_agg(f order by id) from public.consultations f),
    'registrations',(select jsonb_agg(f order by id) from public.walk_registrations f),
    'packages',(select jsonb_agg(f order by id) from public.packages f),
    'service_links',(select jsonb_agg(f order by id) from public.gift_card_service_links f),
    'notifications',(select jsonb_agg(f order by id) from public.notifications f),
    'reminders',(select jsonb_agg(f order by id) from public.reminder_jobs f),
    'audit',(select jsonb_agg(a order by id) from public.audit_events a)) as result`)
  ).rows[0].result;
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
    .filter((f) => f.endsWith(".sql"))
    .sort())
    await db.exec(readFileSync(`supabase/migrations/${file}`, "utf8"));
  await db.query("insert into auth.users(id) values($1),($2),($3),($4)", [
    admin,
    owner,
    other,
    colleague,
  ]);
  await db.query(
    "update public.user_roles set role='admin' where user_id in($1,$2)",
    [admin, colleague],
  );
  await db.query(
    "insert into public.dogs(id,guardian_id,name,status) values($1,$2,'Pies próbny','approved'),($3,$2,'Drugi pies próbny','approved'),($4,$5,'Obcy pies','approved')",
    [dog, owner, dog2, otherDog, other],
  );
});
beforeEach(async () => {
  await db.exec(
    "truncate public.payments cascade;truncate public.gift_cards cascade;truncate public.fitness_packages cascade;truncate public.consultations cascade;truncate public.courses cascade;truncate public.walks cascade;truncate public.packages cascade;delete from public.gift_card_claim_limits;delete from public.audit_events",
  );
  await db.query(
    "update public.dogs set guardian_id=$1,status='approved' where id in($2,$3)",
    [owner, dog, dog2],
  );
  await db.query(
    "update public.services set active=true,price_cents=10000,name=case when id=$1 then 'PSI FITNESS — pakiet 4 spotkań' else name end where true",
    [service(6)],
  );
});
afterAll(async () => db?.close());

it("issues one confirmed sale and one initial value, preserving six calendar months and private code", async () => {
  const c = await card({ purchased: "2026-01-31" });
  const initial = await evidence();
  expect(await rpc(admin, "issue_gift_card", c.args)).toBe(c.id);
  expect(await evidence()).toEqual(initial);
  expect(
    (
      await db.query<{ expires_on: string }>(
        "select expires_on::text from public.gift_cards where id=$1",
        [c.id],
      )
    ).rows[0].expires_on,
  ).toBe("2026-07-31");
  expect((await balance(c.id)).balance_cents).toBe(10000);
  expect(
    (await db.query("select * from public.gift_card_sales")).rows,
  ).toHaveLength(1);
  expect(
    (
      await asUser(owner, () =>
        db.query("select * from public.gift_card_codes"),
      )
    ).rows,
  ).toEqual([]);
  expect(
    (
      await asUser(owner, () =>
        db.query("select * from public.gift_card_sales"),
      )
    ).rows,
  ).toEqual([]);
  const receipt = (
    await db.query<{ payload: Record<string, unknown> }>(
      "select payload from public.gift_card_command_receipts",
    )
  ).rows[0];
  expect(JSON.stringify(receipt.payload)).not.toContain(c.code);
});
it("rejects altered issuance retries and another staff member without changing the original sale", async () => {
  const c = await card();
  const before = await evidence();
  const changed = [...c.args];
  changed[6] = "Inna osoba";
  await expect(rpc(admin, "issue_gift_card", changed)).rejects.toThrow(
    "identyfikator",
  );
  await expect(rpc(colleague, "issue_gift_card", c.args)).rejects.toThrow(
    "identyfikator",
  );
  await expect(rpc(owner, "issue_gift_card", c.args)).rejects.toThrow(
    "Brak uprawnień",
  );
  expect(await evidence()).toEqual(before);
});
it("rejects invalid values, future purchases, predictable codes and gift cards for another gift card atomically", async () => {
  const c = await card();
  const before = await evidence();
  for (const [index, value] of [
    [3, 0],
    [3, 1000001],
    [4, "2099-01-01"],
    [11, "ABC"],
    [1, service(17)],
  ] as [number, unknown][]) {
    const args = [...c.args];
    args[0] = randomUUID();
    args[index] = value;
    await expect(rpc(admin, "issue_gift_card", args)).rejects.toThrow();
  }
  expect(await evidence()).toEqual(before);
});
it("claims a normalized bearer code once and does not disclose someone else's claimed card", async () => {
  const c = await card({ beneficiary: null });
  expect(await balance(c.id)).toBeUndefined();
  expect(await claim(c.code.toLowerCase().match(/.{8}/g)!.join("-"))).toEqual({
    id: c.id,
  });
  const first = await evidence();
  expect(await claim(c.code)).toEqual({ id: c.id });
  expect(await evidence()).toEqual(first);
  const unknown = await claim("0".repeat(40), other);
  expect(await claim(c.code, other)).toEqual(unknown);
  expect(await balance(c.id, other)).toBeUndefined();
  expect((await balance(c.id)).version).toBe(2);
});
it("commits five failed claims, throttles valid new claims, and recovers after its private fifteen-minute window", async () => {
  const c = await card({ beneficiary: null });
  for (let n = 0; n < 5; n++)
    expect((await claim("BAD")).error).toContain("Sprawdź kod");
  expect((await claim(c.code)).error).toContain("15 minut");
  expect(
    (
      await db.query<{ failures: number }>(
        "select failures from public.gift_card_claim_limits where user_id=$1",
        [owner],
      )
    ).rows[0].failures,
  ).toBe(5);
  await db.query(
    "update public.gift_card_claim_limits set window_started_at=now()-interval '16 minutes' where user_id=$1",
    [owner],
  );
  expect(await claim(c.code)).toEqual({ id: c.id });
});
it("withdrawn and expired cards cannot be claimed, while exact historical claims never reactivate them", async () => {
  const cancelled = await card({ beneficiary: null });
  await change(cancelled.id, "cancel");
  expect((await claim(cancelled.code)).error).toContain("Sprawdź kod");
  const expired = await card({ beneficiary: null, purchased: "2020-01-01" });
  expect((await claim(expired.code)).error).toContain("Sprawdź kod");
  const own = await card({ beneficiary: null });
  expect(await claim(own.code)).toEqual({ id: own.id });
  await change(own.id, "cancel");
  expect(await claim(own.code)).toEqual({ id: own.id });
  expect((await balance(own.id)).usable).toBe(false);
});

it("uses part of a value card and combines it with cash without inventing a second sale", async () => {
  const c = await card(),
    target = await fitness();
  const payment = await redeem(c.id, target, 4000);
  expect((await balance(c.id)).balance_cents).toBe(6000);
  await rpc(admin, "record_fitness_payment", [
    target,
    6000,
    "transfer",
    "Rzeczywista dopłata",
    randomUUID(),
  ]);
  const rows = (
    await db.query<{ method: string; gift_card_id: string | null }>(
      "select method,gift_card_id from public.payments order by created_at",
    )
  ).rows;
  expect(rows).toEqual([
    { method: "gift_card", gift_card_id: c.id },
    { method: "transfer", gift_card_id: null },
  ]);
  expect(
    (
      await db.query<{ due_cents: number }>(
        "select due_cents from public.fitness_balances where id=$1",
        [target],
      )
    ).rows[0].due_cents,
  ).toBe(0);
  expect(
    (
      await db.query<{ details: Record<string, unknown> }>(
        "select details from public.audit_events where event='payment_recorded' and entity_id=$1",
        [payment],
      )
    ).rows[0].details,
  ).toMatchObject({ method: "gift_card", gift_card_id: c.id });
  expect(
    (await db.query("select * from public.gift_card_sales")).rows,
  ).toHaveLength(1);
});
it("rejects spending more than the remaining card value and rolls back all source/payment/history changes", async () => {
  const c = await card(),
    a = await fitness(),
    b = await fitness(dog2);
  await redeem(c.id, a, 6000);
  const before = await evidence();
  await expect(redeem(c.id, b, 5000)).rejects.toThrow("saldo karty");
  expect(await evidence()).toEqual(before);
  await redeem(c.id, b, 4000);
  expect((await balance(c.id)).balance_cents).toBe(0);
  expect((await balance(c.id)).usable).toBe(false);
});
it("rejects overpaying the service before taking any card value", async () => {
  const c = await card({ value: 20000 }),
    target = await fitness();
  const before = await evidence();
  await expect(redeem(c.id, target, 10001)).rejects.toThrow("pozostałą kwotę");
  expect(await evidence()).toEqual(before);
});
it("cannot pay another guardian's liability and cannot be spent by a client", async () => {
  const c = await card(),
    target = await fitness(otherDog, other);
  const before = await evidence();
  await expect(redeem(c.id, target, 10000)).rejects.toThrow("samego opiekuna");
  await expect(
    redeem(c.id, target, 10000, "fitness", randomUUID(), undefined, owner),
  ).rejects.toThrow("Brak uprawnień");
  expect(await evidence()).toEqual(before);
});
it("retains the chosen service and price snapshot and leaves an explicit remaining liability after a price increase", async () => {
  const c = await card({ service: service(6) });
  await db.query(
    "update public.services set price_cents=15000,name='Nowa cena fitness',version=version+1 where id=$1",
    [service(6)],
  );
  const target = await fitness();
  await redeem(c.id, target, 10000);
  expect(await balance(c.id)).toMatchObject({
    value_cents: 10000,
    service_name: "PSI FITNESS — pakiet 4 spotkań",
    balance_cents: 0,
  });
  expect(
    (
      await db.query<{ due_cents: number }>(
        "select due_cents from public.fitness_balances where id=$1",
        [target],
      )
    ).rows[0].due_cents,
  ).toBe(5000);
  expect(await rpc(admin, "issue_gift_card", c.args)).toBe(c.id);
});
it("refuses a different service even when its price matches the card", async () => {
  const c = await card({ service: service(11) }),
    target = await fitness();
  const before = await evidence();
  await expect(redeem(c.id, target, 10000)).rejects.toThrow("inną usługę");
  expect(await evidence()).toEqual(before);
});
it("honours a previously issued card for an existing service after its catalogue entry is deactivated", async () => {
  const c = await card({ service: service(6) }),
    target = await fitness();
  await db.query("update public.services set active=false where id=$1", [
    service(6),
  ]);
  await redeem(c.id, target, 10000);
  expect((await balance(c.id)).balance_cents).toBe(0);
});
it("preserves one historical redemption after refund and withdrawal without reversing those later decisions", async () => {
  const c = await card(),
    target = await fitness(),
    key = randomUUID();
  const payment = await redeem(c.id, target, 10000, "fitness", key, 1);
  await rpc(admin, "void_payment", [
    payment,
    "Przywrócenie całej wartości na kartę",
  ]);
  await change(c.id, "cancel");
  const before = await evidence();
  expect(await redeem(c.id, target, 10000, "fitness", key, 1)).toBe(payment);
  expect(await evidence()).toEqual(before);
  expect(await balance(c.id)).toMatchObject({
    balance_cents: 10000,
    status: "cancelled",
    usable: false,
  });
  for (const args of [
    [c.id, 1, "fitness", target, 5000, "Wykorzystanie karty", key],
    [c.id, 1, "fitness", target, 10000, "Inna treść", key],
  ])
    await expect(rpc(admin, "redeem_gift_card", args)).rejects.toThrow(
      "identyfikator",
    );
  await expect(
    redeem(c.id, target, 10000, "fitness", key, 1, colleague),
  ).rejects.toThrow("identyfikator");
  expect(await evidence()).toEqual(before);
});
it("keeps form conflicts atomic and refuses expired or withdrawn cards", async () => {
  const c = await card(),
    target = await fitness();
  await change(c.id, "cancel");
  await change(c.id, "restore");
  const before = await evidence();
  await expect(
    redeem(c.id, target, 10000, "fitness", randomUUID(), 1),
  ).rejects.toThrow("Karta zmieniła się");
  expect(await evidence()).toEqual(before);
  const expired = await card({ purchased: "2020-01-01" });
  await expect(redeem(expired.id, target, 10000)).rejects.toThrow(
    "termin ważności",
  );
  await change(c.id, "cancel");
  await expect(redeem(c.id, target, 10000)).rejects.toThrow("wycofana");
});
it("allows deliberate reassignment only before the first use and never gives another guardian old financial history", async () => {
  const c = await card();
  await change(c.id, "assign", other);
  expect(await balance(c.id)).toBeUndefined();
  expect((await balance(c.id, other)).beneficiary_id).toBe(other);
  await change(c.id, "assign", owner);
  const target = await fitness();
  const payment = await redeem(c.id, target, 10000);
  await rpc(admin, "void_payment", [payment, "Zwrot salda"]);
  const before = await evidence();
  await expect(change(c.id, "assign", other)).rejects.toThrow(
    "zachowuje swojego opiekuna",
  );
  expect(await evidence()).toEqual(before);
  expect(
    (
      await asUser(other, () =>
        db.query("select * from public.gift_card_ledger"),
      )
    ).rows,
  ).toEqual([]);
});

for (const kind of ["fitness", "course"] as const)
  it(`restores each partial ${kind} refund once, including the final refunded status and later whole-void retry`, async () => {
    const c = await card(),
      target = kind === "fitness" ? await fitness() : await course(),
      payment = await redeem(c.id, target, 10000, kind),
      key = randomUUID();
    const refund = (amount: number, request = randomUUID(), actor = admin) =>
      rpc<string>(actor, `refund_${kind}_payment`, [
        payment,
        amount,
        "Zwrot na saldo karty",
        request,
      ]);
    expect(await refund(3000, key)).toBe(key);
    expect(await balance(c.id)).toMatchObject({
      balance_cents: 3000,
      version: 3,
    });
    const partial = await evidence();
    expect(await refund(3000, key)).toBe(key);
    expect(await evidence()).toEqual(partial);
    await expect(refund(7001)).rejects.toThrow("przekracza");
    await expect(refund(3000, key, owner)).rejects.toThrow("Brak uprawnień");
    expect(await evidence()).toEqual(partial);
    await refund(7000);
    expect(await balance(c.id)).toMatchObject({
      balance_cents: 10000,
      version: 4,
    });
    expect(
      (
        await db.query<{ count: number }>(
          "select count(*)::integer as count from public.gift_card_ledger where kind='return'",
        )
      ).rows[0].count,
    ).toBe(2);
    expect(
      (
        await db.query<{ status: string }>(
          "select status from public.payments where id=$1",
          [payment],
        )
      ).rows[0].status,
    ).toBe("refunded");
    const complete = await evidence();
    expect(
      await rpc(admin, "void_payment", [payment, "Powtórzone pełne cofnięcie"]),
    ).toBe(payment);
    expect(await refund(3000, key)).toBe(key);
    expect(await evidence()).toEqual(complete);
  });

for (const kind of ["consultation", "registration", "package"] as const)
  it(`pays and returns the complete ${kind} credit to the same card, without a cash refund`, async () => {
    const c = await card(),
      target =
        kind === "consultation"
          ? await consultation()
          : kind === "registration"
            ? await walk()
            : await packageFixture(),
      payment = await redeem(c.id, target, 10000, kind);
    expect((await balance(c.id)).balance_cents).toBe(0);
    await rpc(admin, "void_payment", [payment, "Przywrócenie salda karty"]);
    expect(await balance(c.id)).toMatchObject({
      balance_cents: 10000,
      version: 3,
    });
    const entries = (
      await db.query<{
        kind: string;
        delta_cents: number;
        payment_id: string | null;
      }>(
        "select kind,delta_cents,payment_id from public.gift_card_ledger order by created_at,id",
      )
    ).rows;
    expect(entries).toEqual([
      { kind: "issue", delta_cents: 10000, payment_id: null },
      { kind: "redemption", delta_cents: -10000, payment_id: payment },
      { kind: "return", delta_cents: 10000, payment_id: payment },
    ]);
    const before = await evidence();
    await rpc(admin, "void_payment", [payment, "Powtórzenie zwrotu"]);
    expect(await evidence()).toEqual(before);
  });

it("finishes a partly returned credit through the ordinary whole-void action without crediting the first part twice", async () => {
  const c = await card(),
    target = await fitness(),
    payment = await redeem(c.id, target, 10000);
  await rpc(admin, "refund_fitness_payment", [
    payment,
    3000,
    "Pierwsza część zwrotu",
    randomUUID(),
  ]);
  await rpc(admin, "void_payment", [payment, "Pozostała część wraca na kartę"]);
  expect((await balance(c.id)).balance_cents).toBe(10000);
  expect(
    (
      await db.query<{ amount: number }>(
        "select sum(delta_cents)::integer as amount from public.gift_card_ledger where kind='return'",
      )
    ).rows[0].amount,
  ).toBe(10000);
});

it("returns service credit to a withdrawn or expired card without renewing its expiry or status", async () => {
  const c = await card(),
    target = await fitness(),
    payment = await redeem(c.id, target, 10000);
  await change(c.id, "cancel");
  // Advance this isolated fixture's validity boundary, without changing clocks
  // or the application's database. Refunds must preserve the original date.
  await db.query(
    "update public.gift_cards set purchased_on='2020-01-01',expires_on='2020-07-01' where id=$1",
    [c.id],
  );
  await rpc(admin, "void_payment", [payment, "Zwrot na pierwotną kartę"]);
  expect(await balance(c.id)).toMatchObject({
    balance_cents: 10000,
    status: "cancelled",
    usable: false,
  });
  expect(
    (
      await db.query<{ expires: string }>(
        "select expires_on::text as expires from public.gift_cards where id=$1",
        [c.id],
      )
    ).rows[0].expires,
  ).toBe("2020-07-01");
  await change(c.id, "restore");
  expect((await balance(c.id)).usable).toBe(false);
  await expect(redeem(c.id, target, 10000)).rejects.toThrow("termin ważności");
});

it("honours the frozen enrollment guardian after a dog transfer without giving the new guardian access to the card or receipt", async () => {
  const c = await card(),
    target = await fitness();
  await db.query("update public.dogs set guardian_id=$1 where id=$2", [
    other,
    dog,
  ]);
  const payment = await redeem(c.id, target, 10000);
  expect(
    (
      await asUser(owner, () =>
        db.query("select id from public.payments where id=$1", [payment]),
      )
    ).rows,
  ).toEqual([{ id: payment }]);
  expect(
    (
      await asUser(other, () =>
        db.query("select id from public.payments where id=$1", [payment]),
      )
    ).rows,
  ).toEqual([]);
  expect(await balance(c.id, other)).toBeUndefined();
  await rpc(admin, "void_payment", [payment, "Zwrot dla pierwotnego opiekuna"]);
  expect((await balance(c.id)).balance_cents).toBe(10000);
});

it("never adopts or rewrites an earlier cash receipt with the same public request key", async () => {
  const c = await card(),
    target = await fitness(),
    key = randomUUID();
  const cash = await rpc<string>(admin, "record_fitness_payment", [
    target,
    4000,
    "cash",
    "Rzeczywista wcześniejsza wpłata",
    key,
  ]);
  const previous = (
    await db.query("select * from public.payments where id=$1", [cash])
  ).rows[0];
  const credit = await redeem(c.id, target, 6000, "fitness", key, 1);
  expect(credit).not.toBe(cash);
  expect(
    (await db.query("select * from public.payments where id=$1", [cash]))
      .rows[0],
  ).toEqual(previous);
  expect((await balance(c.id)).balance_cents).toBe(4000);
  expect((await db.query("select id from public.payments")).rows).toHaveLength(
    2,
  );
});

for (const kind of ["registration", "package"] as const)
  it(`requires explicit catalogue matching for a service-restricted ${kind} card and preserves that match after use`, async () => {
    const catalogue = kind === "registration" ? service(13) : service(14),
      c = await card({ service: catalogue }),
      target = kind === "registration" ? await walk() : await packageFixture();
    const before = await evidence();
    await expect(redeem(c.id, target, 10000, kind)).rejects.toThrow(
      "powiązanie oferty",
    );
    expect(await evidence()).toEqual(before);
    await expect(bind(target, kind, catalogue, 0, owner)).rejects.toThrow(
      "Brak uprawnień",
    );
    await expect(bind(target, kind, service(6))).rejects.toThrow(
      "rodzajem rozliczenia",
    );
    expect(await evidence()).toEqual(before);
    const link = await bind(target, kind, catalogue);
    const bound = await evidence();
    expect(await bind(target, kind, catalogue)).toBe(link);
    expect(await evidence()).toEqual(bound);
    const payment = await redeem(c.id, target, 10000, kind);
    await rpc(admin, "void_payment", [payment, "Zwrot kredytu z karty"]);
    const used = await evidence();
    await expect(bind(target, kind, catalogue, 1)).rejects.toThrow(
      "wcześniejsze powiązanie",
    );
    expect(await evidence()).toEqual(used);
  });

it("rejects stale or incompatible service matching without changing the earlier explicit decision", async () => {
  const target = await walk();
  await bind(target, "registration", service(13));
  const before = await evidence();
  await expect(bind(target, "registration", service(15), 0)).rejects.toThrow(
    "Powiązanie usługi zmieniło",
  );
  expect(await evidence()).toEqual(before);
  await bind(target, "registration", service(15), 1);
  expect(
    (
      await db.query<{ service_id: string; version: number }>(
        "select service_id,version from public.gift_card_service_links",
      )
    ).rows[0],
  ).toEqual({ service_id: service(15), version: 2 });
});
it("honours a previously issued walk-service card after its catalogue service is hidden, with an explicit historical match", async () => {
  const c = await card({ service: service(13) }),
    target = await walk();
  await db.query("update public.services set active=false where id=$1", [
    service(13),
  ]);
  await bind(target, "registration", service(13));
  await redeem(c.id, target, 10000, "registration");
  expect((await balance(c.id)).balance_cents).toBe(0);
});

it("records a real cash refund only after withdrawal, preserves exact retries and refuses overspending or another actor", async () => {
  const c = await card();
  const initial = await evidence();
  await expect(cashRefund(c.id, 10000)).rejects.toThrow("wycofaj kartę");
  expect(await evidence()).toEqual(initial);
  await change(c.id, "cancel");
  expect((await balance(c.id)).balance_cents).toBe(10000);
  const key = randomUUID(),
    version = await cardVersion(c.id),
    result = await cashRefund(c.id, 4000, key, version);
  expect((await balance(c.id)).balance_cents).toBe(6000);
  const partial = await evidence();
  expect(await cashRefund(c.id, 4000, key, version)).toBe(result);
  await expect(cashRefund(c.id, 4001, key, version)).rejects.toThrow(
    "identyfikator",
  );
  await expect(cashRefund(c.id, 4000, key, version, colleague)).rejects.toThrow(
    "identyfikator",
  );
  await expect(
    cashRefund(c.id, 1, randomUUID(), undefined, owner),
  ).rejects.toThrow("Brak uprawnień");
  await expect(cashRefund(c.id, 6001)).rejects.toThrow("niewykorzystane saldo");
  expect(await evidence()).toEqual(partial);
  await cashRefund(c.id, 6000);
  expect(await balance(c.id)).toMatchObject({
    balance_cents: 0,
    cash_refunded_cents: 10000,
    usable: false,
  });
  const finished = await evidence();
  await expect(cashRefund(c.id, 1)).rejects.toThrow("niewykorzystane saldo");
  expect(await evidence()).toEqual(finished);
  expect((await db.query("select * from public.payments")).rows).toEqual([]);
  expect(
    (await db.query("select * from public.gift_card_sales")).rows,
  ).toHaveLength(1);
});

it("conserves the original sale across spending, cash refunds and later returns from services", async () => {
  const c = await card({ value: 20000 }),
    target = await fitness(),
    payment = await redeem(c.id, target, 10000);
  await change(c.id, "cancel");
  await cashRefund(c.id, 10000);
  expect((await balance(c.id)).balance_cents).toBe(0);
  await rpc(admin, "void_payment", [
    payment,
    "Oddanie użytej wcześniej wartości",
  ]);
  expect(await balance(c.id)).toMatchObject({
    balance_cents: 10000,
    usable: false,
  });
  await cashRefund(c.id, 10000);
  expect(await balance(c.id)).toMatchObject({
    balance_cents: 0,
    cash_refunded_cents: 20000,
    redeemed_cents: 10000,
    returned_cents: 10000,
  });
});

it("never turns an ordinary cash payment refund into card credit", async () => {
  const c = await card(),
    target = await fitness(),
    payment = await rpc<string>(admin, "record_fitness_payment", [
      target,
      10000,
      "cash",
      "Rzeczywista wpłata",
      randomUUID(),
    ]);
  await rpc(admin, "void_payment", [payment, "Rzeczywisty zwrot"]);
  expect(await balance(c.id)).toMatchObject({
    balance_cents: 10000,
    version: 1,
  });
  expect(
    (await db.query("select * from public.gift_card_ledger")).rows,
  ).toHaveLength(1);
});

it("does not allow authenticated table writes or execution of the private credit helpers, even for staff", async () => {
  const c = await card();
  for (const actor of [owner, admin]) {
    await expect(
      asUser(actor, () =>
        db.query("update public.gift_cards set value_cents=20000 where id=$1", [
          c.id,
        ]),
      ),
    ).rejects.toThrow("permission denied");
    await expect(
      asUser(actor, () =>
        db.query("delete from public.gift_card_ledger where card_id=$1", [
          c.id,
        ]),
      ),
    ).rejects.toThrow("permission denied");
    await expect(
      rpc(actor, "gift_card_return_credit", [randomUUID()]),
    ).rejects.toThrow("permission denied");
  }
  for (const table of [
    "gift_card_codes",
    "gift_card_sales",
    "gift_card_history",
    "gift_card_command_receipts",
    "gift_card_service_links",
  ])
    expect(
      (await asUser(owner, () => db.query(`select * from public.${table}`)))
        .rows,
    ).toEqual([]);
  await expect(
    asUser(owner, () =>
      db.query("select * from public.gift_card_claim_limits"),
    ),
  ).rejects.toThrow("permission denied");
  expect((await balance(c.id)).balance_cents).toBe(10000);
});

it("keeps a gifted receipt immutable and refuses reopening it after a completed credit return", async () => {
  const c = await card(),
    target = await fitness(),
    payment = await redeem(c.id, target, 10000);
  for (const fragment of [
    "amount_cents=1",
    "method='cash'",
    "gift_card_id=null",
    `guardian_id='${other}'`,
    "fitness_package_id=null",
    "status='none'",
  ])
    await expect(
      db.query(`update public.payments set ${fragment} where id=$1`, [payment]),
    ).rejects.toThrow("zachowuje kwotę");
  await rpc(admin, "void_payment", [payment, "Całkowity zwrot salda"]);
  const before = await evidence();
  await expect(
    db.query("update public.payments set status='paid' where id=$1", [payment]),
  ).rejects.toThrow("zachowuje kwotę");
  expect(await evidence()).toEqual(before);
});

it("rolls back the service receipt, notices and balance together when the card-ledger insert fails", async () => {
  const c = await card(),
    target = await fitness(),
    before = await evidence();
  await db.exec(
    "create function public.fail_gift_ledger() returns trigger language plpgsql as $$begin if new.kind='redemption' then raise exception 'Fikcyjny błąd salda';end if;return new;end$$;create trigger fail_gift_ledger before insert on public.gift_card_ledger for each row execute function public.fail_gift_ledger();",
  );
  try {
    await expect(redeem(c.id, target, 10000)).rejects.toThrow(
      "Fikcyjny błąd salda",
    );
    expect(await evidence()).toEqual(before);
  } finally {
    await db.exec(
      "drop trigger fail_gift_ledger on public.gift_card_ledger;drop function public.fail_gift_ledger();",
    );
  }
});
