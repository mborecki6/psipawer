import type { Snapshot } from "@/lib/data/types";
import type { DashboardFinanceSummary } from "@/lib/data/finance-queries";
import { labels } from "@/lib/domain";
import { consultationLabels } from "@/modules/consultations/types";
import { enrollmentLabels } from "@/modules/courses/types";
import { fitnessLabels } from "@/modules/fitness/types";
import { requestLabels } from "@/modules/service-requests/types";
import type { DashboardActivities } from "./types";

export type DashboardItem = {
  key: string;
  dogName: string;
  service: string;
  startsAt: string | null;
  status: string;
  href: string;
  action: string;
  open: boolean;
  charges: DashboardFinanceSummary["charges"];
  reviewPayments: DashboardFinanceSummary["reviewPayments"];
};
export function hasFinancialIssue(item: DashboardItem) {
  return item.charges.length > 0 || item.reviewPayments.length > 0;
}

export function buildDashboardItems({
  snapshot,
  activities,
  finance,
  now = Date.now(),
}: {
  snapshot: Snapshot;
  activities: DashboardActivities;
  finance: DashboardFinanceSummary;
  now?: number;
}) {
  const dogs = new Map(snapshot.dogs.map((dog) => [dog.id, dog.name]));
  const walks = new Map(snapshot.walks.map((walk) => [walk.id, walk]));
  const items: DashboardItem[] = [];
  function add(
    item: Omit<DashboardItem, "charges" | "reviewPayments" | "dogName"> & {
      dogId: string;
    },
  ) {
    const { dogId, ...row } = item;
    items.push({
      ...row,
      dogName: dogs.get(dogId) || "Pies",
      charges: [],
      reviewPayments: [],
    });
  }
  for (const registration of snapshot.registrations) {
    const walk = walks.get(registration.walk_id);
    if (!walk) continue;
    const ongoing =
      Date.parse(walk.starts_at) + walk.duration_minutes * 60_000 > now;
    const open =
      walk.status !== "cancelled" &&
      ((["pending", "waitlisted"].includes(registration.status) &&
        walk.status !== "completed") ||
        (registration.status === "accepted" &&
          (ongoing || registration.attendance === "pending")));
    add({
      key: `registration:${registration.id}`,
      dogId: registration.dog_id,
      service: `${walk.type} · ${walk.public_location}`,
      startsAt: walk.starts_at,
      status:
        walk.status === "cancelled"
          ? "Spacer odwołany"
          : registration.status === "accepted" &&
              !ongoing &&
              registration.attendance === "pending"
            ? "Oczekuje na zamknięcie obecności"
            : labels[registration.status] || registration.status,
      href: `/app/walks/${walk.id}`,
      action: "Szczegóły spaceru",
      open,
    });
  }
  for (const consultation of activities.consultations) {
    add({
      key: `consultation:${consultation.id}`,
      dogId: consultation.dog_id,
      service: consultation.service_name || "Konsultacja indywidualna",
      startsAt: consultation.starts_at,
      status: consultationLabels[consultation.status],
      href: `/app/consultations/${consultation.id}`,
      action: "Szczegóły konsultacji",
      open: ["requested", "scheduled"].includes(consultation.status),
    });
  }
  const sessions = new Map<string, typeof activities.courseSessions>();
  for (const session of activities.courseSessions) {
    const list = sessions.get(session.course_id) || [];
    list.push(session);
    sessions.set(session.course_id, list);
  }
  for (const enrollment of activities.enrollments) {
    const course = enrollment.courses;
    if (!course) throw new Error("Nie udało się pobrać danych Twojego kursu.");
    const scheduled = (sessions.get(enrollment.course_id) || [])
      .filter((session) => session.status === "scheduled")
      .sort((a, b) => a.starts_at.localeCompare(b.starts_at));
    add({
      key: `course:${enrollment.id}`,
      dogId: enrollment.dog_id,
      service: `${course.service_name} · ${course.title}`,
      startsAt:
        scheduled.find((session) => Date.parse(session.starts_at) >= now)
          ?.starts_at ||
        scheduled[0]?.starts_at ||
        null,
      status: ["completed", "cancelled"].includes(course.status)
        ? `${enrollmentLabels[enrollment.status]} · kurs ${course.status === "completed" ? "zakończony" : "odwołany"}`
        : enrollmentLabels[enrollment.status],
      href: `/app/courses/${enrollment.course_id}?enrollment=${enrollment.id}`,
      action: "Twój udział w kursie",
      open:
        ["requested", "waitlisted"].includes(enrollment.status) ||
        (enrollment.status === "accepted" &&
          !["completed", "cancelled"].includes(course.status)),
    });
  }
  for (const fitness of activities.fitness) {
    add({
      key: `fitness:${fitness.id}`,
      dogId: fitness.dog_id,
      service: fitness.service_name,
      startsAt: fitness.next_starts_at,
      status: fitnessLabels[fitness.status],
      href: `/app/fitness/${fitness.id}`,
      action: "Spotkania i szczegóły fitnessu",
      open: ["requested", "active"].includes(fitness.status),
    });
  }
  for (const request of activities.requests) {
    add({
      key: `request:${request.id}`,
      dogId: request.dog_id,
      service: `${request.service_name} · prośba o termin`,
      startsAt: null,
      status: requestLabels[request.status],
      href: `/app/services/${request.service_id}/request?request=${request.id}#request-${request.id}`,
      action: "Szczegóły prośby o termin",
      open: request.status === "open",
    });
  }
  const keys = new Map(items.map((item) => [item.key, item]));
  for (const charge of finance.charges) {
    let item = keys.get(`${charge.kind}:${charge.id}`);
    if (!item) {
      item = {
        key: `${charge.kind}:${charge.id}`,
        dogName: charge.dogName,
        service: charge.title,
        startsAt: charge.date,
        status: "Sprawa rozliczeniowa",
        href: charge.href,
        action: "Otwórz rozliczenie",
        open: false,
        charges: [],
        reviewPayments: [],
      };
      items.push(item);
      keys.set(item.key, item);
    }
    item.charges.push(charge);
  }
  for (const payment of finance.reviewPayments) {
    // Match the original payment subject, never a name or shared walk URL.
    let item = payment.sourceKey ? keys.get(payment.sourceKey) : undefined;
    if (!item) {
      item = {
        key: payment.sourceKey || `payment:${payment.id}`,
        dogName: payment.dogName,
        service: payment.title,
        startsAt: null,
        status: "Wpłata wymaga sprawdzenia",
        href: payment.href || "/app/finance",
        action: "Sprawdź wpłatę",
        open: false,
        charges: [],
        reviewPayments: [],
      };
      items.push(item);
      keys.set(item.key, item);
    }
    item.reviewPayments.push(payment);
  }
  const current = items
    .filter((item) => item.open || hasFinancialIssue(item))
    .sort(
      (a, b) =>
        Number(hasFinancialIssue(b)) - Number(hasFinancialIssue(a)) ||
        (a.startsAt || "").localeCompare(b.startsAt || "") ||
        a.key.localeCompare(b.key),
    );
  return {
    current,
    history: items.filter((item) => !item.open && !hasFinancialIssue(item)),
  };
}
