export type Service = {
  id: string;
  name: string;
  description: string;
  kind: "individual" | "group" | "course" | "package" | "voucher";
  course_format?: "individual" | "group" | null;
  booking_flow: "consultation" | "walk" | "fitness" | "catalogue";
  meeting_mode: "in_person" | "online" | null;
  price_cents: number;
  price_unit: string;
  duration_minutes: number | null;
  sessions_count: number | null;
  active: boolean;
  is_test_price: boolean;
  source_url: string;
  source_note: string;
  version: number;
  updated_at: string;
  reporting_included?: boolean;
  reporting_days?: number | null;
};
export type ServiceRevision = Pick<
  Service,
  "name" | "version" | "price_cents" | "price_unit" | "active" | "is_test_price"
> & { created_at: string; changed_by: string | null };
export const serviceKinds = {
  individual: "Indywidualnie",
  group: "W grupie",
  course: "Kurs",
  package: "Pakiet",
  voucher: "Karta podarunkowa",
};
export function serviceReporting(
  s: Pick<Service, "reporting_included" | "reporting_days">,
) {
  return s.reporting_included === false
    ? "Raportowanie postępów nie jest włączone."
    : s.reporting_days
      ? `Raportowanie postępów: ${s.reporting_days} dni od pierwszych opublikowanych zaleceń.`
      : "Raportowanie postępów bez limitu czasu.";
}
export function serviceTime(
  s: Pick<Service, "sessions_count" | "duration_minutes">,
) {
  if (!s.duration_minutes) return "Czas do ustalenia";
  return `${s.sessions_count && s.sessions_count > 1 ? `${s.sessions_count} × ` : ""}${s.duration_minutes} min`;
}
