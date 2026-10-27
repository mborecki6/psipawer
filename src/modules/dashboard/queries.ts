import "server-only";
import { requireSession } from "@/lib/auth/session";
import { allRows } from "@/lib/data/queries";
import type {
  DashboardActivities,
  DashboardConsultation,
  DashboardEnrollment,
  DashboardCourseSession,
  DashboardFitness,
  DashboardRequest,
} from "./types";

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
