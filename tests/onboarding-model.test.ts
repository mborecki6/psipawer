import { describe, expect, it } from "vitest";
import {
  onboardingEditorStep,
  onboardingStart,
  onboardingStepError,
} from "../src/modules/onboarding/model";
import {
  createOnboardingAnswers,
  type OnboardingAnswers,
  type OnboardingRecord,
} from "../src/modules/onboarding/types";

function answers(values: Partial<OnboardingAnswers> = {}): OnboardingAnswers {
  return {
    ...createOnboardingAnswers(),
    age: "unknown",
    goal: "unknown",
    format: "unknown",
    ...values,
  };
}

describe("guardian's first step", () => {
  it.each([
    [{}, "dog"],
    [{ age: "unknown" }, "goal"],
    [{ age: "unknown", goal: "unknown" }, "style"],
    [{ age: "unknown", goal: "unknown", format: "unknown" }, "style"],
  ] as const)(
    "never renders an unfinished draft as a completed card: %s",
    (values, step) => {
      const record: OnboardingRecord = {
        guardian_id: "guardian",
        answers: { ...createOnboardingAnswers(), ...values },
        current_step: "plan",
        paused: false,
        completed_at: null,
        revision: 0,
        created_at: "2026-10-26T12:00:00Z",
        updated_at: "2026-10-26T12:00:00Z",
      };
      expect(onboardingEditorStep(record)).toBe(step);
      expect(
        onboardingEditorStep({
          ...record,
          completed_at: "2026-10-26T12:01:00Z",
        }),
      ).toBe("dog");
    },
  );

  it("accepts uncertainty without requiring a name or private note", () => {
    const input = answers();
    for (const step of ["dog", "goal", "style"] as const)
      expect(onboardingStepError(step, input)).toBeNull();
    const result = onboardingStart(input);
    expect(result.heading).toBe("Wasz spokojny start.");
    expect(result.href).toBe("/app/services");
    expect(result.lead).toContain("Nie musisz jeszcze wiedzieć");
    expect(result.tags).toEqual([
      "Wiek do ustalenia",
      "Odkrywanie możliwości",
      "Forma do ustalenia",
    ]);
  });

  it.each([
    ["dog", "age"],
    ["goal", "goal"],
    ["style", "format"],
  ] as const)("asks for the missing choice at %s", (step, field) => {
    expect(onboardingStepError(step, answers({ [field]: null }))).toMatchObject(
      {
        field,
      },
    );
    expect(
      onboardingStepError("welcome", createOnboardingAnswers()),
    ).toBeNull();
  });

  it.each([
    ["walks", "spacery", "spacerach"],
    ["home", "codzienności", "domu"],
    ["puppy", "szczeniakiem", "starcie"],
    ["activity", "aktywność", "opisy zajęć"],
    ["relationship", "porozumienia", "zrozumieć"],
  ] as const)("makes %s a concrete next step", (goal, title, copy) => {
    const result = onboardingStart(answers({ goal }));
    expect(result.title).toContain(title);
    expect(result.copy).toContain(copy);
    expect(result.title).not.toBe(onboardingStart(answers()).title);
  });

  it.each([
    ["puppy", "poznajecie razem świat"],
    ["adult", "Wasza codzienność"],
    ["senior", "obecnym tempie"],
    ["unknown", "uzupełnić później"],
  ] as const)(
    "considers the %s life stage even when the goal is unknown",
    (age, copy) => {
      expect(onboardingStart(answers({ age })).lead).toContain(copy);
    },
  );

  it.each([
    ["individual", "/app/services?category=individual", "Zobacz indywidualne"],
    ["group", "/app/services?category=group", "Zobacz grupowe"],
    ["unknown", "/app/services", "Zobacz ofertę"],
  ] as const)("opens the existing offer for %s", (format, href, action) => {
    expect(onboardingStart(answers({ format, goal: "walks" }))).toMatchObject({
      href,
      action,
    });
  });

  it.each(["individual", "group", "unknown"] as const)(
    "prefers existing care after a meeting, including %s preference",
    (format) => {
      const result = onboardingStart(
        answers({ format, collaboration: "after" }),
      );
      expect(result.href).toBe("/app/care");
      expect(result.action).toBe("Otwórz plany i postępy");
      expect(result.copy).toContain("jeśli Asia już je udostępniła");
    },
  );

  it("uses the chosen rhythm without inventing recommendations", () => {
    expect(onboardingStart(answers({ rhythm: "short" })).rhythm).toBe(
      "Na teraz wystarczy jeden krok.",
    );
    expect(onboardingStart(answers({ rhythm: "more" })).rhythm).toBe(
      "Dalej możesz uzupełnić kartę psa.",
    );
    expect(onboardingStart(answers()).rhythm).toContain("swoim tempie");
  });

  it("keeps private notes out of the dashboard model and leaves answers unchanged", () => {
    const input = Object.freeze(
      answers({ dogName: "  Kluska ", note: "Prywatna sytuacja" }),
    );
    const result = onboardingStart(input);
    expect(result.heading).toBe("Wasz start, Kluska.");
    expect(JSON.stringify(result)).not.toContain("Prywatna sytuacja");
    expect(input.dogName).toBe("  Kluska ");
  });
});
