import Link from "next/link";
import { requireSession } from "@/lib/auth/session";
import { getSnapshot } from "@/lib/data/queries";
import { Badge, Empty } from "@/components/ui";
import { money } from "@/lib/domain";
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string }>;
}) {
  await requireSession("admin");
  const { dogs, walks, registrations } = await getSnapshot();
  const due = (await searchParams).filter === "due";
  const selected = registrations.filter((r) =>
    due ? r.payment_status === "due" : r.payment_status !== "none",
  );
  return (
    <div className="stack">
      <div className="alert">
        Pierwszy etap: podgląd należności ze zgłoszeń. Wprowadzanie wpłat,
        pakiety i historia rozliczeń będą dostępne w kolejnym etapie.
      </div>
      <nav className="filter-tabs">
        <Link
          className={`filter-tab ${!due ? "active" : ""}`}
          href="/admin/finance"
        >
          Wszystkie
        </Link>
        <Link
          className={`filter-tab ${due ? "active" : ""}`}
          href="/admin/finance?filter=due"
        >
          Zaległe płatności
        </Link>
      </nav>
      <article className="card">
        <div className="card-head">
          <h2>{due ? "Do zapłaty" : "Rozliczenia zgłoszeń"}</h2>
        </div>
        <div className="card-body">
          {selected.map((r) => (
            <Link
              key={r.id}
              className="list-row"
              href={`/admin/walks/${r.walk_id}`}
            >
              <div className="list-main">
                <strong>{dogs.find((d) => d.id === r.dog_id)?.name}</strong>
                <span>
                  {walks.find((w) => w.id === r.walk_id)?.public_location}
                </span>
              </div>
              <strong>
                {money(walks.find((w) => w.id === r.walk_id)?.price_cents || 0)}
              </strong>
              <Badge status={r.payment_status} />
            </Link>
          ))}
          {!selected.length && (
            <Empty
              title="Wszystko na bieżąco"
              copy="Brak zgłoszeń do rozliczenia w tym widoku."
            />
          )}
        </div>
      </article>
    </div>
  );
}
