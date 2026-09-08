import Link from "next/link";
import { getSnapshot } from "@/lib/data/queries";
import { Badge, Empty, WalkRow } from "@/components/ui";
import { getQualificationWarnings } from "@/lib/qualification";
import { QualificationAlerts } from "@/components/qualification-alert";
import { getFinanceData } from "@/lib/data/finance-queries";
import { money } from "@/lib/domain";
export default async function Page() {
  const [{ walks, dogs, registrations }, finance] = await Promise.all([
    getSnapshot(),
    getFinanceData(),
  ]);
  const accepted = new Set(
    registrations.filter((r) => r.status === "accepted").map((r) => r.walk_id),
  );
  const next = walks.find(
    (w) =>
      accepted.has(w.id) &&
      new Date(w.starts_at) > new Date() &&
      w.status !== "cancelled",
  );
  const cancelled = walks.filter(
    (w) =>
      w.status === "cancelled" &&
      new Date(w.starts_at) > new Date() &&
      registrations.some((r) => r.walk_id === w.id),
  );
  return (
    <div className="stack">
      <QualificationAlerts
        warnings={getQualificationWarnings({ dogs, walks, registrations })}
        role="client"
      />
      {cancelled.map((w) => (
        <div className="alert red" key={w.id} role="status">
          <div style={{ minWidth: 0, overflowWrap: "anywhere" }}>
            <strong>Organizator odwołał spacer: {w.public_location}</strong>
            <p className="preserve-lines">{w.cancellation_reason}</p>
            <Link className="ghost-button" href={`/app/walks/${w.id}`}>
              Sprawdź szczegóły →
            </Link>
          </div>
        </div>
      ))}
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
                  <Badge
                    status={
                      walks.find((w) => w.id === r.walk_id)?.status ===
                      "cancelled"
                        ? "cancelled"
                        : r.status
                    }
                  />
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
      <article className="card">
        <div className="card-head">
          <div>
            <h2>Wasze pakiety i rozliczenia</h2>
            <p>
              {finance.totals.availableEntries} dostępnych wejść ·{" "}
              {finance.totals.reservedEntries} zarezerwowanych
            </p>
          </div>
          <Link className="ghost-button" href="/app/finance">
            Otwórz rozliczenia →
          </Link>
        </div>
        <div className="card-body">
          {finance.packages
            .filter((p) => p.status === "active")
            .map((p) => (
              <Link
                key={p.id}
                className="list-row"
                href={`/app/finance#package-${p.id}`}
              >
                <div className="list-main">
                  <strong>
                    {p.dogName} · {p.name}
                  </strong>
                  <span>
                    {p.available} dostępnych · {p.reserved} zarezerwowanych ·{" "}
                    {p.used} wykorzystanych
                  </span>
                </div>
              </Link>
            ))}
          {!finance.packages.some((p) => p.status === "active") && (
            <p className="muted">
              Nie macie jeszcze aktywnego pakietu. O dostępne pakiety zapytaj
              prowadzącą.
            </p>
          )}
          {finance.totals.dueCents > 0 && (
            <p>
              Do rozliczenia: <strong>{money(finance.totals.dueCents)}</strong>
            </p>
          )}
        </div>
      </article>
    </div>
  );
}
