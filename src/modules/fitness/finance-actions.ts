"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireSession } from "@/lib/auth/session";
import { parseMoney } from "@/lib/finance";
import type { FitnessActionState } from "./actions";
const allowed = new Set([
  "Pakiet zmienił się. Odśwież widok przed zapisem.",
  "Należność nie może przekroczyć ceny wcześniej przyjętego pakietu.",
  "Zwrot przekracza pozostałą kwotę wpłaty.",
  "Można zwrócić wyłącznie zaksięgowaną wpłatę.",
]);
function failure(message?: string): FitnessActionState {
  return {
    error:
      message && allowed.has(message)
        ? message
        : "Nie udało się zapisać rozliczenia fitness. Wpisane dane pozostają w formularzu. Odśwież widok i sprawdź saldo.",
  };
}
function refresh() {
  revalidatePath("/admin", "layout");
  revalidatePath("/app", "layout");
}
export async function settleFitnessPackage(
  _: FitnessActionState,
  form: FormData,
): Promise<FitnessActionState> {
  const { db } = await requireSession("admin");
  const parsed = z
    .object({
      package_id: z.uuid(),
      expected_version: z.coerce.number().int().min(1).max(2147483646),
      request_id: z.uuid(),
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
    const { data, error } = await db.rpc("settle_fitness_package", {
      p_id: p.package_id,
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
export async function refundFitnessPayment(
  _: FitnessActionState,
  form: FormData,
): Promise<FitnessActionState> {
  const { db } = await requireSession("admin");
  const parsed = z
    .object({
      payment_id: z.uuid(),
      request_id: z.uuid(),
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
    const { data, error } = await db.rpc("refund_fitness_payment", {
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
