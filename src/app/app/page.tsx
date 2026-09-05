import Link from "next/link";
import { getSnapshot } from "@/lib/data/queries";
import { Badge, Empty, WalkRow } from "@/components/ui";
export default async function Page() {
  const { walks, dogs, registrations } = await getSnapshot();
  const accepted = new Set(
    registrations.filter((r) => r.status === "accepted").map((r) => r.walk_id),
  );
  const next = walks.find(
    (w) =>
      accepted.has(w.id) &&
      new Date(w.starts_at) > new Date() &&
      w.status !== "cancelled",
  );
  return (
    <div className="stack">
      <article className="card">
        <div className="card-head">
          <div>
            <h2>Wasz najbliższy spacer</h2>
            <p>Spokojnie, krok po kroku.</p>
          </div>
        </div>
        <div className="card-body">
          {next ? (
            <WalkRow walk={next} base="/app" />
          ) : (
            <Empty
              title="Przed Wami wspólne spacery"
              copy="Wybierz termin i zgłoś swojego psa. Przy zapisach z akceptacją poczekaj na decyzję prowadzącej."
              href="/app/walks"
              action="Zobacz terminy"
            />
          )}
        </div>
      </article>
      <div className="dashboard-grid">
        <article className="card">
          <div className="card-head">
            <h2>Twoje zgłoszenia</h2>
          </div>
          <div className="card-body">
            <div className="list">
              {registrations.map((r) => (
                <Link
                  key={r.id}
                  className="list-row"
                  href={`/app/walks/${r.walk_id}`}
                >
                  <div className="list-main">
                    <strong>{dogs.find((d) => d.id === r.dog_id)?.name}</strong>
                    <span>
                      {walks.find((w) => w.id === r.walk_id)?.public_location}
                    </span>
                  </div>
                  <Badge status={r.status} />
                </Link>
              ))}
            </div>
            {!registrations.length && <p>Nie masz jeszcze zgłoszeń.</p>}
          </div>
        </article>
        <article className="card">
          <div className="card-head">
            <h2>Twoje psy</h2>
            <Link className="ghost-button" href="/app/dogs/new">
              Dodaj psa +
            </Link>
          </div>
          <div className="card-body">
            {dogs.map((d) => (
              <Link key={d.id} className="list-row" href={`/app/dogs/${d.id}`}>
                <div className="list-main">
                  <strong>{d.name}</strong>
                  <span>{d.breed || "Pies jedyny w swoim rodzaju"}</span>
                </div>
                <Badge status={d.status} />
              </Link>
            ))}
            {!dogs.length && <p>Zacznij od dodania profilu swojego psa.</p>}
            <Link className="ghost-button" href="/app/community">
              Poznaj Psiutki →
            </Link>
          </div>
        </article>
      </div>
    </div>
  );
}
