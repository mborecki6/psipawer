import "server-only";
import { requireSession } from "@/lib/auth/session";
import { notFound } from "next/navigation";
import { z } from "zod";
import type {
  Reminder,
  ReminderAttempt,
  ReminderCount,
  ReminderStatus,
  WorkerState,
} from "./types";
const columns =
  "id,kind,dog_id,entity_id,target_at,due_at,next_attempt_at,status,attempts,cycle_attempts,last_error_code,created_at,finished_at,course_enrollment_id,course_session_id,fitness_package_id,fitness_session_id,dogs(name)";
export async function getReminderQueue(
  filter: ReminderStatus | "all",
  page: number,
) {
  const { db } = await requireSession("admin");
  let query = db
    .from("reminder_jobs")
    .select(columns)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .range((page - 1) * 20, page * 20);
  if (filter !== "all") query = query.eq("status", filter);
  const [items, counts, worker] = await Promise.all([
    query,
    db.rpc("reminder_counts"),
    db
      .from("reminder_worker_state")
      .select("last_run_at,result")
      .eq("singleton", true)
      .maybeSingle(),
  ]);
  if (
    items.error ||
    counts.error ||
    worker.error ||
    !items.data ||
    !counts.data
  )
    throw new Error("Nie udało się pobrać kolejki przypomnień.");
  return {
    items: items.data.slice(0, 20) as unknown as Reminder[],
    more: items.data.length > 20,
    counts: counts.data as ReminderCount[],
    worker: worker.data as WorkerState,
  };
}
export async function getReminderDetail(id: string, page: number) {
  const { db } = await requireSession("admin");
  if (!z.uuid().safeParse(id).success) notFound();
  const [job, history] = await Promise.all([
    db.from("reminder_jobs").select(columns).eq("id", id).maybeSingle(),
    db
      .from("reminder_attempts")
      .select("attempt,outcome,error_code,created_at")
      .eq("job_id", id)
      .order("attempt", { ascending: false })
      .range((page - 1) * 20, page * 20),
  ]);
  if (job.error || history.error)
    throw new Error("Nie udało się pobrać przypomnienia.");
  if (!job.data) notFound();
  return {
    job: job.data as unknown as Reminder,
    history: (history.data || []).slice(0, 20) as ReminderAttempt[],
    more: (history.data?.length || 0) > 20,
  };
}
