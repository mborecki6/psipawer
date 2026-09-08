import "server-only";
import { requireSession } from "@/lib/auth/session";
import {
  buildFinanceData,
  type PackageRecord,
  type PackageTransaction,
  type PaymentRecord,
} from "@/lib/finance";
import type { Dog, Walk, Registration } from "./types";

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
    dogs,
    walks,
    registrations,
    packages,
    transactions,
    payments,
    profiles,
  ] = await Promise.all([
    allRows<Dog>((a, b) => db.from("dogs").select("*").order("id").range(a, b)),
    allRows<Walk>((a, b) =>
      db.from("walks").select("*").order("id").range(a, b),
    ),
    allRows<Registration>((a, b) =>
      db.from("walk_registrations").select("*").order("id").range(a, b),
    ),
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
  ]);
  dogs.sort((a, b) => a.name.localeCompare(b.name, "pl"));
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
    admin: role === "admin",
  });
}
