export type CourseStatus =
  "draft" | "open" | "closed" | "completed" | "cancelled";
export type EnrollmentStatus =
  "requested" | "accepted" | "waitlisted" | "rejected" | "cancelled";
export type Course = {
  id: string;
  service_id: string;
  service_version: number;
  service_name: string;
  price_cents: number;
  is_test_price: boolean;
  sessions_count: number;
  duration_minutes: number;
  course_format: "individual" | "group";
  title: string;
  public_location: string;
  capacity: number;
  status: CourseStatus;
  version: number;
  created_at: string;
  updated_at: string;
};
export type CourseSession = {
  id: string;
  course_id: string;
  ordinal: number;
  starts_at: string;
  duration_minutes: number;
  public_location: string;
  status: "scheduled" | "completed" | "cancelled";
  version: number;
};
export type CourseEnrollment = {
  id: string;
  course_id: string;
  dog_id: string;
  guardian_id: string;
  selected_course_version: number;
  status: EnrollmentStatus;
  agreed_price_cents: number;
  is_test_price: boolean;
  charge_cents: number;
  version: number;
  created_at: string;
  updated_at: string;
};
export type CourseAttendance = {
  session_id: string;
  enrollment_id: string;
  attendance: "present" | "absent" | "excused";
  version: number;
};
export type CourseHistory = {
  id: string;
  course_id: string;
  session_id: string | null;
  enrollment_id: string | null;
  action: string;
  note: string;
  details: Record<string, unknown>;
  created_at: string;
};
export const courseLabels: Record<CourseStatus, string> = {
  draft: "Szkic",
  open: "Otwarte zapisy",
  closed: "Zapisy zamknięte",
  completed: "Zakończony",
  cancelled: "Odwołany",
};
export const enrollmentLabels: Record<EnrollmentStatus, string> = {
  requested: "Czeka na decyzję",
  accepted: "Przyjęte",
  waitlisted: "Lista rezerwowa",
  rejected: "Nieprzyjęte",
  cancelled: "Rezygnacja lub odwołanie",
};
export const sessionLabels = {
  scheduled: "Zaplanowane",
  completed: "Zakończone",
  cancelled: "Odwołane",
};
export const attendanceLabels = {
  present: "Obecny",
  absent: "Nieobecny",
  excused: "Usprawiedliwiony",
};
export type SessionDetail = CourseSession & {
  course_session_private_details: { exact_location: string } | null;
};
export type EnrollmentDetail = CourseEnrollment & {
  dogs: { name: string } | null;
};
export type AttendanceDetail = CourseAttendance & {
  course_enrollments: { dog_id: string; dogs: { name: string } | null };
};
export type CourseSummary = Course & {
  course_sessions: Pick<CourseSession, "starts_at" | "status">[];
};
export function coursePage(value?: string) {
  return value && /^[1-9]\d{0,4}$/.test(value) ? Number(value) : 1;
}
export function courseFilter(value?: string, admin = false) {
  return value &&
    (admin
      ? ["active", "draft", "open", "closed", "history"]
      : ["open", "mine", "history"]
    ).includes(value)
    ? value
    : admin
      ? "active"
      : "open";
}
export function enrollmentFilter(value?: string) {
  return value &&
    ["all", "requested", "accepted", "waitlisted", "history"].includes(value)
    ? value
    : "all";
}
