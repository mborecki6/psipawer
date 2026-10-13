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
        "kind,dog_id,entity_id,course_enrollment_id,course_session_id,fitness_package_id,fitness_session_id,invitation_id,chat_id",
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
      (item.kind === "community_chat_message" &&
        (!z.uuid().safeParse(item.chat_id).success ||
          item.chat_id !== item.entity_id)) ||
      (item.kind === "control_invitation_due" &&
        (!z.uuid().safeParse(item.invitation_id).success ||
          item.invitation_id !== item.entity_id))
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
    let planId: string | undefined;
    const careSource =
      item.kind === "progress_reviewed"
        ? "care_progress"
        : role === "client" &&
            ["follow_up_changed", "follow_up_reminder"].includes(item.kind)
          ? "care_follow_ups"
          : null;
    if (careSource) {
      // Resolve only the authorized record referenced by this inbox event.
      // A generic dog URL could otherwise select a different service context.
      const { data: context, error: contextError } = await db
        .from(careSource)
        .select("plan_id,dog_id")
        .eq("id", item.entity_id)
        .maybeSingle();
      if (
        contextError ||
        !context ||
        context.dog_id !== item.dog_id ||
        !z.uuid().safeParse(context.plan_id).success
      )
        return failure;
      planId = context.plan_id;
    }
    const read = await db.rpc("read_notifications", { p_ids: [parsed.data] });
    if (read.error || ![0, 1].includes(read.data)) return failure;
    href = notificationHref(item as Notification, role, planId);
  } catch {
    return failure;
  }
  refresh();
  redirect(href);
}
