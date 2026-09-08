import Link from "next/link";
import { notFound } from "next/navigation";
import { NewWalk } from "@/components/walks";
import { requireSession } from "@/lib/auth/session";
import { uuid } from "@/lib/validation/schemas";

export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { db } = await requireSession("admin");
  const { id } = await params;
  if (!uuid.safeParse(id).success) notFound();
  const { data: walk, error } = await db
    .from("walks")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error("Nie udało się odczytać spaceru.");
  if (!walk) notFound();
  if (
    ["completed", "cancelled"].includes(walk.status) ||
    new Date(walk.starts_at) <= new Date()
  )
    return (
      <article className="card pad">
        <h2>Ten termin pozostaje w historii</h2>
        <p>Możesz utworzyć podobny spacer z nową datą.</p>
        <Link href={`/admin/walks/new?copy=${id}`} className="primary-button">
          Utwórz podobny termin
        </Link>
      </article>
    );
  const [
    { data: location, error: locationError },
    { count, error: countError },
  ] = await Promise.all([
    db
      .from("walk_private_details")
      .select("exact_location,map_url,instructions")
      .eq("walk_id", id)
      .maybeSingle(),
    db
      .from("walk_registrations")
      .select("id", { count: "exact", head: true })
      .eq("walk_id", id),
  ]);
  if (locationError || countError)
    throw new Error("Nie udało się odczytać szczegółów spaceru.");
  return (
    <div className="stack">
      <Link className="ghost-button" href={`/admin/walks/${id}`}>
        ← Wróć do spaceru
      </Link>
      <NewWalk
        editing
        hasRegistrations={Boolean(count)}
        initial={{ ...walk, ...location }}
      />
    </div>
  );
}
