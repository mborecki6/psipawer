import type { Role } from "@/lib/auth/session";

export const notificationLabels = {
  plan_published: "Nowa wersja zaleceń",
  progress_submitted: "Nowa odpowiedź o postępach",
  progress_reviewed: "Prowadząca przeczytała odpowiedź",
  consultation_requested: "Nowe zgłoszenie konsultacji",
  consultation_scheduled: "Potwierdzono termin konsultacji",
  consultation_rescheduled: "Zmieniono szczegóły konsultacji",
  consultation_cancelled: "Odwołano konsultację",
  consultation_completed: "Zakończono konsultację",
  consultation_price_agreed: "Uzgodniono kwotę konsultacji",
  walk_changed: "Zmieniono szczegóły spaceru",
  walk_cancelled: "Odwołano spacer",
  registration_created: "Nowy zapis na spacer",
  registration_changed: "Zmieniono status zapisu",
  registration_cancelled: "Opiekun zrezygnował ze spaceru",
  walk_invitation: "Zaproszenie na spacer",
  payment_recorded: "Zapisano wpłatę",
  payment_refunded: "Zapisano zwrot lub korektę wpłaty",
  follow_up_changed: "Zmieniono kontakt kontrolny",
  consultation_reminder: "Zbliża się konsultacja",
  walk_reminder: "Zbliża się spacer",
  follow_up_reminder: "Czas na kontakt kontrolny",
  course_enrollment_requested: "Nowe zgłoszenie na kurs",
  course_enrollment_accepted: "Przyjęto zgłoszenie na kurs",
  course_enrollment_waitlisted: "Zgłoszenie na liście rezerwowej kursu",
  course_enrollment_rejected: "Zgłoszenie na kurs nie zostało przyjęte",
  course_enrollment_cancelled: "Rezygnacja z kursu",
  course_enrollment_reopened: "Ponownie otwarto zgłoszenie na kurs",
  course_cancelled: "Odwołano kurs",
  course_completed: "Zakończono kurs",
  course_updated: "Zmieniono ustawienia kursu",
  course_session_rescheduled: "Zmieniono spotkanie kursu",
  course_session_cancelled: "Odwołano spotkanie kursu",
  course_session_completed: "Zakończono spotkanie kursu",
  course_attendance_recorded: "Zapisano obecność na kursie",
  course_settled: "Uzgodniono rozliczenie kursu",
  course_payment_recorded: "Zapisano wpłatę za kurs",
  course_payment_refunded: "Zapisano zwrot wpłaty za kurs",
  course_reminder: "Zbliża się spotkanie kursu",
  fitness_requested: "Nowe zgłoszenie na PSI FITNESS",
  fitness_accepted: "Przyjęto pakiet PSI FITNESS",
  fitness_rejected: "Zgłoszenie fitness nie zostało przyjęte",
  fitness_cancelled: "Rezygnacja lub odwołanie pakietu fitness",
  fitness_completed: "Zakończono pakiet fitness",
  fitness_reopened: "Ponownie otwarto pakiet fitness",
  fitness_session_scheduled: "Ustalono termin spotkania fitness",
  fitness_session_rescheduled: "Zmieniono spotkanie fitness",
  fitness_session_cancelled: "Odwołano termin spotkania fitness",
  fitness_session_completed: "Zapisano zakończenie i obecność na fitness",
  fitness_session_reopened: "Przywrócono spotkanie fitness do umówienia",
  fitness_attendance_corrected: "Skorygowano obecność na fitness",
  fitness_settled: "Uzgodniono rozliczenie pakietu fitness",
  fitness_payment_recorded: "Zapisano wpłatę za pakiet fitness",
  fitness_payment_refunded: "Zapisano zwrot wpłaty za fitness",
  fitness_reminder: "Zbliża się spotkanie PSI FITNESS",
};
export type NotificationKind = keyof typeof notificationLabels;
export type Notification = {
  id: string;
  kind: NotificationKind;
  dog_id: string;
  dog_name: string;
  entity_id: string;
  created_at: string;
  read_at: string | null;
  course_enrollment_id?: string | null;
  course_session_id?: string | null;
  fitness_package_id?: string | null;
  fitness_session_id?: string | null;
};
export type NotificationFilter = "unread" | "all";
export function notificationFilter(raw?: string): NotificationFilter {
  return raw === "all" ? "all" : "unread";
}
export function notificationHref(
  item: Pick<
    Notification,
    | "kind"
    | "dog_id"
    | "entity_id"
    | "course_enrollment_id"
    | "course_session_id"
    | "fitness_package_id"
    | "fitness_session_id"
  >,
  role: Role,
) {
  const base = role === "admin" ? "/admin" : "/app";
  if (item.kind.startsWith("fitness_")) {
    const id = item.fitness_package_id || item.entity_id;
    const href = `${base}/fitness/${id}`;
    if (item.fitness_session_id)
      return `${href}#spotkanie-${item.fitness_session_id}`;
    if (
      [
        "fitness_settled",
        "fitness_payment_recorded",
        "fitness_payment_refunded",
      ].includes(item.kind)
    )
      return `${href}#rozliczenie-${id}`;
    return href;
  }
  if (item.kind.startsWith("course_")) {
    const enrollment = item.course_enrollment_id;
    const href = `${base}/courses/${item.entity_id}${enrollment ? `?enrollment=${enrollment}` : ""}`;
    if (item.course_session_id)
      return `${href}#spotkanie-${item.course_session_id}`;
    if (
      enrollment &&
      [
        "course_payment_recorded",
        "course_payment_refunded",
        "course_settled",
      ].includes(item.kind)
    )
      return `${href}#rozliczenie-${enrollment}`;
    return `${href}#zgloszenia`;
  }
  if (item.kind === "plan_published")
    return `${base}/care/plans/${item.entity_id}`;
  if (item.kind.startsWith("consultation_"))
    return `${base}/consultations/${item.entity_id}`;
  if (item.kind.startsWith("payment_"))
    return `${base}/finance#payment-${item.entity_id}`;
  if (item.kind.startsWith("walk_") || item.kind.startsWith("registration_"))
    return `${base}/walks/${item.entity_id}`;
  if (item.kind === "progress_submitted" && role === "admin")
    return `/admin/work/progress/${item.entity_id}`;
  if (
    (item.kind === "follow_up_changed" || item.kind === "follow_up_reminder") &&
    role === "admin"
  )
    return `/admin/work/follow-ups/${item.entity_id}`;
  return `${base}/dogs/${item.dog_id}/care`;
}
export function notificationCountLabel(count: number | null) {
  return count === null
    ? "Powiadomienia — licznik chwilowo niedostępny"
    : count === 0
      ? "Powiadomienia — wszystkie przeczytane"
      : `Powiadomienia — nieprzeczytane: ${count}`;
}
