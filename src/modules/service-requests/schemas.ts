import { z } from "zod";
export const dateRequestSchema = z.object({
  request_id: z.uuid(),
  service_id: z.uuid(),
  dog_id: z.uuid(),
  message: z.string().trim().min(3).max(2000),
  availability: z.string().trim().max(1000),
});
export const changeRequestSchema = z
  .object({
    id: z.uuid(),
    service_id: z.uuid(),
    expected_version: z.coerce.number().int().min(1),
    intent: z.enum(["handled", "cancelled"]),
    note: z.string().trim().max(2000).default(""),
  })
  .refine((value) => value.intent !== "handled" || value.note.length >= 3, {
    path: ["note"],
    message: "Dodaj notatkę dla opiekuna.",
  });
