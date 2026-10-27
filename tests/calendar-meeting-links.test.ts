import { expect, it } from "vitest";
import { attachMeetingIds, appointmentDetailHref } from "../src/modules/calendar/meeting-links";
import type { Appointment } from "../src/modules/calendar/types";

const event: Appointment = {
  id: "course-a", kind: "course", title: "Dowolna nazwa bez numeru",
  starts_at: "2030-01-01T10:00:00Z", ends_at: "2030-01-01T11:00:00Z",
  status: "scheduled", location: "Park", version: 1,
};
it("opens the actual course meeting in both panels, independent of its title", () => {
  const [result] = attachMeetingIds([event], [
    { id: "wrong-parent", course_id: "course-b", starts_at: event.starts_at },
    { id: "wrong-time", course_id: event.id, starts_at: "2030-01-02T10:00:00Z" },
    { id: "right", course_id: event.id, starts_at: "2030-01-01T11:00:00+01:00" },
  ], []);
  expect(appointmentDetailHref("/admin", result)).toBe("/admin/courses/course-a#spotkanie-right");
  expect(appointmentDetailHref("/app", result)).toBe("/app/courses/course-a#spotkanie-right");
  expect(event.appointment_id).toBeUndefined();
});
it("matches fitness by package and instant and leaves a verified server ID intact", () => {
  const [result] = attachMeetingIds([{ ...event, kind: "fitness" }], [], [
    { id: "session", package_id: event.id, starts_at: event.starts_at },
  ]);
  expect(appointmentDetailHref("/app", result)).toBe("/app/fitness/course-a#spotkanie-session");
  expect(attachMeetingIds([{ ...event, appointment_id: "server-id" }], [], [])[0].appointment_id).toBe("server-id");
});
it("does not choose ambiguous, missing or unscheduled meetings", () => {
  for (const courses of [[], [{ id: "a", course_id: event.id, starts_at: null }], [
    { id: "a", course_id: event.id, starts_at: event.starts_at },
    { id: "b", course_id: event.id, starts_at: event.starts_at },
  ]]) {
    const [result] = attachMeetingIds([event], courses, []);
    expect(result.appointment_id).toBeUndefined();
    expect(appointmentDetailHref("/app", result)).toBe("/app/courses/course-a");
  }
});
it("retains direct consultation and walk routes", () => {
  expect(appointmentDetailHref("/app", { ...event, kind: "walk" })).toBe("/app/walks/course-a");
  expect(appointmentDetailHref("/admin", { ...event, kind: "consultation" })).toBe("/admin/consultations/course-a");
});
