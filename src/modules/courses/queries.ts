import "server-only";
import { notFound } from "next/navigation";
import { z } from "zod";
import { requireSession } from "@/lib/auth/session";
import { allRows } from "@/lib/data/queries";
import type {
  CourseBalance,
  CourseRefundRecord,
  PaymentRecord,
} from "@/lib/finance";
import type {
  Course,
  CourseSummary,
  SessionDetail,
  EnrollmentDetail,
  AttendanceDetail,
  CourseHistory,
} from "./types";
const columns =
  "id,service_id,service_version,service_name,price_cents,is_test_price,sessions_count,duration_minutes,course_format,title,public_location,capacity,status,version,created_at,updated_at";
const enrollmentColumns =
  "id,course_id,dog_id,guardian_id,selected_course_version,status,agreed_price_cents,is_test_price,charge_cents,version,created_at,updated_at,dogs(name)";
export async function getCourses(
  filter: string,
  page: number,
  service?: string,
) {
  const { db, role } = await requireSession();
  if (service && !z.uuid().safeParse(service).success) notFound();
  let query = db
    .from("courses")
    .select(
      `${columns},course_sessions(starts_at,status)${filter === "mine" ? ",course_enrollments!inner(id)" : ""}`,
    );
  if (filter === "history")
    query = query.in("status", ["completed", "cancelled"]);
  else if (filter === "active" || filter === "mine")
    query = query.in("status", ["draft", "open", "closed"]);
  else query = query.eq("status", filter);
  if (service) query = query.eq("service_id", service);
  const { data, error } = await query
    .order("created_at", { ascending: false })
    .order("id")
    .range((page - 1) * 20, page * 20);
  if (error) throw new Error("Nie udało się pobrać kursów.");
  return {
    role,
    courses: (data || []).slice(0, 20) as unknown as CourseSummary[],
    more: (data?.length || 0) > 20,
  };
}
export async function getCourse(
  id: string,
  page: number,
  filter: string,
  historyPage: number,
  focus?: string,
) {
  if (!z.uuid().safeParse(id).success) notFound();
  if (focus && !z.uuid().safeParse(focus).success) notFound();
  const { db, role } = await requireSession();
  const { data: course, error } = await db
    .from("courses")
    .select(columns)
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error("Nie udało się pobrać kursu.");
  if (!course) notFound();
  let enrollmentQuery = db
    .from("course_enrollments")
    .select(enrollmentColumns)
    .eq("course_id", id);
  if (focus) enrollmentQuery = enrollmentQuery.eq("id", focus);
  else if (filter !== "all")
    enrollmentQuery =
      filter === "history"
        ? enrollmentQuery.in("status", ["rejected", "cancelled"])
        : enrollmentQuery.eq("status", filter);
  const [
    sessions,
    enrollments,
    roster,
    attendance,
    history,
    ownDogs,
    enrolledDogs,
  ] = await Promise.all([
    db
      .from("course_sessions")
      .select(
        "id,course_id,ordinal,starts_at,duration_minutes,public_location,status,version,course_session_private_details(exact_location)",
      )
      .eq("course_id", id)
      .order("ordinal")
      .limit(100),
    enrollmentQuery
      .order("created_at")
      .order("id")
      .range(focus ? 0 : (page - 1) * 20, focus ? 20 : page * 20),
    db
      .from("course_enrollments")
      .select(enrollmentColumns)
      .eq("course_id", id)
      .eq("status", "accepted")
      .order("id")
      .limit(50),
    allRows<AttendanceDetail>((from, to) =>
      db
        .from("course_attendance")
        .select(
          "session_id,enrollment_id,attendance,version,course_enrollments!inner(course_id,dog_id,dogs(name))",
        )
        .eq("course_enrollments.course_id", id)
        .order("session_id")
        .order("enrollment_id")
        .range(from, to),
    ),
    db
      .from("course_history")
      .select(
        "id,course_id,session_id,enrollment_id,action,note,details,created_at",
      )
      .eq("course_id", id)
      .order("created_at", { ascending: false })
      .order("id")
      .range((historyPage - 1) * 10, historyPage * 10),
    role === "client"
      ? allRows<{ id: string; name: string }>((from, to) =>
          db
            .from("dogs")
            .select("id,name")
            .order("name")
            .order("id")
            .range(from, to),
        )
      : Promise.resolve([]),
    role === "client"
      ? allRows<{ dog_id: string }>((from, to) =>
          db
            .from("course_enrollments")
            .select("dog_id")
            .eq("course_id", id)
            .order("dog_id")
            .range(from, to),
        )
      : Promise.resolve([]),
  ]);
  if (sessions.error || enrollments.error || roster.error || history.error)
    throw new Error(
      "Nie udało się pobrać spotkań, zgłoszeń lub historii kursu.",
    );
  const ids = (enrollments.data || []).slice(0, 20).map((e) => e.id);
  const [balances, payments, refunds] = ids.length
    ? await Promise.all([
        allRows<CourseBalance>((from, to) =>
          db
            .from("course_balances")
            .select("*")
            .in("id", ids)
            .order("id")
            .range(from, to),
        ),
        allRows<PaymentRecord>((from, to) =>
          db
            .from("payments")
            .select("*")
            .in("course_enrollment_id", ids)
            .order("created_at")
            .order("id")
            .range(from, to),
        ),
        allRows<CourseRefundRecord>((from, to) =>
          db
            .from("course_payment_refunds")
            .select("id,payment_id,enrollment_id,amount_cents,note,created_at")
            .in("enrollment_id", ids)
            .order("created_at")
            .order("id")
            .range(from, to),
        ),
      ])
    : [[], [], []];
  return {
    role,
    course: course as Course,
    sessions: (sessions.data || []) as unknown as SessionDetail[],
    enrollments: (enrollments.data || []).slice(
      0,
      20,
    ) as unknown as EnrollmentDetail[],
    roster: (roster.data || []) as unknown as EnrollmentDetail[],
    attendance,
    history: (history.data || []).slice(0, 10) as CourseHistory[],
    more: (enrollments.data?.length || 0) > 20,
    historyMore: (history.data?.length || 0) > 10,
    dogs: ownDogs.filter((d) => !enrolledDogs.some((e) => e.dog_id === d.id)),
    hasDogs: ownDogs.length > 0,
    balances,
    payments,
    refunds,
    focus,
  };
}
