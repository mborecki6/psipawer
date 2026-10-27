import { expect, it } from "vitest";
import {
  buildFinanceData,
  type ConsultationBalance,
  type CourseBalance,
  type PaymentRecord,
} from "../src/lib/finance";
import type { Dog, Registration, Walk } from "../src/lib/data/types";
import type { FitnessBalance } from "../src/modules/fitness/types";

const date = "2030-10-10T10:00:00Z";
const dog = { id: "dog", name: "Figa", guardian_id: "owner" } as Dog;
const walk = {
  id: "walk",
  type: "Spacer",
  public_location: "Park",
  starts_at: date,
  price_cents: 10000,
  status: "open",
} as Walk;
const registration = {
  id: "registration",
  dog_id: dog.id,
  walk_id: walk.id,
  status: "accepted",
  attendance: "pending",
  payment_status: "due",
  package_id: null,
} as Registration;
const consultation: ConsultationBalance = {
  id: "consultation",
  dog_id: dog.id,
  status: "scheduled",
  starts_at: date,
  created_at: date,
  service_name: "Konsultacja",
  agreed_price_cents: 10000,
  is_test_price: false,
  paid_cents: 4000,
  due_cents: 6000,
  needs_review: false,
};
const course: CourseBalance = {
  id: "course-enrollment",
  course_id: "course",
  dog_id: dog.id,
  guardian_id: "owner",
  course_title: "Przedszkole",
  service_name: "Przedszkole",
  course_status: "open",
  status: "accepted",
  version: 1,
  agreed_price_cents: 10000,
  is_test_price: false,
  charge_cents: 10000,
  created_at: date,
  starts_at: date,
  settled_at: null,
  paid_cents: 4000,
  refunded_cents: 0,
  due_cents: 6000,
  refund_due_cents: 0,
  needs_settlement: false,
  needs_review: false,
  can_pay: true,
};
const fitness: FitnessBalance = {
  id: "fitness",
  dog_id: dog.id,
  guardian_id: "owner",
  service_name: "PSI FITNESS",
  status: "active",
  version: 1,
  created_at: date,
  agreed_price_cents: 10000,
  charge_cents: 10000,
  is_test_price: false,
  sessions_count: 4,
  duration_minutes: 45,
  settled_at: null,
  paid_cents: 4000,
  refunded_cents: 0,
  completed_sessions: 0,
  next_starts_at: date,
  due_cents: 6000,
  refund_due_cents: 0,
  needs_settlement: false,
  needs_review: false,
  can_pay: true,
};
const payment: PaymentRecord = {
  id: "receipt",
  guardian_id: "owner",
  dog_id: dog.id,
  registration_id: registration.id,
  package_id: null,
  amount_cents: 4000,
  status: "paid",
  method: "transfer",
  paid_at: date,
  created_at: date,
  note: null,
};

function finance(
  changes: Partial<Parameters<typeof buildFinanceData>[0]> = {},
) {
  return buildFinanceData({
    dogs: [dog],
    walks: [walk],
    registrations: [registration],
    consultations: [consultation],
    courses: [course],
    fitness: [fitness],
    packages: [],
    payments: [payment],
    transactions: [],
    profiles: [{ id: "owner", full_name: "Opiekun" }],
    admin: false,
    now: Date.parse("2026-10-27T12:00:00Z"),
    ...changes,
  });
}

it("qualifies accepted services while keeping the existing 100 minus 40 balance", () => {
  const result = finance();
  expect(result.charges).toHaveLength(4);
  for (const charge of result.charges) {
    expect(charge.onlinePaymentEligible).toBe(true);
    expect(charge.amountCents).toBe(10000);
    expect(charge.paidCents).toBe(4000);
    expect(charge.dueCents).toBe(6000);
  }
  expect(result.totals.dueCents).toBe(24000);
});

it("keeps a late-cancelled walk debt available for manual settlement only", () => {
  const charge = finance({
    registrations: [{ ...registration, status: "cancelled_late" }],
  }).charges.find((charge) => charge.kind === "registration");
  expect(charge).toMatchObject({
    canPay: true,
    dueCents: 6000,
    onlinePaymentEligible: false,
  });
});

it("excludes unaccepted, waiting, rejected, cancelled and settled walks", () => {
  for (const status of [
    "pending",
    "waitlisted",
    "rejected",
    "withdrawn",
    "cancelled_on_time",
  ] as const) {
    expect(
      finance({ registrations: [{ ...registration, status }] }).charges.some(
        (charge) => charge.kind === "registration",
      ),
    ).toBe(false);
  }
  expect(
    finance({ walks: [{ ...walk, status: "cancelled" }] }).charges.some(
      (charge) => charge.kind === "registration",
    ),
  ).toBe(false);
  expect(
    finance({ payments: [{ ...payment, amount_cents: 10000 }] }).charges.some(
      (charge) => charge.kind === "registration",
    ),
  ).toBe(false);
});

it("does not preview unaccepted or cancelled course debts while preserving their amount", () => {
  for (const status of [
    "requested",
    "waitlisted",
    "rejected",
    "cancelled",
  ] as const) {
    const charge = finance({ courses: [{ ...course, status }] }).charges.find(
      (charge) => charge.kind === "course",
    );
    expect(charge).toMatchObject({
      dueCents: 6000,
      onlinePaymentEligible: false,
    });
  }
  expect(
    finance({
      courses: [{ ...course, course_status: "cancelled" }],
    }).charges.find((charge) => charge.kind === "course")
      ?.onlinePaymentEligible,
  ).toBe(false);
});

it("keeps declined or cancelled fitness debts out of the preview", () => {
  for (const status of ["requested", "rejected", "cancelled"] as const) {
    expect(
      finance({ fitness: [{ ...fitness, status }] }).charges.find(
        (charge) => charge.kind === "fitness",
      ),
    ).toMatchObject({ dueCents: 6000, onlinePaymentEligible: false });
  }
});

it("excludes unknown prices, review balances and walking package purchases", () => {
  const result = finance({
    consultations: [{ ...consultation, agreed_price_cents: null }],
    courses: [{ ...course, needs_review: true, needs_settlement: true }],
    fitness: [{ ...fitness, needs_review: true, refund_due_cents: 1000 }],
    packages: [
      {
        id: "walking-package",
        dog_id: dog.id,
        name: "Pakiet spacerów",
        price_cents: 10000,
        purchased_at: date,
        expires_at: null,
        status: "active",
      },
    ],
  });
  expect(result.charges.some((charge) => charge.kind === "consultation")).toBe(
    false,
  );
  for (const kind of ["course", "fitness", "package"])
    expect(
      result.charges.find((charge) => charge.kind === kind)
        ?.onlinePaymentEligible,
    ).toBe(false);
});

it("retains accepted completed services as eligible debts", () => {
  const result = finance({
    walks: [{ ...walk, status: "completed" }],
    consultations: [{ ...consultation, status: "completed" }],
    courses: [{ ...course, course_status: "completed" }],
    fitness: [{ ...fitness, status: "completed" }],
  });
  expect(result.charges).toHaveLength(4);
  expect(result.charges.every((charge) => charge.onlinePaymentEligible)).toBe(
    true,
  );
});
