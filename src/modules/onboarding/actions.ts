"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth/session";
import { OnboardingRecordSchema, SaveOnboardingSchema } from "./schemas";
import {
  ONBOARDING_CONFLICT,
  ONBOARDING_FAILURE,
  ONBOARDING_INVALID,
  type SaveOnboardingInput,
  type SaveOnboardingResult,
} from "./types";

export async function saveOnboarding(
  input: SaveOnboardingInput,
): Promise<SaveOnboardingResult> {
  const { db, user, profile, onboarding } = await requireSession(
    "client",
    false,
  );
  if (!profile?.full_name || !profile?.phone || !profile?.area)
    redirect("/complete-profile");

  if (!onboarding)
    return {
      ok: false,
      error: "To konto nie wymaga wprowadzenia. Wróć do swojego panelu.",
    };
  const parsed = SaveOnboardingSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: ONBOARDING_INVALID };

  const value = parsed.data;
  let saved: SaveOnboardingResult;
  try {
    const { data, error } = await db.rpc("save_guardian_onboarding", {
      p_revision: value.revision,
      p_answers: value.answers,
      p_step: value.step,
      p_paused: value.paused,
      p_complete: value.complete,
    });
    if (error) {
      if (error.message === ONBOARDING_CONFLICT)
        return { ok: false, error: ONBOARDING_CONFLICT, conflict: true };
      return {
        ok: false,
        error:
          error.message === ONBOARDING_INVALID
            ? ONBOARDING_INVALID
            : ONBOARDING_FAILURE,
      };
    }
    const row = Array.isArray(data)
      ? data.length === 1
        ? data[0]
        : null
      : data;
    const result = OnboardingRecordSchema.safeParse(row);
    if (
      !result.success ||
      result.data.guardian_id !== user.id ||
      result.data.revision !== value.revision + 1 ||
      result.data.current_step !== value.step ||
      result.data.paused !== value.paused ||
      JSON.stringify(result.data.answers) !== JSON.stringify(value.answers) ||
      (value.complete && result.data.completed_at === null) ||
      (onboarding.completed_at !== null &&
        result.data.completed_at !== onboarding.completed_at)
    )
      return { ok: false, error: ONBOARDING_FAILURE };
    saved = { ok: true, record: result.data };
  } catch {
    return { ok: false, error: ONBOARDING_FAILURE };
  }

  revalidatePath("/onboarding");
  revalidatePath("/app", "layout");
  return saved;
}
