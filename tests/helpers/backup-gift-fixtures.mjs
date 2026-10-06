// Generated gift-card fixtures for the physical local backup rehearsal.
// Codes remain in memory. New financial writes execute only in the restore.
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";

const service = "60000000-0000-4000-8000-000000000006";
const checked = (reply) => {
  assert(!reply.error, "Próbna operacja karty musi zakończyć się poprawnie.");
  return reply.data;
};
function equalPrivate(actual, expected, message) {
  // A failing comparison must not print activation codes or receipt payloads.
  assert.equal(
    JSON.stringify(actual) === JSON.stringify(expected),
    true,
    message,
  );
}
async function snapshot({ owner, staff, specs }) {
  const result = [];
  for (const spec of specs) {
    const api = spec.role === "owner" ? owner : staff;
    result.push({
      ...spec,
      rows: checked(
        await api
          .from(spec.table)
          .select("*")
          .in(spec.key, spec.ids)
          .order(spec.order),
      ),
    });
  }
  return result;
}

export async function prepareBackupGifts({
  staff,
  owner,
  dog,
  guardianId,
  gifts,
  onStage,
}) {
  const retries = [],
    actors = { owner, staff };
  async function rpc(name, args, role = "staff") {
    onStage(`source-gift-${name}`);
    const result = checked(await actors[role].rpc(name, args));
    retries.push({ name, args, role, result });
    return result;
  }
  const get = async (table, id) =>
    checked(await staff.from(table).select("*").eq("id", id).single());
  const terms = await get("services", service);
  const packageId = randomUUID();
  gifts.packages.push(packageId);
  await rpc(
    "request_fitness_package",
    {
      p_id: packageId,
      p_dog: dog,
      p_service: service,
      p_expected_service_version: terms.version,
      p_topic: "Fikcyjna należność kart do kopii",
      p_availability: "Popołudnia",
    },
    "owner",
  );
  await rpc("change_fitness_package", {
    p_id: packageId,
    p_expected_version: 1,
    p_action: "accept",
    p_note: "Własny pakiet karty do odtworzenia",
    p_request_id: randomUUID(),
  });
  async function issue(value, beneficiary) {
    const id = randomUUID(),
      code = randomBytes(20).toString("hex").toUpperCase();
    gifts.cards.push(id);
    await rpc("issue_gift_card", {
      p_id: id,
      p_service: null,
      p_expected_service_version: null,
      p_value_cents: value,
      p_purchased_on: new Intl.DateTimeFormat("en-CA", {
        timeZone: "Europe/Warsaw",
      }).format(new Date()),
      p_sender: "Darczyńca próby odtworzenia",
      p_recipient: "Odbiorca próby odtworzenia",
      p_message: "Fikcyjna karta do sprawdzenia kopii.",
      p_beneficiary: beneficiary,
      p_method: "transfer",
      p_note: "Cała wpłata własnej próby potwierdzona",
      p_code: code,
    });
    return { id, code };
  }
  const active = await issue(25000, null);
  const claim = await rpc("claim_gift_card", { p_code: active.code }, "owner");
  assert.equal(claim.id, active.id);
  active.payment = await rpc("redeem_gift_card", {
    p_card: active.id,
    p_expected_version: (await get("gift_card_balances", active.id)).version,
    p_kind: "fitness",
    p_target: packageId,
    p_amount_cents: 8000,
    p_note: "Zachowane wykorzystanie karty",
    p_request_id: randomUUID(),
  });
  await rpc("refund_fitness_payment", {
    p_payment: active.payment,
    p_amount_cents: 2000,
    p_note: "Zachowany częściowy powrót na kartę",
    p_request_id: randomUUID(),
  });
  const cancelled = await issue(10000, guardianId);
  await rpc("change_gift_card", {
    p_id: cancelled.id,
    p_expected_version: 1,
    p_action: "cancel",
    p_beneficiary: null,
    p_note: "Zachowane wycofanie karty",
    p_request_id: randomUUID(),
  });
  await rpc("refund_gift_card_sale", {
    p_card: cancelled.id,
    p_expected_version: 2,
    p_amount_cents: 3000,
    p_note: "Zachowany częściowy zwrot pieniędzy",
    p_request_id: randomUUID(),
  });
  const spec = (table, key, ids, role = "owner", order = "id") => ({
    table,
    key,
    ids,
    role,
    order,
  });
  const specs = [
    spec("gift_card_balances", "id", gifts.cards),
    spec("gift_card_ledger", "card_id", gifts.cards),
    spec("gift_card_history", "card_id", gifts.cards, "staff"),
    spec("gift_card_codes", "card_id", gifts.cards, "staff", "card_id"),
    spec("gift_card_sales", "card_id", gifts.cards, "staff", "card_id"),
    spec(
      "gift_card_command_receipts",
      "card_id",
      gifts.cards,
      "staff",
      "request_id",
    ),
    spec("payments", "gift_card_id", gifts.cards),
    spec("fitness_balances", "id", gifts.packages),
    spec("fitness_payment_refunds", "package_id", gifts.packages),
  ];
  return {
    active,
    cancelled,
    packageId,
    retries,
    snapshots: await snapshot({ owner, staff, specs }),
  };
}

export async function verifyBackupGifts({
  http,
  json,
  headers,
  owner,
  staff,
  stranger,
  fixture,
  sourceOwner,
  sourceStaff,
  report,
  onStage,
}) {
  const { active, cancelled, packageId, retries, snapshots } = fixture;
  const users = { owner, staff };
  const get = (table, key, ids, user = owner, order = "id") => {
    onStage(`restore-gift-read-${table}`);
    const response = http(
      "rest",
      `/${table}?select=*&${key}=in.(${ids.join(",")})&order=${order}.asc`,
      { headers: headers(user) },
    );
    assert.equal(response.status, 200, "Odtworzony odczyt karty musi działać.");
    return json(response);
  };
  const rpc = (name, args, user = staff) => {
    onStage(`restore-gift-${name}`);
    const response = http("rest", `/rpc/${name}`, {
      method: "POST",
      headers: { ...headers(user), "Content-Type": "application/json" },
      body: args,
    });
    assert.equal(
      response.status,
      200,
      "Odtworzona operacja karty musi działać.",
    );
    return json(response);
  };
  for (const entry of snapshots)
    equalPrivate(
      get(entry.table, entry.key, entry.ids, users[entry.role], entry.order),
      entry.rows,
      "Wszystkie zapisane dane karty muszą być zachowane.",
    );
  for (const table of ["gift_card_balances", "gift_card_ledger", "payments"])
    equalPrivate(
      get(
        table,
        table === "gift_card_balances"
          ? "id"
          : table === "payments"
            ? "gift_card_id"
            : "card_id",
        [active.id, cancelled.id],
        stranger,
      ),
      [],
      "Obcy opiekun nie może czytać karty ani jej rozliczeń.",
    );
  for (const [table, order] of [
    ["gift_card_codes", "card_id"],
    ["gift_card_sales", "card_id"],
    ["gift_card_history", "id"],
    ["gift_card_command_receipts", "request_id"],
  ])
    equalPrivate(
      get(table, "card_id", [active.id, cancelled.id], owner, order),
      [],
      "Opiekun nie może pobrać prywatnego kodu, sprzedaży lub potwierdzeń.",
    );
  const initialActive = get("gift_card_balances", "id", [active.id])[0],
    initialCancelled = get("gift_card_balances", "id", [cancelled.id])[0];
  assert.equal(initialActive.balance_cents, 19000);
  assert.equal(initialActive.status, "active");
  assert.equal(initialCancelled.balance_cents, 7000);
  assert.equal(initialCancelled.cash_refunded_cents, 3000);
  assert.equal(initialCancelled.status, "cancelled");
  const attempt = {
    p_card: active.id,
    p_expected_version: initialActive.version,
    p_kind: "fitness",
    p_target: packageId,
    p_amount_cents: 2000,
    p_note: "Nowe wykorzystanie wyłącznie w odtworzeniu",
    p_request_id: randomUUID(),
  };
  const denied = http("rest", "/rpc/redeem_gift_card", {
    method: "POST",
    headers: { ...headers(owner), "Content-Type": "application/json" },
    body: attempt,
  });
  assert(
    denied.status >= 400,
    "Opiekun nie może samodzielnie rozliczyć salda.",
  );
  const payment = rpc("redeem_gift_card", attempt);
  const refund = {
    p_payment: payment,
    p_amount_cents: 1000,
    p_note: "Nowy częściowy powrót wyłącznie w odtworzeniu",
    p_request_id: randomUUID(),
  };
  const refundResult = rpc("refund_fitness_payment", refund);
  const restore = {
    p_id: cancelled.id,
    p_expected_version: initialCancelled.version,
    p_action: "restore",
    p_beneficiary: null,
    p_note: "Nowy powrót wyłącznie w odtworzeniu",
    p_request_id: randomUUID(),
  };
  const restoreResult = rpc("change_gift_card", restore);
  for (const retry of retries)
    equalPrivate(
      rpc(retry.name, retry.args, users[retry.role]),
      retry.result,
      "Historyczne ponowienie musi zachować wcześniejszy wynik.",
    );
  equalPrivate(
    rpc("redeem_gift_card", attempt),
    payment,
    "Nowa wpłata też nie może się powielić.",
  );
  equalPrivate(
    rpc("refund_fitness_payment", refund),
    refundResult,
    "Nowy zwrot też nie może się powielić.",
  );
  equalPrivate(
    rpc("change_gift_card", restore),
    restoreResult,
    "Nowy powrót musi być jednokrotny.",
  );
  const finalActive = get("gift_card_balances", "id", [active.id])[0],
    finalReturned = get("gift_card_balances", "id", [cancelled.id])[0];
  assert.equal(finalActive.balance_cents, 18000);
  assert.equal(finalActive.value_cents, 25000);
  assert.equal(finalActive.expires_on, initialActive.expires_on);
  assert.equal(finalReturned.status, "active");
  assert.equal(finalReturned.balance_cents, 7000);
  assert.equal(finalReturned.cash_refunded_cents, 3000);
  assert.equal(finalReturned.expires_on, initialCancelled.expires_on);
  assert.equal(get("payments", "fitness_package_id", [packageId]).length, 2);
  assert.equal(get("fitness_balances", "id", [packageId])[0].due_cents, 3000);
  equalPrivate(
    await snapshot({
      owner: sourceOwner,
      staff: sourceStaff,
      specs: snapshots,
    }),
    snapshots,
    "Nowe zapisy odtworzenia nie mogą zmienić żadnego źródłowego wpisu karty.",
  );
  report.gift_restore_verified = {
    cards: 2,
    private_codes: true,
    partial_service_returns: true,
    partial_cash_returns: true,
    preserved_expiry: true,
    rls: true,
    restored_mutations: true,
    historical_retries: retries.length,
    new_retries: 3,
    source_unchanged: true,
  };
}

export async function disposeBackupGifts(db, gifts) {
  if (gifts.packages.length)
    checked(
      await db
        .from("payments")
        .delete()
        .in("fitness_package_id", gifts.packages),
    );
  if (gifts.cards.length)
    checked(await db.from("gift_cards").delete().in("id", gifts.cards));
  if (gifts.packages.length)
    checked(
      await db.from("fitness_packages").delete().in("id", gifts.packages),
    );
}
