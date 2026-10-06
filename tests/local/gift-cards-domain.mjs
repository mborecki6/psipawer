// Rehearse the pending gift-card schema using independent real PostgreSQL
// sessions in a generated, labelled database on this project's local VM.
// No Auth/API credentials, environment files or source-data mutations.
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { after, before, beforeEach, test } from "node:test";
import {
  LocalPostgres,
  literal,
  waitForLock,
} from "../helpers/local-postgres.mjs";

const run = randomUUID(),
  database = `psi_gift_${run.replaceAll("-", "")}`,
  label = `psi-gift-fixture:${run}`;
const admin = "d3100000-0000-4000-8000-000000000001",
  owner = "d3100000-0000-4000-8000-000000000002",
  other = "d3100000-0000-4000-8000-000000000003";
const dog = "d3200000-0000-4000-8000-000000000001",
  dog2 = "d3200000-0000-4000-8000-000000000002";
const service = "60000000-0000-4000-8000-000000000006";
let source,
  observer,
  baseline,
  created = false,
  observedLocks = 0;
const originalState = () =>
  source.json(`select json_build_object(
  'databases',(select jsonb_agg(datname order by datname) from pg_database),
  'accounts',(select jsonb_agg(id order by id) from auth.users),
  'dogs',(select jsonb_agg(to_jsonb(d) order by id) from public.dogs d),
  'services',(select jsonb_agg(to_jsonb(s) order by id) from public.services s),
  'migrations',(select jsonb_agg(version order by version) from supabase_migrations.schema_migrations));`);
before(async () => {
  source = await new LocalPostgres().ready();
  baseline = await originalState();
  assert(!baseline.databases.includes(database));
  await source.query(`create database "${database}";`);
  created = true;
  await source.query(`comment on database "${database}" is ${literal(label)};`);
  observer = await new LocalPostgres({ database }).ready();
  await observer.query(`create schema auth;
    create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,encrypted_password text);
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    grant usage on schema public,auth to anon,authenticated;grant execute on function auth.uid() to anon,authenticated;
    create schema storage;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
    create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text);
    alter table storage.objects enable row level security;
    create function storage.foldername(name text) returns text[] language sql as $$select string_to_array(name,'/')$$;
    grant usage on schema storage to authenticated;grant select,insert,delete on storage.objects to authenticated;`);
  for (const file of readdirSync("supabase/migrations")
    .filter((f) => /^\d{12}_.+\.sql$/.test(f))
    .sort())
    await observer.query(readFileSync(`supabase/migrations/${file}`, "utf8"));
  await observer.query(`insert into auth.users(id,email) values(${literal(admin)},'gift-admin@example.test'),(${literal(owner)},'gift-owner@example.test'),(${literal(other)},'gift-other@example.test');
    update public.user_roles set role='admin' where user_id=${literal(admin)};
    insert into public.dogs(id,guardian_id,name) values(${literal(dog)},${literal(owner)},'Fikcyjny pies karty'),(${literal(dog2)},${literal(owner)},'Drugi fikcyjny pies karty');
    update public.dogs set status='approved';`);
});
beforeEach(async () => {
  await observer.query(`truncate public.payments cascade;truncate public.gift_cards cascade;truncate public.fitness_packages cascade;truncate public.walks cascade;
    delete from public.gift_card_claim_limits;delete from public.audit_events;
    update public.dogs set guardian_id=${literal(owner)},status='approved';`);
});
after(async () => {
  try {
    await observer?.close();
    if (created) {
      const owned =
        await source.json(`select to_json(shobj_description(oid,'pg_database')) from pg_database
        where datname=${literal(database)} and datdba=(select oid from pg_roles where rolname='postgres');`);
      assert.equal(owned, label, "Do not remove an unrecognised database");
      await source.query(`drop database "${database}";`);
    }
    if (baseline) assert.deepEqual(await originalState(), baseline);
    console.log(
      `Gift-card PostgreSQL: ${observedLocks} observed lock dependencies; owned database removed; source accounts, dogs, services and migrations preserved.`,
    );
  } finally {
    await source?.close();
  }
});

async function operation(actor, sql) {
  const c = await new LocalPostgres({ database }).ready();
  try {
    await c.asUser(actor);
    const result = await c.json(sql);
    await c.query("commit;");
    return result;
  } finally {
    await c.close();
  }
}
// Hold a finished first statement open and observe the second waiting on that
// actual backend. This proves concurrency, rather than relying on Promise.all.
async function race(firstActor, firstSQL, secondActor, secondSQL) {
  const holder = await new LocalPostgres({ database }).ready(),
    waiter = await new LocalPostgres({ database }).ready();
  let pending;
  try {
    if (firstActor) await holder.asUser(firstActor);
    else await holder.query("begin;");
    const first = await holder.json(firstSQL);
    if (secondActor) await waiter.asUser(secondActor);
    else await waiter.query("begin;");
    pending = waiter.json(secondSQL).then(
      (value) => ({ value }),
      (error) => ({ error }),
    );
    await waitForLock(observer, holder, waiter);
    observedLocks++;
    await holder.query("commit;");
    const second = await pending;
    if (!second.error) await waiter.query("commit;");
    return { first, second };
  } finally {
    await holder.close();
    await waiter.close();
    if (pending) await pending;
  }
}
const refused = (r, pattern) =>
  assert.match(r.second.error?.message || "", pattern);
const cardBalance = (id) =>
  observer.json(
    `select to_jsonb(b) from public.gift_card_balances b where id=${literal(id)};`,
  );
const due = (id) =>
  observer.json(
    `select to_json(due_cents) from public.fitness_balances where id=${literal(id)};`,
  );
const paymentCount = () =>
  observer.json("select to_json(count(*)) from public.payments;");
const redeemSQL = (
  id,
  target,
  amount = 6000,
  version = 1,
  key = randomUUID(),
  kind = "fitness",
) =>
  `select to_json(public.redeem_gift_card(${literal(id)},${version},${literal(kind)},${literal(target)},${amount},'Fikcyjne wykorzystanie',${literal(key)}));`;
const changeSQL = (
  id,
  version,
  action,
  beneficiary = null,
  key = randomUUID(),
) =>
  `select to_json(public.change_gift_card(${literal(id)},${version},${literal(action)},${beneficiary ? literal(beneficiary) : "null"},'Fikcyjna decyzja karty',${literal(key)}));`;
const claimSQL = (code) => `select public.claim_gift_card(${literal(code)});`;
const returnSQL = (payment, amount = 3000, key = randomUUID()) =>
  `select to_json(public.refund_fitness_payment(${literal(payment)},${amount},'Fikcyjny zwrot na kartę',${literal(key)}));`;
const cashRefundSQL = (id, version, amount = 6000, key = randomUUID()) =>
  `select to_json(public.refund_gift_card_sale(${literal(id)},${version},${amount},'Fikcyjny zwrot pieniędzy',${literal(key)}));`;
async function card({
  value = 10000,
  beneficiary = owner,
  specificService = null,
} = {}) {
  const id = randomUUID(),
    code = randomBytes(20).toString("hex").toUpperCase();
  const version = specificService
    ? await observer.json(
        `select to_json(version) from public.services where id=${literal(specificService)};`,
      )
    : null;
  const sql = `select to_json(public.issue_gift_card(${literal(id)},${specificService ? literal(specificService) : "null"},${version ?? "null"},${value},
    (clock_timestamp() at time zone 'Europe/Warsaw')::date,'Fikcyjny darczyńca','Fikcyjny odbiorca','Dobrego wspólnego czasu',${beneficiary ? literal(beneficiary) : "null"},'transfer','Fikcyjna potwierdzona wpłata',${literal(code)}));`;
  assert.equal(await operation(admin, sql), id);
  return { id, code, sql };
}
async function fitness(dogId = dog) {
  const id = randomUUID(),
    version = await observer.json(
      `select to_json(version) from public.services where id=${literal(service)};`,
    );
  await operation(
    owner,
    `select to_json(public.request_fitness_package(${literal(id)},${literal(dogId)},${literal(service)},${version},'Fikcyjny cel','Fikcyjne popołudnia'));`,
  );
  await operation(
    admin,
    `select to_json(public.change_fitness_package(${literal(id)},1,'accept','Fikcyjna decyzja',${literal(randomUUID())}));`,
  );
  return id;
}
async function unchangedExcept(sql, runOperation) {
  const before = await observer.json(sql);
  await runOperation();
  assert.deepEqual(await observer.json(sql), before);
}

test("two different debts cannot spend the same card twice after a card-row wait", async () => {
  const c = await card(),
    firstTarget = await fitness(),
    secondTarget = await fitness(dog2);
  const r = await race(
    admin,
    redeemSQL(c.id, firstTarget),
    admin,
    redeemSQL(c.id, secondTarget),
  );
  refused(r, /Karta zmieniła/);
  assert.equal(await paymentCount(), 1);
  assert.equal((await cardBalance(c.id)).balance_cents, 4000);
  assert.equal(await due(firstTarget), 4000);
  assert.equal(await due(secondTarget), 10000);
  assert.equal(
    await observer.json(
      "select to_json(count(*)) from public.fitness_history where action='payment_recorded';",
    ),
    1,
  );
  assert.equal(
    await observer.json(
      "select to_json(count(*)) from public.notifications where kind='fitness_payment_recorded';",
    ),
    1,
  );
});
test("identical simultaneous redemption retries return one receipt after their advisory wait", async () => {
  const c = await card(),
    target = await fitness(),
    key = randomUUID(),
    sql = redeemSQL(c.id, target, 10000, 1, key);
  const r = await race(admin, sql, admin, sql);
  assert.equal(r.second.value, r.first);
  assert.equal(await paymentCount(), 1);
  assert.equal((await cardBalance(c.id)).balance_cents, 0);
  assert.equal(
    await observer.json(
      "select to_json(count(*)) from public.gift_card_ledger where kind='redemption';",
    ),
    1,
  );
});
test("a shared gift request key for different debts rejects the loser before writing its source", async () => {
  const c = await card(),
    a = await fitness(),
    b = await fitness(dog2),
    key = randomUUID();
  const r = await race(
    admin,
    redeemSQL(c.id, a, 6000, 1, key),
    admin,
    redeemSQL(c.id, b, 6000, 1, key),
  );
  refused(r, /identyfikator operacji/);
  assert.equal(await paymentCount(), 1);
  assert.equal(await due(b), 10000);
  assert.equal((await cardBalance(c.id)).balance_cents, 4000);
});
test("two cards racing to cover one debt cannot produce an overpayment", async () => {
  const a = await card(),
    b = await card(),
    target = await fitness();
  const r = await race(
    admin,
    redeemSQL(a.id, target),
    admin,
    redeemSQL(b.id, target),
  );
  refused(r, /pozostałą kwotę do zapłaty/);
  assert.equal(await paymentCount(), 1);
  assert.equal((await cardBalance(a.id)).balance_cents, 4000);
  assert.equal((await cardBalance(b.id)).balance_cents, 10000);
  assert.equal(await due(target), 4000);
});
for (const withdrawalFirst of [true, false])
  test(`withdrawal and redemption serialize (${withdrawalFirst ? "withdrawal" : "redemption"} first)`, async () => {
    const c = await card(),
      target = await fitness();
    const withdrawal = changeSQL(c.id, 1, "cancel"),
      spend = redeemSQL(c.id, target);
    const r = await race(
      admin,
      withdrawalFirst ? withdrawal : spend,
      admin,
      withdrawalFirst ? spend : withdrawal,
    );
    refused(r, /Karta zmieniła/);
    const b = await cardBalance(c.id);
    assert.equal(b.status, withdrawalFirst ? "cancelled" : "active");
    assert.equal(b.balance_cents, withdrawalFirst ? 10000 : 4000);
    assert.equal(await paymentCount(), withdrawalFirst ? 0 : 1);
  });
for (const reassignmentFirst of [true, false])
  test(`reassignment and spending serialize (${reassignmentFirst ? "reassignment" : "spending"} first)`, async () => {
    const c = await card(),
      target = await fitness(),
      assign = changeSQL(c.id, 1, "assign", other),
      spend = redeemSQL(c.id, target);
    const r = await race(
      admin,
      reassignmentFirst ? assign : spend,
      admin,
      reassignmentFirst ? spend : assign,
    );
    refused(r, /Karta zmieniła/);
    const b = await cardBalance(c.id);
    assert.equal(b.beneficiary_id, reassignmentFirst ? other : owner);
    assert.equal(b.balance_cents, reassignmentFirst ? 10000 : 4000);
    assert.equal(await paymentCount(), reassignmentFirst ? 0 : 1);
  });
test("two guardians claiming one bearer code have exactly one beneficiary", async () => {
  const c = await card({ beneficiary: null });
  const r = await race(owner, claimSQL(c.code), other, claimSQL(c.code));
  assert.deepEqual(r.first, { id: c.id });
  assert.match(r.second.value?.error || "", /Sprawdź kod/);
  assert.equal((await cardBalance(c.id)).beneficiary_id, owner);
  assert.equal(
    await observer.json(
      "select to_json(count(*)) from public.gift_card_history where action='claimed';",
    ),
    1,
  );
  assert.equal(
    await operation(
      other,
      "select to_json(count(*)) from public.gift_card_balances;",
    ),
    0,
  );
});
test("an identical claim retry waits and returns the already claimed card without duplicate history", async () => {
  const c = await card({ beneficiary: null });
  const r = await race(owner, claimSQL(c.code), owner, claimSQL(c.code));
  assert.deepEqual(r.first, { id: c.id });
  assert.deepEqual(r.second.value, r.first);
  assert.equal((await cardBalance(c.id)).version, 2);
  assert.equal(
    await observer.json(
      "select to_json(count(*)) from public.gift_card_history where action='claimed';",
    ),
    1,
  );
});
for (const returnFirst of [true, false])
  test(`service return and spending another debt serialize (${returnFirst ? "return" : "spending"} first)`, async () => {
    const c = await card({ value: 20000 }),
      a = await fitness(),
      b = await fitness(dog2),
      payment = await operation(admin, redeemSQL(c.id, a, 10000));
    const refund = returnSQL(payment),
      spend = redeemSQL(c.id, b, 6000, 2);
    const r = await race(
      admin,
      returnFirst ? refund : spend,
      admin,
      returnFirst ? spend : refund,
    );
    if (returnFirst) {
      refused(r, /Karta zmieniła/);
      assert.equal(await paymentCount(), 1);
      assert.equal(await due(b), 10000);
    } else {
      assert.equal(typeof r.second.value, "string");
      assert.equal(await paymentCount(), 2);
      assert.equal(await due(b), 4000);
    }
    assert.equal(
      (await cardBalance(c.id)).balance_cents,
      returnFirst ? 13000 : 7000,
    );
    assert.equal(await due(a), 3000);
  });
test("competing partial returns cannot create more card value than the original credit", async () => {
  const c = await card(),
    target = await fitness(),
    payment = await operation(admin, redeemSQL(c.id, target, 10000));
  const r = await race(
    admin,
    returnSQL(payment, 6000),
    admin,
    returnSQL(payment, 6000),
  );
  refused(r, /pozostałą kwotę wpłaty/);
  assert.equal((await cardBalance(c.id)).balance_cents, 6000);
  assert.equal(
    await observer.json(
      "select to_json(count(*)) from public.fitness_payment_refunds;",
    ),
    1,
  );
  assert.equal(
    await observer.json(
      "select to_json(count(*)) from public.gift_card_ledger where kind='return';",
    ),
    1,
  );
});
test("identical service-return retries credit the card once after waiting on their source", async () => {
  const c = await card(),
    target = await fitness(),
    payment = await operation(admin, redeemSQL(c.id, target, 10000)),
    sql = returnSQL(payment, 10000);
  const r = await race(admin, sql, admin, sql);
  assert.equal(r.second.value, r.first);
  assert.equal((await cardBalance(c.id)).balance_cents, 10000);
  assert.equal(
    await observer.json(
      "select to_json(count(*)) from public.gift_card_ledger where kind='return';",
    ),
    1,
  );
});
test("competing confirmed cash refunds preserve the remaining balance after a card-row wait", async () => {
  const c = await card();
  await operation(admin, changeSQL(c.id, 1, "cancel"));
  const r = await race(
    admin,
    cashRefundSQL(c.id, 2),
    admin,
    cashRefundSQL(c.id, 2),
  );
  refused(r, /Karta zmieniła/);
  assert.equal((await cardBalance(c.id)).balance_cents, 4000);
  assert.equal(
    await observer.json(
      "select to_json(count(*)) from public.gift_card_ledger where kind='cash_refund';",
    ),
    1,
  );
  assert.equal(await paymentCount(), 0);
});
test("identical cash-refund retries return the same confirmation rather than taking value twice", async () => {
  const c = await card();
  await operation(admin, changeSQL(c.id, 1, "cancel"));
  const sql = cashRefundSQL(c.id, 2),
    r = await race(admin, sql, admin, sql);
  assert.equal(r.second.value, r.first);
  assert.equal((await cardBalance(c.id)).balance_cents, 4000);
  assert.equal(
    await observer.json(
      "select to_json(count(*)) from public.gift_card_ledger where kind='cash_refund';",
    ),
    1,
  );
});
for (const returnFirst of [true, false])
  test(`cash and service returns serialize (${returnFirst ? "service" : "cash"} first)`, async () => {
    const c = await card({ value: 20000 }),
      target = await fitness(),
      payment = await operation(admin, redeemSQL(c.id, target, 10000));
    await operation(admin, changeSQL(c.id, 2, "cancel"));
    const refund = returnSQL(payment, 10000),
      cash = cashRefundSQL(c.id, 3, 10000);
    const r = await race(
      admin,
      returnFirst ? refund : cash,
      admin,
      returnFirst ? cash : refund,
    );
    if (returnFirst) refused(r, /Karta zmieniła/);
    else assert.equal(typeof r.second.value, "string");
    const b = await cardBalance(c.id);
    assert.equal(b.balance_cents, returnFirst ? 20000 : 10000);
    assert.equal(b.returned_cents, 10000);
    assert.equal(b.cash_refunded_cents, returnFirst ? 0 : 10000);
    assert.equal(b.status, "cancelled");
  });
test("failed ledger insertion leaves the source, receipt, notices and card untouched in real PostgreSQL", async () => {
  const c = await card(),
    target = await fitness();
  const sql = `select json_build_object(
    'card',(select to_jsonb(b) from public.gift_card_balances b where id=${literal(c.id)}),
    'source',(select to_jsonb(p) from public.fitness_packages p where id=${literal(target)}),
    'payments',(select jsonb_agg(to_jsonb(p) order by id) from public.payments p),
    'receipts',(select jsonb_agg(to_jsonb(p) order by request_id) from public.gift_card_command_receipts p),
    'history',(select jsonb_agg(to_jsonb(p) order by id) from public.fitness_history p),
    'notices',(select jsonb_agg(to_jsonb(p) order by id) from public.notifications p));`;
  await observer.query(`create function public.fail_gift_ledger() returns trigger language plpgsql as $$begin if new.kind='redemption' then raise exception 'Fikcyjny błąd salda';end if;return new;end$$;
    create trigger fail_gift_ledger before insert on public.gift_card_ledger for each row execute function public.fail_gift_ledger();`);
  try {
    await unchangedExcept(sql, async () =>
      assert.rejects(
        operation(admin, redeemSQL(c.id, target)),
        /Fikcyjny błąd salda/,
      ),
    );
  } finally {
    await observer.query(
      "drop trigger fail_gift_ledger on public.gift_card_ledger;drop function public.fail_gift_ledger();",
    );
  }
});
