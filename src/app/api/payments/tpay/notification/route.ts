import { createHash } from "node:crypto";
import { revalidatePath } from "next/cache";
import { getLocalPaymentRuntime } from "@/modules/payments/runtime";
import { privilegedPaymentsClient } from "@/modules/payments/server";
import { verifyTpayNotification } from "@/modules/payments/notifications";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const config = getLocalPaymentRuntime();
  const response = (body: string, status: number) =>
    new Response(body, {
      status,
      headers: { "Content-Type": "text/plain", "Cache-Control": "no-store" },
    });
  if (!config?.sandbox || config.environment === "simulator")
    return response("FALSE", 503);
  if (
    request.headers
      .get("content-type")
      ?.split(";", 1)[0]
      .trim()
      .toLowerCase() !== "application/x-www-form-urlencoded"
  )
    return response("FALSE", 415);
  const reader = request.body?.getReader();
  if (!reader) return response("FALSE", 400);
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.length;
      if (size > 32_768) {
        await reader.cancel();
        return response("FALSE", 413);
      }
      chunks.push(part.value);
    }
    const raw = new TextDecoder("utf-8", {
      fatal: true,
      ignoreBOM: true,
    }).decode(Buffer.concat(chunks));
    const notification = await verifyTpayNotification(
      config.sandbox,
      raw,
      request.headers.get("x-jws-signature") || "",
    );
    const db = privilegedPaymentsClient();
    const read = await db
      .from("online_payment_attempts")
      .select("*")
      .eq("id", notification.attemptId)
      .maybeSingle();
    if (read.error) return response("FALSE", 503);
    const attempt = read.data;
    if (
      !attempt ||
      attempt.environment !== config.environment ||
      attempt.amount_cents !== notification.amountCents ||
      (attempt.merchant_id &&
        attempt.merchant_id !== notification.merchantId) ||
      (attempt.transaction_title &&
        attempt.transaction_title !== notification.transactionTitle)
    )
      return response("FALSE", 400);
    const saved = await db.rpc("record_online_payment_notification", {
      p_attempt: attempt.id,
      p_environment: config.environment,
      p_transaction_id: attempt.transaction_id,
      p_transaction_title: notification.transactionTitle,
      p_merchant_id: notification.merchantId,
      p_status: notification.status === "refunded" ? "chargeback" : "paid",
      p_amount_cents: notification.amountCents,
      p_paid_cents: notification.paidCents,
      p_currency: notification.currency,
      p_payload_sha256: createHash("sha256").update(raw, "utf8").digest("hex"),
    });
    if (saved.error || !saved.data) return response("FALSE", 503);
    revalidatePath("/app", "layout");
    revalidatePath("/admin", "layout");
    return response("TRUE", 200);
  } catch {
    return response("FALSE", 400);
  }
}
