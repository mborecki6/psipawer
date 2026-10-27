import type { Consultation } from "@/modules/consultations/types";
import type {
  Course,
  CourseEnrollment,
  CourseSession,
} from "@/modules/courses/types";
import type { FitnessBalance } from "@/modules/fitness/types";
import type { ServiceRequest } from "@/modules/service-requests/types";

export type DashboardConsultation = Pick<
  Consultation,
  "id" | "dog_id" | "status" | "starts_at" | "service_name" | "created_at"
>;
export type DashboardEnrollment = Pick<
  CourseEnrollment,
  "id" | "dog_id" | "course_id" | "status" | "created_at"
> & {
  courses: Pick<Course, "title" | "service_name" | "status"> | null;
};
export type DashboardCourseSession = Pick<
  CourseSession,
  "id" | "course_id" | "starts_at" | "status"
>;
export type DashboardFitness = Pick<
  FitnessBalance,
  "id" | "dog_id" | "status" | "service_name" | "next_starts_at" | "created_at"
>;
export type DashboardRequest = Pick<
  ServiceRequest,
  "id" | "dog_id" | "service_id" | "service_name" | "status" | "created_at"
>;
export type DashboardActivities = {
  consultations: DashboardConsultation[];
  enrollments: DashboardEnrollment[];
  courseSessions: DashboardCourseSession[];
  fitness: DashboardFitness[];
  requests: DashboardRequest[];
};
