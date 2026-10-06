import "server-only";
import { cache } from "react";
import { requireSession } from "@/lib/auth/session";
import type { Dog, Walk, Registration } from "./types";

export async function allRows<T>(
  query: (
    from: number,
    to: number,
  ) => PromiseLike<{
    data: unknown[] | null;
    error: unknown;
  }>,
): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += 500) {
    const { data, error } = await query(from, from + 499);
    if (error || !data)
      throw new Error("Nie udało się pobrać danych. Spróbuj ponownie.");
    rows.push(...(data as T[]));
    if (data.length < 500) return rows;
  }
}

// Reused by the dashboard and finance during one render only. Avoid fetching
// identical dog, walk and registration pages twice for the same session.
export const getSnapshot = cache(async () => {
  const { db, role, user } = await requireSession();
  const [dogs, walks, registrations] = await Promise.all([
    // Read every page with a unique tie-breaker: counts and upcoming walks
    // must not disappear once the history exceeds the API response limit.
    allRows<Dog>((from, to) =>
      db.from("dogs").select("*").order("name").order("id").range(from, to),
    ),
    allRows<Walk>((from, to) =>
      db
        .from("walks")
        .select("*")
        .order("starts_at")
        .order("id")
        .range(from, to),
    ),
    allRows<Registration>((from, to) =>
      db
        .from("walk_registrations")
        .select("*")
        .order("created_at")
        .order("id")
        .range(from, to),
    ),
  ]);
  return {
    dogs,
    walks,
    registrations,
    role,
    userId: user.id,
  };
});
