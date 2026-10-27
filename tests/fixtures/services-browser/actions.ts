import type { ServiceState } from "@/modules/services/actions";
declare global {
  interface Window {
    serviceFail?: boolean;
    serviceDelay?: number;
    serviceCalls: Record<string, FormDataEntryValue>[];
    refreshService: () => void;
  }
}
export async function updateService(
  _: ServiceState,
  form: FormData,
): Promise<ServiceState> {
  window.serviceCalls ||= [];
  const input = Object.fromEntries(form);
  window.serviceCalls.push(input);
  if (window.serviceDelay)
    await new Promise((resolve) => setTimeout(resolve, window.serviceDelay));
  if (window.serviceFail)
    return {
      error: "Nie udało się zapisać. Twoje zmiany pozostają w formularzu.",
    };
  return {
    success: "Zapisano usługę testową.",
    version: Number(input.expected_version) + 1,
  };
}
