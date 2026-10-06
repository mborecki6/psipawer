"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth/session";
import type { ActionState } from "@/components/action-form";
import {
  requestSchema,
  scheduleSchema,
  closeSchema,
  agreePriceSchema,
} from "./schemas";

function refresh() {
  revalidatePath("/admin", "layout");
  revalidatePath("/app", "layout");
}
function failure(message?: string): ActionState {
  const allowed = [
    "Termin wraz z przerwami wykracza poza godziny pracy. Sprawdź ustawienia kalendarza.",
    "Ten czas jest już zajęty przez spacer, konsultację lub blokadę. Sprawdź kalendarz.",
    "Ten pies ma już otwarte zgłoszenie lub umówioną konsultację.",
    "To zgłoszenie zostało już zapisane. Odśwież widok.",
    "Konsultacja zmieniła się. Odśwież widok przed zapisem.",
    "Ta konsultacja jest już zamknięta.",
    "Wybierz przyszły termin.",
    "Podaj powód zmiany terminu.",
    "Ten termin koliduje z inną konsultacją.",
    "Podaj powód odwołania.",
    "Termin już się rozpoczął. Skontaktuj się z prowadzącą.",
    "Możesz zakończyć konsultację dopiero po jej terminie.",
    "Oferta zmieniła się. Odśwież formularz i sprawdź cenę.",
    "Ta usługa nie jest dostępna do zgłoszenia.",
    "Forma spotkania musi odpowiadać wybranej usłudze.",
    "Ta konsultacja ma już ustaloną cenę. Zachowujemy wcześniejsze uzgodnienie.",
    "Odwołane spotkanie nie wymaga ustalania należności.",
    "Uzgodniona kwota nie może być niższa od zapisanych wpłat.",
    "Ten identyfikator uzgodnienia został już użyty dla innych danych.",
  ];
  return {
    error:
      message && allowed.includes(message)
        ? message
        : "Nie udało się zapisać konsultacji. Twoje wpisy pozostają w formularzu. Spróbuj ponownie.",
  };
}
export async function agreeConsultationPrice(
  _: ActionState,
  form: FormData,
): Promise<ActionState> {
  const { db } = await requireSession("admin");
  const parsed = agreePriceSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success)
    return {
      error:
        "Podaj uzgodnioną kwotę od 0,01 do 10 000 zł i uzasadnienie dla opiekuna (3–3000 znaków).",
      fields: parsed.error.flatten().fieldErrors,
    };
  const p = parsed.data;
  let version: number;
  try {
    const { data, error } = await db.rpc("agree_consultation_price", {
      p_id: p.id,
      p_expected_version: p.expected_version,
      p_amount_cents: p.amount,
      p_is_test_price: p.is_test_price,
      p_note: p.note,
      p_request_id: p.request_id,
    });
    if (error || !Number.isInteger(data)) return failure(error?.message);
    version = data;
  } catch {
    return failure();
  }
  refresh();
  redirect(`/admin/consultations/${p.id}?price_saved=${version}#rozliczenie`);
}
export async function requestConsultation(
  _: ActionState,
  form: FormData,
): Promise<ActionState> {
  const { db } = await requireSession("client");
  const parsed = requestSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success)
    return {
      error:
        "Wybierz psa i opisz potrzebę konsultacji (3–3000 znaków). Dostępność może mieć do 1000 znaków.",
    };
  const p = parsed.data;
  try {
    const { error } = await db.rpc("request_consultation", {
      p_id: p.id,
      p_dog: p.dog_id,
      p_topic: p.topic,
      p_availability: p.availability,
      p_service: p.service_id,
      p_expected_service_version: p.service_version,
    });
    if (error) return failure(error.message);
  } catch {
    return failure();
  }
  refresh();
  redirect(`/app/consultations/${p.id}`);
}
export async function scheduleConsultation(
  _: ActionState,
  form: FormData,
): Promise<ActionState & { version?: number }> {
  const { db } = await requireSession("admin");
  const parsed = scheduleSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success)
    return {
      error:
        "Sprawdź termin, długość (15–240 minut), formę i miejsce spotkania.",
      fields: parsed.error.flatten().fieldErrors,
    };
  const p = parsed.data;
  let version: number;
  try {
    const { data, error } = await db.rpc("change_consultation", {
      p_id: p.id,
      p_expected_version: p.expected_version,
      p_action: "schedule",
      p_starts_at: p.starts_at,
      p_duration: p.duration_minutes,
      p_mode: p.meeting_mode,
      p_location: p.location,
      p_note: p.note,
    });
    if (error) return failure(error.message);
    if (!Number.isInteger(data)) return failure();
    version = data;
  } catch {
    return failure();
  }
  refresh();
  return {
    success: "Termin zapisany. Opiekun zobaczy szczegóły w aplikacji.",
    version,
  };
}
export async function closeConsultation(
  _: ActionState,
  form: FormData,
): Promise<ActionState> {
  const parsed = closeSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success)
    return { error: "Sprawdź dane i podaj powód odwołania (3–3000 znaków)." };
  const p = parsed.data;
  const { db, role } = await requireSession(
    p.intent === "complete" ? "admin" : undefined,
  );
  try {
    const { error } = await db.rpc("change_consultation", {
      p_id: p.id,
      p_expected_version: p.expected_version,
      p_action: p.intent,
      p_starts_at: null,
      p_duration: null,
      p_mode: null,
      p_location: null,
      p_note: p.note,
    });
    if (error) return failure(error.message);
  } catch {
    return failure();
  }
  refresh();
  redirect(`/${role === "admin" ? "admin" : "app"}/consultations/${p.id}`);
}
