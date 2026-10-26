"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireSession } from "@/lib/auth/session";
import { uuid } from "@/lib/validation/schemas";
import type { ActionState } from "@/components/action-form";
import { requireLocalPaymentRuntime } from "./runtime";
import { getOnlinePaymentAttempt, privilegedPaymentsClient } from "./server";
import {
  createTpayTransaction,
  getTpayTransaction,
  TpayProviderError,
  isTrustedTpayCheckoutUrl,
} from "./provider";
import { matchesPaymentAttempt, saveProviderOutcome } from "./reconciliation";
import type {
  BeginOnlinePaymentResult,
  OnlinePaymentAttempt,
  OnlinePaymentOutcome,
} from "./types";

function refresh(id: string) {
  revalidatePath("/app", "layout");
  revalidatePath("/admin", "layout");
  revalidatePath(`/app/payments/${id}`);
  revalidatePath(`/admin/payments/${id}`);
}

async function outcome(
  attempt: OnlinePaymentAttempt,
  status: OnlinePaymentOutcome,
  reason: string | null = null,
  paidCents = attempt.amount_cents,
) {
  const { data, error } = await privilegedPaymentsClient().rpc(
    "record_online_payment_outcome",
    {
      p_attempt: attempt.id,
      p_environment: attempt.environment,
      p_transaction_id: attempt.transaction_id,
      p_transaction_title: attempt.transaction_title,
      p_merchant_id: attempt.merchant_id,
      p_status: status,
      p_amount_cents: attempt.amount_cents,
      p_paid_cents: paidCents,
      p_currency: "PLN",
      p_reason: reason,
    },
  );
  if (error || !data)
    throw new Error(
      "Nie udało się zapisać wyniku płatności. Sprawdź status ponownie.",
    );
  return data as OnlinePaymentAttempt;
}

export async function startOnlinePayment(
  _: ActionState,
  form: FormData,
): Promise<ActionState> {
  const { profile, user } = await requireSession("client");
  const parsed = z
    .object({
      target_kind: z.enum([
        "registration",
        "consultation",
        "course",
        "fitness",
      ]),
      target_id: uuid,
      request_id: uuid,
      expected_due_cents: z.coerce.number().int().min(1).max(1000000),
    })
    .safeParse(Object.fromEntries(form));
  if (!parsed.success)
    return {
      error:
        "Wybierz poprawną należność i otwórz potwierdzenie płatności ponownie.",
    };
  let attempt: OnlinePaymentAttempt;
  let destination: string;
  try {
    const runtime = requireLocalPaymentRuntime();
    if (!runtime.canStart)
      return {
        error:
          "Rozpoczynanie nowych płatności jest wyłączone. Historia pozostaje dostępna.",
      };
    const begun = await privilegedPaymentsClient().rpc("begin_online_payment", {
      p_guardian: user.id,
      p_expected_due_cents: parsed.data.expected_due_cents,
      p_merchant_id:
        runtime.environment === "simulator"
          ? "LOCAL-SIMULATOR"
          : runtime.sandbox!.merchantId,
      p_kind: parsed.data.target_kind,
      p_target: parsed.data.target_id,
      p_request_id: parsed.data.request_id,
      p_environment: runtime.environment,
    });
    if (
      begun.error?.message ===
      "Należność zmieniła się. Otwórz podsumowanie i potwierdź aktualną kwotę."
    )
      return { error: begun.error.message };
    if (begun.error || !begun.data)
      return {
        error:
          "Nie można teraz rozpocząć płatności. Sprawdź przyjęcie zgłoszenia, aktualną należność i wcześniejsze próby.",
      };
    const result = begun.data as BeginOnlinePaymentResult;
    attempt = result.attempt;
    destination = `/app/payments/${attempt.id}`;
    if (result.created) {
      if (runtime.environment === "simulator") {
        const bound = await privilegedPaymentsClient().rpc(
          "bind_online_payment",
          {
            p_attempt: attempt.id,
            p_transaction_id: `SIM-${attempt.id}`,
            p_transaction_title: `SIM-${attempt.id}`,
            p_merchant_id: "LOCAL-SIMULATOR",
            p_checkout_url: `${runtime.appOrigin}${destination}`,
          },
        );
        if (bound.error)
          return {
            error:
              "Próba została utworzona, ale nie potwierdzono jej przygotowania. Sprawdź historię prób przed ponowieniem.",
          };
      } else {
        try {
          const transaction = await createTpayTransaction(runtime.sandbox!, {
            attemptId: attempt.id,
            amountCents: attempt.amount_cents,
            payerName: profile.full_name,
            payerEmail: user.email || "",
          });
          const bound = await privilegedPaymentsClient().rpc(
            "bind_online_payment",
            {
              p_attempt: attempt.id,
              p_transaction_id: transaction.transactionId,
              p_transaction_title: transaction.transactionTitle,
              p_merchant_id: runtime.sandbox!.merchantId,
              p_checkout_url: transaction.checkoutUrl,
            },
          );
          if (bound.error || !bound.data) throw new Error("binding");
          destination = transaction.checkoutUrl;
        } catch (error) {
          const rejected =
            error instanceof TpayProviderError && error.kind === "rejected";
          await outcome(
            attempt,
            rejected ? "failed" : "uncertain",
            rejected ? "operator_rejected" : "creation_uncertain",
          );
        }
      }
    }
  } catch {
    return {
      error:
        "Nie potwierdzono rozpoczęcia płatności. Sprawdź historię prób przed ponowieniem.",
    };
  }
  refresh(attempt.id);
  redirect(destination);
}

export async function continueOnlinePayment(
  _: ActionState,
  form: FormData,
): Promise<ActionState> {
  await requireSession("client");
  let destination: string;
  try {
    const runtime = requireLocalPaymentRuntime();
    const attempt = await getOnlinePaymentAttempt(
      String(form.get("attempt_id") || ""),
    );
    if (
      !attempt ||
      attempt.environment !== runtime.environment ||
      attempt.status !== "pending" ||
      !attempt.checkout_url
    )
      return {
        error:
          "Ta próba nie pozwala teraz kontynuować płatności. Sprawdź jej wynik.",
      };
    if (runtime.environment === "simulator")
      return {
        success:
          "To lokalna symulacja. Wybierz poniżej testowy wynik płatności.",
      };
    const url = new URL(attempt.checkout_url);
    if (
      !runtime.sandbox ||
      !isTrustedTpayCheckoutUrl(attempt.checkout_url, runtime.sandbox)
    )
      return { error: "Adres bramki jest nieprawidłowy." };
    destination = url.href;
  } catch {
    return { error: "Nie udało się otworzyć bramki." };
  }
  redirect(destination);
}

export async function checkOnlinePayment(
  _: ActionState,
  form: FormData,
): Promise<ActionState> {
  await requireSession();
  try {
    const runtime = requireLocalPaymentRuntime();
    const attempt = await getOnlinePaymentAttempt(
      String(form.get("attempt_id") || ""),
    );
    if (!attempt || attempt.environment !== runtime.environment)
      return { error: "Ta płatność jest niedostępna." };
    if (runtime.environment === "simulator")
      return {
        success:
          "Symulacja lokalna nie łączy się z Tpay. Wybierz testowy wynik poniżej.",
      };
    if (!attempt.transaction_id)
      return {
        error:
          "Utworzenie transakcji nie zostało potwierdzone. Nie rozpoczynaj kolejnej płatności; zgłoś próbę prowadzącej.",
      };
    const transaction = await getTpayTransaction(
      runtime.sandbox!,
      attempt.transaction_id,
    );
    if (!matchesPaymentAttempt(attempt, transaction))
      return {
        error:
          "Odpowiedź operatora nie odpowiada zapisanej próbie. Wynik wymaga sprawdzenia; nie płać ponownie.",
      };
    const saved = await saveProviderOutcome(attempt, transaction);
    if (!saved)
      return {
        error:
          "Operator udostępnił dane transakcji, ale nie potwierdził otrzymanej kwoty. Czekamy na potwierdzenie wpłaty; nie płać ponownie.",
      };
    const status = transaction.status;
    refresh(attempt.id);
    return {
      success:
        status === "pending"
          ? "Operator nadal oczekuje na zakończenie płatności."
          : "Wynik operatora został sprawdzony i zapisany.",
    };
  } catch {
    return {
      error:
        "Nie udało się potwierdzić wyniku u operatora. To nie oznacza nieudanej wpłaty — sprawdź ponownie później.",
    };
  }
}

export async function simulateOnlinePayment(
  _: ActionState,
  form: FormData,
): Promise<ActionState> {
  await requireSession("client");
  try {
    const runtime = requireLocalPaymentRuntime();
    if (runtime.environment !== "simulator")
      return {
        error: "Symulacja jest dostępna tylko w osobnym trybie lokalnym.",
      };
    const attempt = await getOnlinePaymentAttempt(
      String(form.get("attempt_id") || ""),
    );
    if (!attempt || attempt.environment !== "simulator")
      return { error: "Ta próba symulacji jest niedostępna." };
    const choice = form.get("outcome");
    if (choice !== "success" && choice !== "failure")
      return { error: "Wybierz testowy wynik." };
    if (["paid", "requires_review", "failed"].includes(attempt.status))
      return { success: "Wynik tej próby jest już zapisany." };
    await outcome(
      attempt,
      choice === "success" ? "paid" : "failed",
      choice === "failure" ? "simulated_failure" : null,
    );
    refresh(attempt.id);
    return {
      success:
        "Zapisano wynik symulacji lokalnej. Nie pobrano żadnych pieniędzy i nie połączono się z Tpay.",
    };
  } catch {
    return {
      error:
        "Nie udało się zapisać symulacji. Sprawdź aktualny stan próby przed ponowieniem.",
    };
  }
}

export async function recoverOnlinePayment(
  _: ActionState,
  form: FormData,
): Promise<ActionState> {
  const { user } = await requireSession("admin");
  const parsed = z
    .object({
      attempt_id: uuid,
      transaction_id: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/),
    })
    .safeParse(Object.fromEntries(form));
  if (!parsed.success)
    return { error: "Podaj identyfikator transakcji z panelu operatora." };
  try {
    const runtime = requireLocalPaymentRuntime();
    const attempt = await getOnlinePaymentAttempt(parsed.data.attempt_id);
    if (
      !runtime.sandbox ||
      !attempt ||
      attempt.environment !== runtime.environment ||
      (attempt.merchant_id &&
        attempt.merchant_id !== runtime.sandbox.merchantId)
    )
      return {
        error: "Obsługa tej próby nie jest dostępna w bieżącym środowisku.",
      };
    const transaction = await getTpayTransaction(
      runtime.sandbox,
      parsed.data.transaction_id,
    );
    if (!matchesPaymentAttempt(attempt, transaction, true))
      return {
        error:
          "Transakcja operatora nie odpowiada tej próbie. Nie zmieniono rozliczeń.",
      };
    const { data, error } = await privilegedPaymentsClient().rpc(
      "recover_online_payment_binding",
      {
        p_attempt: attempt.id,
        p_actor: user.id,
        p_transaction_id: transaction.transactionId,
        p_transaction_title: transaction.transactionTitle,
        p_merchant_id: transaction.merchantId,
        p_checkout_url: transaction.checkoutUrl ?? null,
      },
    );
    if (error || !data) throw new Error("Binding unavailable");
    const saved = await saveProviderOutcome(
      data as OnlinePaymentAttempt,
      transaction,
    );
    refresh(attempt.id);
    return {
      success: saved
        ? "Powiązanie i zweryfikowany wynik operatora zapisano. Sprawdź stan rozliczenia poniżej."
        : "Powiązanie transakcji zapisano. Otrzymana kwota nie jest potwierdzona; czekamy na potwierdzenie wpłaty. Nie zlecaj kolejnej płatności.",
    };
  } catch {
    return {
      error:
        "Nie udało się potwierdzić transakcji u operatora. Nie zmieniaj jej na nieopłaconą i nie zlecaj kolejnej płatności.",
    };
  }
}
