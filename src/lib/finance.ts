import type { Dog, Registration, Walk } from "@/lib/data/types";
import type { ConsultationStatus } from "@/modules/consultations/types";
import type { CourseStatus, EnrollmentStatus } from "@/modules/courses/types";
import { financePackageHref } from "./finance-pagination";
import type { FitnessBalance, FitnessRefund } from "@/modules/fitness/types";
import type { GiftSaleFinance, GiftCashReturn } from "@/modules/gifts/types";

export type ConsultationBalance = {
  id: string;
  dog_id: string;
  status: ConsultationStatus;
  starts_at: string | null;
  created_at: string;
  service_name: string | null;
  agreed_price_cents: number | null;
  is_test_price: boolean | null;
  paid_cents: number;
  due_cents: number;
  needs_review: boolean;
};
export type CourseBalance = {
  id: string;
  course_id: string;
  dog_id: string;
  guardian_id: string;
  course_title: string;
  service_name: string;
  course_status: CourseStatus;
  status: EnrollmentStatus;
  version: number;
  agreed_price_cents: number;
  is_test_price: boolean;
  charge_cents: number;
  created_at: string;
  starts_at: string | null;
  settled_at: string | null;
  paid_cents: number;
  refunded_cents: number;
  due_cents: number;
  refund_due_cents: number;
  needs_settlement: boolean;
  needs_review: boolean;
  can_pay: boolean;
};
export type CourseRefundRecord = {
  id: string;
  payment_id: string;
  enrollment_id: string;
  amount_cents: number;
  note: string;
  created_at: string;
};

export type PackageRecord = {
  id: string;
  dog_id: string;
  name: string;
  price_cents: number;
  purchased_at: string;
  expires_at: string | null;
  status: string;
};
export type PackageTransaction = {
  id: string;
  package_id: string;
  available_delta: number;
  reserved_delta: number;
  used_delta: number;
  reason: string;
  registration_id: string | null;
  created_at: string;
};
export type PaymentRecord = {
  id: string;
  dog_id: string | null;
  guardian_id: string;
  registration_id: string | null;
  package_id: string | null;
  amount_cents: number;
  consultation_id?: string | null;
  course_enrollment_id?: string | null;
  fitness_package_id?: string | null;
  gift_card_id?: string | null;
  status: string;
  method: string;
  paid_at: string | null;
  created_at: string;
  note: string | null;
  refunded_at?: string | null;
  refund_note?: string | null;
};
export type FinanceDog = { id: string; name: string; guardianName: string };
export type FinancePackage = {
  id: string;
  dogId: string;
  dogName: string;
  guardianName: string;
  name: string;
  priceCents: number;
  paidCents: number;
  dueCents: number;
  available: number;
  reserved: number;
  used: number;
  purchasedAt: string;
  expiresAt: string | null;
  status: string;
  usable: boolean;
  transactions: PackageTransaction[];
  canCancel: boolean;
  reservations: {
    id: string;
    title: string;
    startsAt: string;
    canRelease: boolean;
  }[];
};
export type FinanceCharge = {
  id: string;
  kind: "registration" | "package" | "consultation" | "course" | "fitness";
  dogId: string;
  dogName: string;
  guardianName: string;
  guardianId?: string;
  title: string;
  date: string;
  href: string;
  amountCents: number;
  paidCents: number;
  dueCents: number;
  canPay: boolean;
  isTestPrice?: boolean;
  reviewReason?: "settlement" | "refund";
  refundDueCents?: number;
  availablePackages: { id: string; name: string; available: number }[];
};
export type FinancePayment = {
  id: string;
  amountCents: number;
  status: string;
  method: string;
  paidAt: string;
  dogName: string;
  guardianName: string;
  title: string;
  note: string | null;
  href?: string;
  needsReview: boolean;
  refundedAt: string | null;
  refundNote: string | null;
  courseEnrollmentId?: string;
  fitnessPackageId?: string;
  refundedCents?: number;
  remainingCents?: number;
  refunds?: (CourseRefundRecord | FitnessRefund)[];
  giftCardId?: string;
  giftCardSale?: boolean;
};
export type FinanceData = {
  dogs: FinanceDog[];
  charges: FinanceCharge[];
  packages: FinancePackage[];
  payments: FinancePayment[];
  totals: {
    dueCents: number;
    paidCents: number;
    availableEntries: number;
    reservedEntries: number;
  };
};

// Parse decimal input directly into grosze; never silently round a payment.
export function parseMoney(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const match = /^(\d{1,5})(?:[.,](\d{1,2}))?$/.exec(value.trim());
  if (!match) return null;
  const cents =
    Number(match[1]) * 100 + Number((match[2] || "").padEnd(2, "0"));
  return cents > 0 && cents <= 1_000_000 ? cents : null;
}

export function buildFinanceData(input: {
  dogs: Dog[];
  walks: Walk[];
  registrations: Registration[];
  packages: PackageRecord[];
  transactions: PackageTransaction[];
  payments: PaymentRecord[];
  consultations?: ConsultationBalance[];
  courses?: CourseBalance[];
  courseRefunds?: CourseRefundRecord[];
  fitness?: FitnessBalance[];
  fitnessRefunds?: FitnessRefund[];
  giftCardSales?: GiftSaleFinance[];
  giftCardCashReturns?: GiftCashReturn[];
  profiles: { id: string; full_name: string }[];
  admin: boolean;
  now?: number;
}): FinanceData {
  const now = input.now ?? Date.now();
  const base = input.admin ? "/admin" : "/app";
  const profiles = new Map(input.profiles.map((p) => [p.id, p.full_name]));
  const dogs = new Map(input.dogs.map((d) => [d.id, d]));
  const walks = new Map(input.walks.map((w) => [w.id, w]));
  const registrations = new Map(input.registrations.map((r) => [r.id, r]));
  const packageRecords = new Map(input.packages.map((p) => [p.id, p]));
  const consultations = new Map(
    (input.consultations || []).map((c) => [c.id, c]),
  );
  const courses = new Map((input.courses || []).map((c) => [c.id, c]));
  const fitness = new Map((input.fitness || []).map((p) => [p.id, p]));
  const refundsByPayment = new Map<
    string,
    (CourseRefundRecord | FitnessRefund)[]
  >();
  for (const refund of [
    ...(input.courseRefunds || []),
    ...(input.fitnessRefunds || []),
  ]) {
    const list = refundsByPayment.get(refund.payment_id) || [];
    list.push(refund);
    refundsByPayment.set(refund.payment_id, list);
  }
  const netReceipt = (p: PaymentRecord) =>
    p.status !== "paid"
      ? 0
      : Math.max(
          0,
          p.amount_cents -
            (p.course_enrollment_id || p.fitness_package_id
              ? (refundsByPayment.get(p.id) || []).reduce(
                  (sum, r) => sum + r.amount_cents,
                  0,
                )
              : 0),
        );
  const dogInfo = (id: string | null) => {
    const dog = id ? dogs.get(id) : undefined;
    return {
      dogName: dog?.name || "Pies",
      guardianName: profiles.get(dog?.guardian_id || "") || "Opiekun",
    };
  };
  const paidFor = (kind: "package_id" | "registration_id", id: string) =>
    input.payments
      .filter((p) => p[kind] === id && p.status === "paid")
      .reduce((sum, p) => sum + p.amount_cents, 0);
  const packages: FinancePackage[] = input.packages.map((p) => {
    const transactions = input.transactions.filter(
      (t) => t.package_id === p.id,
    );
    const balance = transactions.reduce(
      (b, t) => ({
        available: b.available + t.available_delta,
        reserved: b.reserved + t.reserved_delta,
        used: b.used + t.used_delta,
      }),
      { available: 0, reserved: 0, used: 0 },
    );
    const expired = !!p.expires_at && Date.parse(p.expires_at) <= now;
    const paidCents = paidFor("package_id", p.id);
    return {
      id: p.id,
      dogId: p.dog_id,
      ...dogInfo(p.dog_id),
      name: p.name,
      priceCents: p.price_cents,
      paidCents,
      dueCents:
        p.status === "cancelled" ? 0 : Math.max(0, p.price_cents - paidCents),
      ...balance,
      purchasedAt: p.purchased_at,
      expiresAt: p.expires_at,
      status: p.status === "active" && expired ? "expired" : p.status,
      usable: p.status === "active" && !expired && balance.available > 0,
      transactions,
      canCancel:
        p.status !== "cancelled" &&
        balance.reserved === 0 &&
        balance.used === 0,
      reservations: input.registrations
        .filter((r) => r.package_id === p.id && r.status === "accepted")
        .flatMap((r) => {
          const w = walks.get(r.walk_id);
          return w
            ? [
                {
                  id: r.id,
                  title: `${w.type} · ${w.public_location}`,
                  startsAt: w.starts_at,
                  canRelease:
                    r.attendance === "pending" &&
                    Date.parse(w.starts_at) > now &&
                    ["open", "full", "closed"].includes(w.status),
                },
              ]
            : [];
        }),
    };
  });
  const charges: FinanceCharge[] = [];
  for (const r of input.registrations) {
    const w = walks.get(r.walk_id);
    if (
      !w ||
      w.status === "cancelled" ||
      r.package_id ||
      r.attendance === "absent" ||
      !["accepted", "cancelled_late"].includes(r.status) ||
      r.payment_status !== "due"
    )
      continue;
    const paidCents = paidFor("registration_id", r.id);
    const dueCents = Math.max(0, w.price_cents - paidCents);
    if (!dueCents) continue;
    charges.push({
      id: r.id,
      kind: "registration",
      dogId: r.dog_id,
      guardianId: dogs.get(r.dog_id)?.guardian_id,
      ...dogInfo(r.dog_id),
      title: `${w.type} · ${w.public_location}`,
      date: w.starts_at,
      href: `${base}/walks/${w.id}`,
      amountCents: w.price_cents,
      paidCents,
      dueCents,
      canPay: true,
      availablePackages:
        r.status === "accepted" && Date.parse(w.starts_at) > now && !paidCents
          ? packages
              .filter((p) => p.dogId === r.dog_id && p.usable)
              .map((p) => ({ id: p.id, name: p.name, available: p.available }))
          : [],
    });
  }
  for (const p of packages.filter((p) => p.dueCents > 0)) {
    charges.push({
      id: p.id,
      kind: "package",
      dogId: p.dogId,
      guardianId: dogs.get(p.dogId)?.guardian_id,
      dogName: p.dogName,
      guardianName: p.guardianName,
      title: p.name,
      date: p.purchasedAt,
      href: financePackageHref(base, p.id),
      amountCents: p.priceCents,
      paidCents: p.paidCents,
      dueCents: p.dueCents,
      canPay: true,
      availablePackages: [],
    });
  }
  for (const c of consultations.values()) {
    if (c.due_cents <= 0 || c.agreed_price_cents === null) continue;
    charges.push({
      id: c.id,
      kind: "consultation",
      dogId: c.dog_id,
      guardianId: dogs.get(c.dog_id)?.guardian_id,
      ...dogInfo(c.dog_id),
      title: c.service_name || "Konsultacja indywidualna",
      date: c.starts_at || c.created_at,
      href: `${base}/consultations/${c.id}`,
      amountCents: c.agreed_price_cents,
      paidCents: c.paid_cents,
      dueCents: c.due_cents,
      canPay: true,
      isTestPrice: Boolean(c.is_test_price),
      availablePackages: [],
    });
  }
  for (const c of courses.values()) {
    if (c.due_cents <= 0 && !c.needs_review) continue;
    charges.push({
      id: c.id,
      kind: "course",
      dogId: c.dog_id,
      guardianId: c.guardian_id,
      ...dogInfo(c.dog_id),
      guardianName: profiles.get(c.guardian_id) || "Opiekun",
      title: c.course_title,
      date: c.starts_at || c.created_at,
      href: `${base}/courses/${c.course_id}?enrollment=${c.id}#rozliczenie-${c.id}`,
      amountCents: c.charge_cents,
      paidCents: c.paid_cents,
      dueCents: c.due_cents,
      canPay: c.can_pay,
      isTestPrice: c.is_test_price,
      reviewReason: c.needs_settlement
        ? "settlement"
        : c.refund_due_cents > 0
          ? "refund"
          : undefined,
      refundDueCents: c.refund_due_cents,
      availablePackages: [],
    });
  }
  charges.sort((a, b) => a.date.localeCompare(b.date));
  for (const f of fitness.values()) {
    if (f.due_cents <= 0 && !f.needs_review) continue;
    charges.push({
      id: f.id,
      kind: "fitness",
      dogId: f.dog_id,
      guardianId: f.guardian_id,
      ...dogInfo(f.dog_id),
      guardianName: profiles.get(f.guardian_id) || "Opiekun",
      title: f.service_name,
      date: f.next_starts_at || f.created_at,
      href: `${base}/fitness/${f.id}#rozliczenie-${f.id}`,
      amountCents: f.charge_cents,
      paidCents: f.paid_cents,
      dueCents: f.due_cents,
      canPay: f.can_pay,
      isTestPrice: f.is_test_price,
      reviewReason: f.needs_settlement
        ? "settlement"
        : f.refund_due_cents > 0
          ? "refund"
          : undefined,
      refundDueCents: f.refund_due_cents,
      availablePackages: [],
    });
  }
  charges.sort(
    (a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id),
  );
  const payments: FinancePayment[] = input.payments.map((p) => {
    const registration = p.registration_id
      ? registrations.get(p.registration_id)
      : undefined;
    const walk = registration ? walks.get(registration.walk_id) : undefined;
    const consultation = p.consultation_id
      ? consultations.get(p.consultation_id)
      : undefined;
    const course = p.course_enrollment_id
      ? courses.get(p.course_enrollment_id)
      : undefined;
    const fitnessPackage = p.fitness_package_id
      ? fitness.get(p.fitness_package_id)
      : undefined;
    const refunds =
      p.course_enrollment_id || p.fitness_package_id
        ? (refundsByPayment.get(p.id) || []).sort(
            (a, b) =>
              a.created_at.localeCompare(b.created_at) ||
              a.id.localeCompare(b.id),
          )
        : [];
    return {
      id: p.id,
      amountCents: p.amount_cents,
      status: p.status,
      method: p.method,
      ...(p.gift_card_id ? { giftCardId: p.gift_card_id } : {}),
      paidAt: p.paid_at || p.created_at,
      ...dogInfo(p.dog_id),
      guardianName: profiles.get(p.guardian_id) || "Opiekun",
      title: p.fitness_package_id
        ? fitnessPackage?.service_name || "Pakiet PSI FITNESS"
        : p.course_enrollment_id
          ? course?.course_title || "Kurs"
          : p.consultation_id
            ? consultation?.service_name || "Konsultacja indywidualna"
            : p.package_id
              ? packageRecords.get(p.package_id)?.name || "Pakiet"
              : walk
                ? `${walk.type} · ${walk.public_location}`
                : "Wpłata",
      note: p.note,
      href: p.fitness_package_id
        ? `${base}/fitness/${p.fitness_package_id}#rozliczenie-${p.fitness_package_id}`
        : course
          ? `${base}/courses/${course.course_id}?enrollment=${course.id}#rozliczenie-${course.id}`
          : p.consultation_id
            ? `${base}/consultations/${p.consultation_id}`
            : walk
              ? `${base}/walks/${walk.id}`
              : undefined,
      needsReview:
        p.status === "paid" &&
        (fitnessPackage?.needs_review === true ||
          course?.needs_review === true ||
          consultation?.needs_review === true ||
          (!!p.package_id &&
            packageRecords.get(p.package_id)?.status === "cancelled") ||
          (!!registration &&
            (walk?.status === "cancelled" ||
              registration.attendance === "absent" ||
              !["accepted", "cancelled_late"].includes(registration.status)))),
      refundedAt: p.refunded_at || null,
      refundNote: p.refund_note || null,
      ...(p.course_enrollment_id || p.fitness_package_id
        ? {
            ...(p.course_enrollment_id
              ? { courseEnrollmentId: p.course_enrollment_id }
              : { fitnessPackageId: p.fitness_package_id! }),
            refundedCents: refunds.reduce((sum, r) => sum + r.amount_cents, 0),
            remainingCents: netReceipt(p),
            refunds,
          }
        : {}),
    };
  });
  // A card purchase is cash received once. Redeeming its stored value settles
  // a service debt but must not count as a second cash receipt. Returning a
  // service credit does not return cash until a separate card-sale refund.
  const sales = input.giftCardSales || [];
  const returnedCash = new Map<string, number>();
  for (const entry of input.giftCardCashReturns || [])
    returnedCash.set(
      entry.card_id,
      (returnedCash.get(entry.card_id) || 0) - entry.delta_cents,
    );
  for (const sale of sales) {
    const refunded = returnedCash.get(sale.card_id) || 0;
    payments.push({
      id: `gift-sale-${sale.card_id}`,
      giftCardId: sale.card_id,
      giftCardSale: true,
      amountCents: sale.amount_cents,
      method: sale.method,
      status: refunded >= sale.amount_cents ? "refunded" : "paid",
      paidAt: sale.created_at,
      dogName: "Karta podarunkowa",
      guardianName: sale.sender_label,
      title: `Karta dla: ${sale.recipient_label}`,
      note: sale.note || null,
      href: `${base}/gifts/${sale.card_id}`,
      needsReview: false,
      refundedAt: null,
      refundNote: null,
      refundedCents: refunded,
      remainingCents: Math.max(0, sale.amount_cents - refunded),
    });
  }
  if (sales.length)
    payments.sort(
      (a, b) => b.paidAt.localeCompare(a.paidAt) || a.id.localeCompare(b.id),
    );
  return {
    dogs: input.dogs.map((d) => ({
      id: d.id,
      name: d.name,
      guardianName: profiles.get(d.guardian_id) || "Opiekun",
    })),
    charges,
    packages,
    payments,
    totals: {
      dueCents: charges.reduce((sum, c) => sum + c.dueCents, 0),
      paidCents:
        input.payments
          .filter((p) => p.status === "paid" && p.method !== "gift_card")
          .reduce((sum, p) => sum + netReceipt(p), 0) +
        sales.reduce(
          (sum, s) =>
            sum +
            Math.max(0, s.amount_cents - (returnedCash.get(s.card_id) || 0)),
          0,
        ),
      availableEntries: packages
        .filter((p) => p.usable)
        .reduce((sum, p) => sum + p.available, 0),
      reservedEntries: packages.reduce((sum, p) => sum + p.reserved, 0),
    },
  };
}
