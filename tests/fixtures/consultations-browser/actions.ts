import type { ActionState } from "@/components/action-form";
declare global {
  interface Window {
    consultationFail?: boolean;
    consultationCalls: Record<string, FormDataEntryValue>[];
    refreshConsultation: () => void;
  }
}
async function record(_: ActionState, form: FormData) {
  window.consultationCalls ||= [];
  const input = Object.fromEntries(form);
  window.consultationCalls.push(input);
  if (window.consultationFail)
    return { error: "Nie udało się zapisać. Spróbuj ponownie." };
  return {
    success: "Zapisano dane testowe.",
    version: Number(input.expected_version || 0) + 1,
  };
}
export const requestConsultation = record;
export const scheduleConsultation = record;
export const closeConsultation = record;
