import { createHash } from "node:crypto";
import type { requireSession } from "@/lib/auth/session";
import type { ActionState } from "@/components/action-form";

type Database = Awaited<ReturnType<typeof requireSession>>["db"];
type CalendarError = {
  message: string;
  hint?: string;
  details?: string;
  code?: string;
  confirmation_signature?: string;
};
type Operation =
  | "create_walk"
  | "update_walk"
  | "create_course"
  | "change_consultation"
  | "change_course"
  | "reschedule_course_session"
  | "save_fitness_session";
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function assignment(form: FormData) {
  if (!form.has("calendar_staff_id") && !form.has("calendar_resource_id"))
    return null;
  const staff = form.get("calendar_staff_id") || null;
  const resource = form.get("calendar_resource_id") || null;
  for (const value of [staff, resource])
    if (value !== null && (typeof value !== "string" || !uuid.test(value)))
      throw new Error("invalid assignment");
  const rawVersion = form.get("calendar_assignment_version");
  const version = rawVersion === null ? 0 : Number(rawVersion);
  if (
    (typeof rawVersion === "object" && rawVersion !== null) ||
    !Number.isInteger(version) ||
    version < 0 ||
    version > 2147483646
  )
    throw new Error("invalid assignment version");
  return { staff_id: staff, resource_id: resource, expected_version: version };
}
function signature(
  operation: string,
  args: Record<string, unknown>,
  selected: unknown,
) {
  return createHash("sha256")
    .update(JSON.stringify([operation, args, selected]))
    .digest("hex");
}

export async function calendarWrite(
  db: Database,
  operation: Operation,
  args: Record<string, unknown>,
  form: FormData,
) {
  let selected;
  try {
    selected = assignment(form);
  } catch {
    return {
      data: null,
      error: {
        message: "Sprawdź prowadzącego i miejsce zajęć.",
      } as CalendarError,
    };
  }
  const confirmation = signature(operation, args, selected);
  const { data, error } = await db.rpc("calendar_write", {
    p_operation: operation,
    p_arguments: args,
    p_assignment: selected,
    p_confirm_short_break:
      form.get("confirm_short_break") === "true" &&
      form.get("calendar_confirmation") === confirmation,
  });
  return {
    data,
    error: error
      ? ({ ...error, confirmation_signature: confirmation } as CalendarError)
      : null,
  };
}

/** Use the same confirmation for direct calendar RPCs. A changed payload must be checked again. */
export function calendarConfirmation(
  operation: string,
  args: Record<string, unknown>,
  form: FormData,
) {
  const confirmation = signature(operation, args, null);
  return {
    signature: confirmation,
    confirmed:
      form.get("confirm_short_break") === "true" &&
      form.get("calendar_confirmation") === confirmation,
  };
}

export function calendarWarning(
  error: CalendarError | null | undefined,
): Pick<ActionState, "calendarWarning"> | null {
  if (error?.hint !== "CALENDAR_SHORT_BREAK" || !error.confirmation_signature)
    return null;
  const details: string[] = [];
  try {
    const rows: unknown = JSON.parse(error.details || "[]");
    const format = new Intl.DateTimeFormat("pl-PL", {
      timeZone: "Europe/Warsaw",
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    });
    if (Array.isArray(rows))
      for (const row of rows.slice(0, 5)) {
        if (!row || typeof row !== "object") continue;
        const item = row as Record<string, unknown>;
        if (
          typeof item.previous_end !== "string" ||
          typeof item.next_start !== "string" ||
          typeof item.gap_minutes !== "number" ||
          typeof item.required_minutes !== "number"
        )
          continue;
        const before = new Date(item.previous_end),
          after = new Date(item.next_start);
        if (
          !Number.isFinite(before.getTime()) ||
          !Number.isFinite(after.getTime()) ||
          item.gap_minutes < 0 ||
          item.required_minutes < 0 ||
          item.required_minutes > 240
        )
          continue;
        details.push(
          `Przerwa ${Math.floor(item.gap_minutes)} min (zalecane ${item.required_minutes} min): koniec poprzedniego ${format.format(before)}, początek następnego ${format.format(after)}.`,
        );
      }
  } catch {
    /* A malformed detail never blocks showing the safe warning. */
  }
  return {
    calendarWarning: {
      message:
        "Ten termin pozostawia krótszą przerwę niż ustawiona. Sprawdź czas na dojazd i przygotowanie przed zatwierdzeniem.",
      signature: error.confirmation_signature,
      details,
    },
  };
}
