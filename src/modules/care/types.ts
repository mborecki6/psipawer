export type CareTemplate = {
  id: string;
  title: string;
  body: string;
  version: number;
  updated_at: string;
};
export type CareDraft = {
  id?: string;
  context_key?: string;
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
  control_invite_on?: string | null;
  version: number;
  updated_at: string;
};
export type CarePlan = {
  id: string;
  context_key?: string;
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
  control_invite_on?: string | null;
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

export type CareContext = Pick<
  CarePlan,
  | "consultation_id"
  | "course_enrollment_id"
  | "course_session_id"
  | "fitness_package_id"
  | "fitness_session_id"
>;
export type ControlInvitation = {
  id: string;
  plan_id: string;
  dog_id: string;
  guardian_id: string;
  due_on: string;
  status: "open" | "requested" | "cancelled" | "superseded";
  version: number;
  consultation_id: string | null;
};
export type ReportingAccess = {
  id: string | null;
  included: boolean;
  allowed: boolean;
  starts_at: string | null;
  expires_at: string | null;
  version: number;
  overridden: boolean;
  snapshot_days: number | null;
  service_id: string | null;
};
export type CareContextSummary = CareContext & {
  context_key: string;
  title: string;
  published_id: string | null;
  revision: number | null;
  has_draft: boolean;
};

// For navigation only. SQL independently derives the authoritative context.
export function careContextKey(context: CareContext): string {
  if (context.consultation_id) return `consultation:${context.consultation_id}`;
  if (context.course_enrollment_id)
    return `course:${context.course_enrollment_id}:${context.course_session_id || "all"}`;
  if (context.fitness_package_id)
    return `fitness:${context.fitness_package_id}:${context.fitness_session_id || "all"}`;
  return "general";
}
export function careContextSearch(context: CareContext): string {
  const search = new URLSearchParams();
  if (context.consultation_id)
    search.set("consultation", context.consultation_id);
  else if (context.course_enrollment_id) {
    search.set("enrollment", context.course_enrollment_id);
    if (context.course_session_id)
      search.set("session", context.course_session_id);
  } else if (context.fitness_package_id) {
    search.set("fitness", context.fitness_package_id);
    if (context.fitness_session_id)
      search.set("fitness_session", context.fitness_session_id);
  } else search.set("context", "general");
  return search.toString();
}
export function careContextLabel(context: CareContext): string {
  if (context.consultation_id) return "Po konsultacji";
  if (context.course_enrollment_id)
    return context.course_session_id ? "Po spotkaniu kursu" : "Cały kurs";
  if (context.fitness_package_id)
    return context.fitness_session_id
      ? "Po spotkaniu fitness"
      : "Cały pakiet fitness";
  return "Ogólny plan pracy";
}

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
  draftSessions?: (string | null)[];
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
  draftSessions?: (string | null)[];
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
