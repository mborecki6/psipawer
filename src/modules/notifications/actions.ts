"use server";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth/session";
import type { ActionState } from "@/components/action-form";
import {
  notificationHref,
  notificationLabels,
  type Notification,
} from "./types";

const failure = {
  error:
    "Nie udało się oznaczyć powiadomień. Odśwież listę i spróbuj ponownie.",
};
function refresh() {
  revalidatePath("/admin", "layout");
  revalidatePath("/app", "layout");
}
export async function markNotificationsRead(
  _: ActionState,
  form: FormData,
): Promise<ActionState> {
  const { db } = await requireSession();
  const parsed = z
    .array(z.uuid())
    .min(1)
    .max(20)
    .refine((ids) => new Set(ids).size === ids.length)
    .safeParse(form.getAll("id"));
  if (!parsed.success)
    return { error: "Wybierz powiadomienia z wyświetlonej strony." };
  try {
    const { data, error } = await db.rpc("read_notifications", {
      p_ids: parsed.data,
    });
    if (
      error ||
      !Number.isInteger(data) ||
      data < 0 ||
      data > parsed.data.length
    )
      return failure;
  } catch {
    return failure;
  }
  refresh();
  return {
    success:
      "Powiadomienia oznaczone jako przeczytane. Status spraw pozostaje bez zmian.",
  };
}
export async function openNotification(
  _: ActionState,
  form: FormData,
): Promise<ActionState> {
  const { db, role } = await requireSession();
  const parsed = z.uuid().safeParse(form.get("id"));
  if (!parsed.success || form.getAll("id").length !== 1) return failure;
  let href: string;
  try {
    const { data: item, error } = await db
      .from("notifications")
      .select(
        "kind,dog_id,entity_id,course_enrollment_id,course_session_id,fitness_package_id,fitness_session_id",
      )
      .eq("id", parsed.data)
      .maybeSingle();
    if (
      error ||
      !item ||
      !Object.hasOwn(notificationLabels, item.kind) ||
      !z.uuid().safeParse(item.dog_id).success ||
      !z.uuid().safeParse(item.entity_id).success
    )
      return failure;
    if (
      item.kind.startsWith("fitness_") &&
      (!z.uuid().safeParse(item.fitness_package_id).success ||
        item.fitness_package_id !== item.entity_id ||
        (item.fitness_session_id !== null &&
          !z.uuid().safeParse(item.fitness_session_id).success))
    )
      return failure;
    if (
      item.kind.startsWith("course_") &&
      (!z.uuid().safeParse(item.course_enrollment_id).success ||
        (item.course_session_id !== null &&
          !z.uuid().safeParse(item.course_session_id).success))
    )
      return failure;
    const read = await db.rpc("read_notifications", { p_ids: [parsed.data] });
    if (read.error || ![0, 1].includes(read.data)) return failure;
    href = notificationHref(item as Notification, role);
  } catch {
    return failure;
  }
  refresh();
  redirect(href);
}
