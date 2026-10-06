import "server-only";
import { requireSession } from "@/lib/auth/session";
import {
  buildFinanceData,
  type PackageRecord,
  type PackageTransaction,
  type PaymentRecord,
  type ConsultationBalance,
  type CourseBalance,
  type CourseRefundRecord,
} from "@/lib/finance";
import { getSnapshot } from "./queries";
import type { FitnessBalance, FitnessRefund } from "@/modules/fitness/types";
import type { GiftCashReturn, GiftSale } from "@/modules/gifts/types";
type GiftSaleRow = GiftSale & {
  gift_cards: { sender_label: string; recipient_label: string } | null;
};

// A ledger must never silently stop at the API's default row limit.
async function allRows<T>(
  query: (
    from: number,
    to: number,
  ) => PromiseLike<{ data: unknown[] | null; error: unknown }>,
): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += 500) {
    const result = await query(from, from + 499);
    if (result.error || !result.data)
      throw new Error(
        "Nie udało się pobrać rozliczeń. Odśwież stronę i spróbuj ponownie.",
      );
    rows.push(...(result.data as T[]));
    if (result.data.length < 500) return rows;
  }
}

export async function getFinanceData() {
  const { db, role } = await requireSession();
  const [
    snapshot,
    packages,
    transactions,
    payments,
    profiles,
    consultations,
    courses,
    courseRefunds,
    fitness,
    fitnessRefunds,
    giftSales,
    giftCashReturns,
  ] = await Promise.all([
    getSnapshot(),
    allRows<PackageRecord>((a, b) =>
      db.from("packages").select("*").order("id").range(a, b),
    ),
    allRows<PackageTransaction>((a, b) =>
      db.from("package_transactions").select("*").order("id").range(a, b),
    ),
    allRows<PaymentRecord>((a, b) =>
      db.from("payments").select("*").order("id").range(a, b),
    ),
    allRows<{ id: string; full_name: string }>((a, b) =>
      db.from("profiles").select("id,full_name").order("id").range(a, b),
    ),
    allRows<ConsultationBalance>((a, b) =>
      db.from("consultation_balances").select("*").order("id").range(a, b),
    ),
    allRows<CourseBalance>((a, b) =>
      db.from("course_balances").select("*").order("id").range(a, b),
    ),
    allRows<CourseRefundRecord>((a, b) =>
      db
        .from("course_payment_refunds")
        .select("id,payment_id,enrollment_id,amount_cents,note,created_at")
        .order("id")
        .range(a, b),
    ),
    allRows<FitnessBalance>((a, b) =>
      db.from("fitness_balances").select("*").order("id").range(a, b),
    ),
    allRows<FitnessRefund>((a, b) =>
      db
        .from("fitness_payment_refunds")
        .select("id,payment_id,package_id,amount_cents,note,created_at")
        .order("id")
        .range(a, b),
    ),
    role === "admin"
      ? allRows<GiftSaleRow>((a, b) =>
          db
            .from("gift_card_sales")
            .select(
              "card_id,amount_cents,method,note,created_at,gift_cards(sender_label,recipient_label)",
            )
            .order("card_id")
            .range(a, b),
        )
      : Promise.resolve([] as GiftSaleRow[]),
    role === "admin"
      ? allRows<GiftCashReturn>((a, b) =>
          db
            .from("gift_card_ledger")
            .select("card_id,delta_cents")
            .eq("kind", "cash_refund")
            .order("id")
            .range(a, b),
        )
      : Promise.resolve([] as GiftCashReturn[]),
  ]);
  const { walks, registrations } = snapshot;
  const dogs = [...snapshot.dogs].sort((a, b) =>
    a.name.localeCompare(b.name, "pl"),
  );
  packages.sort((a, b) => b.purchased_at.localeCompare(a.purchased_at));
  transactions.sort((a, b) => b.created_at.localeCompare(a.created_at));
  payments.sort((a, b) => b.created_at.localeCompare(a.created_at));
  return buildFinanceData({
    dogs,
    walks,
    registrations,
    packages,
    transactions,
    payments,
    profiles,
    consultations,
    courses,
    courseRefunds,
    fitness,
    fitnessRefunds,
    giftCardSales: giftSales.map((s) => {
      if (!s.gift_cards)
        throw new Error("Nie udało się pobrać danych sprzedaży karty.");
      return { ...s, ...s.gift_cards };
    }),
    giftCardCashReturns: giftCashReturns,
    admin: role === "admin",
  });
}
