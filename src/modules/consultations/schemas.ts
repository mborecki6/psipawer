import { z } from "zod";
import { warsawLocalToISO } from "../../lib/time";
import { priceToCents } from "../services/schemas";
export const requestSchema = z.object({
  id: z.uuid(),
  dog_id: z.uuid(),
  service_id: z.uuid(),
  service_version: z.coerce.number().int().min(1).max(2147483647),
  topic: z.string().trim().min(3).max(3000),
  availability: z.string().trim().max(1000),
});
const base = {
  id: z.uuid(),
  expected_version: z.coerce.number().int().min(1).max(2147483646),
};
export const agreePriceSchema = z.object({
  ...base,
  request_id: z.uuid(),
  amount: z
    .string()
    .transform(priceToCents)
    .pipe(z.number().int().min(1).max(1000000)),
  is_test_price: z.enum(["true", "false"]).transform((v) => v === "true"),
  note: z.string().trim().min(3).max(3000),
});
export const scheduleSchema = z.object({
  ...base,
  starts_at: z.string().transform((value, context) => {
    try {
      return warsawLocalToISO(value);
    } catch {
      context.addIssue({
        code: "custom",
        message: "Podaj poprawny termin w czasie polskim.",
      });
      return z.NEVER;
    }
  }),
  duration_minutes: z.coerce.number().int().min(15).max(240),
  meeting_mode: z.enum(["in_person", "online"]),
  location: z.string().trim().min(3).max(1000),
  note: z.string().trim().max(3000),
});
export const closeSchema = z
  .object({
    ...base,
    intent: z.enum(["cancel", "complete"]),
    note: z.string().trim().max(3000),
  })
  .refine((p) => p.intent !== "cancel" || p.note.length >= 3, {
    message: "Podaj powód odwołania.",
    path: ["note"],
  });
