"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireSession } from "@/lib/auth/session";
import { uuid } from "@/lib/validation/schemas";
import type { ActionState } from "@/components/action-form";

export async function reopenRegistration(
  _: ActionState,
  form: FormData,
): Promise<ActionState> {
  const { db } = await requireSession("admin");
  const parsed = z
    .object({ registration_id: uuid, note: z.string().trim().min(3).max(2000) })
    .safeParse(Object.fromEntries(form));
  if (!parsed.success)
    return { error: "Podaj powód przywrócenia zgłoszenia (3–2000 znaków)." };
  const { error } = await db.rpc("reopen_registration", {
    p_registration: parsed.data.registration_id,
    p_note: parsed.data.note,
  });
  if (error)
    return {
      error:
        "Nie udało się przywrócić zgłoszenia. Sprawdź, czy spacer nadal przyjmuje zapisy, a rezygnacja nastąpiła w terminie.",
    };
  revalidatePath("/admin", "layout");
  revalidatePath("/app", "layout");
  return {
    success:
      "Zgłoszenie przywrócone do decyzji. Zaakceptuj je po sprawdzeniu psa i wolnych miejsc; pakiet możesz przypisać ponownie w rozliczeniach.",
  };
}
