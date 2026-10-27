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
  type FinanceData,
  type FinancePackage,
  type FinanceCharge,
  type FinancePayment,
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

async function readFinanceData(scope: "full" | "dashboard") {
  const { db, role, profile } = await requireSession();
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
    scope === "dashboard"
      ? Promise.resolve([])
      : role === "admin"
        ? allRows<{ id: string; full_name: string }>((a, b) =>
            db.from("profiles").select("id,full_name").order("id").range(a, b),
          )
        : Promise.resolve([{ id: profile.id, full_name: profile.full_name }]),
    allRows<ConsultationBalance>((a, b) =>
      db.from("consultation_balances").select("*").order("id").range(a, b),
    ),
    allRows<CourseBalance>((a, b) =>
      db.from("course_balances").select("*").order("id").range(a, b),
    ),
    scope === "full"
      ? allRows<CourseRefundRecord>((a, b) =>
          db
            .from("course_payment_refunds")
            .select("id,payment_id,enrollment_id,amount_cents,note,created_at")
            .order("id")
            .range(a, b),
        )
      : Promise.resolve([]),
    allRows<FitnessBalance>((a, b) =>
      db.from("fitness_balances").select("*").order("id").range(a, b),
    ),
    scope === "full"
      ? allRows<FitnessRefund>((a, b) =>
          db
            .from("fitness_payment_refunds")
            .select("id,payment_id,package_id,amount_cents,note,created_at")
            .order("id")
            .range(a, b),
        )
      : Promise.resolve([]),
    scope === "full" && role === "admin"
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
    scope === "full" && role === "admin"
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
  const data = buildFinanceData({
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
  return { data, paymentSources: new Map(payments.map((p) => [p.id, p])) };
}

export async function getFinanceData() {
  return (await readFinanceData("full")).data;
}

export type DashboardFinanceSummary = {
  chargeCount: number;
  charges: Pick<
    FinanceCharge,
    | "id"
    | "kind"
    | "dogName"
    | "title"
    | "date"
    | "href"
    | "dueCents"
    | "reviewReason"
    | "refundDueCents"
  >[];
  reviewPayments: (Pick<
    FinancePayment,
    "id" | "dogName" | "title" | "href" | "amountCents" | "paidAt"
  > & { sourceKey: string | null })[];
  totals: Pick<
    FinanceData["totals"],
    "dueCents" | "availableEntries" | "reservedEntries"
  >;
  packages: Pick<
    FinancePackage,
    "id" | "dogName" | "name" | "status" | "available" | "reserved" | "used"
  >[];
};

export async function getDashboardFinanceSummary(): Promise<DashboardFinanceSummary> {
  // Balances, settlement/refund reasons and payment review flags all come from
  // the existing finance model. Refund history changes retained receipts, not
  // these flags; the dashboard neither calculates refunds nor exposes notes.
  const { data, paymentSources } = await readFinanceData("dashboard");
  return {
    chargeCount: data.charges.length,
    charges: data.charges.map((charge) => ({
      id: charge.id,
      kind: charge.kind,
      dogName: charge.dogName,
      title: charge.title,
      date: charge.date,
      href: charge.href,
      dueCents: charge.dueCents,
      reviewReason: charge.reviewReason,
      refundDueCents: charge.refundDueCents,
    })),
    reviewPayments: data.payments
      .filter((payment) => payment.needsReview)
      .map((payment) => {
        const source = paymentSources.get(payment.id);
        return {
          id: payment.id,
          dogName: payment.dogName,
          title: payment.title,
          href: payment.href,
          amountCents: payment.amountCents,
          paidAt: payment.paidAt,
          // Identity is carried alongside the existing review decision. Names
          // and shared walk URLs cannot distinguish two dogs reliably.
          sourceKey: source?.fitness_package_id
            ? `fitness:${source.fitness_package_id}`
            : source?.course_enrollment_id
              ? `course:${source.course_enrollment_id}`
              : source?.consultation_id
                ? `consultation:${source.consultation_id}`
                : source?.registration_id
                  ? `registration:${source.registration_id}`
                  : source?.package_id
                    ? `package:${source.package_id}`
                    : null,
        };
      }),
    totals: {
      dueCents: data.totals.dueCents,
      availableEntries: data.totals.availableEntries,
      reservedEntries: data.totals.reservedEntries,
    },
    packages: data.packages.map((p) => ({
      id: p.id,
      dogName: p.dogName,
      name: p.name,
      status: p.status,
      available: p.available,
      reserved: p.reserved,
      used: p.used,
    })),
  };
}
