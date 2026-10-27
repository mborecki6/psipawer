import "server-only";
import { requireSession } from "@/lib/auth/session";
import { allRows } from "@/lib/data/queries";
import { monthRange, weekRange } from "./dates";
import type {
  Appointment,
  CalendarSettings,
  WorkingDay,
  CalendarTeamMember,
  CalendarResource,
} from "./types";
import { reportDataReadError } from "@/lib/observability/server-errors";
import { calendarPractitioners } from "./practitioners";
import {
  attachMeetingIds,
  type CourseMeeting,
  type FitnessMeeting,
} from "./meeting-links";

async function clientMeetingIds(
  db: Awaited<ReturnType<typeof requireSession>>["db"],
  appointments: Appointment[],
) {
  const courseIds = [
    ...new Set(
      appointments.filter((a) => a.kind === "course").map((a) => a.id),
    ),
  ];
  const fitnessIds = [
    ...new Set(
      appointments.filter((a) => a.kind === "fitness").map((a) => a.id),
    ),
  ];
  const courses: CourseMeeting[] = [];
  const fitness: FitnessMeeting[] = [];
  // Read only public identifiers/times through the current guardian's RLS.
  // Small ID batches also keep PostgREST GET URLs bounded.
  for (let offset = 0; offset < courseIds.length; offset += 100) {
    courses.push(
      ...(await allRows<CourseMeeting>((from, to) =>
        db
          .from("course_sessions")
          .select("id,course_id,starts_at")
          .in("course_id", courseIds.slice(offset, offset + 100))
          .order("id")
          .range(from, to),
      )),
    );
  }
  for (let offset = 0; offset < fitnessIds.length; offset += 100) {
    fitness.push(
      ...(await allRows<FitnessMeeting>((from, to) =>
        db
          .from("fitness_sessions")
          .select("id,package_id,starts_at")
          .in("package_id", fitnessIds.slice(offset, offset + 100))
          .order("id")
          .range(from, to),
      )),
    );
  }
  return attachMeetingIds(appointments, courses, fitness);
}
export async function getCalendar(
  staff: boolean,
  date?: string,
  view: "week" | "month" = "week",
) {
  const { db, user } = await requireSession(staff ? "admin" : "client");
  const range = view === "month" ? monthRange(date) : weekRange(date);
  const appointments = await allRows<Appointment>((from, to) => {
    const query = db
      .rpc(
        staff ? "calendar_team_appointments" : "calendar_appointments",
        { p_from: range.from, p_to: range.to },
        { get: true },
      )
      .order("starts_at")
      .order("kind")
      .order("id");
    return (staff ? query.order("appointment_id") : query).range(from, to);
  });
  let settings: CalendarSettings | null = null;
  let members: CalendarTeamMember[] = [];
  let resources: CalendarResource[] = [];
  let primaryId: string | null = null;
  if (staff) {
    const [policy, hours, team, places, primary] = await Promise.all([
      db
        .from("calendar_settings")
        .select("version,hours_enabled,before_minutes,after_minutes")
        .single(),
      db
        .from("calendar_weekly_hours")
        .select("weekday,enabled,start_minute,end_minute")
        .order("weekday"),
      db.rpc("calendar_team_members", {}, { get: true }),
      db
        .from("calendar_resources")
        .select("id,name,exclusive,active,version")
        .order("name")
        .order("id"),
      db.rpc("calendar_primary_practitioner", {}, { get: true }),
    ]);
    for (const result of [policy, hours, team, places, primary])
      if (result.error) {
        reportDataReadError("calendar.settings", result.error, result.status);
        throw new Error("Nie udało się pobrać ustawień kalendarza.");
      }
    if (!policy.data || hours.data?.length !== 7)
      throw new Error("Nie udało się pobrać ustawień kalendarza.");
    settings = { ...policy.data, week: hours.data as WorkingDay[] };
    members = (team.data || []) as CalendarTeamMember[];
    resources = (places.data || []) as CalendarResource[];
    primaryId = primary.data;
  }
  return {
    appointments: staff
      ? appointments
      : await clientMeetingIds(db, appointments),
    range,
    settings,
    members,
    ...calendarPractitioners(members, primaryId),
    resources,
    currentUserId: staff ? user.id : null,
  };
}

export async function getCalendarSetup(selectedStaff?: string) {
  const { db, user } = await requireSession("admin");
  const [policy, hours, team, places, primary] = await Promise.all([
    db
      .from("calendar_settings")
      .select("version,hours_enabled,before_minutes,after_minutes")
      .single(),
    db
      .from("calendar_weekly_hours")
      .select("weekday,enabled,start_minute,end_minute")
      .order("weekday"),
    db.rpc("calendar_team_members", {}, { get: true }),
    db
      .from("calendar_resources")
      .select("id,name,exclusive,active,version")
      .order("name")
      .order("id"),
    db.rpc("calendar_primary_practitioner", {}, { get: true }),
  ]);
  for (const result of [policy, hours, team, places, primary])
    if (result.error) {
      reportDataReadError("calendar.setup", result.error, result.status);
      throw new Error("Nie udało się pobrać ustawień kalendarza.");
    }
  if (!policy.data || hours.data?.length !== 7)
    throw new Error("Nie udało się pobrać ustawień kalendarza.");
  const members = (team.data || []) as CalendarTeamMember[];
  const practitioners = calendarPractitioners(members, primary.data);
  const staffId =
    typeof selectedStaff === "string" &&
    practitioners.activeMembers.some(
      (member) => member.user_id === selectedStaff,
    )
      ? selectedStaff
      : null;
  let settings: CalendarSettings = {
    ...policy.data,
    week: hours.data as WorkingDay[],
  };
  if (staffId) {
    const result = await db.rpc(
      "calendar_staff_preferences",
      { p_staff_id: staffId },
      { get: true },
    );
    if (result.error || !result.data) {
      reportDataReadError(
        "calendar.staff_preferences",
        result.error,
        result.status,
      );
      throw new Error("Nie udało się pobrać godzin pracy prowadzącego.");
    }
    settings = result.data as CalendarSettings;
  }
  return {
    settings,
    members,
    ...practitioners,
    resources: (places.data || []) as CalendarResource[],
    staffId,
    currentUserId: user.id,
  };
}

export async function getNextAppointment() {
  const { db, role } = await requireSession();
  const from = new Date();
  const to = new Date(from.getTime() + 31 * 86400000);
  // This stable, read-only RPC uses GET. The SDK can safely retry a transient
  // connection failure; mutation RPCs keep their existing POST semantics.
  const { data, error, status } = await db
    .rpc(
      role === "admin" ? "calendar_team_appointments" : "calendar_appointments",
      {
        p_from: from.toISOString(),
        p_to: to.toISOString(),
      },
      { get: true },
    )
    .neq("kind", "block")
    .neq("status", "completed")
    .order("starts_at")
    .order("kind")
    .order("id")
    .limit(1);
  if (error) {
    reportDataReadError("calendar.next", error, status);
    throw new Error("Nie udało się pobrać najbliższego spotkania.");
  }
  const appointment = (data?.[0] as Appointment | undefined) || null;
  if (!appointment || role === "admin") return appointment;
  return (await clientMeetingIds(db, [appointment]))[0];
}
