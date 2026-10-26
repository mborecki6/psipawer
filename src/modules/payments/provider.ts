import "server-only";
import { createHash } from "node:crypto";
import {
  assertTpayConfig,
  TPAY_SANDBOX_CHECKOUT_ORIGIN,
  type TpayConfig,
} from "./config";

export type TpayStatus = "pending" | "paid" | "failed" | "refunded";
export type TpayTransportDependencies = {
  fetch?: typeof fetch;
  now?: () => number;
};
export class TpayProviderError extends Error {
  constructor(
    public readonly kind: "rejected" | "uncertain" | "configuration",
  ) {
    super(
      kind === "rejected"
        ? "Tpay odrzucił żądanie płatności."
        : "Nie udało się pewnie ustalić wyniku operacji Tpay.",
    );
    this.name = "TpayProviderError";
  }
}

type TokenState = {
  token?: string;
  expiresAt?: number;
  pending?: Promise<string>;
};
const tokenCaches = new WeakMap<typeof fetch, Map<string, TokenState>>();
const MAX_RESPONSE_BYTES = 65536;
const REQUEST_TIMEOUT_MS = 15000;
const ATTEMPT_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const IDENTIFIER = /^[A-Za-z0-9_-]{1,128}$/;

/** Decimal money is parsed without rounding a malformed value into a valid payment. */
export function tpayAmountToCents(value: unknown): number {
  if (typeof value !== "string" && typeof value !== "number")
    throw new TpayProviderError("uncertain");
  const decimal = String(value);
  if (!/^(0|[1-9]\d{0,10})(\.\d{1,2})?$/.test(decimal))
    throw new TpayProviderError("uncertain");
  const [units, fraction = ""] = decimal.split(".");
  const cents = Number(units) * 100 + Number(fraction.padEnd(2, "0"));
  if (!Number.isSafeInteger(cents) || cents > 2147483647)
    throw new TpayProviderError("uncertain");
  return cents;
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new TpayProviderError("uncertain");
  return value as Record<string, unknown>;
}

async function requestJson(
  transport: typeof fetch,
  url: string,
  init: RequestInit,
): Promise<Record<string, unknown>> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      (async () => {
        const response = await transport(url, {
          ...init,
          redirect: "error",
          cache: "no-store",
          signal: controller.signal,
        });
        if (!response.ok) {
          void response.body?.cancel().catch(() => {});
          // 408 and 5xx may follow an accepted transaction. Never recreate it automatically.
          throw new TpayProviderError(
            response.status >= 400 &&
              response.status < 500 &&
              response.status !== 408
              ? "rejected"
              : "uncertain",
          );
        }
        if (
          Number(response.headers.get("content-length")) > MAX_RESPONSE_BYTES
        ) {
          void response.body?.cancel().catch(() => {});
          throw new TpayProviderError("uncertain");
        }
        const reader = response.body?.getReader();
        if (!reader) throw new TpayProviderError("uncertain");
        const chunks: Uint8Array[] = [];
        let size = 0;
        try {
          while (true) {
            const chunk = await reader.read();
            if (chunk.done) break;
            size += chunk.value.byteLength;
            if (size > MAX_RESPONSE_BYTES)
              throw new TpayProviderError("uncertain");
            chunks.push(chunk.value);
          }
        } finally {
          void reader.cancel().catch(() => {});
        }
        return record(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      })(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(new TpayProviderError("uncertain"));
        }, REQUEST_TIMEOUT_MS);
      }),
    ]);
  } catch (error) {
    if (error instanceof TpayProviderError) throw error;
    throw new TpayProviderError("uncertain");
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function accessToken(
  config: TpayConfig,
  deps: TpayTransportDependencies,
): Promise<string> {
  const transport = deps.fetch ?? fetch;
  const now = deps.now ?? Date.now;
  let cache = tokenCaches.get(transport);
  if (!cache) {
    cache = new Map();
    tokenCaches.set(transport, cache);
  }
  const key = createHash("sha256")
    .update(
      JSON.stringify([
        config.mode,
        config.apiOrigin,
        config.clientId,
        config.clientSecret,
        config.merchantId,
      ]),
    )
    .digest("hex");
  let state = cache.get(key);
  if (!state) {
    state = {};
    cache.set(key, state);
  }
  const currentTime = now();
  if (!Number.isFinite(currentTime)) throw new TpayProviderError("uncertain");
  if (state.token && state.expiresAt && state.expiresAt > currentTime)
    return state.token;
  if (state.pending) return state.pending;
  const current = state;
  current.pending = (async () => {
    const started = currentTime;
    const result = await requestJson(
      transport,
      `${config.apiOrigin}/oauth/auth`,
      {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          accept: "application/json",
        },
        body: new URLSearchParams({
          client_id: config.clientId,
          client_secret: config.clientSecret,
        }),
      },
    );
    const expiresIn =
      typeof result.expires_in === "string" &&
      /^\d{1,6}$/.test(result.expires_in)
        ? Number(result.expires_in)
        : result.expires_in;
    if (
      typeof result.access_token !== "string" ||
      !/^[A-Za-z0-9._~-]{1,8192}$/.test(result.access_token) ||
      (result.token_type !== undefined &&
        String(result.token_type).toLowerCase() !== "bearer") ||
      typeof expiresIn !== "number" ||
      !Number.isInteger(expiresIn) ||
      expiresIn <= 0 ||
      expiresIn > 604800
    )
      throw new TpayProviderError("uncertain");
    current.token = result.access_token;
    current.expiresAt =
      started + expiresIn * 1000 - Math.min(5000, expiresIn * 100);
    return current.token;
  })();
  try {
    return await current.pending;
  } finally {
    current.pending = undefined;
  }
}

function status(value: unknown): TpayStatus {
  if (value === "paid" || value === "correct") return "paid";
  if (value === "refund") return "refunded";
  if (value === "canceled") return "failed";
  return "pending";
}

export function isTrustedTpayCheckoutUrl(
  value: unknown,
  config?: TpayConfig,
): value is string {
  if (
    typeof value !== "string" ||
    value.length > 3072 ||
    /[\u0000-\u0020\\]/.test(value)
  )
    return false;
  try {
    if (config) assertTpayConfig(config);
    const url = new URL(value);
    return (
      url.origin === (config?.checkoutOrigin ?? TPAY_SANDBOX_CHECKOUT_ORIGIN) &&
      !url.username &&
      !url.password &&
      !url.hash
    );
  } catch {
    return false;
  }
}

export type TpayTransaction = {
  checkoutUrl?: string;
  transactionId: string;
  transactionTitle: string;
  attemptId: string;
  merchantId: string;
  amountCents: number;
  /** Null means the status read did not provide evidence of the actual paid amount. */
  paidCents: number | null;
  currency: "PLN";
  status: TpayStatus;
};

function transaction(
  result: Record<string, unknown>,
  config: TpayConfig,
  allowMissingPaidAmount = false,
): TpayTransaction {
  if (
    result.result !== "success" ||
    typeof result.transactionId !== "string" ||
    !IDENTIFIER.test(result.transactionId) ||
    typeof result.title !== "string" ||
    !IDENTIFIER.test(result.title) ||
    typeof result.hiddenDescription !== "string" ||
    !ATTEMPT_ID.test(result.hiddenDescription) ||
    result.currency !== "PLN" ||
    (result.merchantId !== undefined &&
      String(result.merchantId) !== config.merchantId) ||
    (result.test_mode !== undefined &&
      result.test_mode !== (config.mode === "sandbox" ? "1" : "0"))
  )
    throw new TpayProviderError("uncertain");
  const normalizedStatus = status(result.status);
  const payments = result.payments ? record(result.payments) : {};
  // The current GET schema documents only payments.attempts. A paid GET without
  // an actual amount can identify the transaction but cannot establish received money.
  const paidCents =
    payments.amountPaid === undefined &&
    normalizedStatus !== "paid" &&
    normalizedStatus !== "refunded"
      ? 0
      : payments.amountPaid === undefined && allowMissingPaidAmount
        ? null
        : tpayAmountToCents(payments.amountPaid);
  const amountCents = tpayAmountToCents(result.amount);
  if (
    amountCents <= 0 ||
    ((normalizedStatus === "paid" || normalizedStatus === "refunded") &&
      paidCents !== null &&
      paidCents <= 0)
  )
    throw new TpayProviderError("uncertain");
  if (
    result.transactionPaymentUrl !== undefined &&
    !isTrustedTpayCheckoutUrl(result.transactionPaymentUrl, config)
  )
    throw new TpayProviderError("uncertain");
  return {
    ...(typeof result.transactionPaymentUrl === "string"
      ? { checkoutUrl: result.transactionPaymentUrl }
      : {}),
    transactionId: result.transactionId,
    transactionTitle: result.title,
    attemptId: result.hiddenDescription,
    merchantId: config.merchantId,
    amountCents,
    paidCents,
    currency: "PLN",
    status: normalizedStatus,
  };
}

export async function createTpayTransaction(
  config: TpayConfig,
  input: {
    attemptId: string;
    amountCents: number;
    payerName: string;
    payerEmail: string;
  },
  deps: TpayTransportDependencies = {},
): Promise<TpayTransaction & { checkoutUrl: string }> {
  assertTpayConfig(config);
  if (
    !ATTEMPT_ID.test(input.attemptId) ||
    !Number.isSafeInteger(input.amountCents) ||
    input.amountCents <= 0 ||
    input.amountCents > 2147483647 ||
    !input.payerName.trim() ||
    input.payerName.length > 255 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.payerEmail) ||
    input.payerEmail.length > 254
  )
    throw new TpayProviderError("rejected");
  const token = await accessToken(config, deps);
  const returnUrl = `${config.appOrigin}/app/payments/${input.attemptId}`;
  const result = await requestJson(
    deps.fetch ?? fetch,
    `${config.apiOrigin}/transactions`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
        accept: "application/json",
      },
      body: JSON.stringify({
        amount: input.amountCents / 100,
        currency: "PLN",
        description:
          config.mode === "live"
            ? "Psi Pawer — płatność"
            : "Psi Pawer — płatność testowa",
        hiddenDescription: input.attemptId,
        lang: "pl",
        payer: { name: input.payerName, email: input.payerEmail },
        pay: { groupId: 150 },
        callbacks: {
          notification: config.notificationUrl
            ? { url: config.notificationUrl }
            : {},
          payerUrls: { success: returnUrl, error: returnUrl },
        },
      }),
    },
  );
  const normalized = transaction(result, config);
  if (
    normalized.attemptId !== input.attemptId ||
    normalized.amountCents !== input.amountCents ||
    !isTrustedTpayCheckoutUrl(result.transactionPaymentUrl, config)
  )
    throw new TpayProviderError("uncertain");
  return { ...normalized, checkoutUrl: result.transactionPaymentUrl };
}

export async function getTpayTransaction(
  config: TpayConfig,
  transactionId: string,
  deps: TpayTransportDependencies = {},
): Promise<TpayTransaction> {
  assertTpayConfig(config);
  if (!IDENTIFIER.test(transactionId)) throw new TpayProviderError("rejected");
  const token = await accessToken(config, deps);
  const result = await requestJson(
    deps.fetch ?? fetch,
    `${config.apiOrigin}/transactions/${encodeURIComponent(transactionId)}`,
    {
      headers: { authorization: `Bearer ${token}`, accept: "application/json" },
    },
  );
  const normalized = transaction(result, config, true);
  if (normalized.transactionId !== transactionId)
    throw new TpayProviderError("uncertain");
  return normalized;
}
