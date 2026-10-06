import "server-only";
import { requireSession } from "@/lib/auth/session";
import { notFound } from "next/navigation";
import { z } from "zod";
import { reportDataReadError } from "@/lib/observability/server-errors";
import { readWithGatewayRetry } from "@/lib/data/read-retry";
import type {
  WorkKind,
  WorkItem,
  WorkCount,
  FollowUp,
  FollowUpHistory,
} from "./types";
import type { CareProgress } from "@/modules/care/types";
const followupColumns =
  "id,plan_id,dog_id,due_on,status,version,created_at,closed_at";
export async function getWorkQueue(filter: WorkKind | "all", page: number) {
  const { db } = await requireSession("admin");
  const failure = () => new Error("Nie udało się pobrać listy spraw.");
  let result;
  try {
    result = await Promise.all([
      readWithGatewayRetry("work.items", () =>
        db.rpc("staff_work_queue", {
          p_filter: filter,
          p_offset: (page - 1) * 20,
        }),
      ),
      readWithGatewayRetry("work.counts", () => db.rpc("staff_work_counts")),
    ]);
  } catch (error) {
    reportDataReadError("work.queue", error);
    throw failure();
  }
  const [items, counts] = result;
  if (items.error || !Array.isArray(items.data))
    reportDataReadError("work.items", items.error, items.status);
  if (counts.error || !Array.isArray(counts.data))
    reportDataReadError("work.counts", counts.error, counts.status);
  if (
    items.error ||
    counts.error ||
    !Array.isArray(items.data) ||
    !Array.isArray(counts.data)
  )
    throw new Error("Nie udało się pobrać listy spraw.");
  return {
    items: items.data.slice(0, 20) as WorkItem[],
    more: items.data.length > 20,
    counts: counts.data as WorkCount[],
  };
}
export async function getFollowUp(id: string, page: number) {
  const { db } = await requireSession("admin");
  if (!z.uuid().safeParse(id).success) notFound();
  const item = await db
    .from("care_follow_ups")
    .select(`${followupColumns},dogs(name),care_plan_versions(title,revision)`)
    .eq("id", id)
    .maybeSingle();
  if (item.error) throw new Error("Nie udało się pobrać kontaktu.");
  if (!item.data) notFound();
  const [history, latest] = await Promise.all([
    db
      .from("care_follow_up_history")
      .select("version,action,due_on,note,created_at")
      .eq("follow_up_id", id)
      .order("version", { ascending: false })
      .range((page - 1) * 20, page * 20),
    db
      .from("care_plan_versions")
      .select("id")
      .eq("dog_id", item.data.dog_id)
      .order("revision", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);
  if (history.error || latest.error)
    throw new Error("Nie udało się pobrać historii kontaktu.");
  return {
    item: item.data as unknown as FollowUp & {
      dogs: { name: string };
      care_plan_versions: { title: string; revision: number };
    },
    history: (history.data || []).slice(0, 20) as FollowUpHistory[],
    more: (history.data?.length || 0) > 20,
    isCurrent: latest.data?.id === item.data.plan_id,
  };
}
export async function getProgressForReview(id: string) {
  const { db } = await requireSession("admin");
  if (!z.uuid().safeParse(id).success) notFound();
  const { data, error } = await db
    .from("care_progress")
    .select(
      "id,dog_id,plan_id,attempted,went_well,difficult,created_at,reviewed_at,care_plan_versions(title,revision),dogs(name)",
    )
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error("Nie udało się pobrać odpowiedzi.");
  if (!data) notFound();
  return data as unknown as CareProgress;
}
export async function getFollowUpArchive(
  dogId: string | undefined,
  page: number,
) {
  const { db } = await requireSession("admin");
  if (dogId && !z.uuid().safeParse(dogId).success) notFound();
  let q = db
    .from("care_follow_ups")
    .select(`${followupColumns},dogs(name),care_plan_versions(title,revision)`)
    .order("created_at", { ascending: false })
    .order("id")
    .range((page - 1) * 20, page * 20);
  if (dogId) q = q.eq("dog_id", dogId);
  const { data, error } = await q;
  if (error) throw new Error("Nie udało się pobrać kontaktów.");
  return {
    items: (data || []).slice(0, 20) as unknown as (FollowUp & {
      dogs: { name: string };
      care_plan_versions: { title: string; revision: number };
    })[],
    more: (data?.length || 0) > 20,
  };
}
