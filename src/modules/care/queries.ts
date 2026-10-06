import "server-only";
import { notFound } from "next/navigation";
import { z } from "zod";
import { requireSession } from "@/lib/auth/session";
import type { FollowUp } from "@/modules/work/types";
import type {
  CareDraft,
  CarePlan,
  CareProgress,
  CareSummary,
  CareTemplate,
  CareConsultation,
  CareCourse,
  CourseCarePage,
  CareFitness,
  FitnessCarePage,
} from "./types";

const planColumns =
  "id,dog_id,consultation_id,course_id,course_enrollment_id,course_session_id,fitness_package_id,fitness_session_id,title,body,revision,follow_up_on,published_at,course_enrollments(id),fitness_packages!care_plan_fitness_fk(id)";
const progressColumns =
  "id,dog_id,plan_id,attempted,went_well,difficult,created_at,reviewed_at,care_plan_versions(title,revision)";
type DB = Awaited<ReturnType<typeof requireSession>>["db"];

async function templates(db: DB): Promise<CareTemplate[]> {
  const rows: CareTemplate[] = [];
  for (let offset = 0; ; offset += 100) {
    const { data, error } = await db
      .from("care_templates")
      .select("id,title,body,version,updated_at")
      .order("title")
      .order("id")
      .range(offset, offset + 99);
    if (error) throw new Error("Nie udało się pobrać biblioteki zaleceń.");
    rows.push(...(data || []));
    if (!data || data.length < 100) return rows;
  }
}
export async function getCareLibrary() {
  const { db } = await requireSession("admin");
  return templates(db);
}
export async function getDogCare(
  id: string,
  historyPage: number,
  progressPage: number,
  requestedId?: string,
  requestedEnrollment?: string,
  requestedSession?: string,
  requestedFitnessId?: string,
  requestedFitnessSession?: string,
) {
  if (!z.uuid().safeParse(id).success) notFound();
  const { db, role } = await requireSession();
  const dog = await db
    .from("dogs")
    .select("id,name,guardian_id")
    .eq("id", id)
    .maybeSingle();
  if (dog.error) throw new Error("Nie udało się pobrać profilu psa.");
  if (!dog.data) notFound();
  const [
    latest,
    history,
    progress,
    draft,
    library,
    consultations,
    courses,
    fitness,
  ] = await Promise.all([
    db
      .from("care_plan_versions")
      .select(planColumns)
      .eq("dog_id", id)
      .order("revision", { ascending: false })
      .limit(1)
      .maybeSingle(),
    db
      .from("care_plan_versions")
      .select(planColumns)
      .eq("dog_id", id)
      .order("revision", { ascending: false })
      .range(1 + (historyPage - 1) * 5, 6 + (historyPage - 1) * 5),
    db
      .from("care_progress")
      .select(progressColumns)
      .eq("dog_id", id)
      .order("created_at", { ascending: false })
      .order("id")
      .range((progressPage - 1) * 10, progressPage * 10),
    role === "admin"
      ? db
          .from("care_drafts")
          .select(
            "dog_id,consultation_id,course_id,course_enrollment_id,course_session_id,fitness_package_id,fitness_session_id,title,body,follow_up_on,version,updated_at",
          )
          .eq("dog_id", id)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    role === "admin" ? templates(db) : Promise.resolve([]),
    role === "admin" ? dogConsultations(db, id) : Promise.resolve([]),
    role === "admin"
      ? dogCourses(db, id, dog.data.guardian_id)
      : Promise.resolve([]),
    role === "admin"
      ? dogFitness(db, id, dog.data.guardian_id)
      : Promise.resolve([]),
  ]);
  if (latest.error || history.error || progress.error || draft.error)
    throw new Error("Nie udało się pobrać planu i postępów. Spróbuj ponownie.");
  const followUp = latest.data
    ? await db
        .from("care_follow_ups")
        .select("id,plan_id,dog_id,due_on,status,version,created_at,closed_at")
        .eq("plan_id", latest.data.id)
        .maybeSingle()
    : { data: null, error: null };
  if (followUp.error)
    throw new Error("Nie udało się pobrać kontaktu kontrolnego.");
  const requestedCourse =
    !requestedId && !requestedFitnessId && !requestedFitnessSession
      ? courses.find(
          (c) =>
            c.id === requestedEnrollment &&
            (!requestedSession ||
              c.sessions.some(
                (s) => s.id === requestedSession && s.status !== "cancelled",
              )),
        ) || null
      : null;
  const requestedFitness =
    !requestedId && !requestedEnrollment && !requestedSession
      ? fitness.find(
          (p) =>
            p.id === requestedFitnessId &&
            (!requestedFitnessSession ||
              p.sessions.some(
                (s) =>
                  s.id === requestedFitnessSession &&
                  ["scheduled", "completed"].includes(s.status),
              )),
        ) || null
      : null;
  return {
    role,
    dog: dog.data,
    latest: latest.data as CarePlan | null,
    draft: draft.data as CareDraft | null,
    history: (history.data || []).slice(0, 5) as unknown as CarePlan[],
    moreHistory: (history.data?.length || 0) > 5,
    progress: (progress.data || []).slice(0, 10) as unknown as CareProgress[],
    moreProgress: (progress.data?.length || 0) > 10,
    templates: library,
    followUp: followUp.data as FollowUp | null,
    consultations,
    courses,
    fitness,
    requestedFitness,
    requestedFitnessSession: requestedFitness
      ? requestedFitnessSession
      : undefined,
    requestedFitnessUnavailable:
      role === "admin" &&
      Boolean(requestedFitnessId || requestedFitnessSession) &&
      !requestedFitness,
    requestedCourse,
    requestedSession: requestedCourse ? requestedSession : undefined,
    requestedCourseUnavailable:
      role === "admin" &&
      Boolean(requestedEnrollment || requestedSession) &&
      !requestedCourse,
    requestedConsultation:
      !requestedEnrollment &&
      !requestedSession &&
      !requestedFitnessId &&
      !requestedFitnessSession
        ? consultations.find(
            (c) =>
              c.id === requestedId &&
              (c.status === "scheduled" || c.status === "completed"),
          ) || null
        : null,
    requestedUnavailable:
      role === "admin" &&
      Boolean(requestedId) &&
      (Boolean(
        requestedEnrollment ||
        requestedSession ||
        requestedFitnessId ||
        requestedFitnessSession,
      ) ||
        !consultations.some(
          (c) =>
            c.id === requestedId &&
            (c.status === "scheduled" || c.status === "completed"),
        )),
  };
}

async function dogFitness(
  db: DB,
  dogId: string,
  guardianId: string,
): Promise<CareFitness[]> {
  const choices: CareFitness[] = [];
  for (let from = 0; ; from += 100) {
    const { data, error } = await db
      .from("fitness_packages")
      .select(
        "id,guardian_id,status,service_name,fitness_sessions(id,ordinal,starts_at,status)",
      )
      .eq("dog_id", dogId)
      .order("created_at", { ascending: false })
      .order("id")
      .range(from, from + 99);
    if (error)
      throw new Error("Nie udało się pobrać pakietów fitness do planu.");
    for (const p of (data || []) as unknown as {
      id: string;
      guardian_id: string;
      status: string;
      service_name: string;
      fitness_sessions: CareFitness["sessions"];
    }[])
      if (
        p.guardian_id === guardianId &&
        ["active", "completed"].includes(p.status)
      )
        choices.push({
          id: p.id,
          title: p.service_name,
          sessions: [...p.fitness_sessions].sort(
            (a, b) => a.ordinal - b.ordinal,
          ),
        });
    if (!data || data.length < 100) return choices;
  }
}

export async function getFitnessCare(
  id: string,
  page: number,
): Promise<FitnessCarePage> {
  if (
    !z.uuid().safeParse(id).success ||
    !Number.isInteger(page) ||
    page < 1 ||
    page > 99999
  )
    notFound();
  const { db } = await requireSession();
  const { data, error } = await db.rpc("fitness_care_feed", {
    p_package: id,
    p_offset: (page - 1) * 5,
  });
  if (error || !Array.isArray(data))
    throw new Error("Nie udało się pobrać zaleceń fitness.");
  if (data.length !== 1) notFound();
  const row = data[0] as {
    plans: FitnessCarePage["plans"];
    has_draft: boolean;
    can_prepare: boolean;
  };
  return {
    plans: row.plans.slice(0, 5),
    more: row.plans.length > 5,
    hasDraft: row.has_draft,
    canPrepare: row.can_prepare,
  };
}

async function dogCourses(
  db: DB,
  dogId: string,
  guardianId: string,
): Promise<CareCourse[]> {
  type Row = {
    id: string;
    guardian_id: string;
    courses: {
      id: string;
      title: string;
      status: string;
      course_sessions: CareCourse["sessions"];
    };
  };
  const choices: CareCourse[] = [];
  for (let from = 0; ; from += 100) {
    const { data, error } = await db
      .from("course_enrollments")
      .select(
        "id,guardian_id,courses!inner(id,title,status,course_sessions(id,ordinal,starts_at,status))",
      )
      .eq("dog_id", dogId)
      .eq("status", "accepted")
      .order("course_id")
      .order("id")
      .range(from, from + 99);
    if (error) throw new Error("Nie udało się pobrać kursów do planu.");
    for (const row of (data || []) as unknown as Row[])
      if (
        row.guardian_id === guardianId &&
        ["open", "closed", "completed"].includes(row.courses.status)
      )
        choices.push({
          id: row.id,
          course_id: row.courses.id,
          title: row.courses.title,
          sessions: [...row.courses.course_sessions].sort(
            (a, b) => a.ordinal - b.ordinal,
          ),
        });
    if (!data || data.length < 100) return choices;
  }
}

export async function getCourseCare(
  id: string,
  enrollments: string[],
  page: number,
): Promise<Record<string, CourseCarePage>> {
  const { db } = await requireSession();
  if (
    !z.uuid().safeParse(id).success ||
    enrollments.length > 20 ||
    !enrollments.every((x) => z.uuid().safeParse(x).success)
  )
    notFound();
  if (!enrollments.length) return {};
  const { data, error } = await db.rpc("course_care_feed", {
    p_course: id,
    p_enrollments: enrollments,
    p_offset: (page - 1) * 5,
  });
  if (error || !data)
    throw new Error("Nie udało się pobrać zaleceń kursowych.");
  return Object.fromEntries(
    (
      data as {
        enrollment_id: string;
        plans: CourseCarePage["plans"];
        has_draft: boolean;
      }[]
    ).map((row) => [
      row.enrollment_id,
      {
        plans: row.plans.slice(0, 5),
        more: row.plans.length > 5,
        hasDraft: row.has_draft,
      },
    ]),
  );
}

async function dogConsultations(
  db: DB,
  dogId: string,
): Promise<CareConsultation[]> {
  const result: CareConsultation[] = [];
  for (let offset = 0; ; offset += 100) {
    const { data, error } = await db
      .from("consultations")
      .select("id,service_name,starts_at,status")
      .eq("dog_id", dogId)
      .order("starts_at", { ascending: false, nullsFirst: false })
      .order("id")
      .range(offset, offset + 99);
    if (error) throw new Error("Nie udało się pobrać konsultacji do planu.");
    result.push(...((data || []) as CareConsultation[]));
    if (!data || data.length < 100) return result;
  }
}

export async function getConsultationCare(id: string, page: number) {
  if (!z.uuid().safeParse(id).success) notFound();
  const { db, role } = await requireSession();
  const [plans, draft] = await Promise.all([
    db
      .from("care_plan_versions")
      .select("id,title,revision,published_at")
      .eq("consultation_id", id)
      .order("revision", { ascending: false })
      .range((page - 1) * 5, page * 5),
    role === "admin"
      ? db
          .from("care_drafts")
          .select("dog_id")
          .eq("consultation_id", id)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ]);
  if (plans.error || draft.error)
    throw new Error("Nie udało się pobrać zaleceń ze spotkania.");
  return {
    plans: (plans.data || []).slice(0, 5) as Pick<
      CarePlan,
      "id" | "title" | "revision" | "published_at"
    >[],
    more: (plans.data?.length || 0) > 5,
    hasDraft: Boolean(draft.data),
  };
}

export async function getCarePublication(id: string) {
  if (!z.uuid().safeParse(id).success) notFound();
  const { db, role } = await requireSession();
  const { data, error } = await db
    .from("care_plan_versions")
    .select(`${planColumns},dogs(name)`)
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error("Nie udało się pobrać opublikowanych zaleceń.");
  if (!data) notFound();
  const plan = data as unknown as CarePlan & { dogs: { name: string } };
  const latest = await db
    .from("care_plan_versions")
    .select("id")
    .eq("dog_id", plan.dog_id)
    .order("revision", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (latest.error) throw new Error("Nie udało się sprawdzić wersji zaleceń.");
  return { role, plan, current: latest.data?.id === plan.id };
}
export async function getCareOverview(page: number, inboxPage: number) {
  const { db, role } = await requireSession();
  const [plans, inbox] = await Promise.all([
    db.rpc("care_plan_summaries", { p_offset: (page - 1) * 20 }),
    role === "admin"
      ? db
          .from("care_progress")
          .select(`${progressColumns},dogs(name)`, { count: "exact" })
          .is("reviewed_at", null)
          .order("created_at")
          .order("id")
          .range((inboxPage - 1) * 10, inboxPage * 10)
      : Promise.resolve({ data: [], error: null, count: 0 }),
  ]);
  if (plans.error || inbox.error)
    throw new Error("Nie udało się pobrać planów pracy.");
  return {
    role,
    plans: (plans.data || []).slice(0, 20) as CareSummary[],
    morePlans: (plans.data?.length || 0) > 20,
    inbox: (inbox.data || []).slice(0, 10) as unknown as CareProgress[],
    moreInbox: (inbox.data?.length || 0) > 10,
    inboxCount: inbox.count || 0,
  };
}
