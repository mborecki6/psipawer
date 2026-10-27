import "server-only";
import { requireSession } from "@/lib/auth/session";
import { allRows } from "@/lib/data/queries";
import type { OfferItem } from "@/modules/calendar-offer/types";
import type {
  DashboardActivities,
  DashboardConsultation,
  DashboardEnrollment,
  DashboardCourseSession,
  DashboardFitness,
  DashboardRequest,
  DashboardSnapshot,
} from "./types";

export async function getDashboardSnapshot(): Promise<DashboardSnapshot> {
  const { db } = await requireSession("client");
  const [dogs, walks, registrations] = await Promise.all([
    allRows<DashboardSnapshot["dogs"][number]>((from, to) =>
      db
        .from("dogs")
        .select("id,name,breed,status")
        .order("name")
        .order("id")
        .range(from, to),
    ),
    allRows<DashboardSnapshot["walks"][number]>((from, to) =>
      db
        .from("walks")
        .select(
          "id,type,public_location,status,starts_at,duration_minutes,cancellation_reason",
        )
        .order("starts_at")
        .order("id")
        .range(from, to),
    ),
    allRows<DashboardSnapshot["registrations"][number]>((from, to) =>
      db
        .from("walk_registrations")
        .select("id,dog_id,walk_id,status,attendance")
        .order("created_at")
        .order("id")
        .range(from, to),
    ),
  ]);
  return { dogs, walks, registrations };
}

export async function getDashboardOfferItems(now: string) {
  const { db } = await requireSession("client");
  const until = new Date(Date.parse(now) + 31 * 86400000).toISOString();
  const items = await allRows<OfferItem>((from, to) =>
    db
      .rpc("calendar_offer", { p_from: now, p_to: until }, { get: true })
      .eq("availability", "available")
      .in("eligibility", ["eligible", "needs_dog", "qualification_required"])
      .order("starts_at")
      .order("kind")
      .order("id")
      .range(from, to),
  );
  return items;
}

export async function getDashboardActivities(): Promise<DashboardActivities> {
  // Use the guardian's verified client throughout; RLS remains the authority.
  const { db } = await requireSession("client");
  const [consultations, enrollments, fitness, requests] = await Promise.all([
    allRows<DashboardConsultation>((from, to) =>
      db
        .from("consultations")
        .select("id,dog_id,status,starts_at,service_name,created_at")
        .order("id")
        .range(from, to),
    ),
    allRows<DashboardEnrollment>((from, to) =>
      db
        .from("course_enrollments")
        .select(
          "id,dog_id,course_id,status,created_at,courses(title,service_name,status)",
        )
        .order("id")
        .range(from, to),
    ),
    allRows<DashboardFitness>((from, to) =>
      db
        .from("fitness_balances")
        .select("id,dog_id,status,service_name,next_starts_at,created_at")
        .order("id")
        .range(from, to),
    ),
    allRows<DashboardRequest>((from, to) =>
      db
        .from("service_requests")
        .select("id,dog_id,service_id,service_name,status,created_at")
        .order("id")
        .range(from, to),
    ),
  ]);
  // Restrict public timetable reads to the guardian's courses. Separate pages
  // avoid the response limit of embedded PostgREST relationships; bounded ID
  // groups also avoid growing an unbounded URL for a long enrollment history.
  const ids = [...new Set(enrollments.map((entry) => entry.course_id))];
  const courseSessions: DashboardCourseSession[] = [];
  for (let offset = 0; offset < ids.length; offset += 100) {
    courseSessions.push(
      ...(await allRows<DashboardCourseSession>((from, to) =>
        db
          .from("course_sessions")
          .select("id,course_id,starts_at,status")
          .in("course_id", ids.slice(offset, offset + 100))
          .order("id")
          .range(from, to),
      )),
    );
  }
  return { consultations, enrollments, courseSessions, fitness, requests };
}
