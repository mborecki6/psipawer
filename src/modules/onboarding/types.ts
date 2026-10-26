export type OnboardingStep = "welcome" | "dog" | "goal" | "style" | "plan";

export type OnboardingAnswers = {
  dogName: string;
  age: "puppy" | "adult" | "senior" | "unknown" | null;
  goal:
    "walks" | "home" | "puppy" | "activity" | "relationship" | "unknown" | null;
  format: "individual" | "group" | "unknown" | null;
  note: string;
  collaboration: "unknown" | "new" | "after";
  rhythm: "unknown" | "short" | "more";
};

export type OnboardingRecord = {
  guardian_id: string;
  answers: OnboardingAnswers;
  current_step: OnboardingStep;
  paused: boolean;
  completed_at: string | null;
  revision: number;
  created_at: string;
  updated_at: string;
};

export type SaveOnboardingInput = {
  revision: number;
  answers: OnboardingAnswers;
  step: OnboardingStep;
  paused: boolean;
  complete: boolean;
};

export type SaveOnboardingResult =
  | { ok: true; record: OnboardingRecord }
  | { ok: false; error: string; conflict?: boolean };

export function createOnboardingAnswers(): OnboardingAnswers {
  return {
    dogName: "",
    age: null,
    goal: null,
    format: null,
    note: "",
    collaboration: "unknown",
    rhythm: "unknown",
  };
}

export const ONBOARDING_CONFLICT =
  "Odpowiedzi zmieniły się w innym oknie. Odśwież wprowadzenie przed kolejnym zapisem.";

export const ONBOARDING_INVALID = "Sprawdź odpowiedzi wprowadzenia.";

export const ONBOARDING_FAILURE =
  "Nie udało się zapisać odpowiedzi. Twoje wpisy pozostają w formularzu. Spróbuj ponownie.";
