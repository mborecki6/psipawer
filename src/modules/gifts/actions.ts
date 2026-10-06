"use server";
import { randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireSession } from "@/lib/auth/session";
import { parseMoney } from "@/lib/finance";
import type { ActionState } from "@/components/action-form";
import {
  giftIssueSchema,
  giftChangeSchema,
  giftRedeemSchema,
  giftCashRefundSchema,
  giftClaimSchema,
  giftBindSchema,
} from "./schemas";
export type GiftActionState = ActionState & { id?: string; version?: number };
const allowed = new Set([
  "Karta zmieniła się. Odśwież widok przed zapisem.",
  "Usługa zmieniła się. Odśwież widok przed zapisem.",
  "Kwota przekracza dostępne saldo karty.",
  "Wpłata przekracza pozostałą kwotę do zapłaty.",
  "Wpłata przekracza pozostałą należność.",
  "Karta jest wycofana lub minął jej termin ważności.",
  "Karta i należność muszą należeć do tego samego opiekuna.",
  "Ta karta jest przeznaczona na inną usługę. Sprawdź powiązanie oferty.",
  "Wykorzystana karta zachowuje swojego opiekuna i historię.",
  "Ten identyfikator operacji karty został użyty dla innych danych.",
  "Przed zwrotem pieniędzy wycofaj kartę.",
  "Zwrot przekracza niewykorzystane saldo karty.",
  "Powiązanie usługi zmieniło się. Odśwież widok.",
  "Rozliczenie kartą zachowuje wcześniejsze powiązanie usługi.",
  "Wybierz usługę zgodną z rodzajem rozliczenia.",
  "Nie można przypisać tej karty. Sprawdź kod lub skontaktuj się z prowadzącą.",
  "Zbyt wiele prób. Spróbuj ponownie za 15 minut.",
]);
function failure(message?: string): GiftActionState {
  return {
    error:
      message && allowed.has(message)
        ? message
        : "Nie udało się zapisać karty. Wpisane dane pozostają w formularzu. Odśwież widok i sprawdź aktualne saldo.",
  };
}
function refresh() {
  revalidatePath("/admin", "layout");
  revalidatePath("/app", "layout");
}
export async function issueGiftCard(
  _: GiftActionState,
  form: FormData,
): Promise<GiftActionState> {
  const { db } = await requireSession("admin");
  const parsed = giftIssueSchema.safeParse(Object.fromEntries(form)),
    amount = parseMoney(form.get("amount"));
  if (!parsed.success || amount === null)
    return {
      error:
        "Sprawdź dane karty, wartość od 0,01 do 10 000 zł i potwierdź otrzymaną wpłatę.",
      fields: parsed.success ? undefined : parsed.error.flatten().fieldErrors,
    };
  const p = parsed.data;
  try {
    // A lost response must reuse the original private code. Never accept a
    // caller-supplied code, and never return it through the action response.
    const { data: existing, error: lookupError } = await db
      .from("gift_card_codes")
      .select("code")
      .eq("card_id", p.id)
      .maybeSingle();
    if (lookupError) return failure();
    const code =
      existing?.code ?? randomBytes(20).toString("hex").toUpperCase();
    const { data, error } = await db.rpc("issue_gift_card", {
      p_id: p.id,
      p_service: p.service_id,
      p_expected_service_version: p.service_version,
      p_value_cents: amount,
      p_purchased_on: p.purchased_on,
      p_sender: p.sender,
      p_recipient: p.recipient,
      p_message: p.message,
      p_beneficiary: p.beneficiary_id,
      p_method: p.method,
      p_note: p.note,
      p_code: code,
    });
    if (error || data !== p.id) return failure(error?.message);
    refresh();
    return {
      id: data,
      success:
        "Karta wystawiona. Potwierdzona wpłata i wartość karty zostały zapisane raz. Otwórz kartę, aby przygotować ją do przekazania.",
    };
  } catch {
    return failure();
  }
}
export async function changeGiftCard(
  _: GiftActionState,
  form: FormData,
): Promise<GiftActionState> {
  const { db } = await requireSession("admin");
  const parsed = giftChangeSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success)
    return { error: "Wybierz działanie karty i podaj powód (3–2000 znaków)." };
  const p = parsed.data;
  try {
    const { data, error } = await db.rpc("change_gift_card", {
      p_id: p.card_id,
      p_expected_version: p.expected_version,
      p_action: p.intent,
      p_beneficiary: p.beneficiary_id,
      p_note: p.note,
      p_request_id: p.request_id,
    });
    if (error || !Number.isInteger(data) || data <= p.expected_version)
      return failure(error?.message);
    refresh();
    return {
      version: data,
      success:
        "Zmiana karty zapisana. Saldo, termin ważności i historia pozostały zachowane.",
    };
  } catch {
    return failure();
  }
}
export async function redeemGiftCard(
  _: GiftActionState,
  form: FormData,
): Promise<GiftActionState> {
  const { db } = await requireSession("admin");
  const parsed = giftRedeemSchema.safeParse(Object.fromEntries(form)),
    amount = parseMoney(form.get("amount"));
  if (!parsed.success || amount === null)
    return {
      error:
        "Wybierz należność i podaj kwotę wykorzystania od 0,01 do 10 000 zł.",
    };
  const p = parsed.data;
  try {
    const { data, error } = await db.rpc("redeem_gift_card", {
      p_card: p.card_id,
      p_expected_version: p.expected_version,
      p_kind: p.target_kind,
      p_target: p.target_id,
      p_amount_cents: amount,
      p_note: p.note,
      p_request_id: p.request_id,
    });
    if (error || !z.uuid().safeParse(data).success)
      return failure(error?.message);
    refresh();
    return {
      id: data,
      success:
        "Należność rozliczona z salda karty. To wykorzystanie wcześniejszej wpłaty; nie zapisano nowego wpływu pieniędzy.",
    };
  } catch {
    return failure();
  }
}
export async function refundGiftCardSale(
  _: GiftActionState,
  form: FormData,
): Promise<GiftActionState> {
  const { db } = await requireSession("admin");
  const parsed = giftCashRefundSchema.safeParse(Object.fromEntries(form)),
    amount = parseMoney(form.get("amount"));
  if (!parsed.success || amount === null)
    return {
      error:
        "Podaj kwotę i powód zwrotu oraz potwierdź, że pieniądze zostały zwrócone poza aplikacją.",
    };
  const p = parsed.data;
  try {
    const { data, error } = await db.rpc("refund_gift_card_sale", {
      p_card: p.card_id,
      p_expected_version: p.expected_version,
      p_amount_cents: amount,
      p_note: p.note,
      p_request_id: p.request_id,
    });
    if (error || !z.uuid().safeParse(data).success)
      return failure(error?.message);
    refresh();
    return {
      id: data,
      success:
        "Potwierdzony zwrot pieniędzy odnotowany. Saldo karty zostało pomniejszone; aplikacja nie wykonuje przelewu.",
    };
  } catch {
    return failure();
  }
}
export async function claimGiftCard(
  _: GiftActionState,
  form: FormData,
): Promise<GiftActionState> {
  const { db } = await requireSession("client");
  const parsed = giftClaimSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success)
    return {
      error: "Wklej pełny kod karty (40 znaków). Możesz zachować myślniki.",
    };
  try {
    const { data, error } = await db.rpc("claim_gift_card", {
      p_code: parsed.data.code,
    });
    if (error) return failure();
    if (typeof data?.error === "string") return failure(data.error);
    if (!z.uuid().safeParse(data?.id).success) return failure();
    refresh();
    return {
      id: data.id,
      success:
        "Karta jest przypisana do Twojego konta. Otwórz ją, aby zobaczyć saldo i termin ważności.",
    };
  } catch {
    return failure();
  }
}
export async function bindGiftService(
  _: GiftActionState,
  form: FormData,
): Promise<GiftActionState> {
  const { db } = await requireSession("admin");
  const parsed = giftBindSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success)
    return {
      error:
        "Wybierz usługę z oferty i podaj powód powiązania (3–2000 znaków).",
    };
  const p = parsed.data;
  try {
    const { data, error } = await db.rpc("bind_gift_card_service", {
      p_registration: p.target_kind === "registration" ? p.target_id : null,
      p_package: p.target_kind === "package" ? p.target_id : null,
      p_service: p.service_id,
      p_expected_version: p.expected_version,
      p_note: p.note,
    });
    if (error || !z.uuid().safeParse(data).success)
      return failure(error?.message);
    refresh();
    return {
      id: data,
      success:
        "Usługa została jawnie powiązana z rozliczeniem. Odśwież kartę przed wykorzystaniem salda.",
    };
  } catch {
    return failure();
  }
}
