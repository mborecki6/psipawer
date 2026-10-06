import { expect, it } from "vitest";
import {
  buildFinanceData,
  parseMoney,
  type PackageRecord,
  type PaymentRecord,
  type PackageTransaction,
  type ConsultationBalance,
} from "../src/lib/finance";
import type { Dog, Walk, Registration } from "../src/lib/data/types";

const dog = { id: "dog", name: "Luna", guardian_id: "owner" } as Dog;
const walk = {
  id: "walk",
  type: "Spacer",
  public_location: "Park",
  starts_at: "2030-10-10T10:00:00Z",
  price_cents: 6000,
  status: "open",
} as Walk;
const registration = {
  id: "booking",
  walk_id: walk.id,
  dog_id: dog.id,
  status: "accepted",
  payment_status: "due",
  attendance: "pending",
  package_id: null,
} as Registration;
const pack: PackageRecord = {
  id: "package",
  dog_id: dog.id,
  name: "Cztery spacery",
  price_cents: 20000,
  status: "active",
  purchased_at: "2026-09-01T10:00:00Z",
  expires_at: null,
};
const payment = (overrides: Partial<PaymentRecord> = {}): PaymentRecord => ({
  id: "payment",
  guardian_id: "owner",
  dog_id: dog.id,
  registration_id: registration.id,
  package_id: null,
  amount_cents: 2000,
  status: "paid",
  method: "transfer",
  paid_at: "2026-09-08T10:00:00Z",
  created_at: "2026-09-08T10:00:00Z",
  note: "Pierwsza część",
  ...overrides,
});
function fixture(
  overrides: Partial<Parameters<typeof buildFinanceData>[0]> = {},
) {
  return buildFinanceData({
    dogs: [dog],
    walks: [walk],
    registrations: [registration],
    packages: [],
    transactions: [],
    payments: [],
    profiles: [{ id: "owner", full_name: "Opiekun testowy" }],
    admin: true,
    now: Date.parse("2026-09-08T12:00:00Z"),
    ...overrides,
  });
}

it("parses Polish amounts exactly without rounding invalid payments", () => {
  expect(parseMoney(" 12,34 ")).toBe(1234);
  expect(parseMoney("0.01")).toBe(1);
  expect(parseMoney("2,5")).toBe(250);
  expect(parseMoney("10000.00")).toBe(1_000_000);
  for (const value of [
    "",
    "-1",
    "0",
    "1e3",
    "12.345",
    "1,2.3",
    "10000.01",
    "NaN",
    null,
    12,
  ])
    expect(parseMoney(value)).toBeNull();
});
it("shows only remaining cash debt after partial payment and refund, never offers double payment by package", () => {
  const result = fixture({
    payments: [
      payment(),
      payment({ id: "old", status: "refunded", amount_cents: 1000 }),
    ],
  });
  expect(result.totals.dueCents).toBe(4000);
  expect(result.totals.paidCents).toBe(2000);
  expect(result.charges[0]).toMatchObject({
    paidCents: 2000,
    dueCents: 4000,
    availablePackages: [],
  });
  expect(result.payments).toHaveLength(2);
});
it("separates package purchase debt from included walks and derives every credit from the ledger", () => {
  const tx = (
    id: string,
    available_delta: number,
    reserved_delta = 0,
    used_delta = 0,
  ): PackageTransaction => ({
    id,
    package_id: pack.id,
    available_delta,
    reserved_delta,
    used_delta,
    reason: "Operacja",
    registration_id: null,
    created_at: "2026-09-01T10:00:00Z",
  });
  const result = fixture({
    packages: [pack],
    registrations: [
      { ...registration, package_id: pack.id, payment_status: "none" },
    ],
    transactions: [tx("buy", 4), tx("reserve", -1, 1), tx("use", 0, -1, 1)],
    payments: [
      payment({
        package_id: pack.id,
        registration_id: null,
        amount_cents: 10000,
      }),
    ],
  });
  expect(result.charges).toHaveLength(1);
  expect(result.charges[0]).toMatchObject({ kind: "package", dueCents: 10000 });
  expect(result.packages[0]).toMatchObject({
    available: 3,
    reserved: 0,
    used: 1,
  });
  expect(result.totals).toMatchObject({ dueCents: 10000, availableEntries: 3 });
});
it("never counts expired package credits as available and does not offer another dog's package", () => {
  const transactions = [
    {
      id: "buy",
      package_id: pack.id,
      available_delta: 4,
      reserved_delta: 0,
      used_delta: 0,
      reason: "Zakup",
      registration_id: null,
      created_at: pack.purchased_at,
    },
  ];
  const expired = fixture({
    packages: [{ ...pack, expires_at: "2026-09-01T12:00:00Z" }],
    transactions,
  });
  expect(expired.totals.availableEntries).toBe(0);
  expect(expired.packages[0].status).toBe("expired");
  expect(expired.charges[0].availablePackages).toEqual([]);
  const other = fixture({
    packages: [{ ...pack, dog_id: "different" }],
    transactions,
  });
  expect(
    other.charges.find((c) => c.kind === "registration")?.availablePackages,
  ).toEqual([]);
});
it("removes cancelled and excused charges while surfacing received money requiring refund review", () => {
  for (const registrations of [
    [{ ...registration, attendance: "absent" }],
    [{ ...registration, status: "cancelled_on_time" as const }],
  ]) {
    const result = fixture({ registrations, payments: [payment()] });
    expect(result.charges).toEqual([]);
    expect(result.payments[0].needsReview).toBe(true);
  }
  const result = fixture({
    walks: [{ ...walk, status: "cancelled" }],
    payments: [payment()],
  });
  expect(result.charges).toEqual([]);
  expect(result.payments[0].needsReview).toBe(true);
});

const consultation: ConsultationBalance = {
  id: "consultation",
  dog_id: dog.id,
  status: "scheduled",
  starts_at: walk.starts_at,
  created_at: pack.purchased_at,
  service_name: "Konsultacja online",
  agreed_price_cents: 10000,
  is_test_price: true,
  paid_cents: 4000,
  due_cents: 6000,
  needs_review: false,
};
it("combines consultation debt with walk debt, keeping service price, partial receipt and a direct link", () => {
  const result = fixture({
    consultations: [consultation],
    payments: [
      payment({
        registration_id: null,
        consultation_id: consultation.id,
        amount_cents: 4000,
      }),
    ],
  });
  expect(result.charges).toHaveLength(2);
  expect(result.charges.find((c) => c.kind === "consultation")).toMatchObject({
    amountCents: 10000,
    paidCents: 4000,
    dueCents: 6000,
    title: "Konsultacja online",
    dogName: "Luna",
    href: "/admin/consultations/consultation",
    isTestPrice: true,
    availablePackages: [],
  });
  expect(result.totals).toMatchObject({ dueCents: 12000, paidCents: 4000 });
  expect(result.payments[0]).toMatchObject({
    title: "Konsultacja online",
    href: "/admin/consultations/consultation",
    needsReview: false,
  });
});
it("links the guardian to their own consultation and flags cancelled receipts without creating another debt", () => {
  const result = fixture({
    admin: false,
    registrations: [],
    consultations: [
      {
        ...consultation,
        status: "cancelled",
        due_cents: 0,
        needs_review: true,
      },
    ],
    payments: [
      payment({
        registration_id: null,
        consultation_id: consultation.id,
        amount_cents: 4000,
      }),
    ],
  });
  expect(result.charges).toEqual([]);
  expect(result.payments[0]).toMatchObject({
    href: "/app/consultations/consultation",
    needsReview: true,
  });
  expect(result.totals).toMatchObject({ dueCents: 0, paidCents: 4000 });
});
it("does not invent receivables for requested, legacy, paid or cancelled consultation balances", () => {
  const result = fixture({
    registrations: [],
    consultations: [
      {
        ...consultation,
        id: "requested",
        status: "requested",
        due_cents: 0,
        paid_cents: 0,
      },
      {
        ...consultation,
        id: "legacy",
        agreed_price_cents: null,
        due_cents: 0,
        paid_cents: 0,
      },
      { ...consultation, id: "paid", due_cents: 0, paid_cents: 10000 },
      { ...consultation, id: "cancelled", status: "cancelled", due_cents: 0 },
    ],
  });
  expect(result.charges).toEqual([]);
  expect(result.totals.dueCents).toBe(0);
});
