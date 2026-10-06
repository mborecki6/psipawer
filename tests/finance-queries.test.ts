import { beforeEach, expect, it, vi } from "vitest";
import type { ConsultationBalance, CourseBalance } from "../src/lib/finance";
const mocks = vi.hoisted(() => ({ session: vi.fn(), from: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/session", () => ({ requireSession: mocks.session }));
vi.mock("@/lib/finance", async () => import("../src/lib/finance"));
import { getFinanceData } from "../src/lib/data/finance-queries";

const balance: ConsultationBalance = {
  id: "meeting",
  dog_id: "dog",
  status: "scheduled",
  starts_at: "2030-10-10T10:00:00Z",
  created_at: "2030-10-01T10:00:00Z",
  service_name: "Konsultacja",
  agreed_price_cents: 10000,
  is_test_price: true,
  paid_cents: 0,
  due_cents: 10000,
  needs_review: false,
};
let rows: Record<string, unknown[]>;
let failedTable: string;
const ranges: { table: string; from: number; to: number }[] = [];
beforeEach(() => {
  vi.resetAllMocks();
  rows = {
    dogs: [{ id: "dog", name: "Figa", guardian_id: "owner" }],
    profiles: [{ id: "owner", full_name: "Opiekun" }],
    consultation_balances: [balance],
  };
  ranges.length = 0;
  failedTable = "";
  mocks.from.mockImplementation((table: string) => {
    const builder = {
      select: vi.fn(() => builder),
      eq: vi.fn(() => builder),
      order: vi.fn(() => builder),
      range: vi.fn(async (from: number, to: number) => {
        ranges.push({ table, from, to });
        return table === failedTable
          ? { data: null, error: { message: "private error" } }
          : { data: (rows[table] || []).slice(from, to + 1), error: null };
      }),
    };
    return builder;
  });
  mocks.session.mockResolvedValue({
    db: { from: mocks.from },
    role: "client",
    user: { id: "owner" },
  });
});
it("does not fetch private gift-card sales for the client finance view", async () => {
  await getFinanceData();
  expect(mocks.from).not.toHaveBeenCalledWith("gift_card_sales");
  expect(mocks.from).not.toHaveBeenCalledWith("gift_card_ledger");
});
it("loads all confirmed gift sales and cash returns before computing staff cash totals", async () => {
  mocks.session.mockResolvedValue({
    db: { from: mocks.from },
    role: "admin",
    user: { id: "staff" },
  });
  rows.gift_card_sales = Array.from({ length: 1005 }, (_, i) => ({
    card_id: `card-${i}`,
    amount_cents: 10000,
    method: "transfer",
    note: "Potwierdzona wpłata",
    created_at: balance.created_at,
    gift_cards: { sender_label: "Darczyńca", recipient_label: "Obdarowany" },
  }));
  rows.gift_card_ledger = Array.from({ length: 1005 }, (_, i) => ({
    card_id: `card-${i}`,
    delta_cents: -1000,
  }));
  const result = await getFinanceData();
  expect(result.totals.paidCents).toBe(9045000);
  expect(result.payments.filter((p) => p.giftCardSale)).toHaveLength(1005);
  expect(ranges.filter((r) => r.table === "gift_card_sales")).toHaveLength(3);
  expect(ranges.filter((r) => r.table === "gift_card_ledger")).toHaveLength(3);
});
it.each(["gift_card_sales", "gift_card_ledger"])(
  "fails visibly rather than hiding cash receipts when %s fails",
  async (table) => {
    mocks.session.mockResolvedValue({
      db: { from: mocks.from },
      role: "admin",
      user: { id: "staff" },
    });
    failedTable = table;
    await expect(getFinanceData()).rejects.toThrow(
      "Nie udało się pobrać rozliczeń",
    );
  },
);
it("loads balances using the authenticated client and builds guardian destinations", async () => {
  const data = await getFinanceData();
  expect(mocks.session).toHaveBeenCalled();
  expect(mocks.from).toHaveBeenCalledWith("consultation_balances");
  expect(data.charges[0]).toMatchObject({
    kind: "consultation",
    dueCents: 10000,
    href: "/app/consultations/meeting",
    guardianName: "Opiekun",
  });
});
it("does not silently truncate consultation debt at the API row limit", async () => {
  rows.consultation_balances = Array.from({ length: 1005 }, (_, i) => ({
    ...balance,
    id: `meeting-${i}`,
  }));
  const data = await getFinanceData();
  expect(data.charges).toHaveLength(1005);
  expect(data.totals.dueCents).toBe(10050000);
  expect(ranges.filter((r) => r.table === "consultation_balances")).toEqual([
    { table: "consultation_balances", from: 0, to: 499 },
    { table: "consultation_balances", from: 500, to: 999 },
    { table: "consultation_balances", from: 1000, to: 1499 },
  ]);
});
it("fails visibly instead of showing zero debt if the balance query fails", async () => {
  failedTable = "consultation_balances";
  await expect(getFinanceData()).rejects.toThrow(
    "Nie udało się pobrać rozliczeń",
  );
});
it("loads every course balance beyond the row limit, including an unpaid cancellation awaiting agreement", async () => {
  const course: CourseBalance = {
    id: "enrollment",
    course_id: "cycle",
    dog_id: "dog",
    guardian_id: "owner",
    course_title: "Cały kurs",
    service_name: "Kurs",
    course_status: "cancelled",
    status: "cancelled",
    version: 3,
    agreed_price_cents: 10000,
    charge_cents: 10000,
    is_test_price: true,
    created_at: balance.created_at,
    starts_at: balance.starts_at,
    settled_at: null,
    paid_cents: 0,
    refunded_cents: 0,
    due_cents: 0,
    refund_due_cents: 0,
    needs_settlement: true,
    needs_review: true,
    can_pay: false,
  };
  rows.consultation_balances = [];
  rows.course_balances = Array.from({ length: 1005 }, (_, i) => ({
    ...course,
    id: `enrollment-${i}`,
  }));
  const data = await getFinanceData();
  expect(data.charges).toHaveLength(1005);
  expect(
    data.charges.every(
      (c) => c.kind === "course" && c.reviewReason === "settlement",
    ),
  ).toBe(true);
  expect(data.totals.dueCents).toBe(0);
  expect(ranges.filter((r) => r.table === "course_balances")).toEqual([
    { table: "course_balances", from: 0, to: 499 },
    { table: "course_balances", from: 500, to: 999 },
    { table: "course_balances", from: 1000, to: 1499 },
  ]);
});
it("loads all partial refunds before calculating retained receipts", async () => {
  rows.payments = [
    {
      id: "receipt",
      course_enrollment_id: "enrollment",
      guardian_id: "owner",
      dog_id: "dog",
      amount_cents: 10000,
      status: "paid",
      created_at: balance.created_at,
      method: "cash",
    },
  ];
  rows.course_payment_refunds = Array.from({ length: 1005 }, (_, i) => ({
    id: `refund-${i}`,
    enrollment_id: "enrollment",
    payment_id: "receipt",
    amount_cents: 1,
    note: "Korekta",
    created_at: balance.created_at,
  }));
  const data = await getFinanceData();
  expect(data.totals.paidCents).toBe(8995);
  expect(data.payments[0].refunds).toHaveLength(1005);
  expect(
    ranges.filter((r) => r.table === "course_payment_refunds"),
  ).toHaveLength(3);
});
it.each([
  "course_balances",
  "course_payment_refunds",
  "fitness_balances",
  "fitness_payment_refunds",
])("fails visibly when %s is unavailable", async (table) => {
  failedTable = table;
  await expect(getFinanceData()).rejects.toThrow(
    "Nie udało się pobrać rozliczeń",
  );
});
it("loads fitness refunds beyond the API limit and retains the correct module destination", async () => {
  rows.consultation_balances = [];
  rows.fitness_balances = [
    {
      id: "fitness",
      dog_id: "dog",
      guardian_id: "owner",
      service_name: "PSI FITNESS",
      status: "active",
      charge_cents: 10000,
      paid_cents: 8995,
      due_cents: 1005,
      refund_due_cents: 0,
      can_pay: true,
      needs_review: false,
      needs_settlement: false,
      created_at: balance.created_at,
      next_starts_at: balance.starts_at,
    },
  ];
  rows.payments = [
    {
      id: "receipt",
      fitness_package_id: "fitness",
      guardian_id: "owner",
      dog_id: "dog",
      amount_cents: 10000,
      status: "paid",
      created_at: balance.created_at,
      method: "cash",
    },
  ];
  rows.fitness_payment_refunds = Array.from({ length: 1005 }, (_, i) => ({
    id: `refund-${i}`,
    package_id: "fitness",
    payment_id: "receipt",
    amount_cents: 1,
    note: "Korekta",
    created_at: balance.created_at,
  }));
  const data = await getFinanceData();
  expect(data.charges[0]).toMatchObject({
    kind: "fitness",
    dueCents: 1005,
    href: "/app/fitness/fitness#rozliczenie-fitness",
  });
  expect(data.totals.paidCents).toBe(8995);
  expect(data.payments[0].refunds).toHaveLength(1005);
  expect(
    ranges.filter((r) => r.table === "fitness_payment_refunds"),
  ).toHaveLength(3);
});
