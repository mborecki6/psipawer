import { getNextAppointment } from "@/modules/calendar/queries";
import { NextAppointment } from "@/modules/calendar/next-appointment";
import Link from "next/link";
import { getSnapshot } from "@/lib/data/queries";
import { Badge } from "@/components/ui";
import { getQualificationWarnings } from "@/lib/qualification";
import { QualificationAlerts } from "@/components/qualification-alert";
import { getDashboardFinanceSummary } from "@/lib/data/finance-queries";
import { money } from "@/lib/domain";
import { financePackageHref } from "@/lib/finance-pagination";
import { requireSession } from "@/lib/auth/session";
import { OnboardingStartCard } from "@/modules/onboarding/start-card";
import { getDashboardActivities } from "@/modules/dashboard/queries";
import { buildDashboardItems } from "@/modules/dashboard/model";
import { DashboardRegistrations } from "@/modules/dashboard/views";
export default async function Page() {
  const { onboarding } = await requireSession("client");
  const [snapshot, finance, nextAppointment, activities] = await Promise.all([
    getSnapshot(),
    getDashboardFinanceSummary(),
    getNextAppointment(),
    getDashboardActivities(),
  ]);
  const { walks, dogs, registrations } = snapshot;
  const dashboard = buildDashboardItems({ snapshot, activities, finance });
  const activePackages = finance.packages.filter((p) => p.status === "active");
  const hasFinance =
    finance.charges.length > 0 || finance.reviewPayments.length > 0;
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
      {!nextAppointment && onboarding?.completed_at ? (
        <OnboardingStartCard record={onboarding} />
      ) : (
        <NextAppointment appointment={nextAppointment} admin={false} />
      )}
      <div className="dashboard-grid">
        <DashboardRegistrations {...dashboard} />
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
      {(activePackages.length > 0 || hasFinance) && (
        <article className="card">
          <div className="card-head">
            <div>
              <h2>
                {activePackages.length
                  ? "Wasze pakiety i rozliczenia"
                  : "Rozliczenia"}
              </h2>
              {activePackages.length > 0 && (
                <p>
                  {finance.totals.availableEntries} dostępnych wejść ·{" "}
                  {finance.totals.reservedEntries} zarezerwowanych
                </p>
              )}
            </div>
            <Link className="ghost-button" href="/app/finance">
              Otwórz rozliczenia →
            </Link>
          </div>
          <div className="card-body">
            {activePackages.map((p) => (
              <Link
                key={p.id}
                className="list-row"
                href={financePackageHref("/app", p.id)}
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
            {finance.totals.dueCents > 0 && (
              <p>
                Do rozliczenia:{" "}
                <strong>{money(finance.totals.dueCents)}</strong>
              </p>
            )}
            {hasFinance && finance.totals.dueCents === 0 && (
              <p>Sprawdź sprawy rozliczeniowe widoczne przy zgłoszeniach.</p>
            )}
          </div>
        </article>
      )}
    </div>
  );
}
