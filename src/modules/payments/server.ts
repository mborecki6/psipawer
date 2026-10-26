import "server-only";
import { createClient } from "@supabase/supabase-js";
import { requireSession } from "@/lib/auth/session";
import { getFinanceData } from "@/lib/data/finance-queries";
import { uuid } from "@/lib/validation/schemas";
import type { FinanceCharge } from "@/lib/finance";
import type { OnlinePaymentAttempt, OnlinePaymentEnvironment } from "./types";
import { getLocalPaymentRuntime, requireLocalPaymentRuntime } from "./runtime";

export type OnlinePaymentContext = {
  enabled: boolean;
  canProcess?: boolean;
  environment: OnlinePaymentEnvironment | null;
  walkGate: string;
  notice: string;
  attempts: OnlinePaymentAttempt[];
};

export function privilegedPaymentsClient() {
  requireLocalPaymentRuntime();
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SECRET_KEY!,
    {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    },
  );
}

export async function getOnlinePaymentContext(): Promise<OnlinePaymentContext> {
  const { db } = await requireSession();
  const runtime = getLocalPaymentRuntime();
  const off: OnlinePaymentContext = {
    enabled: false,
    canProcess: Boolean(runtime),
    environment: runtime?.environment ?? null,
    walkGate: "disabled",
    attempts: [],
    notice: "Płatności BLIK nie są skonfigurowane w tym środowisku.",
  };
  // History uses only the user's session and RLS; provider credentials and the
  // checkout switch must never erase an existing financial record.
  const attempts: OnlinePaymentAttempt[] = [];
  for (let from = 0; ; from += 200) {
    const result = await db
      .from("online_payment_attempts")
      .select("*")
      .order("created_at", { ascending: false })
      .order("id")
      .range(from, from + 199);
    if (result.error && ["42P01", "PGRST205"].includes(result.error.code))
      return {
        ...off,
        canProcess: false,
        notice: "Baza nie ma jeszcze konfiguracji płatności BLIK.",
      };
    if (result.error || !result.data)
      throw new Error("Nie udało się pobrać prób płatności. Odśwież stronę.");
    attempts.push(...(result.data as OnlinePaymentAttempt[]));
    if (result.data.length < 200) break;
  }
  off.attempts = attempts.filter(
    (attempt, index) =>
      index < 20 ||
      ["creating", "pending", "uncertain", "requires_review"].includes(
        attempt.status,
      ),
  );
  if (!runtime) return off;
  const settings = await privilegedPaymentsClient()
    .from("online_payment_settings")
    .select("enabled,walk_gate")
    .limit(1)
    .maybeSingle();
  if (settings.error) {
    if (!["42P01", "PGRST205"].includes(settings.error.code))
      throw new Error(
        "Nie udało się odczytać konfiguracji płatności. Odśwież stronę.",
      );
    return {
      ...off,
      canProcess: false,
      notice: "Baza nie ma jeszcze konfiguracji płatności BLIK.",
    };
  }
  const enabled = Boolean(settings.data?.enabled && runtime.canStart);
  return {
    ...off,
    enabled,
    walkGate: settings.data?.walk_gate || "disabled",
    notice: enabled
      ? ""
      : "Rozpoczynanie nowych płatności BLIK jest wyłączone. Historia pozostaje dostępna.",
  };
}

export async function getOnlinePaymentAttempt(
  id: string,
): Promise<OnlinePaymentAttempt | null> {
  const { db } = await requireSession();
  if (!uuid.safeParse(id).success) return null;
  const { data, error } = await db
    .from("online_payment_attempts")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error && ["42P01", "PGRST205"].includes(error.code)) return null;
  if (error)
    throw new Error("Nie udało się odczytać płatności. Odśwież stronę.");
  return data as OnlinePaymentAttempt | null;
}

export async function getOnlinePaymentCharge(
  kind: string,
  target: string,
): Promise<FinanceCharge | null> {
  const { db } = await requireSession("client");
  if (
    !["registration", "consultation", "course", "fitness"].includes(kind) ||
    !uuid.safeParse(target).success
  )
    return null;
  const table = {
    registration: "walk_registrations",
    consultation: "consultations",
    course: "course_enrollments",
    fitness: "fitness_packages",
  }[kind]!;
  const columns =
    kind === "registration"
      ? "status,walk_id,attendance,package_id"
      : kind === "course"
        ? "status,course_id"
        : kind === "fitness"
          ? "status,accepted_at"
          : "status";
  const eligibility = await db
    .from(table)
    .select(columns)
    .eq("id", target)
    .maybeSingle();
  if (eligibility.error)
    throw new Error(
      "Nie udało się sprawdzić przyjęcia zgłoszenia. Odśwież stronę.",
    );
  // The selected columns differ between four existing tables; the client-side
  // select parser cannot infer a single row shape from that runtime choice.
  const row = eligibility.data as unknown as {
    status: string;
    accepted_at?: string | null;
    attendance?: string;
    package_id?: string | null;
    walk_id?: string;
    course_id?: string;
  } | null;
  const statuses: Record<string, string[]> = {
    registration: ["accepted"],
    consultation: ["scheduled", "completed"],
    course: ["accepted"],
    fitness: ["active", "completed"],
  };
  if (!row || !statuses[kind].includes(row.status)) return null;
  if (kind === "fitness" && !row.accepted_at) return null;
  if (
    kind === "registration" &&
    (row.attendance === "absent" || row.package_id)
  )
    return null;
  if (kind === "registration" || kind === "course") {
    const parent = await db
      .from(kind === "registration" ? "walks" : "courses")
      .select("status")
      .eq("id", kind === "registration" ? row.walk_id : row.course_id)
      .maybeSingle();
    if (parent.error)
      throw new Error(
        "Nie udało się sprawdzić dostępności zajęć. Odśwież stronę.",
      );
    if (
      !parent.data ||
      !["open", "full", "closed", "completed"].includes(parent.data.status)
    )
      return null;
  }
  const data = await getFinanceData();
  return (
    data.charges.find(
      (c) =>
        c.kind === kind &&
        c.id === target &&
        c.canPay &&
        c.dueCents > 0 &&
        !c.reviewReason,
    ) || null
  );
}
