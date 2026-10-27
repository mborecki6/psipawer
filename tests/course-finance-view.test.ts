import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
vi.mock("@/lib/domain", async () => import("../src/lib/domain"));
vi.mock(
  "@/lib/finance-pagination",
  async () => import("../src/lib/finance-pagination"),
);
vi.mock("@/modules/courses/money-form", () => ({}));
vi.mock("@/components/use-hydrated", () => ({ useHydrated: () => true }));
vi.mock("@/components/use-persistent-form", () => ({
  usePersistentForm: () => ({ current: null }),
}));
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
  ActionForm: ({ children, label }: { children: ReactNode; label: string }) =>
    createElement("form", null, children, createElement("button", null, label)),
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
it("lets staff record a received course payment within finance after one disclosure", () => {
  const html = renderToStaticMarkup(
    createElement(FinanceView, { data: data(), admin: true }),
  );
  expect(html).toContain(
    'href="/admin/courses/cycle?enrollment=enrollment#rozliczenie-enrollment"',
  );
  expect(html).toContain("Odnotuj wpłatę</span>");
  expect(html).toContain("Odnotuj otrzymaną wpłatę");
  expect(html).toContain('name="target_kind" value="course"');
  expect(html).toContain('name="target_id" value="enrollment"');
  expect(html).toContain('name="amount"');
  expect(html).toContain('value="60,00"');
  expect(html).toContain("Metoda płatności");
  expect(html).toContain("Dodaj notatkę (opcjonalnie)");
  expect(html).toContain("Opis będzie widoczny także dla opiekuna.");
  const note =
    /<textarea id="([^"]+)" aria-describedby="([^"]+)" name="note"/.exec(html);
  expect(note).toBeTruthy();
  expect(html).toContain(
    `<label for="${note![1]}">Notatka (opcjonalnie)</label>`,
  );
  expect(html).toContain(
    `<small id="${note![2]}" class="field-hint">Opis będzie widoczny także dla opiekuna.</small>`,
  );
  expect(html).not.toContain("Odnotuj wpłatę w kursie");
});
it("shows the whole current course charge before any receipt and retains agreed cancellation amounts", () => {
  const initial = renderToStaticMarkup(
    createElement(FinanceView, {
      data: data({ ...balance, paid_cents: 0, due_cents: 10000 }),
      admin: true,
    }),
  );
  expect(initial).toMatch(/Aktualna należność<\/dt><dd>100,00\s*zł/);
  expect(initial).toMatch(/Wpłacono<\/dt><dd>0,00\s*zł/);
  expect(initial).toMatch(/Pozostało<\/dt><dd>100,00\s*zł/);
  const agreed = renderToStaticMarkup(
    createElement(FinanceView, {
      data: data({
        ...balance,
        status: "cancelled",
        settled_at: "2030-01-02T10:00:00Z",
        charge_cents: 7000,
        due_cents: 3000,
      }),
      admin: true,
    }),
  );
  expect(agreed).toMatch(/Aktualna należność<\/dt><dd>70,00\s*zł/);
  expect(agreed).toContain("Odnotuj otrzymaną wpłatę");
  expect(agreed).not.toContain("Cena za cały cykl");
});
it("keeps course receipt entry unavailable to guardians and nonpayable or settled charges", () => {
  const guardian = renderToStaticMarkup(
    createElement(FinanceView, { data: data(), admin: false }),
  );
  expect(guardian).not.toContain('name="target_kind"');
  expect(guardian).not.toContain("Odnotuj otrzymaną wpłatę");
  for (const b of [
    { ...balance, can_pay: false },
    { ...balance, due_cents: 0, paid_cents: 10000 },
  ]) {
    const html = renderToStaticMarkup(
      createElement(FinanceView, { data: data(b), admin: true }),
    );
    expect(html).not.toContain('name="target_kind"');
  }
});
it("does not call a zero balance settled when a projected receipt still needs review", () => {
  const result = data({ ...balance, due_cents: 0, paid_cents: 10000 }, [
    payment,
  ]);
  result.payments[0].needsReview = true;
  const html = renderToStaticMarkup(
    createElement(FinanceView, { data: result, admin: false }),
  );
  expect(html).toContain("Wpłaty do sprawdzenia: 1");
  expect(html).not.toContain("Wszystko rozliczone");
  expect(html).toContain('href="/app/finance#payments"');
  expect(html).toContain('id="payments"');
});
it("keeps an empty guardian finance view compact without removing staff package creation", () => {
  const result = data({ ...balance, due_cents: 0 });
  const guardian = renderToStaticMarkup(
    createElement(FinanceView, { data: result, admin: false }),
  );
  expect(guardian).not.toContain("Twoje pakiety");
  expect(guardian).not.toContain("Historia wpłat");
  expect(guardian).toContain("Brak należności do zapłaty");
  const staff = renderToStaticMarkup(
    createElement(FinanceView, { data: result, admin: true }),
  );
  expect(staff).toContain("Pakiety spacerowe");
  expect(staff).toContain("Dodaj pakiet");
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
  expect(html).not.toContain("Odnotuj otrzymaną wpłatę");
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
  expect(html).not.toContain("Odnotuj otrzymaną wpłatę");
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
