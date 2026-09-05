import { z } from "zod";
export const emailSchema = z.object({
  email: z.email("Wpisz poprawny adres e-mail.").max(254),
});
export const profileSchema = z.object({
  full_name: z.string().trim().min(2, "Podaj imię i nazwisko.").max(120),
  phone: z
    .string()
    .trim()
    .regex(/^\+?[0-9 ()-]{7,20}$/, "Podaj poprawny numer telefonu."),
  area: z.string().trim().min(2, "Podaj okolicę.").max(120),
});
export const dogStatuses = [
  "new",
  "needs_review",
  "consultation_required",
  "approved",
  "approved_conditional",
  "suspended",
  "not_eligible",
] as const;
export const dogSchema = z.object({
  name: z.string().trim().min(1, "Podaj imię psa.").max(80),
  breed: z.string().trim().max(120),
  approximate_age: z.string().trim().max(80),
  sex: z.enum(["female", "male", "unknown"]),
  weight_kg: z.preprocess(
    (v) => (v === "" || v === null ? null : Number(v)),
    z.number().positive().max(150).nullable(),
  ),
  color: z.string().trim().max(120),
});
export const behaviorSchema = z.object(
  Object.fromEntries(
    [
      "comfort_distance",
      "reactions",
      "triggers",
      "helps",
      "health",
      "medications",
      "allergies",
      "muzzle",
      "bite_history",
      "goals",
    ].map((k) => [k, z.string().trim().max(4000)]),
  ) as Record<string, z.ZodString>,
);
export const walkSchema = z.object({
  starts_at: z.iso
    .datetime({ offset: true })
    .refine(
      (v) => Date.parse(v) > Date.now(),
      "Termin musi być w przyszłości.",
    ),
  duration_minutes: z.coerce.number().int().min(15).max(480),
  public_location: z.string().trim().min(3).max(200),
  type: z.string().trim().min(3).max(100),
  price_cents: z.coerce.number().int().positive().max(1000000),
  capacity: z.coerce.number().int().min(1).max(50),
  booking_mode: z.enum(["approval", "automatic", "invite"]),
  info: z.string().trim().max(4000),
  exact_location: z.string().trim().min(3).max(500),
  map_url: z.union([
    z.literal(""),
    z
      .url()
      .refine(
        (v) => /^https:\/\//.test(v),
        "Link mapy musi zaczynać się od https://",
      ),
  ]),
  instructions: z.string().trim().max(2000),
  cancellation_deadline_hours: z.coerce.number().int().min(0).max(168),
});
export const uuid = z.uuid();
