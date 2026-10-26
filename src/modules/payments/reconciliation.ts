import "server-only";
import type { OnlinePaymentAttempt } from "./types";
import { getLocalPaymentRuntime } from "./runtime";
import { privilegedPaymentsClient } from "./server";
import type { TpayTransaction } from "./provider";
import { getTpayTransaction } from "./provider";

/** An operator GET must identify the immutable attempt, never just a debt. */
export function matchesPaymentAttempt(
  attempt: OnlinePaymentAttempt,
  transaction: TpayTransaction,
  allowUnbound = false,
): boolean {
  return (
    (allowUnbound || Boolean(attempt.transaction_id)) &&
    (!attempt.transaction_id ||
      transaction.transactionId === attempt.transaction_id) &&
    (!attempt.transaction_title ||
      transaction.transactionTitle === attempt.transaction_title) &&
    transaction.attemptId === attempt.id &&
    transaction.amountCents === attempt.amount_cents &&
    transaction.currency === "PLN" &&
    (!attempt.merchant_id || transaction.merchantId === attempt.merchant_id)
  );
}

export async function saveProviderOutcome(
  attempt: OnlinePaymentAttempt,
  transaction: TpayTransaction,
) {
  if (!matchesPaymentAttempt(attempt, transaction))
    throw new Error("Payment identity mismatch");
  // GET metadata alone is not a receipt. The requested amount is never used as
  // a substitute for the amount actually received by the operator.
  if (
    (transaction.status === "paid" || transaction.status === "refunded") &&
    transaction.paidCents === null
  )
    return null;
  const { data, error } = await privilegedPaymentsClient().rpc(
    "record_online_payment_outcome",
    {
      p_attempt: attempt.id,
      p_environment: attempt.environment,
      p_transaction_id: attempt.transaction_id,
      p_transaction_title: transaction.transactionTitle,
      p_merchant_id: transaction.merchantId,
      p_status:
        transaction.status === "refunded" ? "chargeback" : transaction.status,
      p_amount_cents: transaction.amountCents,
      p_paid_cents: transaction.paidCents ?? 0,
      p_currency: "PLN",
      p_reason: null,
    },
  );
  if (error || !data) throw new Error("Payment result unavailable");
  return data as OnlinePaymentAttempt;
}

export type ReconciliationResult = {
  state: "pending" | "confirmed" | "failed" | "review" | "unavailable";
  changed: boolean;
};

/** Internal worker entrypoint; callers authenticate the scheduler separately. */
export async function reconcileBoundPayment(
  attemptId: string,
): Promise<ReconciliationResult> {
  try {
    const runtime = getLocalPaymentRuntime();
    if (!runtime?.sandbox) return { state: "unavailable", changed: false };
    const { data, error } = await privilegedPaymentsClient()
      .from("online_payment_attempts")
      .select("*")
      .eq("id", attemptId)
      .maybeSingle();
    const attempt = data as OnlinePaymentAttempt | null;
    if (
      error ||
      !attempt?.transaction_id ||
      attempt.environment !== runtime.environment ||
      (attempt.merchant_id &&
        attempt.merchant_id !== runtime.sandbox.merchantId)
    )
      return { state: "unavailable", changed: false };
    const transaction = await getTpayTransaction(
      runtime.sandbox,
      attempt.transaction_id,
    );
    const saved = await saveProviderOutcome(attempt, transaction);
    if (!saved) return { state: "unavailable", changed: false };
    return {
      state:
        saved.status === "paid"
          ? "confirmed"
          : saved.status === "requires_review"
            ? "review"
            : saved.status === "failed"
              ? "failed"
              : "pending",
      changed: saved.status !== attempt.status,
    };
  } catch {
    return { state: "unavailable", changed: false };
  }
}
