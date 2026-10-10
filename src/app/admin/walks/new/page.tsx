import { requireSession } from "@/lib/auth/session";
import { NewWalk } from "@/components/walks";
import { uuid } from "@/lib/validation/schemas";
import { notFound } from "next/navigation";
import { getServices } from "@/modules/services/queries";
import { getBookingChoices } from "@/modules/calendar/booking-queries";
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ copy?: string }>;
}) {
  const { db, user } = await requireSession("admin");
  const { copy } = await searchParams;
  const [{ services }, booking] = await Promise.all([
    getServices(false, "walk"),
    getBookingChoices(db, user.id),
  ]);
  if (!copy) return <NewWalk services={services} booking={booking} />;
  if (!uuid.safeParse(copy).success) notFound();
  const { data: walk, error } = await db
    .from("walks")
    .select("*")
    .eq("id", copy)
    .maybeSingle();
  if (error) throw new Error("Nie udało się odczytać spaceru.");
  if (!walk) notFound();
  const { data: location, error: locationError } = await db
    .from("walk_private_details")
    .select("exact_location,map_url,instructions")
    .eq("walk_id", copy)
    .maybeSingle();
  if (locationError)
    throw new Error("Nie udało się odczytać miejsca spotkania.");
  return (
    <div className="stack">
      <div className="alert">
        Kopiujesz ustawienia spaceru. Wybierz nową datę; zgłoszenia i
        rozliczenia nie będą kopiowane.
      </div>
      <NewWalk
        services={services}
        booking={booking}
        initial={{
          ...walk,
          ...location,
          id: undefined,
          starts_at: undefined,
          updated_at: undefined,
        }}
      />
    </div>
  );
}
