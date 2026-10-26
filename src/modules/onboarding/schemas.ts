import { z } from "zod";

export const OnboardingStepSchema = z.enum([
  "welcome",
  "dog",
  "goal",
  "style",
  "plan",
]);

export const OnboardingAnswersSchema = z.strictObject({
  dogName: z.string().trim().max(40),
  age: z.enum(["puppy", "adult", "senior", "unknown"]).nullable(),
  goal: z
    .enum(["walks", "home", "puppy", "activity", "relationship", "unknown"])
    .nullable(),
  format: z.enum(["individual", "group", "unknown"]).nullable(),
  note: z.string().trim().max(240),
  collaboration: z.enum(["unknown", "new", "after"]),
  rhythm: z.enum(["unknown", "short", "more"]),
});

export const SaveOnboardingSchema = z
  .strictObject({
    revision: z.number().int().min(0).max(2147483646),
    answers: OnboardingAnswersSchema,
    step: OnboardingStepSchema,
    paused: z.boolean(),
    complete: z.boolean(),
  })
  .refine(
    (input) =>
      !input.complete ||
      (input.answers.age !== null &&
        input.answers.goal !== null &&
        input.answers.format !== null &&
        input.step === "plan" &&
        !input.paused),
    { message: "Wybierz etap życia, potrzebę i formę spotkań." },
  );

export const OnboardingRecordSchema = z
  .strictObject({
    guardian_id: z.uuid(),
    answers: OnboardingAnswersSchema,
    current_step: OnboardingStepSchema,
    paused: z.boolean(),
    completed_at: z.iso.datetime({ offset: true }).nullable(),
    revision: z.number().int().min(0).max(2147483647),
    created_at: z.iso.datetime({ offset: true }),
    updated_at: z.iso.datetime({ offset: true }),
  })
  .refine(
    (record) =>
      record.completed_at === null ||
      (record.answers.age !== null &&
        record.answers.goal !== null &&
        record.answers.format !== null),
    { message: "Nieprawidłowy zapis ukończonego wprowadzenia." },
  );
