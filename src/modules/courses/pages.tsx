import { randomUUID } from "node:crypto";
import { requireSession } from "@/lib/auth/session";
import { getServices } from "@/modules/services/queries";
import { getCourse, getCourses } from "./queries";
import { courseFilter, coursePage, enrollmentFilter } from "./types";
import { CourseDetailView, CourseListView, CourseCreateView } from "./views";
import { getCourseCare } from "@/modules/care/queries";
import { getBookingChoices } from "@/modules/calendar/booking-queries";
export async function CoursesPage({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string; page?: string; service?: string }>;
}) {
  const search = await searchParams,
    { role } = await requireSession();
  const filter = courseFilter(search.filter, role === "admin"),
    page = coursePage(search.page);
  return (
    <CourseListView
      {...await getCourses(filter, page, search.service)}
      filter={filter}
      page={page}
      serviceId={search.service}
    />
  );
}
export async function CoursePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{
    page?: string;
    filter?: string;
    history?: string;
    enrollment?: string;
    plans?: string;
  }>;
}) {
  const { id } = await params,
    search = await searchParams;
  const page = search.enrollment ? 1 : coursePage(search.page),
    filter = search.enrollment ? "all" : enrollmentFilter(search.filter),
    historyPage = coursePage(search.history);
  const data = await getCourse(
    id,
    page,
    filter,
    historyPage,
    search.enrollment,
  );
  const plansPage = coursePage(search.plans);
  const care = await getCourseCare(
    id,
    data.enrollments.map((e) => e.id),
    plansPage,
  );
  return (
    <CourseDetailView
      {...data}
      care={care}
      plansPage={plansPage}
      page={page}
      filter={filter}
      historyPage={historyPage}
      requestId={randomUUID()}
      now={new Date().toISOString()}
    />
  );
}
export async function CourseCreatePage({
  searchParams,
}: {
  searchParams: Promise<{ service?: string }>;
}) {
  const { db, user } = await requireSession("admin");
  const [search, { services }, booking] = await Promise.all([
    searchParams,
    getServices(true),
    getBookingChoices(db, user.id),
  ]);
  return (
    <CourseCreateView
      id={randomUUID()}
      services={services.filter(
        (s) =>
          s.active &&
          s.kind === "course" &&
          s.course_format &&
          s.sessions_count &&
          s.duration_minutes,
      )}
      serviceId={search.service}
      booking={booking}
    />
  );
}
