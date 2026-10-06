import { z } from "zod";

export const careText = {
  title: z
    .string()
    .trim()
    .min(3, "Tytuł musi mieć co najmniej 3 znaki.")
    .max(160, "Tytuł może mieć do 160 znaków."),
  body: z
    .string()
    // HTML form submission uses CRLF while textarea values and API clients
    // use LF. Normalize before validation so paragraphs and length agree.
    .transform((value) => value.replace(/\r\n?/g, "\n"))
    .pipe(
      z
        .string()
        .trim()
        .min(3, "Wpisz treść zaleceń.")
        .max(20000, "Treść może mieć do 20 000 znaków."),
    ),
};
const version = z.coerce.number().int().min(0).max(2147483646);
export const planSchema = z
  .object({
    dog_id: z.uuid(),
    consultation_id: z.union([z.literal(""), z.uuid()]).default(""),
    course_enrollment_id: z.union([z.literal(""), z.uuid()]).default(""),
    course_session_id: z.union([z.literal(""), z.uuid()]).default(""),
    fitness_package_id: z.union([z.literal(""), z.uuid()]).default(""),
    fitness_session_id: z.union([z.literal(""), z.uuid()]).default(""),
    expected_version: version,
    ...careText,
    follow_up_on: z.union([z.literal(""), z.iso.date()]),
    intent: z.enum(["draft", "publish"]),
  })
  .refine(
    (p) =>
      [p.consultation_id, p.course_enrollment_id, p.fitness_package_id].filter(
        Boolean,
      ).length <= 1,
    {
      message: "Wybierz konsultację, kurs albo fitness.",
      path: ["course_enrollment_id"],
    },
  )
  .refine((p) => !p.course_session_id || Boolean(p.course_enrollment_id), {
    message: "Wybierz kurs tego spotkania.",
    path: ["course_session_id"],
  })
  .refine((p) => !p.fitness_session_id || Boolean(p.fitness_package_id), {
    message: "Wybierz pakiet fitness tego spotkania.",
    path: ["fitness_session_id"],
  });
export const templateSchema = z.object({
  id: z.uuid(),
  expected_version: version,
  ...careText,
});
export const progressSchema = z.object({
  id: z.uuid(),
  plan_id: z.uuid(),
  attempted: z
    .string()
    .trim()
    .min(3, "Napisz kilka słów o Waszej pracy.")
    .max(3000),
  went_well: z.string().trim().max(3000),
  difficult: z.string().trim().max(3000),
});
