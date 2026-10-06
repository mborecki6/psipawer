export type FitnessStatus =
  "requested" | "active" | "completed" | "cancelled" | "rejected";
export type FitnessPackage = {
  id: string;
  dog_id: string;
  guardian_id: string;
  service_id: string;
  service_version: number;
  service_name: string;
  sessions_count: number;
  duration_minutes: number;
  agreed_price_cents: number;
  is_test_price: boolean;
  topic: string;
  availability: string;
  status: FitnessStatus;
  charge_cents: number;
  accepted_at: string | null;
  settled_at: string | null;
  version: number;
  created_at: string;
  updated_at: string;
  dogs: { name: string } | null;
};
export type FitnessSession = {
  id: string;
  package_id: string;
  ordinal: number;
  status: "pending" | "scheduled" | "completed" | "cancelled";
  starts_at: string | null;
  duration_minutes: number;
  attendance: "present" | "absent" | "excused" | null;
  version: number;
  fitness_session_private_details: { exact_location: string } | null;
};
export type FitnessHistory = {
  id: string;
  package_id: string;
  session_id: string | null;
  action: string;
  note: string;
  details: Record<string, unknown>;
  created_at: string;
};
export type FitnessBalance = {
  id: string;
  dog_id: string;
  guardian_id: string;
  service_name: string;
  status: FitnessStatus;
  version: number;
  created_at: string;
  agreed_price_cents: number;
  charge_cents: number;
  is_test_price: boolean;
  sessions_count: number;
  duration_minutes: number;
  settled_at: string | null;
  paid_cents: number;
  refunded_cents: number;
  completed_sessions: number;
  next_starts_at: string | null;
  due_cents: number;
  refund_due_cents: number;
  needs_settlement: boolean;
  needs_review: boolean;
  can_pay: boolean;
};
export type FitnessRefund = {
  id: string;
  payment_id: string;
  package_id: string;
  amount_cents: number;
  note: string;
  created_at: string;
};
export const fitnessLabels: Record<FitnessStatus, string> = {
  requested: "Czeka na decyzję",
  active: "W trakcie",
  completed: "Zakończony",
  cancelled: "Rezygnacja lub odwołanie",
  rejected: "Nieprzyjęte",
};
export const fitnessSessionLabels = {
  pending: "Do umówienia",
  scheduled: "Umówione",
  completed: "Zakończone",
  cancelled: "Odwołane",
};
export const fitnessAttendanceLabels = {
  present: "Obecny",
  absent: "Nieobecny",
  excused: "Usprawiedliwiony",
};
export function fitnessFilter(value?: string) {
  return value &&
    ["open", "requested", "active", "history", "all"].includes(value)
    ? value
    : "open";
}
export function fitnessPage(value?: string) {
  return value && /^[1-9]\d{0,4}$/.test(value) ? Number(value) : 1;
}
