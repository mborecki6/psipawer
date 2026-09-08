import Link from "next/link";
import { requireSession } from "@/lib/auth/session";
import { Hourglass, CalendarDays, Wallet, Activity } from "lucide-react";
import { getSnapshot } from "@/lib/data/queries";
import { getFinanceData } from "@/lib/data/finance-queries";
import { Kpi, WalkRow, Empty } from "@/components/ui";
import { kpiUrl, warsawDate, dateLabel } from "@/lib/domain";
import { getQualificationWarnings } from "@/lib/qualification";
import { QualificationAlerts } from "@/components/qualification-alert";
export default async function Page() {
  await requireSession("admin");
  const [{ walks, registrations, dogs }, finance] = await Promise.all([
    getSnapshot(),
    getFinanceData(),
  ]);
  const upcoming = walks.filter(
    (w) =>
      new Date(w.starts_at) >= new Date() &&
      ["open", "full", "closed"].includes(w.status),
  );
  const ids = new Set(upcoming.map((w) => w.id));
  const pending = registrations.filter(
    (r) => r.status === "pending" && ids.has(r.walk_id),
  );
  const today = walks.filter(
    (w) =>
      warsawDate(w.starts_at) === warsawDate(new Date()) &&
      !["cancelled", "draft"].includes(w.status),
  );
  const next = upcoming.slice(0, 6);
  const capacity = next.reduce((n, w) => n + w.capacity, 0);
  const accepted = (id: string) =>
    registrations.filter((r) => r.walk_id === id && r.status === "accepted")
      .length;
  const fill = capacity
    ? Math.round(
        (next.reduce((n, w) => n + accepted(w.id), 0) / capacity) * 100,
      )
    : 0;
  return (
    <div className="stack">
      <QualificationAlerts
        warnings={getQualificationWarnings({ dogs, walks, registrations })}
        role="admin"
      />
      <div className="grid-4">
        <Kpi
          label="Zgłoszenia do decyzji"
          value={pending.length}
          copy={
            pending.length ? "Czekają na Twoją decyzję" : "Wszystko rozpatrzone"
          }
          href={kpiUrl("pending")}
          icon={<Hourglass />}
        />
        <Kpi
          label="Dzisiejsze spacery"
          value={today.length}
          copy="Plan na dziś"
          href={kpiUrl("today")}
          icon={<CalendarDays />}
        />
        <Kpi
          label="Do rozliczenia"
          value={finance.charges.length}
          copy="Spacery i pakiety do opłacenia"
          href={kpiUrl("due-payments")}
          icon={<Wallet />}
        />
        <Kpi
          label="Wypełnienie najbliższych"
          value={`${fill}%`}
          copy="6 kolejnych terminów"
          href={kpiUrl("next-six")}
          icon={<Activity />}
        />
      </div>
      {upcoming[0] && (
        <article className="card hero-card">
          <div className="hero-content">
            <span className="hero-eyebrow">
              <CalendarDays /> Najbliższy spacer
            </span>
            <h2>{dateLabel(upcoming[0].starts_at)}</h2>
            <p>
              {upcoming[0].public_location}. {upcoming[0].type}.{" "}
              {accepted(upcoming[0].id)} z {upcoming[0].capacity} miejsc jest
              już potwierdzonych.
            </p>
            <div className="hero-actions">
              <Link
                className="primary-button"
                href={`/admin/walks/${upcoming[0].id}`}
              >
                Otwórz skład →
              </Link>
            </div>
          </div>
        </article>
      )}
      <div className="dashboard-grid">
        <article className="card">
          <div className="card-head">
            <div>
              <h2>Najbliższe terminy</h2>
              <p>Plan spacerów i zgłoszenia w jednym miejscu</p>
            </div>
            <Link className="ghost-button" href="/admin/walks">
              Wszystkie →
            </Link>
          </div>
          <div className="card-body">
            <div className="list">
              {upcoming.slice(0, 5).map((w) => (
                <WalkRow
                  key={w.id}
                  walk={w}
                  base="/admin"
                  accepted={accepted(w.id)}
                  pending={pending.filter((r) => r.walk_id === w.id).length}
                />
              ))}
            </div>
            {!upcoming.length && (
              <Empty
                title="Czas na pierwszy spacer"
                copy="Dodaj termin, a opiekunowie będą mogli zgłosić swoje psy."
                href="/admin/walks/new"
                action="Dodaj spacer"
              />
            )}
          </div>
        </article>
        <div className="stack">
          <article className="card">
            <div className="card-head">
              <div>
                <h3>Wymaga uwagi</h3>
                <p>Zgłoszenia i profile do sprawdzenia</p>
              </div>
            </div>
            <div className="card-body">
              <div className="list">
                {pending.slice(0, 4).map((r) => (
                  <Link
                    className="list-row"
                    key={r.id}
                    href={`/admin/walks/${r.walk_id}`}
                  >
                    <div className="role-avatar">
                      {dogs.find((d) => d.id === r.dog_id)?.name.slice(0, 1)}
                    </div>
                    <div className="list-main">
                      <strong>
                        {dogs.find((d) => d.id === r.dog_id)?.name}
                      </strong>
                      <span>Zgłoszenie na spacer</span>
                    </div>
                    <span className="small-button">Sprawdź</span>
                  </Link>
                ))}
              </div>
              {!pending.length && (
                <div className="alert green">
                  Wszystkie zgłoszenia rozpatrzone.
                </div>
              )}
              <Link
                className="ghost-button"
                href="/admin/dogs?status=needs_review"
              >
                {dogs.filter((d) => d.status === "needs_review").length} profili
                do ponownej oceny →
              </Link>
            </div>
          </article>
          <article className="card pad">
            <h3>Pakiety i płatności</h3>
            <p className="muted">
              {finance.totals.availableEntries} wolnych wejść w pakietach.
              Wpłaty, rezerwacje i historię rozliczeń znajdziesz w jednym
              miejscu.
            </p>
            <Link className="ghost-button" href="/admin/finance">
              Otwórz rozliczenia →
            </Link>
          </article>
        </div>
      </div>
    </div>
  );
}
