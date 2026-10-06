import { z } from "zod";
const optionalId = z
  .union([z.uuid(), z.literal("")])
  .transform((value) => value || null);
const version = z.coerce.number().int().min(1).max(2147483646);
const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const parsed = new Date(`${value}T12:00:00Z`);
    return (
      Number.isFinite(parsed.getTime()) &&
      parsed.toISOString().slice(0, 10) === value &&
      value >= "2000-01-01"
    );
  }, "Podaj prawidłową datę zakupu.");
export const giftIssueSchema = z
  .object({
    id: z.uuid(),
    service_id: optionalId,
    service_version: z
      .union([version, z.literal("")])
      .transform((value) => value || null),
    beneficiary_id: optionalId,
    purchased_on: date,
    sender: z.string().trim().min(1).max(120),
    recipient: z.string().trim().min(1).max(120),
    message: z.string().trim().max(500),
    method: z.enum(["cash", "transfer", "card", "other"]),
    note: z.string().trim().max(2000),
    confirmed: z.literal("on"),
  })
  .refine(
    (value) => Boolean(value.service_id) === Boolean(value.service_version),
    {
      path: ["service_id"],
      message: "Wybierz usługę z bieżącej oferty.",
    },
  );
const command = {
  card_id: z.uuid(),
  expected_version: version,
  request_id: z.uuid(),
};
export const giftChangeSchema = z
  .object({
    ...command,
    intent: z.enum(["assign", "unassign", "cancel", "restore"]),
    beneficiary_id: optionalId,
    note: z.string().trim().min(3).max(2000),
  })
  .refine(
    (value) =>
      value.intent === "assign"
        ? Boolean(value.beneficiary_id)
        : !value.beneficiary_id,
    {
      path: ["beneficiary_id"],
      message: "Wybierz opiekuna wyłącznie dla przypisania karty.",
    },
  );
export const giftRedeemSchema = z.object({
  ...command,
  target_kind: z.enum([
    "registration",
    "package",
    "consultation",
    "course",
    "fitness",
  ]),
  target_id: z.uuid(),
  note: z.string().trim().max(2000),
});
export const giftCashRefundSchema = z.object({
  ...command,
  note: z.string().trim().min(3).max(2000),
  confirmed: z.literal("on"),
});
export const giftBindSchema = z.object({
  target_kind: z.enum(["registration", "package"]),
  target_id: z.uuid(),
  service_id: z.uuid(),
  expected_version: z.coerce.number().int().min(0).max(2147483646),
  note: z.string().trim().min(3).max(2000),
});
export const giftClaimSchema = z.object({
  code: z
    .string()
    .trim()
    .max(60)
    .transform((value) => value.replaceAll("-", "").toUpperCase())
    .pipe(
      z
        .string()
        .regex(
          /^[A-F0-9]{40}$/,
          "Kod karty ma 40 znaków. Możesz wkleić go z myślnikami.",
        ),
    ),
});
