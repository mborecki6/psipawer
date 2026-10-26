import "server-only";
import { requireSession } from "@/lib/auth/session";
import type { OnboardingRecord } from "./types";

export async function getOwnOnboarding(): Promise<OnboardingRecord | null> {
  const { onboarding } = await requireSession("client", false);
  return onboarding;
}
