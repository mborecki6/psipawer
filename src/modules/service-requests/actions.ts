"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth/session";
import type { ActionState } from "@/components/action-form";
import { dateRequestSchema, changeRequestSchema } from "./schemas";
const allowed = [
  "Wybierz swojego psa.",
  "Ten identyfikator zgłoszenia został już użyty. Odśwież formularz.",
  "Ustalenie terminu dla tego psa wymaga kontaktu z prowadzącą.",
  "Ta usługa nie jest dostępna do ustalenia terminu.",
  "Ten kurs ma opublikowany termin. Przejdź do zapisów na kurs.",
  "Zgłoszenie zmieniło się. Odśwież widok.",
  "Dodaj notatkę dla opiekuna (3–2000 znaków).",
];
function failure(message?: string): ActionState {
  return {
    error:
      message && allowed.includes(message)
        ? message
        : "Nie udało się zapisać zgłoszenia. Twoje wpisy pozostają w formularzu.",
  };
}
function refresh() {
  revalidatePath("/app", "layout");
  revalidatePath("/admin", "layout");
}
export async function requestServiceDate(
  _: ActionState,
  form: FormData,
): Promise<ActionState> {
  const { db } = await requireSession("client");
  const parsed = dateRequestSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success)
    return {
      error:
        "Wybierz psa i opisz potrzebę spotkania (3–2000 znaków). Dostępność może mieć do 1000 znaków.",
    };
  const p = parsed.data;
  let id: string;
  try {
    const { data, error } = await db.rpc("request_service_date", {
      p_request_id: p.request_id,
      p_service: p.service_id,
      p_dog: p.dog_id,
      p_message: p.message,
      p_availability: p.availability,
    });
    if (error || typeof data !== "string") return failure(error?.message);
    id = data;
  } catch {
    return failure();
  }
  refresh();
  redirect(`/app/services/${p.service_id}/request?saved=${id}#request-${id}`);
}
export async function changeServiceRequest(
  _: ActionState,
  form: FormData,
): Promise<ActionState> {
  const parsed = changeRequestSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success)
    return {
      error: "Sprawdź zgłoszenie i notatkę dla opiekuna (3–2000 znaków).",
    };
  const p = parsed.data;
  const { db } = await requireSession(
    p.intent === "handled" ? "admin" : "client",
  );
  try {
    const { data, error } = await db.rpc("change_service_request", {
      p_id: p.id,
      p_expected_version: p.expected_version,
      p_action: p.intent,
      p_note: p.note,
    });
    if (error || !Number.isInteger(data)) return failure(error?.message);
  } catch {
    return failure();
  }
  refresh();
  return {
    success:
      p.intent === "handled"
        ? "Zgłoszenie oznaczono jako załatwione. Opiekun zobaczy notatkę w aplikacji."
        : "Zgłoszenie wycofane. Historia pozostaje dostępna.",
  };
}
