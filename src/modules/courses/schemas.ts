import { z } from "zod";
import { warsawLocalToISO } from "../../lib/time";

const version = z.coerce.number().int().min(1).max(2147483646);
const base = { id: z.uuid(), expected_version: version };
const note = z.string().trim().max(3000);
const date = z.string().transform((value, ctx) => {
  try {
    return warsawLocalToISO(value);
  } catch {
    ctx.addIssue({
      code: "custom",
      message: "Podaj poprawny termin w czasie polskim.",
    });
    return z.NEVER;
  }
});
export const createCourseSchema = z.object({
  id: z.uuid(),
  service_id: z.uuid(),
  service_version: version,
  title: z.string().trim().min(3).max(160),
  capacity: z.coerce.number().int().min(1).max(50),
  public_location: z.string().trim().min(3).max(300),
  exact_location: z.string().trim().min(3).max(2000),
  starts: z.array(date).min(1).max(100),
});
export const courseChangeSchema = z
  .object({
    ...base,
    intent: z.enum(["publish", "close", "reopen", "complete", "cancel"]),
    note,
  })
  .refine((p) => p.intent !== "cancel" || p.note.length >= 3, {
    path: ["note"],
    message: "Podaj powód odwołania.",
  });
export const courseSettingsSchema = z.object({
  ...base,
  request_id: z.uuid(),
  title: z.string().trim().min(3).max(160),
  capacity: z.coerce.number().int().min(1).max(50),
  note: note.pipe(z.string().min(3)),
});
export const enrollmentSchema = z.object({
  id: z.uuid(),
  course_id: z.uuid(),
  dog_id: z.uuid(),
  course_version: version,
});
export const decisionSchema = z
  .object({
    ...base,
    intent: z.enum(["accept", "waitlist", "reject", "cancel"]),
    note,
  })
  .refine(
    (p) => !["reject", "cancel"].includes(p.intent) || p.note.length >= 3,
    { path: ["note"], message: "Podaj powód decyzji." },
  );
export const reopeningSchema = z.object({
  ...base,
  intent: z.enum(["reconsider", "restore"]),
  note: note.pipe(z.string().min(3)),
});
export const rescheduleSchema = z.object({
  ...base,
  starts_at: date,
  public_location: z.string().trim().min(3).max(300),
  exact_location: z.string().trim().min(3).max(2000),
  note: note.pipe(z.string().min(3)),
});
export const sessionChangeSchema = z
  .object({ ...base, intent: z.enum(["complete", "cancel"]), note })
  .refine((p) => p.intent !== "cancel" || p.note.length >= 3, {
    path: ["note"],
    message: "Podaj powód odwołania.",
  });
export const attendanceSchema = z.object({
  session_id: z.uuid(),
  enrollment_id: z.uuid(),
  expected_version: z.coerce.number().int().min(0).max(2147483646),
  attendance: z.enum(["present", "absent", "excused"]),
});
export const attendanceCorrectionSchema = attendanceSchema.extend({
  expected_version: version,
  note: note.pipe(z.string().min(3)),
});
