"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireSession } from "@/lib/auth/session";
import type { ActionState } from "@/components/action-form";
export async function saveServiceReporting(
  _: ActionState,
  form: FormData,
): Promise<ActionState> {
  const { db } = await requireSession("admin");
  const parsed = z
    .object({
      id: z.uuid(),
      expected_version: z.coerce.number().int().min(1).max(2147483646),
      included: z.enum(["true", "false"]),
      days: z.union([z.literal(""), z.coerce.number().int().min(1).max(36500)]),
      note: z.string().trim().min(3).max(2000),
    })
    .safeParse(Object.fromEntries(form));
  if (!parsed.success)
    return {
      error:
        "Wybierz dostęp, opcjonalny okres w dniach (1–36 500) i uzasadnienie.",
    };
  const p = parsed.data;
  if (p.included === "false" && p.days !== "")
    return { error: "Przy wyłączonym raportowaniu pozostaw okres pusty." };
  try {
    const { error } = await db.rpc("set_service_reporting", {
      p_service: p.id,
      p_expected_version: p.expected_version,
      p_included: p.included === "true",
      p_days: p.days === "" ? null : p.days,
      p_note: p.note,
    });
    if (error)
      return {
        error:
          error.message === "Oferta zmieniła się. Odśwież widok przed zapisem."
            ? error.message
            : "Nie udało się zapisać zasad raportowania. Wpisy pozostają w formularzu.",
      };
    revalidatePath("/admin", "layout");
    revalidatePath("/app", "layout");
    return {
      success:
        "Zasady zapisane dla nowych zgłoszeń. Wcześniejsze przypisania zachowują swój dostęp.",
    };
  } catch {
    return {
      error: "Nie udało się zapisać zasad raportowania. Spróbuj ponownie.",
    };
  }
}
