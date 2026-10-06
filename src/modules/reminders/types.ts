export const reminderKinds = {
  consultation: "Przed konsultacją",
  walk: "Przed spacerem",
  follow_up: "Kontakt kontrolny",
  course: "Przed spotkaniem kursu",
  fitness: "Przed spotkaniem PSI FITNESS",
};
export const reminderStatuses = {
  pending: "Zaplanowane",
  retry: "Ponowna próba",
  failed: "Wymagają uwagi",
  sent: "W skrzynce",
  cancelled: "Wycofane",
};
export const retryQueuedMessage =
  "Przypomnienie czeka na ponowną próbę. Możesz uruchomić sprawdzenie kolejki.";
export type ReminderStatus = keyof typeof reminderStatuses;
export type Reminder = {
  id: string;
  kind: keyof typeof reminderKinds;
  dog_id: string;
  entity_id: string;
  target_at: string;
  due_at: string;
  next_attempt_at: string;
  status: ReminderStatus;
  attempts: number;
  cycle_attempts: number;
  last_error_code: "delivery_failed" | "source_changed" | null;
  created_at: string;
  finished_at: string | null;
  dogs: { name: string } | null;
  course_enrollment_id?: string | null;
  course_session_id?: string | null;
  fitness_package_id?: string | null;
  fitness_session_id?: string | null;
};
export type ReminderAttempt = {
  attempt: number;
  outcome: "sent" | "failed" | "cancelled";
  error_code: string | null;
  created_at: string;
};
export type DeliveryResult = {
  sent: number;
  failed: number;
  cancelled: number;
  skipped: number;
};
export type ReminderCount = {
  status: ReminderStatus;
  total: number;
  due: number;
};
export type WorkerState = {
  last_run_at: string;
  result: DeliveryResult;
} | null;
export function reminderFilter(raw?: string): ReminderStatus | "all" {
  return raw && Object.hasOwn(reminderStatuses, raw)
    ? (raw as ReminderStatus)
    : "all";
}
export function reminderHref(
  r: Pick<
    Reminder,
    | "kind"
    | "entity_id"
    | "course_enrollment_id"
    | "course_session_id"
    | "fitness_package_id"
    | "fitness_session_id"
  >,
) {
  if (r.kind === "fitness")
    return `/admin/fitness/${r.fitness_package_id || r.entity_id}${r.fitness_session_id ? `#spotkanie-${r.fitness_session_id}` : ""}`;
  if (r.kind === "course")
    return `/admin/courses/${r.entity_id}${r.course_enrollment_id ? `?enrollment=${r.course_enrollment_id}` : ""}${r.course_session_id ? `#spotkanie-${r.course_session_id}` : ""}`;
  if (r.kind === "follow_up") return `/admin/work/follow-ups/${r.entity_id}`;
  return `/admin/${r.kind === "walk" ? "walks" : "consultations"}/${r.entity_id}`;
}
