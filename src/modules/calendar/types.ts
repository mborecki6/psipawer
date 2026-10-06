export type Appointment = {
  id: string;
  kind: "walk" | "consultation" | "block" | "course" | "fitness";
  title: string;
  starts_at: string;
  ends_at: string;
  status: string;
  location: string;
  version: number | null;
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
};
