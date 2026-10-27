import type { Appointment } from "./types";

type Meeting = { id: string; starts_at: string | null };
export type CourseMeeting = Meeting & { course_id: string };
export type FitnessMeeting = Meeting & { package_id: string };

export function attachMeetingIds(
  appointments: Appointment[],
  courses: CourseMeeting[],
  fitness: FitnessMeeting[],
): Appointment[] {
  return appointments.map((item) => {
    if (item.appointment_id || !["course", "fitness"].includes(item.kind))
      return item;
    const matches =
      item.kind === "course"
        ? courses.filter(
            (s) =>
              s.course_id === item.id &&
              s.starts_at !== null &&
              Date.parse(s.starts_at) === Date.parse(item.starts_at),
          )
        : fitness.filter(
            (s) =>
              s.package_id === item.id &&
              s.starts_at !== null &&
              Date.parse(s.starts_at) === Date.parse(item.starts_at),
          );
    // Never infer an ordinal from the title or choose an ambiguous meeting.
    return matches.length === 1
      ? { ...item, appointment_id: matches[0].id }
      : item;
  });
}

export function appointmentDetailHref(
  base: "/admin" | "/app",
  item: Appointment,
) {
  const section = {
    walk: "walks",
    consultation: "consultations",
    course: "courses",
    fitness: "fitness",
    block: "calendar",
  }[item.kind];
  if (item.kind === "block") return `${base}/calendar`;
  const anchor =
    (item.kind === "course" || item.kind === "fitness") && item.appointment_id
      ? `#spotkanie-${item.appointment_id}`
      : "";
  return `${base}/${section}/${item.id}${anchor}`;
}
