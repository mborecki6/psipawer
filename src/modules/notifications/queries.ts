import "server-only";
import { z } from "zod";
import { requireSession } from "@/lib/auth/session";
import { reportDataReadError } from "@/lib/observability/server-errors";
import { readWithGatewayRetry } from "@/lib/data/read-retry";
import type { Notification, NotificationFilter } from "./types";

export async function getUnreadCount(
  db: Awaited<ReturnType<typeof requireSession>>["db"],
): Promise<number | null> {
  try {
    const { count, error, status } = await readWithGatewayRetry(
      "notifications.count",
      () =>
        db
          .from("notifications")
          .select("id", { count: "exact", head: true })
          .is("read_at", null),
    );
    if (
      !error &&
      typeof count === "number" &&
      Number.isSafeInteger(count) &&
      count >= 0
    )
      return count;
    reportDataReadError("notifications.count", error, status);
    return null;
  } catch (error) {
    reportDataReadError("notifications.count", error);
    return null;
  }
}
export async function getNotificationInbox(
  filter: NotificationFilter,
  before?: string,
) {
  const { db, role } = await requireSession();
  const failureMessage = "Nie udało się pobrać powiadomień. Spróbuj ponownie.";
  const cursor = z.uuid().safeParse(before);
  const [result, count] = await Promise.all([
    readWithGatewayRetry("notifications.feed", () =>
      db.rpc("notification_feed", {
        p_filter: filter,
        p_before: cursor.success ? cursor.data : null,
      }),
    ),
    getUnreadCount(db),
  ]).catch((error) => {
    reportDataReadError("notifications.feed", error);
    throw new Error(failureMessage);
  });
  const resetRequired =
    result.error?.message === "Wróć do początku listy powiadomień.";
  if (!resetRequired && (result.error || !Array.isArray(result.data)))
    reportDataReadError("notifications.feed", result.error, result.status);
  if (
    (result.error && !resetRequired) ||
    count === null ||
    (!Array.isArray(result.data) && !resetRequired)
  )
    throw new Error(failureMessage);
  const items = (result.data || []).slice(0, 20) as Notification[];
  return {
    role,
    items,
    count,
    resetRequired,
    more: (result.data?.length || 0) > 20,
    before: cursor.success ? cursor.data : undefined,
  };
}
