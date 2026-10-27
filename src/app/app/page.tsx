import { getNextAppointment } from "@/modules/calendar/queries";
import { NextAppointment } from "@/modules/calendar/next-appointment";
import Link from "next/link";
import { Badge } from "@/components/ui";
import { getQualificationWarnings } from "@/lib/qualification";
import { QualificationAlerts } from "@/components/qualification-alert";
import { requireSession } from "@/lib/auth/session";
import { OnboardingStartCard } from "@/modules/onboarding/start-card";
import {
  getDashboardActivities,
  getDashboardOfferItems,
  getDashboardSnapshot,
} from "@/modules/dashboard/queries";
import {
  buildDashboardItems,
  dashboardSuggestions,
} from "@/modules/dashboard/model";
import {
  DashboardCare,
  DashboardRegistrations,
  DashboardSuggestions,
} from "@/modules/dashboard/views";
import { getCareOverview } from "@/modules/care/queries";
export default async function Page() {
  const { onboarding } = await requireSession("client");
  const now = new Date().toISOString();
  const [snapshot, nextAppointment, activities, offers, care] =
    await Promise.all([
      getDashboardSnapshot(),
      getNextAppointment(),
      getDashboardActivities(),
      getDashboardOfferItems(now),
      getCareOverview(1, 1),
    ]);
  const { walks, dogs, registrations } = snapshot;
  const dashboard = buildDashboardItems({ snapshot, activities });
  const suggestions = dashboardSuggestions(
    offers,
    Date.parse(now),
    new Set([
      ...registrations.map((entry) => `walk:${entry.walk_id}`),
      ...activities.enrollments.map((entry) => `course:${entry.course_id}`),
    ]),
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
      {!nextAppointment && onboarding?.completed_at ? (
        <OnboardingStartCard record={onboarding} />
      ) : (
        <NextAppointment appointment={nextAppointment} admin={false} />
      )}
      <div className="dashboard-grid">
        <DashboardCare plans={care.plans} />
        <DashboardSuggestions items={suggestions} />
      </div>
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
    </div>
  );
}
