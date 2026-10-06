import { z } from "zod";
import { warsawLocalToISO } from "@/lib/time";
export const fitnessRequestSchema = z.object({
  id: z.uuid(),
  dog_id: z.uuid(),
  service_id: z.uuid(),
  service_version: z.coerce.number().int().min(1).max(2147483647),
  topic: z.string().trim().min(3).max(3000),
  availability: z.string().trim().max(1000),
});
const command = {
  id: z.uuid(),
  expected_version: z.coerce.number().int().min(1).max(2147483646),
  request_id: z.uuid(),
  note: z.string().trim().max(3000),
};
export const fitnessPackageSchema = z
  .object({
    ...command,
    intent: z.enum([
      "accept",
      "reject",
      "cancel",
      "complete",
      "resume",
      "restore",
      "reconsider",
    ]),
  })
  .refine(
    (p) => ["accept", "complete"].includes(p.intent) || p.note.length >= 3,
    { path: ["note"], message: "Podaj powód zmiany." },
  );
export const fitnessScheduleSchema = z.object({
  ...command,
  location: z.string().trim().min(3).max(2000),
  starts_at: z.string().transform((value, context) => {
    try {
      return warsawLocalToISO(value);
    } catch {
      context.addIssue({
        code: "custom",
        message: "Podaj termin w czasie polskim.",
      });
      return z.NEVER;
    }
  }),
});
export const fitnessSessionSchema = z
  .object({
    ...command,
    intent: z.enum(["cancel", "complete", "reopen", "correct"]),
    attendance: z.enum(["present", "absent", "excused", ""]).default(""),
  })
  .refine((p) => p.intent === "complete" || p.note.length >= 3, {
    path: ["note"],
    message: "Podaj powód zmiany.",
  })
  .refine(
    (p) =>
      ["complete", "correct"].includes(p.intent)
        ? !!p.attendance
        : !p.attendance,
    {
      path: ["attendance"],
      message: "Wybierz obecność dla zakończenia lub korekty.",
    },
  );
