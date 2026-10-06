export type CareTemplate = {
  id: string;
  title: string;
  body: string;
  version: number;
  updated_at: string;
};
export type CareDraft = {
  dog_id: string;
  consultation_id: string | null;
  course_id?: string | null;
  course_enrollment_id?: string | null;
  course_session_id?: string | null;
  fitness_package_id?: string | null;
  fitness_session_id?: string | null;
  title: string;
  body: string;
  follow_up_on: string | null;
  version: number;
  updated_at: string;
};
export type CarePlan = {
  id: string;
  consultation_id: string | null;
  course_id?: string | null;
  course_enrollment_id?: string | null;
  course_session_id?: string | null;
  course_enrollments?: { id: string } | null;
  fitness_package_id?: string | null;
  fitness_session_id?: string | null;
  fitness_packages?: { id: string } | null;
  dog_id: string;
  revision: number;
  title: string;
  body: string;
  follow_up_on: string | null;
  published_at: string;
};
export type CareProgress = {
  id: string;
  dog_id: string;
  plan_id: string;
  attempted: string;
  went_well: string;
  difficult: string;
  created_at: string;
  reviewed_at: string | null;
  care_plan_versions: { title: string; revision: number };
  dogs?: { name: string };
};
export type CareSummary = Omit<CarePlan, "body" | "consultation_id"> & {
  dog_name: string;
  unread_count: number;
};

export type CareConsultation = {
  id: string;
  service_name: string | null;
  starts_at: string | null;
  status: "requested" | "scheduled" | "completed" | "cancelled";
};
export type CareCourse = {
  id: string;
  course_id: string;
  title: string;
  sessions: {
    id: string;
    ordinal: number;
    starts_at: string;
    status: "scheduled" | "completed" | "cancelled";
  }[];
};
export type CourseCarePage = {
  plans: Pick<
    CarePlan,
    "id" | "title" | "revision" | "published_at" | "course_session_id"
  >[];
  more: boolean;
  hasDraft: boolean;
};

export type CareFitness = {
  id: string;
  title: string;
  sessions: {
    id: string;
    ordinal: number;
    starts_at: string | null;
    status: "pending" | "scheduled" | "completed" | "cancelled";
  }[];
};
export type FitnessCarePage = {
  plans: Pick<
    CarePlan,
    "id" | "title" | "revision" | "published_at" | "fitness_session_id"
  >[];
  more: boolean;
  hasDraft: boolean;
  canPrepare: boolean;
};

export function careDate(value: string) {
  return new Intl.DateTimeFormat("pl-PL", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "Europe/Warsaw",
  }).format(new Date(value.length === 10 ? `${value}T12:00:00Z` : value));
}

export function carePage(value?: string) {
  return value && /^\d{1,5}$/.test(value) ? Math.max(1, Number(value)) : 1;
}
