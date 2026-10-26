import "server-only";
import { timingSafeEqual } from "node:crypto";
import { loadTpayConfig } from "../modules/payments/config";
import {
  reconcileBoundPayment,
  type ReconciliationResult,
} from "../modules/payments/reconciliation";

type Values = Readonly<Record<string, string | undefined>>;
const idPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

async function boundedJson(response: Response): Promise<unknown> {
  if (!response.body) throw new Error("Invalid payment worker response");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 4096) throw new Error("Invalid payment worker response");
      chunks.push(value);
    }
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  } finally {
    reader.releaseLock();
  }
  return JSON.parse(
    new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)),
  );
}

export function paymentWorkerAuthorized(request: Request, values: Values) {
  const key = values.PAYMENTS_WORKER_SECRET;
  if (!key || !/^[A-Za-z0-9_-]{43,128}$/.test(key)) return false;
  const supplied = request.headers.get("authorization") || "";
  const expected = `Bearer ${key}`;
  return (
    Buffer.byteLength(supplied) === Buffer.byteLength(expected) &&
    timingSafeEqual(Buffer.from(supplied), Buffer.from(expected))
  );
}

/** One leased attempt per invocation fits the OAuth + lookup timeout budget.
 * No checkout flag is used: pausing new charges must not pause settlement. */
export async function processPaymentChecks(
  values: Values = process.env,
  transport: typeof fetch = fetch,
  reconcile: (
    id: string,
  ) => Promise<ReconciliationResult> = reconcileBoundPayment,
) {
  if (values.TPAY_RECONCILIATION_ENABLED !== "true")
    return { configured: false as const };
  const config = loadTpayConfig(values);
  const key = values.SUPABASE_SECRET_KEY?.trim();
  if (!config || !key || /[\r\n]/.test(key))
    throw new Error("Payment worker configuration unavailable");
  const rpc = async (name: string, payload: unknown) => {
    const response = await transport(
      `${config.supabaseOrigin}/rest/v1/rpc/${name}`,
      {
        method: "POST",
        redirect: "error",
        cache: "no-store",
        signal: AbortSignal.timeout(5000),
        headers: {
          apikey: key,
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      },
    );
    if (!response.ok) throw new Error("Payment check persistence unavailable");
    return boundedJson(response);
  };
  const claimed = await rpc("worker_claim_online_payment_checks", {
    p_limit: 1,
  });
  if (
    !Array.isArray(claimed) ||
    claimed.length > 1 ||
    claimed.some(
      (row) =>
        !row ||
        typeof row !== "object" ||
        !idPattern.test(row.id) ||
        !idPattern.test(row.claim_token),
    )
  )
    throw new Error("Invalid payment worker claim");
  let processed = 0,
    changed = 0,
    unavailable = 0;
  for (const row of claimed) {
    let outcome: ReconciliationResult;
    try {
      outcome = await reconcile(row.id);
    } catch {
      outcome = { state: "unavailable", changed: false };
    }
    if (
      !["pending", "confirmed", "failed", "review", "unavailable"].includes(
        outcome.state,
      ) ||
      typeof outcome.changed !== "boolean"
    )
      outcome = { state: "unavailable", changed: false };
    const finished = await rpc("worker_finish_online_payment_check", {
      p_id: row.id,
      p_claim: row.claim_token,
      p_outcome: outcome.state,
    });
    if (finished !== true)
      throw new Error("Payment worker claim was not completed");
    processed++;
    if (outcome.changed) changed++;
    if (outcome.state === "unavailable") unavailable++;
  }
  return { configured: true as const, processed, changed, unavailable };
}

export async function handlePaymentChecks(
  request: Request,
  values: Values = process.env,
) {
  const headers = { "Cache-Control": "private, no-store" };
  if (!paymentWorkerAuthorized(request, values))
    return Response.json({ error: "Unauthorized" }, { status: 401, headers });
  try {
    const result = await processPaymentChecks(values);
    return Response.json(result, {
      headers,
      status: result.configured && result.unavailable ? 503 : 200,
    });
  } catch {
    return Response.json(
      { error: "Payment checks unavailable" },
      { status: 503, headers },
    );
  }
}
