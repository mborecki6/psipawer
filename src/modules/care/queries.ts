import "server-only";
import { notFound } from "next/navigation";
import { z } from "zod";
import { requireSession } from "@/lib/auth/session";
import { readWithGatewayRetry } from "@/lib/data/read-retry";
import { reportDataReadError } from "@/lib/observability/server-errors";
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
  CareContext,
  CareContextSummary,
  ControlInvitation,
  ReportingAccess,
} from "./types";
import { careContextKey } from "./types";

const planColumns =
  "id,context_key,dog_id,consultation_id,course_id,course_enrollment_id,course_session_id,fitness_package_id,fitness_session_id,title,body,revision,follow_up_on,control_invite_on,published_at,course_enrollments(id),fitness_packages!care_plan_fitness_fk(id)";
const progressColumns =
  "id,dog_id,plan_id,attempted,went_well,difficult,created_at,reviewed_at,care_plan_versions(title,revision)";
type DB = Awaited<ReturnType<typeof requireSession>>["db"];

async function careRead<T extends { error?: unknown; status?: number }>(
  operation:
    "care.contexts" | "care.invitation" | "care.reporting" | "care.summaries",
  read: () => PromiseLike<T>,
  message: string,
): Promise<T> {
  let result;
  try {
    result = await readWithGatewayRetry(operation, read);
  } catch (error) {
    reportDataReadError(operation, error);
    throw new Error(message);
  }
  if (result.error) {
    reportDataReadError(operation, result.error, result.status);
    throw new Error(message);
  }
  return result;
}

async function dogContexts(
  db: DB,
  dogId: string,
): Promise<CareContextSummary[]> {
  const failure = () =>
    new Error("Nie udało się pobrać planów psa. Spróbuj ponownie.");
  // This stable read may be repeated only after an actual HTTP 502. A SQL
  // error, denied access or invalid payload must remain a visible failure.
  const result = await careRead(
    "care.contexts",
    () => db.rpc("dog_care_contexts", { p_dog: dogId }),
    failure().message,
  );
  if (!Array.isArray(result.data)) {
    reportDataReadError("care.contexts", result.error, result.status);
    throw failure();
  }
  return result.data as CareContextSummary[];
}

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
  requestedGeneral?: string,
  requestedPlan?: string,
) {
  if (!z.uuid().safeParse(id).success) notFound();
  const raw = [
    requestedId,
    requestedEnrollment,
    requestedSession,
    requestedFitnessId,
    requestedFitnessSession,
  ];
  if (
    raw.some(
      (value) => value !== undefined && !z.uuid().safeParse(value).success,
    ) ||
    [requestedId, requestedEnrollment, requestedFitnessId].filter(Boolean)
      .length > 1 ||
    (requestedSession && !requestedEnrollment) ||
    (requestedFitnessSession && !requestedFitnessId) ||
    (requestedGeneral !== undefined &&
      (requestedGeneral !== "general" || raw.some(Boolean) || requestedPlan)) ||
    (requestedPlan !== undefined &&
      (!z.uuid().safeParse(requestedPlan).success || raw.some(Boolean)))
  )
    notFound();
  const { db, role } = await requireSession();
  const dog = await db
    .from("dogs")
    .select("id,name,guardian_id")
    .eq("id", id)
    .maybeSingle();
  if (dog.error) throw new Error("Nie udało się pobrać profilu psa.");
  if (!dog.data) notFound();
  const readPlans = (contextKey: string) =>
    Promise.all([
      db
        .from("care_plan_versions")
        .select(planColumns)
        .eq("dog_id", id)
        .eq("context_key", contextKey)
        .order("revision", { ascending: false })
        .limit(1)
        .maybeSingle(),
      db
        .from("care_plan_versions")
        .select(planColumns)
        .eq("dog_id", id)
        .eq("context_key", contextKey)
        .order("revision", { ascending: false })
        .range(1 + (historyPage - 1) * 5, 6 + (historyPage - 1) * 5),
      db
        .from("care_progress")
        .select(
          progressColumns.replace(
            "care_plan_versions(",
            "care_plan_versions!inner(",
          ),
        )
        .eq("dog_id", id)
        .eq("care_plan_versions.context_key", contextKey)
        .order("created_at", { ascending: false })
        .order("id")
        .range((progressPage - 1) * 10, progressPage * 10),
      role === "admin"
        ? db
            .from("care_drafts")
            .select(
              "id,context_key,dog_id,consultation_id,course_id,course_enrollment_id,course_session_id,fitness_package_id,fitness_session_id,title,body,follow_up_on,control_invite_on,version,updated_at",
            )
            .eq("dog_id", id)
            .eq("context_key", contextKey)
            .maybeSingle()
        : Promise.resolve({ data: null, error: null }),
    ]);
  const [metadata, generalPlans] = await Promise.all([
    Promise.all([
      dogContexts(db, id),
      role === "admin" ? templates(db) : Promise.resolve([]),
      role === "admin" ? dogConsultations(db, id) : Promise.resolve([]),
      role === "admin"
        ? dogCourses(db, id, dog.data.guardian_id)
        : Promise.resolve([]),
      role === "admin"
        ? dogFitness(db, id, dog.data.guardian_id)
        : Promise.resolve([]),
    ]),
    requestedGeneral === "general"
      ? readPlans("general")
      : Promise.resolve(null),
  ]);
  const [contexts, library, consultations, courses, fitness] = metadata;
  const requested: CareContext = {
    consultation_id: requestedId?.toLowerCase() || null,
    course_enrollment_id: requestedEnrollment?.toLowerCase() || null,
    course_session_id: requestedSession?.toLowerCase() || null,
    fitness_package_id: requestedFitnessId?.toLowerCase() || null,
    fitness_session_id: requestedFitnessSession?.toLowerCase() || null,
  };
  let context: CareContext = requested;
  if (requestedPlan) {
    // Overview links identify a publication, not a user-supplied context key.
    // Older versions keep a valid path back to the current context as well.
    const publication = await db
      .from("care_plan_versions")
      .select(
        "consultation_id,course_enrollment_id,course_session_id,fitness_package_id,fitness_session_id",
      )
      .eq("id", requestedPlan)
      .eq("dog_id", id)
      .maybeSingle();
    if (publication.error)
      throw new Error("Nie udało się pobrać powiązania planu.");
    if (!publication.data) notFound();
    context = publication.data as CareContext;
  } else if (!raw.some(Boolean) && requestedGeneral === undefined) {
    context = contexts[0] || requested;
  }
  const contextKey = careContextKey(context);
  const consultation =
    consultations.find((item) => item.id === context.consultation_id) || null;
  const course =
    courses.find((item) => item.id === context.course_enrollment_id) || null;
  const pack =
    fitness.find((item) => item.id === context.fitness_package_id) || null;
  const canChooseConsultation =
    consultation && ["scheduled", "completed"].includes(consultation.status);
  const canChooseCourse =
    course &&
    (!context.course_session_id ||
      course.sessions.some(
        (item) =>
          item.id === context.course_session_id && item.status !== "cancelled",
      ));
  const canChooseFitness =
    pack &&
    (!context.fitness_session_id ||
      pack.sessions.some(
        (item) =>
          item.id === context.fitness_session_id &&
          ["scheduled", "completed"].includes(item.status),
      ));
  const available =
    contextKey === "general" ||
    contexts.some((item) => item.context_key === contextKey) ||
    (role === "admin" &&
      (canChooseConsultation || canChooseCourse || canChooseFitness));
  const [latest, history, progress, draft] =
    generalPlans || (await readPlans(contextKey));
  if (latest.error || history.error || progress.error || draft.error)
    throw new Error("Nie udało się pobrać planu i postępów. Spróbuj ponownie.");
  // A direct historical link stays valid even beyond the context-list API page.
  if (!available && !latest.data && !draft.data) notFound();
  const [followUp, invitation, reporting] = latest.data
    ? await Promise.all([
        db
          .from("care_follow_ups")
          .select(
            "id,plan_id,dog_id,due_on,status,version,created_at,closed_at",
          )
          .eq("plan_id", latest.data.id)
          .maybeSingle(),
        careRead(
          "care.invitation",
          () =>
            db
              .from("care_control_invitations")
              .select(
                "id,plan_id,dog_id,guardian_id,due_on,status,version,consultation_id",
              )
              .eq("plan_id", latest.data!.id)
              .maybeSingle(),
          "Nie udało się pobrać zaproszenia do kontroli.",
        ),
        careRead(
          "care.reporting",
          () => db.rpc("care_reporting_access", { p_plan: latest.data!.id }),
          "Nie udało się pobrać dostępu do raportowania.",
        ),
      ])
    : [
        { data: null, error: null },
        { data: null, error: null },
        { data: null, error: null },
      ];
  if (followUp.error)
    throw new Error("Nie udało się pobrać kontaktu kontrolnego.");
  if (
    invitation.error ||
    reporting.error ||
    (latest.data &&
      (!reporting.data ||
        Array.isArray(reporting.data) ||
        typeof reporting.data !== "object" ||
        typeof reporting.data.allowed !== "boolean" ||
        typeof reporting.data.included !== "boolean"))
  ) {
    reportDataReadError(
      "care.reporting",
      reporting.error,
      "status" in reporting ? reporting.status : undefined,
    );
    throw new Error(
      "Nie udało się pobrać zaproszenia i dostępu do raportowania.",
    );
  }
  return {
    role,
    dog: dog.data,
    contexts,
    context,
    contextKey,
    latest: latest.data as CarePlan | null,
    draft: draft.data as CareDraft | null,
    history: (history.data || []).slice(0, 5) as unknown as CarePlan[],
    moreHistory: (history.data?.length || 0) > 5,
    progress: (progress.data || []).slice(0, 10) as unknown as CareProgress[],
    moreProgress: (progress.data?.length || 0) > 10,
    templates: library,
    followUp: followUp.data as FollowUp | null,
    controlInvitation: invitation.data as ControlInvitation | null,
    reporting: reporting.data as ReportingAccess | null,
    consultations,
    courses,
    fitness,
    requestedConsultation: consultation,
    requestedCourse: course,
    requestedSession: context.course_session_id || undefined,
    requestedFitness: pack,
    requestedFitnessSession: context.fitness_session_id || undefined,
    requestedUnavailable: Boolean(context.consultation_id) && !consultation,
    requestedCourseUnavailable:
      Boolean(context.course_enrollment_id) && !course,
    requestedFitnessUnavailable: Boolean(context.fitness_package_id) && !pack,
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

async function careDraftSessions(
  db: DB,
  column: "course_enrollment_id" | "fitness_package_id",
  ids: string[],
) {
  const rows: {
    course_enrollment_id: string | null;
    course_session_id: string | null;
    fitness_session_id: string | null;
  }[] = [];
  for (let from = 0; ; from += 100) {
    const result = await db
      .from("care_drafts")
      .select("course_enrollment_id,course_session_id,fitness_session_id")
      .in(column, ids)
      .order("id")
      .range(from, from + 99);
    if (result.error) throw new Error("Nie udało się pobrać szkiców zaleceń.");
    rows.push(...(result.data || []));
    if (!result.data || result.data.length < 100) return rows;
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
  const { db, role } = await requireSession();
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
    draftSessions:
      role === "admin"
        ? (await careDraftSessions(db, "fitness_package_id", [id])).map(
            (draft) => draft.fitness_session_id,
          )
        : [],
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
  const { db, role } = await requireSession();
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
  const drafts =
    role === "admin"
      ? await careDraftSessions(db, "course_enrollment_id", enrollments)
      : [];
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
        draftSessions: drafts
          .filter((draft) => draft.course_enrollment_id === row.enrollment_id)
          .map((draft) => draft.course_session_id),
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
    .eq("context_key", plan.context_key || careContextKey(plan))
    .order("revision", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (latest.error) throw new Error("Nie udało się sprawdzić wersji zaleceń.");
  return { role, plan, current: latest.data?.id === plan.id };
}
export async function getCareOverview(page: number, inboxPage: number) {
  const { db, role } = await requireSession();
  const [plans, inbox] = await Promise.all([
    careRead(
      "care.summaries",
      () => db.rpc("care_plan_summaries", { p_offset: (page - 1) * 20 }),
      "Nie udało się pobrać planów pracy.",
    ),
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
  if (!Array.isArray(plans.data)) {
    reportDataReadError("care.summaries", plans.error, plans.status);
    throw new Error("Nie udało się pobrać planów pracy.");
  }
  return {
    role,
    plans: plans.data.slice(0, 20) as CareSummary[],
    morePlans: plans.data.length > 20,
    inbox: (inbox.data || []).slice(0, 10) as unknown as CareProgress[],
    moreInbox: (inbox.data?.length || 0) > 10,
    inboxCount: inbox.count || 0,
  };
}
