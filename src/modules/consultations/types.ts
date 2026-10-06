export type ConsultationStatus =
  "requested" | "scheduled" | "completed" | "cancelled";
export type Consultation = {
  id: string;
  dog_id: string;
  topic: string;
  availability: string;
  status: ConsultationStatus;
  starts_at: string | null;
  duration_minutes: number | null;
  meeting_mode: "in_person" | "online" | null;
  location: string;
  version: number;
  created_at: string;
  dogs: { name: string };
  service_name: string | null;
  agreed_price_cents: number | null;
  service_duration_minutes: number | null;
  service_meeting_mode: "in_person" | "online" | null;
  is_test_price: boolean | null;
};
export type ConsultationHistory = {
  id: string;
  version: number;
  action:
    | "requested"
    | "scheduled"
    | "rescheduled"
    | "completed"
    | "cancelled"
    | "price_agreed";
  starts_at: string | null;
  duration_minutes: number | null;
  meeting_mode: "in_person" | "online" | null;
  location: string;
  note: string;
  created_at: string;
  agreed_price_cents?: number | null;
  is_test_price?: boolean | null;
};
export const consultationLabels = {
  requested: "Do ustalenia",
  scheduled: "Umówiona",
  completed: "Zakończona",
  cancelled: "Odwołana",
};
export const historyLabels = {
  requested: "Zgłoszenie przyjęte",
  scheduled: "Ustalono termin",
  rescheduled: "Zmieniono szczegóły spotkania",
  completed: "Konsultacja zakończona",
  cancelled: "Konsultacja odwołana",
  price_agreed: "Uzgodniono kwotę spotkania",
};
export function consultationFilter(value?: string) {
  return value === "requested" || value === "scheduled" || value === "history"
    ? value
    : "active";
}
export function consultationPage(value?: string) {
  return value && /^\d{1,5}$/.test(value) ? Math.max(1, Number(value)) : 1;
}
