"use server";
import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/auth/session";
import type { ActionState } from "@/components/action-form";
import {
  blockSchema,
  cancelBlockSchema,
  calendarSettingsSchema,
} from "./schemas";
export type BlockState = ActionState & {
  version?: number;
  cancelled?: boolean;
};
const messages = [
  "Ten czas jest już zajęty przez spacer, konsultację lub blokadę. Sprawdź kalendarz.",
  "Blokada zmieniła się. Odśwież widok przed zapisem.",
  "Ta blokada została już usunięta.",
  "Blokada musi obejmować przyszły czas.",
  "Termin wraz z przerwami wykracza poza godziny pracy. Sprawdź ustawienia kalendarza.",
];
function failed(message?: string): BlockState {
  return {
    error:
      message && messages.includes(message)
        ? message
        : "Nie udało się zapisać blokady. Wpisane dane pozostają w formularzu.",
  };
}
export async function saveBlock(
  _: BlockState,
  form: FormData,
): Promise<BlockState> {
  const { db } = await requireSession("admin");
  const parsed = blockSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success)
    return {
      error: "Sprawdź nazwę oraz początek i koniec blokady.",
      fields: parsed.error.flatten().fieldErrors,
    };
  const p = parsed.data;
  try {
    const { data, error } = await db.rpc("save_calendar_block", {
      p_id: p.id,
      p_expected_version: p.expected_version,
      p_title: p.title,
      p_starts_at: p.starts_at,
      p_ends_at: p.ends_at,
    });
    if (error || !Number.isInteger(data)) return failed(error?.message);
    revalidatePath("/admin", "layout");
    return {
      version: data,
      success: "Czas zablokowany. W tym przedziale nie umówisz innych spotkań.",
    };
  } catch {
    return failed();
  }
}
export async function cancelBlock(
  _: BlockState,
  form: FormData,
): Promise<BlockState> {
  const { db } = await requireSession("admin");
  const parsed = cancelBlockSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: "Sprawdź wybraną blokadę." };
  try {
    const { error } = await db.rpc("cancel_calendar_block", {
      p_id: parsed.data.id,
      p_expected_version: parsed.data.expected_version,
    });
    if (error) return failed(error.message);
    revalidatePath("/admin", "layout");
    return {
      cancelled: true,
      success: "Blokada usunięta. Ten czas jest ponownie dostępny.",
    };
  } catch {
    return failed();
  }
}

export async function saveCalendarSettings(
  _: BlockState,
  form: FormData,
): Promise<BlockState> {
  const { db } = await requireSession("admin");
  const parsed = calendarSettingsSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success)
    return {
      error:
        "Sprawdź przerwy (0–120 minut) oraz godziny każdego dnia. Przy włączonym harmonogramie wybierz przynajmniej jeden dzień pracy.",
    };
  const p = parsed.data;
  const allowed = [
    "Ustawienia kalendarza zmieniły się. Odśwież widok przed zapisem.",
    "Termin wraz z przerwami wykracza poza godziny pracy. Sprawdź ustawienia kalendarza.",
    "Nowe przerwy powodują kolizję istniejących terminów. Najpierw przełóż spotkania lub zmniejsz przerwy.",
  ];
  try {
    const { data, error } = await db.rpc("save_calendar_settings", {
      p_expected_version: p.expected_version,
      p_hours_enabled: p.hours_enabled,
      p_before_minutes: p.before_minutes,
      p_after_minutes: p.after_minutes,
      p_week: p.week,
    });
    if (error || !Number.isInteger(data))
      return {
        error:
          error && allowed.includes(error.message)
            ? error.message
            : "Nie udało się zapisać ustawień. Twoje wpisy pozostają w formularzu.",
      };
    revalidatePath("/admin", "layout");
    return {
      version: data,
      success:
        "Ustawienia zapisane. Kalendarz pilnuje wybranych przerw i godzin pracy.",
    };
  } catch {
    return {
      error:
        "Nie udało się zapisać ustawień. Twoje wpisy pozostają w formularzu.",
    };
  }
}
