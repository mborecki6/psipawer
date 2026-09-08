"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireSession } from "@/lib/auth/session";
import { uuid } from "@/lib/validation/schemas";
import { warsawLocalToISO } from "@/lib/time";
import type { ActionState } from "@/components/action-form";

export async function saveDogRelation(
  _: ActionState,
  form: FormData,
): Promise<ActionState> {
  const { db } = await requireSession("admin");
  const parsed = z
    .object({
      dog_a: uuid,
      dog_b: uuid,
      level: z.enum([
        "unknown",
        "good",
        "neutral",
        "caution",
        "block",
        "possible_duet",
      ]),
      note: z.string().trim().min(3).max(2000),
      expected_updated_at: z.union([
        z.literal(""),
        z.iso.datetime({ offset: true }),
      ]),
    })
    .safeParse({
      ...Object.fromEntries(form),
      expected_updated_at: form.get("expected_updated_at") || "",
    });
  if (!parsed.success)
    return {
      error:
        "Wybierz dwa psy, ocenę relacji i podaj prywatną notatkę (3–2000 znaków).",
      fields: parsed.error.flatten().fieldErrors,
    };
  if (parsed.data.dog_a === parsed.data.dog_b)
    return { error: "Wybierz dwa różne psy." };
  let lastMetAt: string | null = null;
  if (form.get("last_met_at")) {
    try {
      lastMetAt = warsawLocalToISO(String(form.get("last_met_at")));
    } catch {
      return {
        error:
          "Podaj poprawny termin ostatniego spotkania w strefie Europe/Warsaw.",
      };
    }
    if (Date.parse(lastMetAt) > Date.now())
      return { error: "Ostatnie spotkanie nie może być w przyszłości." };
  }
  const { error } = await db.rpc("save_dog_relation", {
    p_dog_a: parsed.data.dog_a,
    p_dog_b: parsed.data.dog_b,
    p_level: parsed.data.level,
    p_note: parsed.data.note,
    p_last_met_at: lastMetAt,
    p_expected_updated_at: parsed.data.expected_updated_at || null,
  });
  if (error) {
    const allowed = [
      "Wybierz dwa różne psy.",
      "Wybierz poprawną ocenę relacji.",
      "Podaj prywatną notatkę (3–2000 znaków).",
      "Nie znaleziono wybranych psów.",
      "Ostatnie spotkanie nie może być w przyszłości.",
      "Ocena relacji już istnieje lub zmieniła się. Odśwież widok i otwórz jej edycję.",
    ];
    return {
      error: allowed.includes(error.message)
        ? error.message
        : "Nie udało się zapisać relacji. Odśwież widok i spróbuj ponownie.",
    };
  }
  revalidatePath("/admin", "layout");
  return {
    success:
      "Ocena relacji zapisana. Jest widoczna wyłącznie dla behawiorysty.",
  };
}
