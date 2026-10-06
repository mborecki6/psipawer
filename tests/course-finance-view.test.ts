import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
vi.mock("@/lib/domain", async () => import("../src/lib/domain"));
vi.mock(
  "@/lib/finance-pagination",
  async () => import("../src/lib/finance-pagination"),
);
vi.mock("@/modules/courses/money-form", () => ({}));
vi.mock("../src/modules/courses/money-form", () => ({
  CourseMoneyForm: ({ kind }: { kind: string }) =>
    createElement("form", { "data-money-kind": kind }),
}));
vi.mock("@/components/ui", async () => import("../src/components/ui"));
vi.mock("@/lib/data/finance-actions", () => ({
  recordPayment: vi.fn(),
  voidPayment: vi.fn(),
  purchasePackage: vi.fn(),
  usePackage: vi.fn(),
  releasePackage: vi.fn(),
  cancelPackage: vi.fn(),
}));
vi.mock("@/components/action-form", () => ({
  ActionForm: ({ children }: { children: ReactNode }) =>
    createElement("form", null, children),
  Field: () => null,
}));
import { CourseBilling } from "../src/modules/courses/billing";
import { FinanceView } from "../src/components/finance";
import {
  buildFinanceData,
  type CourseBalance,
  type PaymentRecord,
  type CourseRefundRecord,
} from "../src/lib/finance";
import type { Dog } from "../src/lib/data/types";
const balance: CourseBalance = {
  id: "enrollment",
  course_id: "cycle",
  dog_id: "dog",
  guardian_id: "owner",
  course_title: "Przedszkole — grupa pierwsza",
  service_name: "Przedszkole",
  course_status: "open",
  status: "accepted",
  version: 2,
  agreed_price_cents: 10000,
  charge_cents: 10000,
  is_test_price: true,
  created_at: "2030-01-01T10:00:00Z",
  starts_at: "2030-01-15T10:00:00Z",
  settled_at: null,
  paid_cents: 4000,
  refunded_cents: 0,
  due_cents: 6000,
  refund_due_cents: 0,
  needs_review: false,
  needs_settlement: false,
  can_pay: true,
};
const payment: PaymentRecord = {
  id: "receipt",
  guardian_id: "owner",
  dog_id: "dog",
  registration_id: null,
  package_id: null,
  consultation_id: null,
  course_enrollment_id: "enrollment",
  amount_cents: 10000,
  status: "paid",
  method: "transfer",
  paid_at: null,
  created_at: "2030-01-01T10:00:00Z",
  note: "Opłata za kurs",
};
const refund: CourseRefundRecord = {
  id: "refund",
  payment_id: "receipt",
  enrollment_id: "enrollment",
  amount_cents: 7000,
  created_at: "2030-01-02T10:00:00Z",
  note: "Uzgodniony częściowy zwrot",
};
function data(
  b = balance,
  payments: PaymentRecord[] = [],
  courseRefunds: CourseRefundRecord[] = [],
) {
  return buildFinanceData({
    dogs: [{ id: "dog", guardian_id: "new-owner", name: "Figa" } as Dog],
    profiles: [{ id: "owner", full_name: "Pierwotny opiekun" }],
    walks: [],
    registrations: [],
    packages: [],
    transactions: [],
    payments,
    courses: [b],
    courseRefunds,
    admin: true,
  });
}
function billing(
  overrides: Partial<CourseBalance> = {},
  admin = false,
  payments: PaymentRecord[] = [],
  refunds: CourseRefundRecord[] = [],
) {
  return renderToStaticMarkup(
    createElement(CourseBilling, {
      balance: { ...balance, ...overrides },
      admin,
      payments,
      refunds,
    }),
  );
}
it("adds a frozen course debt and a focused destination using the enrollment guardian", () => {
  const result = data();
  expect(result.charges[0]).toMatchObject({
    kind: "course",
    amountCents: 10000,
    dueCents: 6000,
    guardianName: "Pierwotny opiekun",
    href: "/admin/courses/cycle?enrollment=enrollment#rozliczenie-enrollment",
  });
  expect(result.totals.dueCents).toBe(6000);
});
it("shows cancellation awaiting agreement without counting its provisional quote as debt", () => {
  const result = data({
    ...balance,
    status: "cancelled",
    paid_cents: 10000,
    due_cents: 0,
    needs_settlement: true,
    needs_review: true,
    can_pay: false,
  });
  expect(result.charges[0]).toMatchObject({
    reviewReason: "settlement",
    canPay: false,
    dueCents: 0,
  });
  expect(result.totals.dueCents).toBe(0);
  const html = renderToStaticMarkup(
    createElement(FinanceView, { data: result, admin: true }),
  );
  expect(html).toContain("Do uzgodnienia");
  expect(html).toContain("Do zapłaty i uzgodnienia");
  expect(html).not.toContain("Rozlicz należność");
});
it("shows the actual refund due as a review item and computes net retained receipts", () => {
  const result = data(
    {
      ...balance,
      status: "cancelled",
      charge_cents: 2000,
      paid_cents: 3000,
      refunded_cents: 7000,
      due_cents: 0,
      refund_due_cents: 1000,
      needs_review: true,
      can_pay: false,
      settled_at: "2030-01-02T10:00:00Z",
    },
    [payment],
    [refund],
  );
  expect(result.charges[0]).toMatchObject({
    reviewReason: "refund",
    refundDueCents: 1000,
  });
  expect(result.payments[0]).toMatchObject({
    amountCents: 10000,
    refundedCents: 7000,
    remainingCents: 3000,
    title: balance.course_title,
    courseEnrollmentId: "enrollment",
    needsReview: true,
  });
  expect(result.totals).toMatchObject({ dueCents: 0, paidCents: 3000 });
  const html = renderToStaticMarkup(
    createElement(FinanceView, { data: result, admin: true }),
  );
  expect(html).toContain("Historia częściowych zwrotów");
  expect(html).toContain("10,00");
  expect(html).toContain("70,00");
  expect(html).toContain("Odnotuj pełny lub częściowy zwrot w kursie");
});
it("does not subtract full refunds twice or change original receipt amounts", () => {
  const result = data(
    { ...balance, paid_cents: 0, due_cents: 10000, refunded_cents: 10000 },
    [{ ...payment, status: "refunded" }],
    [{ ...refund, amount_cents: 10000 }],
  );
  expect(result.totals.paidCents).toBe(0);
  expect(result.payments[0]).toMatchObject({
    amountCents: 10000,
    remainingCents: 0,
    refundedCents: 10000,
  });
});
it("distinguishes requests, pending settlement, actual refund and a settled zero fee", () => {
  expect(
    billing({
      status: "requested",
      charge_cents: 0,
      due_cents: 0,
      paid_cents: 0,
      can_pay: false,
    }),
  ).toContain("Samo zgłoszenie");
  const pending = billing({
    status: "cancelled",
    due_cents: 0,
    needs_settlement: true,
    needs_review: true,
  });
  expect(pending).toContain("Kwota po rezygnacji do uzgodnienia");
  expect(pending).not.toContain("Opłacone");
  expect(
    billing({
      status: "cancelled",
      charge_cents: 3000,
      paid_cents: 10000,
      due_cents: 0,
      refund_due_cents: 7000,
      needs_review: true,
    }),
  ).toContain("Pozostało do zwrotu");
  expect(
    billing({
      status: "cancelled",
      charge_cents: 0,
      paid_cents: 0,
      due_cents: 0,
    }),
  ).toContain("Brak należności");
  expect(
    billing({
      status: "cancelled",
      charge_cents: 3000,
      paid_cents: 3000,
      due_cents: 0,
    }),
  ).toContain("Rozliczone");
});
it("shows financial forms to staff only and renders each refund to the guardian", () => {
  const staff = billing(
    { status: "cancelled", settled_at: "2030-01-02T10:00:00Z" },
    true,
    [payment],
    [refund],
  );
  expect(staff).toContain('data-money-kind="settlement"');
  expect(staff).toContain('data-money-kind="payment"');
  expect(staff).toContain('data-money-kind="refund"');
  const client = billing({}, false, [payment], [refund]);
  expect(client).not.toContain("data-money-kind");
  expect(client).not.toContain("/admin/");
  expect(client).toContain("Uzgodniony częściowy zwrot");
  expect(client).toContain("Pozostało z wpłaty");
});
