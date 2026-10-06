import type { BlockState } from "@/modules/calendar/actions";
declare global {
  interface Window {
    calendarFail?: boolean;
    calendarCalls: Record<string, FormDataEntryValue>[];
    refreshCalendar: () => void;
  }
}
async function record(form: FormData, cancelled = false): Promise<BlockState> {
  window.calendarCalls ||= [];
  const input = Object.fromEntries(form);
  window.calendarCalls.push(input);
  if (window.calendarFail)
    return {
      error:
        "Ten czas jest już zajęty przez spacer, konsultację lub blokadę. Sprawdź kalendarz.",
    };
  return cancelled
    ? { cancelled: true, success: "Blokada usunięta." }
    : {
        version: Number(input.expected_version) + 1,
        success: "Zapisano blokadę testową.",
      };
}
export async function saveBlock(_: BlockState, form: FormData) {
  return record(form);
}
export async function cancelBlock(_: BlockState, form: FormData) {
  return record(form, true);
}
