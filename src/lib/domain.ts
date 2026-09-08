export type RegistrationStatus =
  | "pending"
  | "accepted"
  | "waitlisted"
  | "rejected"
  | "withdrawn"
  | "cancelled_on_time"
  | "cancelled_late";
export const transitions: Record<RegistrationStatus, RegistrationStatus[]> = {
  pending: ["accepted", "waitlisted", "rejected", "withdrawn"],
  accepted: ["waitlisted", "rejected", "cancelled_on_time", "cancelled_late"],
  waitlisted: ["accepted", "rejected", "pending", "withdrawn"],
  rejected: ["pending"],
  withdrawn: [],
  cancelled_on_time: [],
  cancelled_late: [],
};
export function mayTransition(
  from: RegistrationStatus,
  to: RegistrationStatus,
) {
  return transitions[from].includes(to);
}
export function validateRegistration(input: {
  guardianId: string;
  userId: string;
  walkStatus: string;
  mode: string;
  duplicate: boolean;
}) {
  if (input.guardianId !== input.userId)
    throw new Error("To nie jest Twój pies.");
  if (input.walkStatus !== "open") throw new Error("Zapisy są zamknięte.");
  if (input.mode === "invite") throw new Error("Spacer tylko na zaproszenie.");
  if (input.duplicate) throw new Error("Zgłoszenie już istnieje.");
}
export function mayAccept(accepted: number, capacity: number) {
  return accepted < capacity;
}
export function canReadLocation(role: string, ownsAcceptedDog: boolean) {
  return role === "admin" || ownsAcceptedDog;
}
export function canAssignRole(role: string) {
  return role === "service_role";
}
export function kpiUrl(filter: string) {
  return filter === "due-payments"
    ? "/admin/finance?filter=due"
    : `/admin/walks?filter=${["pending", "today", "next-six"].includes(filter) ? filter : "upcoming"}`;
}
export function warsawDate(date: Date | string) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Warsaw",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(date));
}
export function dateLabel(value: string) {
  return new Intl.DateTimeFormat("pl-PL", {
    timeZone: "Europe/Warsaw",
    weekday: "short",
    day: "numeric",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}
export function money(cents: number) {
  return new Intl.NumberFormat("pl-PL", {
    style: "currency",
    currency: "PLN",
  }).format(cents / 100);
}
export const labels: Record<string, string> = {
  new: "Nowy profil",
  needs_review: "Do sprawdzenia",
  consultation_required: "Wymagana konsultacja",
  approved: "Dopuszczony",
  approved_conditional: "Warunkowo dopuszczony",
  suspended: "Wstrzymany",
  not_eligible: "Niezakwalifikowany",
  pending: "Do decyzji",
  accepted: "Zaakceptowany",
  waitlisted: "Lista rezerwowa",
  rejected: "Odrzucony",
  withdrawn: "Wycofany",
  cancelled_on_time: "Odwołany w terminie",
  cancelled_late: "Późne odwołanie",
  open: "Otwarte zapisy",
  full: "Komplet",
  closed: "Zapisy zamknięte",
  completed: "Zakończony",
  cancelled: "Odwołany",
  draft: "Szkic",
  approval: "Po akceptacji",
  automatic: "Zapisy automatyczne",
  invite: "Na zaproszenie",
  present: "Obecny",
  absent: "Nieobecność usprawiedliwiona",
  no_show: "Nieobecność płatna",
  due: "Do zapłaty",
  paid: "Opłacone",
  refunded: "Zwrot / korekta",
  active: "Aktywny",
  expired: "Wygasły",
  none: "Nie dotyczy",
  unknown: "Nieznana",
  female: "Suka",
  male: "Pies",
};
