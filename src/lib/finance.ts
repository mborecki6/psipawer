import type { Dog, Registration, Walk } from "@/lib/data/types";

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
  kind: "registration" | "package";
  dogId: string;
  dogName: string;
  guardianName: string;
  title: string;
  date: string;
  href: string;
  amountCents: number;
  paidCents: number;
  dueCents: number;
  canPay: boolean;
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
  needsReview: boolean;
  refundedAt: string | null;
  refundNote: string | null;
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
      dogName: p.dogName,
      guardianName: p.guardianName,
      title: p.name,
      date: p.purchasedAt,
      href: `${base}/finance#package-${p.id}`,
      amountCents: p.priceCents,
      paidCents: p.paidCents,
      dueCents: p.dueCents,
      canPay: true,
      availablePackages: [],
    });
  }
  charges.sort((a, b) => a.date.localeCompare(b.date));
  const payments: FinancePayment[] = input.payments.map((p) => {
    const registration = p.registration_id
      ? registrations.get(p.registration_id)
      : undefined;
    const walk = registration ? walks.get(registration.walk_id) : undefined;
    return {
      id: p.id,
      amountCents: p.amount_cents,
      status: p.status,
      method: p.method,
      paidAt: p.paid_at || p.created_at,
      ...dogInfo(p.dog_id),
      guardianName: profiles.get(p.guardian_id) || "Opiekun",
      title: p.package_id
        ? packageRecords.get(p.package_id)?.name || "Pakiet"
        : walk
          ? `${walk.type} · ${walk.public_location}`
          : "Wpłata",
      note: p.note,
      needsReview:
        p.status === "paid" &&
        ((!!p.package_id &&
          packageRecords.get(p.package_id)?.status === "cancelled") ||
          (!!registration &&
            (walk?.status === "cancelled" ||
              registration.attendance === "absent" ||
              !["accepted", "cancelled_late"].includes(registration.status)))),
      refundedAt: p.refunded_at || null,
      refundNote: p.refund_note || null,
    };
  });
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
      paidCents: input.payments
        .filter((p) => p.status === "paid")
        .reduce((sum, p) => sum + p.amount_cents, 0),
      availableEntries: packages
        .filter((p) => p.usable)
        .reduce((sum, p) => sum + p.available, 0),
      reservedEntries: packages.reduce((sum, p) => sum + p.reserved, 0),
    },
  };
}
