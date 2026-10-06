import { z } from "zod";
// Parse decimal PLN without rounding invalid extra precision or using float multiplication.
export function priceToCents(value: string) {
  const cleaned = value.trim().replace(",", ".");
  if (!/^\d{1,5}(\.\d{1,2})?$/.test(cleaned)) return NaN;
  const [whole, decimal = ""] = cleaned.split(".");
  return Number(whole) * 100 + Number(decimal.padEnd(2, "0"));
}
const optionalNumber = (max: number) =>
  z.preprocess(
    (v) => (v === "" ? null : v),
    z.coerce.number().int().min(1).max(max).nullable(),
  );
export const serviceSchema = z.object({
  id: z.uuid(),
  expected_version: z.coerce.number().int().min(1).max(2147483646),
  name: z.string().trim().min(3).max(160),
  description: z.string().trim().max(2000),
  price: z
    .string()
    .transform(priceToCents)
    .pipe(z.number().int().min(1).max(1000000)),
  price_unit: z.string().trim().min(3).max(80),
  duration_minutes: optionalNumber(480).refine((v) => v === null || v >= 15),
  sessions_count: optionalNumber(100),
  active: z.enum(["true", "false"]).transform((v) => v === "true"),
  is_test_price: z.enum(["true", "false"]).transform((v) => v === "true"),
});
