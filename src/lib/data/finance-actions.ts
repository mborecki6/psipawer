"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireSession } from "@/lib/auth/session";
import { uuid } from "@/lib/validation/schemas";
import { parseMoney } from "@/lib/finance";
import { warsawLocalToISO } from "@/lib/time";
import type { ActionState } from "@/components/action-form";

const note = z.string().trim().max(2000);
function refresh() {
  revalidatePath("/admin", "layout");
  revalidatePath("/app", "layout");
}
function failure(message: string): ActionState {
  const allowed = [
    "Wpłata przekracza pozostałą kwotę do zapłaty.",
    "To zgłoszenie nie wymaga wpłaty.",
    "Pakiet nie jest aktywny lub utracił ważność.",
    "Brak dostępnych wejść w pakiecie.",
    "To zgłoszenie jest rozliczane pakietem.",
    "Zgłoszenie ma już wpłatę. Nie można rozliczyć go ponownie pakietem.",
    "Pakiet można przypisać do zaakceptowanego przyszłego spaceru.",
    "Zgłoszenie ma już przypisany pakiet.",
    "Pakiet został anulowany.",
  ];
  return {
    error: allowed.includes(message)
      ? message
      : "Nie udało się zapisać rozliczenia. Odśwież widok, sprawdź aktualną należność i spróbuj ponownie.",
  };
}

export async function purchasePackage(
  _: ActionState,
  form: FormData,
): Promise<ActionState> {
  const { db } = await requireSession("admin");
  const parsed = z
    .object({
      dog_id: uuid,
      name: z.string().trim().min(3).max(120),
      entries: z.coerce.number().int().min(1).max(100),
      note,
    })
    .safeParse({ ...Object.fromEntries(form), note: form.get("note") || "" });
  const price = parseMoney(form.get("price"));
  if (!parsed.success || !price)
    return {
      error:
        "Wybierz psa, podaj nazwę (3–120 znaków), 1–100 wejść i cenę od 0,01 do 10 000 zł.",
    };
  let expiresAt: string | null = null;
  if (form.get("expires_at")) {
    try {
      expiresAt = warsawLocalToISO(String(form.get("expires_at")));
    } catch {
      return { error: "Podaj poprawną datę ważności w strefie Europe/Warsaw." };
    }
    if (Date.parse(expiresAt) <= Date.now())
      return { error: "Data ważności musi być w przyszłości." };
  }
  const { error } = await db.rpc("purchase_package", {
    p_dog: parsed.data.dog_id,
    p_name: parsed.data.name,
    p_entries: parsed.data.entries,
    p_price_cents: price,
    p_expires_at: expiresAt,
    p_note: parsed.data.note,
  });
  if (error) return failure(error.message);
  refresh();
  return {
    success: "Pakiet dodany. Otrzymaną wpłatę zapisz osobno w należnościach.",
  };
}

export async function recordPayment(
  _: ActionState,
  form: FormData,
): Promise<ActionState> {
  const { db } = await requireSession("admin");
  const parsed = z
    .object({
      target_kind: z.enum(["registration", "package"]),
      target_id: uuid,
      method: z.enum(["cash", "transfer", "card", "other"]),
      note,
      request_id: uuid,
    })
    .safeParse({ ...Object.fromEntries(form), note: form.get("note") || "" });
  const amount = parseMoney(form.get("amount"));
  if (!parsed.success || !amount)
    return {
      error:
        "Podaj kwotę od 0,01 do 10 000 zł (maksymalnie dwa miejsca po przecinku) i metodę wpłaty.",
    };
  const { data: p } = parsed;
  const { error } = await db.rpc("record_payment", {
    p_registration: p.target_kind === "registration" ? p.target_id : null,
    p_package: p.target_kind === "package" ? p.target_id : null,
    p_amount_cents: amount,
    p_method: p.method,
    p_note: p.note,
    p_request_id: p.request_id,
  });
  if (error) return failure(error.message);
  refresh();
  return { success: "Wpłata zapisana. Należność została przeliczona." };
}

export async function usePackage(
  _: ActionState,
  form: FormData,
): Promise<ActionState> {
  const { db } = await requireSession("admin");
  const parsed = z
    .object({ registration_id: uuid, package_id: uuid, note })
    .safeParse({ ...Object.fromEntries(form), note: form.get("note") || "" });
  if (!parsed.success) return { error: "Wybierz pakiet dla tego zgłoszenia." };
  const { error } = await db.rpc("use_package", {
    p_registration: parsed.data.registration_id,
    p_package: parsed.data.package_id,
    p_note: parsed.data.note,
  });
  if (error) return failure(error.message);
  refresh();
  return {
    success:
      "Wejście zarezerwowane. Obecność lub odwołanie spaceru automatycznie przeliczy pakiet.",
  };
}

export async function voidPayment(
  _: ActionState,
  form: FormData,
): Promise<ActionState> {
  const { db } = await requireSession("admin");
  const parsed = z
    .object({ payment_id: uuid, note: z.string().trim().min(3).max(2000) })
    .safeParse(Object.fromEntries(form));
  if (!parsed.success)
    return { error: "Podaj powód zwrotu lub korekty (3–2000 znaków)." };
  const { error } = await db.rpc("void_payment", {
    p_payment: parsed.data.payment_id,
    p_note: parsed.data.note,
  });
  if (error) return failure(error.message);
  refresh();
  return {
    success:
      "Zwrot lub korekta odnotowana. Oryginalna wpłata pozostaje w historii. Ta operacja nie przelewa pieniędzy.",
  };
}

export async function releasePackage(
  _: ActionState,
  form: FormData,
): Promise<ActionState> {
  const { db } = await requireSession("admin");
  const parsed = z
    .object({ registration_id: uuid, note: z.string().trim().min(3).max(2000) })
    .safeParse(Object.fromEntries(form));
  if (!parsed.success)
    return { error: "Podaj powód odłączenia wejścia (3–2000 znaków)." };
  const { error } = await db.rpc("release_package", {
    p_registration: parsed.data.registration_id,
    p_note: parsed.data.note,
  });
  if (error) return failure(error.message);
  refresh();
  return {
    success:
      "Wejście wróciło do pakietu. Spacer ponownie czeka na rozliczenie.",
  };
}

export async function cancelPackage(
  _: ActionState,
  form: FormData,
): Promise<ActionState> {
  const { db } = await requireSession("admin");
  const parsed = z
    .object({ package_id: uuid, note: z.string().trim().min(3).max(2000) })
    .safeParse(Object.fromEntries(form));
  if (!parsed.success)
    return { error: "Podaj powód anulowania pakietu (3–2000 znaków)." };
  const { error } = await db.rpc("cancel_package", {
    p_package: parsed.data.package_id,
    p_note: parsed.data.note,
  });
  if (error) return failure(error.message);
  refresh();
  return {
    success:
      "Pakiet anulowany. Jeśli był opłacony, rozlicz zwrot i odnotuj go w historii wpłat.",
  };
}
