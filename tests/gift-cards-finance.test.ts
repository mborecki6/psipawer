import { expect, it } from "vitest";
import { buildFinanceData, type PaymentRecord } from "../src/lib/finance";
import type {
  GiftCashReturn,
  GiftSaleFinance,
} from "../src/modules/gifts/types";
import type { FitnessRefund } from "../src/modules/fitness/types";
const sale: GiftSaleFinance = {
  card_id: "card",
  amount_cents: 10000,
  method: "transfer",
  note: "Otrzymana wpłata",
  sender_label: "Darczyńca",
  recipient_label: "Obdarowany",
  created_at: "2030-01-01T10:00:00Z",
};
const payment: PaymentRecord = {
  id: "receipt",
  guardian_id: "owner",
  dog_id: "dog",
  registration_id: null,
  package_id: null,
  fitness_package_id: "fitness",
  gift_card_id: "card",
  amount_cents: 10000,
  status: "paid",
  method: "gift_card",
  paid_at: "2030-01-02T10:00:00Z",
  created_at: "2030-01-02T10:00:00Z",
  note: null,
};
function finance(
  payments: PaymentRecord[],
  sales = [sale],
  cashReturns: GiftCashReturn[] = [],
  refunds: FitnessRefund[] = [],
  admin = true,
) {
  return buildFinanceData({
    dogs: [],
    profiles: [],
    walks: [],
    registrations: [],
    packages: [],
    transactions: [],
    payments,
    giftCardSales: sales,
    giftCardCashReturns: cashReturns,
    fitnessRefunds: refunds,
    admin,
  });
}
it("counts a card's confirmed sale once without counting its service credit as a second cash receipt", () => {
  const result = finance([payment]);
  expect(result.totals.paidCents).toBe(10000);
  expect(result.payments).toHaveLength(2);
  expect(result.payments[0]).toMatchObject({
    id: "receipt",
    giftCardId: "card",
    method: "gift_card",
    amountCents: 10000,
    remainingCents: 10000,
  });
  expect(result.payments[1]).toMatchObject({
    id: "gift-sale-card",
    giftCardSale: true,
    giftCardId: "card",
    amountCents: 10000,
    href: "/admin/gifts/card",
  });
});
it("counts a separate cash top-up while preserving the full non-cash service credit", () => {
  const result = finance([
    { ...payment, amount_cents: 4000 },
    {
      ...payment,
      id: "cash",
      amount_cents: 6000,
      method: "cash",
      gift_card_id: null,
    },
  ]);
  expect(result.totals.paidCents).toBe(16000);
  expect(
    result.payments.find((p) => p.id === "cash")?.giftCardId,
  ).toBeUndefined();
});
it("does not subtract a service-credit return from actual money received for the original card", () => {
  const refund: FitnessRefund = {
    id: "part",
    payment_id: "receipt",
    package_id: "fitness",
    amount_cents: 3000,
    note: "Zwrot na kartę",
    created_at: "2030-01-03T10:00:00Z",
  };
  const result = finance([payment], [sale], [], [refund]);
  expect(result.totals.paidCents).toBe(10000);
  expect(result.payments[0]).toMatchObject({
    remainingCents: 7000,
    refundedCents: 3000,
    giftCardId: "card",
  });
});
it("keeps the card sale after a complete service-credit return", () => {
  expect(finance([{ ...payment, status: "refunded" }]).totals.paidCents).toBe(
    10000,
  );
});
it("subtracts only confirmed cash returns for the matching sale and shows a partial refund", () => {
  const result = finance(
    [],
    [sale],
    [
      { card_id: "card", delta_cents: -4000 },
      { card_id: "other", delta_cents: -9999 },
    ],
  );
  expect(result.totals.paidCents).toBe(6000);
  expect(result.payments[0]).toMatchObject({
    status: "paid",
    refundedCents: 4000,
    remainingCents: 6000,
    giftCardSale: true,
  });
});
it("sums partial cash returns without discarding the original sale or creating a false service debt", () => {
  const result = finance(
    [],
    [sale],
    [
      { card_id: "card", delta_cents: -4000 },
      { card_id: "card", delta_cents: -6000 },
    ],
  );
  expect(result.totals).toMatchObject({ paidCents: 0, dueCents: 0 });
  expect(result.payments[0]).toMatchObject({
    amountCents: 10000,
    status: "refunded",
    refundedCents: 10000,
    remainingCents: 0,
  });
});
it("lets a client see their service-credit receipt without disclosing a private sale or inventing their own cash payment", () => {
  const result = finance([payment], [], [], [], false);
  expect(result.payments).toHaveLength(1);
  expect(result.payments[0]).toMatchObject({
    giftCardId: "card",
    method: "gift_card",
  });
  expect(result.totals.paidCents).toBe(0);
});
it("continues counting ordinary retained cash after a partial service refund", () => {
  const refund: FitnessRefund = {
    id: "part",
    payment_id: "receipt",
    package_id: "fitness",
    amount_cents: 3000,
    note: "Pieniądze zwrócone",
    created_at: "2030-01-03T10:00:00Z",
  };
  expect(
    finance(
      [{ ...payment, method: "transfer", gift_card_id: null }],
      [],
      [],
      [refund],
    ).totals.paidCents,
  ).toBe(7000);
});
