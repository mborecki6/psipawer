import { z } from "zod";
import { warsawLocalToISO } from "../../lib/time";
const datetime = z.string().transform((v, ctx) => {
  try {
    return warsawLocalToISO(v);
  } catch {
    ctx.addIssue({
      code: "custom",
      message: "Podaj poprawną datę i godzinę (czas polski).",
    });
    return z.NEVER;
  }
});
export const blockSchema = z
  .object({
    id: z.uuid(),
    expected_version: z.coerce.number().int().min(0).max(2147483646),
    title: z.string().trim().min(3).max(160),
    starts_at: datetime,
    ends_at: datetime,
  })
  .refine(
    (v) =>
      Date.parse(v.ends_at) > Date.parse(v.starts_at) &&
      Date.parse(v.ends_at) - Date.parse(v.starts_at) <= 366 * 86400000,
    {
      path: ["ends_at"],
      message: "Koniec musi być po początku, najwyżej rok później.",
    },
  );
export const cancelBlockSchema = z.object({
  id: z.uuid(),
  expected_version: z.coerce.number().int().min(1).max(2147483646),
});

const workingDay = z
  .object({
    weekday: z.number().int().min(1).max(7),
    enabled: z.boolean(),
    start_minute: z.number().int().min(0).max(1425).multipleOf(15),
    end_minute: z.number().int().min(15).max(1440).multipleOf(15),
  })
  .refine((v) => v.end_minute > v.start_minute);
export const calendarSettingsSchema = z
  .object({
    expected_version: z.coerce.number().int().min(1).max(2147483646),
    hours_enabled: z.enum(["true", "false"]).transform((v) => v === "true"),
    before_minutes: z
      .string()
      .regex(/^\d{1,3}$/)
      .transform(Number)
      .pipe(z.number().int().min(0).max(120)),
    after_minutes: z
      .string()
      .regex(/^\d{1,3}$/)
      .transform(Number)
      .pipe(z.number().int().min(0).max(120)),
    week: z
      .string()
      .max(2000)
      .transform((value, ctx) => {
        try {
          return JSON.parse(value) as unknown;
        } catch {
          ctx.addIssue({
            code: "custom",
            message: "Sprawdź harmonogram tygodnia.",
          });
          return z.NEVER;
        }
      })
      .pipe(
        z
          .array(workingDay)
          .length(7)
          .refine((v) => new Set(v.map((d) => d.weekday)).size === 7),
      ),
  })
  .refine((v) => !v.hours_enabled || v.week.some((d) => d.enabled));
