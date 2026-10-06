"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireSession } from "@/lib/auth/session";
import type { ActionState } from "@/components/action-form";
import { planSchema, progressSchema, templateSchema } from "./schemas";

export type CareEditorState = ActionState & { version?: number };

function refresh() {
  revalidatePath("/admin", "layout");
  revalidatePath("/app", "layout");
}
function failure(message?: string): ActionState {
  const allowed = [
    "Plan zmienił się. Skopiuj swoje zmiany i odśwież widok.",
    "Materiał zmienił się. Odśwież widok przed edycją.",
    "Ta odpowiedź została już zapisana. Odśwież widok.",
    "Nie znaleziono planu dla Twojego psa.",
    "Wybierz konsultację tego psa.",
    "Wybierz umówioną lub zakończoną konsultację albo plan bez konsultacji.",
    "Najpierw oznacz konsultację jako zakończoną. Teraz możesz zapisać szkic.",
    "Wybierz jedno powiązanie: konsultację lub kurs.",
    "Wybierz jedno powiązanie: konsultację, kurs albo fitness.",
    "Wybierz pakiet fitness tego psa.",
    "Wybierz spotkanie tego pakietu fitness.",
    "Wybierz aktywny lub zakończony pakiet aktualnego opiekuna.",
    "Wybierz umówione lub zakończone spotkanie fitness.",
    "Najpierw zakończ spotkanie fitness. Teraz możesz zapisać szkic.",
    "Wybierz spotkanie tego kursu.",
    "Wybierz zgłoszenie tego psa na kurs.",
    "Wybierz przyjęte zgłoszenie aktualnego opiekuna na aktywny lub zakończony kurs.",
    "To spotkanie kursu jest odwołane. Wybierz inne powiązanie.",
    "Najpierw zakończ spotkanie kursu. Teraz możesz zapisać szkic.",
  ];
  return {
    error:
      message && allowed.includes(message)
        ? message
        : "Nie udało się zapisać zmian. Twoja treść pozostaje w formularzu. Spróbuj ponownie.",
  };
}

export async function savePlan(
  previous: CareEditorState,
  form: FormData,
): Promise<CareEditorState> {
  const { db } = await requireSession("admin");
  const parsed = planSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success)
    return {
      version: previous.version,
      error: "Sprawdź tytuł, treść, powiązanie i datę kontaktu.",
      fields: parsed.error.flatten().fieldErrors,
    };
  const p = parsed.data;
  try {
    const { data, error } = await db.rpc("save_care_plan", {
      p_dog: p.dog_id,
      p_consultation: p.consultation_id || null,
      ...(p.course_enrollment_id
        ? {
            p_course_enrollment: p.course_enrollment_id,
            p_course_session: p.course_session_id || null,
          }
        : {}),
      ...(p.fitness_package_id
        ? {
            p_fitness_package: p.fitness_package_id,
            p_fitness_session: p.fitness_session_id || null,
          }
        : {}),
      p_expected_version: p.expected_version,
      p_title: p.title,
      p_body: p.body,
      p_follow_up_on: p.follow_up_on || null,
      p_publish: p.intent === "publish",
    });
    if (error) return { ...failure(error.message), version: previous.version };
    if (!data || !Number.isInteger(data.version))
      return { ...failure(), version: previous.version };
    refresh();
    return {
      version: data.version,
      success:
        p.intent === "publish"
          ? "Plan opublikowany. Opiekun zobaczy go w aplikacji."
          : "Szkic zapisany. Jest widoczny wyłącznie dla zespołu prowadzącego.",
    };
  } catch {
    return { ...failure(), version: previous.version };
  }
}

export async function saveTemplate(
  _: ActionState,
  form: FormData,
): Promise<CareEditorState> {
  const { db } = await requireSession("admin");
  const parsed = templateSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success)
    return {
      error: "Wpisz tytuł (3–160 znaków) i treść materiału (3–20 000 znaków).",
    };
  const p = parsed.data;
  try {
    const { error } = await db.rpc("save_care_template", {
      p_id: p.id,
      p_expected_version: p.expected_version,
      p_title: p.title,
      p_body: p.body,
    });
    if (error) return failure(error.message);
    refresh();
    return {
      version: p.expected_version + 1,
      success:
        "Materiał zapisany w bibliotece. Opublikowane plany pozostają bez zmian.",
    };
  } catch {
    return failure();
  }
}

export async function submitProgress(
  _: ActionState,
  form: FormData,
): Promise<ActionState> {
  const { db } = await requireSession("client");
  const parsed = progressSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success)
    return {
      error:
        "Opisz Waszą pracę (3–3000 znaków). Pozostałe pola mogą mieć do 3000 znaków.",
    };
  const p = parsed.data;
  try {
    const { error } = await db.rpc("submit_care_progress", {
      p_id: p.id,
      p_plan: p.plan_id,
      p_attempted: p.attempted,
      p_went_well: p.went_well,
      p_difficult: p.difficult,
    });
    if (error) return failure(error.message);
    refresh();
    return {
      success:
        "Odpowiedź zapisana. Behawiorystka zobaczy ją przy planie Twojego psa.",
    };
  } catch {
    return failure();
  }
}

export async function reviewProgress(
  _: ActionState,
  form: FormData,
): Promise<ActionState> {
  const { db } = await requireSession("admin");
  const id = z.uuid().safeParse(form.get("id"));
  if (!id.success) return failure();
  try {
    const { error } = await db.rpc("review_care_progress", { p_id: id.data });
    if (error) return failure();
    refresh();
    return { success: "Odpowiedź oznaczona jako przeczytana." };
  } catch {
    return failure();
  }
}
