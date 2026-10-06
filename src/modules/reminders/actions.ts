"use server";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth/session";
import type { ActionState } from "@/components/action-form";

const resultSchema = z.object({
  sent: z.number().int().min(0).max(50),
  failed: z.number().int().min(0).max(50),
  cancelled: z.number().int().min(0).max(50),
  skipped: z.number().int().min(0).max(50),
});
export async function processReminders(): Promise<ActionState> {
  const { db } = await requireSession("admin");
  try {
    const { data, error } = await db.rpc("process_due_reminders", {
      p_limit: 50,
    });
    const result = resultSchema.safeParse(data);
    if (error || !result.success)
      return { error: "Nie udało się sprawdzić kolejki. Spróbuj ponownie." };
    revalidatePath("/admin", "layout");
    revalidatePath("/app", "layout");
    const r = result.data;
    return {
      success: `Sprawdzono do 50 zadań. W skrzynkach: ${r.sent}. Nieudane próby: ${r.failed}. Wycofane: ${r.cancelled}. Odłożone z powodu równoległej zmiany: ${r.skipped}.`,
    };
  } catch {
    return { error: "Nie udało się sprawdzić kolejki. Spróbuj ponownie." };
  }
}
export async function retryReminder(
  _: ActionState,
  form: FormData,
): Promise<ActionState> {
  const { db } = await requireSession("admin");
  const parsed = z
    .object({
      id: z.uuid(),
      attempts: z.coerce.number().int().min(1).max(2147483647),
    })
    .safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: "Odśwież kolejkę przed ponowieniem." };
  try {
    const { data, error } = await db.rpc("retry_reminder", {
      p_id: parsed.data.id,
      p_expected_attempts: parsed.data.attempts,
    });
    if (error || typeof data !== "boolean")
      return {
        error:
          "Nie udało się ponowić. Odśwież kolejkę i sprawdź aktualny stan.",
      };
    revalidatePath("/admin/reminders");
  } catch {
    return { error: "Nie udało się ponowić przypomnienia. Spróbuj ponownie." };
  }
  // A retried job disappears from the "failed" filter. Open its durable
  // status/history instead of losing the form's success message with the row.
  redirect(`/admin/reminders/${parsed.data.id}`);
}
