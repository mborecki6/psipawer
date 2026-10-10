export type Appointment = {
  id: string;
  kind: "walk" | "consultation" | "block" | "course" | "fitness";
  title: string;
  starts_at: string;
  ends_at: string;
  status: string;
  location: string;
  version: number | null;
  appointment_id?: string;
  assigned_staff_id?: string | null;
  assigned_staff_name?: string | null;
  resource_id?: string | null;
  resource_name?: string | null;
  assignment_version?: number;
  created_by?: string | null;
  created_by_name?: string | null;
  break_warnings?: BreakWarning[];
};

export type BreakWarning = {
  previous_end: string;
  next_start: string;
  gap_minutes: number;
  required_minutes: number;
};
export type CalendarTeamMember = { user_id: string; full_name: string };
export type CalendarResource = {
  id: string;
  name: string;
  exclusive: boolean;
  active: boolean;
  version: number;
};

export type WorkingDay = {
  weekday: number;
  enabled: boolean;
  start_minute: number;
  end_minute: number;
};
export type CalendarSettings = {
  version: number;
  hours_enabled: boolean;
  before_minutes: number;
  after_minutes: number;
  week: WorkingDay[];
  use_default?: boolean;
};
