export type GiftCard = {
  id: string;
  beneficiary_id: string | null;
  service_id: string | null;
  service_version: number | null;
  service_name: string | null;
  is_test_price: boolean;
  value_cents: number;
  purchased_on: string;
  expires_on: string;
  sender_label: string;
  recipient_label: string;
  message: string;
  status: "active" | "cancelled";
  version: number;
  created_at: string;
  balance_cents: number;
  redeemed_cents: number;
  returned_cents: number;
  cash_refunded_cents: number;
  usable: boolean;
};
export type GiftLedgerEntry = {
  id: string;
  card_id: string;
  kind: "issue" | "redemption" | "return" | "cash_refund";
  delta_cents: number;
  payment_id: string | null;
  note: string;
  created_at: string;
};
export type GiftHistoryEntry = {
  id: string;
  action: string;
  note: string;
  details: Record<string, unknown>;
  created_at: string;
};
export type GiftSale = {
  card_id: string;
  amount_cents: number;
  method: string;
  note: string;
  created_at: string;
};
export type GiftSaleFinance = GiftSale & {
  recipient_label: string;
  sender_label: string;
};
export type GiftCashReturn = Pick<GiftLedgerEntry, "card_id" | "delta_cents">;
export const giftLedgerLabels: Record<GiftLedgerEntry["kind"], string> = {
  issue: "Wystawienie karty",
  redemption: "Wykorzystanie na usługę",
  return: "Zwrot na saldo karty",
  cash_refund: "Zwrot pieniędzy za kartę",
};
export const giftHistoryLabels: Record<string, string> = {
  issued: "Karta wystawiona",
  assigned: "Przypisano opiekuna",
  claimed: "Opiekun aktywował kartę",
  unassigned: "Usunięto przypisanie",
  cancelled: "Karta wycofana",
  restored: "Karta przywrócona",
  redeemed: "Saldo wykorzystane",
  returned: "Saldo przywrócone",
  cash_refunded: "Odnotowano zwrot pieniędzy",
};
export function giftStatus(card: GiftCard, warsawDate: string) {
  if (card.status === "cancelled") return "Wycofana";
  if (card.expires_on < warsawDate) return "Po terminie";
  if (card.balance_cents === 0) return "Saldo wykorzystane";
  if (!card.beneficiary_id) return "Do przypisania";
  return "Gotowa do wykorzystania";
}
