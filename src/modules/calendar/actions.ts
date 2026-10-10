"use server";
import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/auth/session";
import type { ActionState } from "@/components/action-form";
import {
  blockSchema,
  cancelBlockSchema,
  calendarSettingsSchema,
  calendarAssignmentSchema,
  calendarResourceSchema,
  calendarStaffSettingsSchema,
} from "./schemas";
import { calendarConfirmation, calendarWarning } from "./write";
export type BlockState = ActionState & {
  version?: number;
  assignmentVersion?: number;
  cancelled?: boolean;
};
const messages = [
  "Ten czas jest już zajęty przez spacer, konsultację lub blokadę. Sprawdź kalendarz.",
  "Blokada zmieniła się. Odśwież widok przed zapisem.",
  "Ta blokada została już usunięta.",
  "Blokada musi obejmować przyszły czas.",
  "Termin wraz z przerwami wykracza poza godziny pracy. Sprawdź ustawienia kalendarza.",
  "Przypisanie zmieniło się. Odśwież widok przed zapisem.",
  "Ten czas jest już zajęty przez prowadzącego lub wybrane miejsce. Sprawdź kalendarz.",
  "Ten czas jest już zajęty dla wybranego prowadzącego lub sali. Sprawdź kalendarz.",
  "Wybierz aktywnego członka zespołu.",
  "Wybierz aktywne miejsce.",
  "Termin wykracza poza godziny pracy prowadzącego. Sprawdź ustawienia kalendarza.",
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
  const args = {
    p_id: p.id,
    p_expected_version: p.expected_version,
    p_expected_assignment_version: p.expected_assignment_version,
    p_title: p.title,
    p_starts_at: p.starts_at,
    p_ends_at: p.ends_at,
    p_staff_id: p.assigned_staff_id,
    p_resource_id: p.resource_id,
  };
  const confirmation = calendarConfirmation(
    "save_calendar_team_block",
    args,
    form,
  );
  try {
    const { data, error } = await db.rpc("save_calendar_team_block", {
      ...args,
      p_confirm_short_break: confirmation.confirmed,
    });
    const warning = calendarWarning(
      error
        ? { ...error, confirmation_signature: confirmation.signature }
        : null,
    );
    if (warning) return warning;
    if (
      error ||
      !data ||
      !Number.isInteger(data.version) ||
      !Number.isInteger(data.assignment_version)
    )
      return failed(error?.message);
    revalidatePath("/admin", "layout");
    return {
      version: data.version,
      assignmentVersion: data.assignment_version,
      success: "Czas zablokowany dla wybranego prowadzącego i miejsca.",
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
        "Ustawienia zapisane. Godziny pracy są pilnowane po włączeniu kontroli, a krótkie przerwy wymagają potwierdzenia.",
    };
  } catch {
    return {
      error:
        "Nie udało się zapisać ustawień. Twoje wpisy pozostają w formularzu.",
    };
  }
}

export async function saveCalendarAssignment(
  _: BlockState,
  form: FormData,
): Promise<BlockState> {
  const { db } = await requireSession("admin");
  const parsed = calendarAssignmentSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success)
    return { error: "Sprawdź wybrane zajęcia, prowadzącego i miejsce." };
  const p = parsed.data;
  const args = {
    p_kind: p.kind,
    p_appointment_id: p.appointment_id,
    p_expected_version: p.expected_version,
    p_staff_id: p.assigned_staff_id,
    p_resource_id: p.resource_id,
  };
  const confirmation = calendarConfirmation(
    "save_calendar_assignment",
    args,
    form,
  );
  try {
    const { data, error } = await db.rpc("save_calendar_assignment", {
      ...args,
      p_confirm_short_break: confirmation.confirmed,
    });
    const warning = calendarWarning(
      error
        ? { ...error, confirmation_signature: confirmation.signature }
        : null,
    );
    if (warning) return warning;
    if (error || !Number.isInteger(data)) return failed(error?.message);
    revalidatePath("/admin", "layout");
    return { version: data, success: "Prowadzący i miejsce zapisane." };
  } catch {
    return failed();
  }
}

export async function saveCalendarResource(
  _: BlockState,
  form: FormData,
): Promise<BlockState> {
  const { db } = await requireSession("admin");
  const parsed = calendarResourceSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: "Sprawdź nazwę i ustawienia miejsca." };
  const p = parsed.data;
  try {
    const { data, error } = await db.rpc("save_calendar_resource", {
      p_id: p.id,
      p_expected_version: p.expected_version,
      p_name: p.name,
      p_exclusive: p.exclusive,
      p_active: p.active,
    });
    if (error || !Number.isInteger(data))
      return {
        error:
          error &&
          [
            "Miejsce zmieniło się. Odśwież widok przed zapisem.",
            "Sala jest zajęta przez równoległe spotkania. Najpierw zmień ich przypisanie.",
          ].includes(error.message)
            ? error.message
            : "Nie udało się zapisać miejsca. Wpisane dane pozostają w formularzu.",
      };
    revalidatePath("/admin", "layout");
    return { version: data, success: "Miejsce zapisane." };
  } catch {
    return {
      error:
        "Nie udało się zapisać miejsca. Wpisane dane pozostają w formularzu.",
    };
  }
}

export async function saveCalendarStaffSettings(
  _: BlockState,
  form: FormData,
): Promise<BlockState> {
  const { db } = await requireSession("admin");
  const parsed = calendarStaffSettingsSchema.safeParse(
    Object.fromEntries(form),
  );
  if (!parsed.success)
    return { error: "Sprawdź prowadzącego, przerwy i godziny pracy." };
  const p = parsed.data;
  try {
    const { data, error } = await db.rpc("save_calendar_staff_settings", {
      p_staff_id: p.staff_id,
      p_expected_version: p.expected_version,
      p_use_default: p.use_default,
      p_hours_enabled: p.hours_enabled,
      p_before_minutes: p.before_minutes,
      p_after_minutes: p.after_minutes,
      p_week: p.week,
    });
    if (error || !Number.isInteger(data))
      return {
        error:
          error &&
          [
            "Ustawienia prowadzącego zmieniły się. Odśwież widok przed zapisem.",
            "Termin wykracza poza godziny pracy prowadzącego. Sprawdź ustawienia kalendarza.",
          ].includes(error.message)
            ? error.message
            : "Nie udało się zapisać godzin prowadzącego. Wpisane dane pozostają w formularzu.",
      };
    revalidatePath("/admin", "layout");
    return { version: data, success: "Rytm pracy prowadzącego zapisany." };
  } catch {
    return {
      error:
        "Nie udało się zapisać godzin prowadzącego. Wpisane dane pozostają w formularzu.",
    };
  }
}
