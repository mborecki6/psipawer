import type { RegistrationStatus } from "@/lib/domain";
export type Dog = {
  id: string;
  guardian_id: string;
  name: string;
  birth_date: string | null;
  approximate_age: string | null;
  breed: string | null;
  sex: string;
  weight_kg: number | null;
  color: string | null;
  status: string;
  avatar_path: string | null;
  created_at: string;
};
export type Walk = {
  id: string;
  starts_at: string;
  duration_minutes: number;
  public_location: string;
  type: string;
  price_cents: number;
  capacity: number;
  booking_mode: string;
  status: string;
  info: string;
  tags: string[];
  cancellation_deadline_hours: number;
  cancellation_reason: string | null;
  change_note: string | null;
  updated_at: string;
};
export type Registration = {
  id: string;
  walk_id: string;
  dog_id: string;
  status: RegistrationStatus;
  payment_status: string;
  package_id?: string | null;
  attendance: string;
  decision_note: string | null;
  cancellation_free_until: string | null;
  created_at: string;
};
export type Snapshot = {
  dogs: Dog[];
  walks: Walk[];
  registrations: Registration[];
};
