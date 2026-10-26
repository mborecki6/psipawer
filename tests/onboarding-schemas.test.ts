import { describe, expect, it } from "vitest";
import {
  OnboardingAnswersSchema,
  OnboardingRecordSchema,
  SaveOnboardingSchema,
} from "../src/modules/onboarding/schemas";
import { createOnboardingAnswers } from "../src/modules/onboarding/types";

const answers = {
  ...createOnboardingAnswers(),
  age: "unknown" as const,
  goal: "unknown" as const,
  format: "unknown" as const,
};
const input = {
  revision: 0,
  answers,
  step: "plan" as const,
  paused: false,
  complete: true,
};
const record = {
  guardian_id: "81000000-0000-4000-8000-000000000001",
  answers,
  current_step: "plan",
  paused: false,
  completed_at: "2026-10-26T10:00:00+00:00",
  revision: 1,
  created_at: "2026-10-26T09:00:00+00:00",
  updated_at: "2026-10-26T10:00:00+00:00",
};

describe("onboarding input and persisted state", () => {
  it("creates an independent empty draft and accepts it for pause, not completion", () => {
    const first = createOnboardingAnswers();
    first.dogName = "Figa";
    expect(createOnboardingAnswers().dogName).toBe("");
    const draft = {
      ...input,
      answers: createOnboardingAnswers(),
      step: "dog",
      paused: true,
      complete: false,
    };
    expect(SaveOnboardingSchema.safeParse(draft).success).toBe(true);
    expect(
      SaveOnboardingSchema.safeParse({ ...draft, complete: true }).success,
    ).toBe(false);
  });

  it("accepts every unknown as a complete answer without a dog name or note", () => {
    expect(SaveOnboardingSchema.parse(input)).toEqual(input);
    expect(OnboardingRecordSchema.parse(record)).toEqual(record);
  });

  it("normalizes optional text and enforces the prototype limits", () => {
    expect(
      OnboardingAnswersSchema.parse({
        ...answers,
        dogName: " Figa ",
        note: "  Jedna sytuacja.  ",
      }),
    ).toMatchObject({ dogName: "Figa", note: "Jedna sytuacja." });
    expect(
      OnboardingAnswersSchema.safeParse({
        ...answers,
        dogName: "x".repeat(40),
        note: "x".repeat(240),
      }).success,
    ).toBe(true);
    for (const invalid of [
      { ...answers, dogName: "x".repeat(41) },
      { ...answers, note: "x".repeat(241) },
    ])
      expect(OnboardingAnswersSchema.safeParse(invalid).success).toBe(false);
  });

  it.each([
    null,
    [],
    {},
    { ...answers, age: "" },
    { ...answers, age: "old" },
    { ...answers, goal: false },
    { ...answers, format: "therapy" },
    { ...answers, dogName: null },
    { ...answers, note: undefined },
    { ...answers, collaboration: null },
    { ...answers, rhythm: "daily" },
    { ...answers, guardian_id: "other" },
    { ...answers, completed_at: "2026-10-26" },
  ])("rejects malformed answers and privileged extra keys: %j", (value) => {
    expect(OnboardingAnswersSchema.safeParse(value).success).toBe(false);
  });

  it.each([
    { ...input, revision: -1 },
    { ...input, revision: 0.5 },
    { ...input, revision: "0" },
    { ...input, revision: 2147483647 },
    { ...input, paused: "false" },
    { ...input, complete: null },
    { ...input, step: "paused" },
    { ...input, step: "style" },
    { ...input, paused: true },
    { ...input, answers: { ...answers, age: null } },
    { ...input, answers: { ...answers, goal: null } },
    { ...input, answers: { ...answers, format: null } },
    { ...input, guardian_id: "other" },
  ])("rejects an invalid save or premature completion: %j", (value) => {
    expect(SaveOnboardingSchema.safeParse(value).success).toBe(false);
  });

  it("validates persisted state without mistaking malformed data for an old account", () => {
    expect(
      OnboardingRecordSchema.safeParse({
        ...record,
        completed_at: null,
        answers: createOnboardingAnswers(),
      }).success,
    ).toBe(true);
    for (const malformed of [
      null,
      [],
      {},
      { ...record, guardian_id: "other" },
      { ...record, revision: -1 },
      { ...record, current_step: "paused" },
      { ...record, completed_at: "yesterday" },
      { ...record, created_at: "2026-10-26" },
      { ...record, updated_at: null },
      { ...record, answers: createOnboardingAnswers() },
      { ...record, role: "admin" },
    ])
      expect(OnboardingRecordSchema.safeParse(malformed).success).toBe(false);
  });

  it("keeps a completed record valid while editing or pausing", () => {
    expect(
      OnboardingRecordSchema.safeParse({
        ...record,
        current_step: "dog",
        paused: true,
      }).success,
    ).toBe(true);
  });
});
