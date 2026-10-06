"use server";
import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/auth/session";
import type { ActionState } from "@/components/action-form";
import type { FollowUp } from "./types";
import { followUpSchema } from "./schemas";
export type FollowUpState = ActionState & {
  version?: number;
  status?: FollowUp["status"];
};
export async function changeFollowUp(
  _: FollowUpState,
  form: FormData,
): Promise<FollowUpState> {
  const { db } = await requireSession("admin");
  const parsed = followUpSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success)
    return {
      error: "Sprawdź działanie, datę i notatkę (3–2000 znaków).",
      fields: parsed.error.flatten().fieldErrors,
    };
  const p = parsed.data;
  try {
    const { data, error } = await db.rpc("change_care_follow_up", {
      p_id: p.id,
      p_expected_version: p.expected_version,
      p_action: p.intent,
      p_due_on: ["rescheduled", "reopened"].includes(p.intent)
        ? p.due_on
        : null,
      p_note: p.note,
    });
    if (error || !Number.isInteger(data)) {
      const allowed = [
        "Kontakt zmienił się. Odśwież widok przed zapisem.",
        "Ten kontakt dotyczy wcześniejszego planu. Otwórz aktualny plan psa.",
        "Nie można wykonać tego działania w aktualnym stanie.",
        "Wybierz dzisiejszą lub przyszłą datę kontaktu.",
        "Wybierz inną datę kontaktu.",
      ];
      return {
        error:
          error && allowed.includes(error.message)
            ? error.message
            : "Nie udało się zapisać kontaktu. Twoja notatka pozostaje w formularzu.",
      };
    }
    revalidatePath("/admin", "layout");
    revalidatePath("/app", "layout");
    return {
      version: data,
      status:
        p.intent === "completed"
          ? "done"
          : p.intent === "cancelled"
            ? "cancelled"
            : "open",
      success:
        "Kontakt zapisany. Notatka jest widoczna wyłącznie dla zespołu prowadzącego.",
    };
  } catch {
    return { error: "Nie udało się zapisać kontaktu. Spróbuj ponownie." };
  }
}
