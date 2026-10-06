"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireSession } from "@/lib/auth/session";
import { uuid } from "@/lib/validation/schemas";
import { parseMoney } from "@/lib/finance";
import type { CourseActionState } from "./actions";

const knownErrors = new Set([
  "Zgłoszenie zmieniło się. Odśwież widok przed zapisem.",
  "Uzgodnij kwotę po rezygnacji lub odwołaniu zgłoszenia.",
  "Kwota nie może przekraczać ceny przyjętego zgłoszenia.",
  "Zwrot przekracza pozostałą kwotę wpłaty.",
  "Można zwrócić wyłącznie zaksięgowaną wpłatę.",
]);
const failure = (message?: string): CourseActionState => ({
  error:
    message && knownErrors.has(message)
      ? message
      : "Nie udało się zapisać rozliczenia. Wpisane dane pozostają w formularzu. Odśwież widok i sprawdź aktualne saldo.",
});
function refresh() {
  revalidatePath("/admin", "layout");
  revalidatePath("/app", "layout");
}
export async function settleEnrollment(
  _: CourseActionState,
  form: FormData,
): Promise<CourseActionState> {
  const { db } = await requireSession("admin");
  const parsed = z
    .object({
      enrollment_id: uuid,
      expected_version: z.coerce.number().int().min(1),
      request_id: uuid,
      note: z.string().trim().min(3).max(3000),
    })
    .safeParse(Object.fromEntries(form));
  const raw = form.get("amount"),
    amount =
      typeof raw === "string" && /^0{1,5}(?:[.,]0{1,2})?$/.test(raw.trim())
        ? 0
        : parseMoney(raw);
  if (!parsed.success || amount === null)
    return {
      error:
        "Podaj kwotę od 0 do 10 000 zł (do dwóch miejsc po przecinku) i powód uzgodnienia (3–3000 znaków).",
    };
  const p = parsed.data;
  try {
    const { data, error } = await db.rpc("settle_course_enrollment", {
      p_id: p.enrollment_id,
      p_expected_version: p.expected_version,
      p_amount_cents: amount,
      p_note: p.note,
      p_request_id: p.request_id,
    });
    if (error || !Number.isInteger(data) || data <= p.expected_version)
      return failure(error?.message);
    refresh();
    return {
      version: data,
      success:
        "Uzgodniona kwota zapisana. Wpłaty i zwroty zachowały swoją historię.",
    };
  } catch {
    return failure();
  }
}
export async function refundCoursePayment(
  _: CourseActionState,
  form: FormData,
): Promise<CourseActionState> {
  const { db } = await requireSession("admin");
  const parsed = z
    .object({
      payment_id: uuid,
      request_id: uuid,
      note: z.string().trim().min(3).max(2000),
    })
    .safeParse(Object.fromEntries(form));
  const amount = parseMoney(form.get("amount"));
  if (!parsed.success || amount === null)
    return {
      error:
        "Podaj zwróconą kwotę od 0,01 do 10 000 zł (do dwóch miejsc po przecinku) i powód (3–2000 znaków).",
    };
  const p = parsed.data;
  try {
    const { data, error } = await db.rpc("refund_course_payment", {
      p_payment: p.payment_id,
      p_amount_cents: amount,
      p_note: p.note,
      p_request_id: p.request_id,
    });
    if (error || data !== p.request_id) return failure(error?.message);
    refresh();
    return {
      success:
        "Zwrot odnotowany w historii rozliczenia. Aplikacja nie wykonuje przelewu.",
    };
  } catch {
    return failure();
  }
}
