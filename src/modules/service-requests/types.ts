import type { Service } from "../services/types";
export type RequestStatus = "open" | "handled" | "cancelled";
export const requestLabels: Record<RequestStatus, string> = {
  open: "Do ustalenia",
  handled: "Załatwione",
  cancelled: "Wycofane",
};
export type ServiceRequest = {
  id: string;
  dog_id: string;
  guardian_id: string;
  service_id: string;
  service_name: string;
  message: string;
  availability: string;
  status: RequestStatus;
  version: number;
  resolution_note: string;
  created_at: string;
  updated_at: string;
  dogs: { name: string } | null;
  profiles: { full_name: string | null } | null;
  service_request_history: {
    id: string;
    action: "requested" | "handled" | "cancelled";
    note: string;
    version: number;
    created_at: string;
  }[];
};
export type RequestService = Pick<
  Service,
  "id" | "name" | "active" | "kind" | "booking_flow" | "course_format"
>;
export type PublicCourse = {
  id: string;
  title: string;
  course_sessions: { starts_at: string; status: string }[];
};
export function isDateRequestService(service: RequestService) {
  return (
    service.active &&
    ((service.kind === "course" && service.course_format === "individual") ||
      (service.kind === "individual" && service.booking_flow === "catalogue"))
  );
}
export function bookableCourses(courses: PublicCourse[], now = new Date()) {
  return courses.filter(
    (course) =>
      course.course_sessions.some(
        (session) =>
          session.status === "scheduled" &&
          Date.parse(session.starts_at) > now.getTime(),
      ) &&
      course.course_sessions.every(
        (session) => Date.parse(session.starts_at) > now.getTime(),
      ),
  );
}
export function requestPage(value?: string | string[]) {
  return typeof value === "string" && /^[1-9]\d{0,4}$/.test(value)
    ? Number(value)
    : 1;
}
export function requestFilter(value?: string | string[]): "open" | "history" {
  return value === "history" ? "history" : "open";
}
