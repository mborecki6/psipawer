import type { BlockState } from "@/modules/calendar/actions";
declare global {
  interface Window {
    calendarFail?: boolean;
    calendarWarn?: boolean;
    calendarCalls: Record<string, FormDataEntryValue>[];
    refreshCalendar: () => void;
  }
}
async function record(form: FormData, cancelled = false): Promise<BlockState> {
  window.calendarCalls ||= [];
  const input = Object.fromEntries(form);
  window.calendarCalls.push(input);
  if (window.calendarWarn && form.get("confirm_short_break") !== "true")
    return {
      calendarWarning: {
        message: "Ten termin pozostawia krótszą przerwę niż ustawiona.",
        signature: "fixture-confirmation",
        details: [
          "Poprzednie spotkanie kończy się o 10:00; przerwa 15 min (zalecane 30 min).",
        ],
      },
    };
  if (window.calendarFail)
    return {
      error:
        "Ten czas jest już zajęty przez spacer, konsultację lub blokadę. Sprawdź kalendarz.",
    };
  return cancelled
    ? { cancelled: true, success: "Blokada usunięta." }
    : {
        version: Number(input.expected_version) + 1,
        assignmentVersion: Number(input.expected_assignment_version || 0) + 1,
        success: "Zapisano blokadę testową.",
      };
}
export async function saveBlock(_: BlockState, form: FormData) {
  return record(form);
}
export async function cancelBlock(_: BlockState, form: FormData) {
  return record(form, true);
}
export async function saveCalendarAssignment(_: BlockState, form: FormData) {
  return record(form);
}
export async function saveCalendarResource(_: BlockState, form: FormData) {
  return record(form);
}
export async function saveCalendarSettings(_: BlockState, form: FormData) {
  return record(form);
}
export async function saveCalendarStaffSettings(_: BlockState, form: FormData) {
  return record(form);
}
