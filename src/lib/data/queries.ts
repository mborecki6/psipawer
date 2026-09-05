import "server-only";
import { requireSession } from "@/lib/auth/session";
import type { Dog, Walk, Registration } from "./types";
export async function getSnapshot() {
  const { db, role, user } = await requireSession();
  const [dogs, walks, registrations] = await Promise.all([
    db.from("dogs").select("*").order("name"),
    db.from("walks").select("*").order("starts_at"),
    db.from("walk_registrations").select("*").order("created_at"),
  ]);
  if (dogs.error || walks.error || registrations.error)
    throw new Error("Nie udało się pobrać danych. Spróbuj ponownie.");
  return {
    dogs: dogs.data as Dog[],
    walks: walks.data as Walk[],
    registrations: registrations.data as Registration[],
    role,
    userId: user.id,
  };
}
