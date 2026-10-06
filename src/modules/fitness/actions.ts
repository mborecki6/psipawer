"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth/session";
import type { ActionState } from "@/components/action-form";
import {
  fitnessPackageSchema,
  fitnessRequestSchema,
  fitnessScheduleSchema,
  fitnessSessionSchema,
} from "./schemas";
export type FitnessActionState = ActionState & { version?: number };
const allowed = new Set([
  "Termin wraz z przerwami wykracza poza godziny pracy. Sprawdź ustawienia kalendarza.",
  "Oferta zmieniła się. Odśwież formularz i sprawdź cenę.",
  "Ten pakiet nie jest dostępny do zgłoszenia.",
  "Ten pies ma już otwarte zgłoszenie lub aktywny pakiet fitness.",
  "Ten pies ma już inne otwarte zgłoszenie lub aktywny pakiet fitness.",
  "Pakiet zmienił się. Odśwież widok przed zapisem.",
  "Spotkanie zmieniło się. Odśwież widok przed zapisem.",
  "Opiekun psa zmienił się. Uzgodnij nowe zgłoszenie.",
  "Najpierw zakończ każde spotkanie pakietu.",
  "Ten czas jest już zajęty. Sprawdź wspólny kalendarz.",
  "Wybierz przyszły termin.",
  "Podaj powód zmiany terminu (co najmniej 3 znaki).",
  "Zakończ umówione spotkanie dopiero po jego zakończeniu.",
  "Wybierz inną obecność zakończonego spotkania.",
  "Ten zapis został już użyty dla innych danych. Odśwież widok.",
]);
function failure(message?: string): FitnessActionState {
  return {
    error:
      message && allowed.has(message)
        ? message
        : "Nie udało się zapisać zmiany fitness. Wpisane dane pozostają w formularzu. Odśwież widok, sprawdź aktualny stan i spróbuj ponownie.",
  };
}
function refresh() {
  revalidatePath("/admin", "layout");
  revalidatePath("/app", "layout");
}
export async function requestFitness(
  _: FitnessActionState,
  form: FormData,
): Promise<FitnessActionState> {
  const { db } = await requireSession("client");
  const parsed = fitnessRequestSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success)
    return {
      error:
        "Wybierz psa i pakiet, opisz cel spotkań (3–3000 znaków) oraz dostępność (do 1000 znaków).",
      fields: parsed.error.flatten().fieldErrors,
    };
  const p = parsed.data;
  try {
    const { data, error } = await db.rpc("request_fitness_package", {
      p_id: p.id,
      p_dog: p.dog_id,
      p_service: p.service_id,
      p_expected_service_version: p.service_version,
      p_topic: p.topic,
      p_availability: p.availability,
    });
    if (error || data !== p.id) return failure(error?.message);
  } catch {
    return failure();
  }
  refresh();
  redirect(`/app/fitness/${p.id}`);
}
export async function changeFitnessPackage(
  _: FitnessActionState,
  form: FormData,
): Promise<FitnessActionState> {
  const parsed = fitnessPackageSchema.safeParse(Object.fromEntries(form));
  const { db } = await requireSession(
    parsed.success && parsed.data.intent === "cancel" ? undefined : "admin",
  );
  if (!parsed.success)
    return { error: "Wybierz działanie i podaj powód zmiany (3–3000 znaków)." };
  const p = parsed.data;
  try {
    const { data, error } = await db.rpc("change_fitness_package", {
      p_id: p.id,
      p_expected_version: p.expected_version,
      p_action: p.intent,
      p_note: p.note,
      p_request_id: p.request_id,
    });
    if (error || !Number.isInteger(data) || data <= p.expected_version)
      return failure(error?.message);
    refresh();
    return {
      version: data,
      success:
        p.intent === "accept" || p.intent === "restore"
          ? "Pakiet przyjęty z pierwotną ceną całego pakietu. Terminy ustalisz osobno; wpłaty i zwroty pozostały w historii."
          : "Zmiana pakietu zapisana. Historia spotkań i rozliczeń została zachowana.",
    };
  } catch {
    return failure();
  }
}
export async function saveFitnessSession(
  _: FitnessActionState,
  form: FormData,
): Promise<FitnessActionState> {
  const { db } = await requireSession("admin");
  const parsed = fitnessScheduleSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success)
    return {
      error:
        "Podaj termin w czasie polskim, miejsce (3–2000 znaków) i powód przełożenia (3–3000 znaków).",
    };
  const p = parsed.data;
  try {
    const { data, error } = await db.rpc("save_fitness_session", {
      p_id: p.id,
      p_expected_version: p.expected_version,
      p_starts_at: p.starts_at,
      p_location: p.location,
      p_note: p.note,
      p_request_id: p.request_id,
    });
    if (error || !Number.isInteger(data) || data <= p.expected_version)
      return failure(error?.message);
    refresh();
    return {
      version: data,
      success: "Termin i miejsce zapisane we wspólnym kalendarzu.",
    };
  } catch {
    return failure();
  }
}
export async function changeFitnessSession(
  _: FitnessActionState,
  form: FormData,
): Promise<FitnessActionState> {
  const { db } = await requireSession("admin");
  const parsed = fitnessSessionSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success)
    return {
      error:
        "Wybierz działanie, właściwą obecność i powód korekty lub odwołania (3–3000 znaków).",
    };
  const p = parsed.data;
  try {
    const { data, error } = await db.rpc("change_fitness_session", {
      p_id: p.id,
      p_expected_version: p.expected_version,
      p_action: p.intent,
      p_attendance: p.attendance || null,
      p_note: p.note,
      p_request_id: p.request_id,
    });
    if (error || !Number.isInteger(data) || data <= p.expected_version)
      return failure(error?.message);
    refresh();
    return {
      version: data,
      success:
        "Zmiana spotkania zapisana. Opłata za pakiet pozostała bez zmian.",
    };
  } catch {
    return failure();
  }
}
