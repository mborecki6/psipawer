import { z } from "zod";
const date = z
  .string()
  .regex(/^20\d{2}-\d{2}-\d{2}$/)
  .refine(
    (v) =>
      Number.isFinite(Date.parse(`${v}T12:00:00Z`)) &&
      new Date(`${v}T12:00:00Z`).toISOString().slice(0, 10) === v,
  );
export const followUpSchema = z
  .object({
    id: z.uuid(),
    expected_version: z.coerce.number().int().min(1).max(2147483646),
    intent: z.enum(["rescheduled", "completed", "cancelled", "reopened"]),
    note: z.string().trim().min(3).max(2000),
    due_on: z.string().optional(),
  })
  .superRefine((v, ctx) => {
    if (
      ["rescheduled", "reopened"].includes(v.intent) &&
      !date.safeParse(v.due_on).success
    )
      ctx.addIssue({
        code: "custom",
        path: ["due_on"],
        message: "Podaj poprawną datę kontaktu.",
      });
  });
