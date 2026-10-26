import { expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("../src/modules/payments/reconciliation", () => ({
  reconcileBoundPayment: vi.fn(),
}));
import {
  handlePaymentChecks,
  paymentWorkerAuthorized,
  processPaymentChecks,
} from "../src/lib/payment-worker";

const env = {
  TPAY_RECONCILIATION_ENABLED: "true",
  TPAY_ENABLED: "false",
  TPAY_MODE: "sandbox",
  TPAY_CLIENT_ID: "synthetic-id",
  TPAY_CLIENT_SECRET: "synthetic-secret",
  TPAY_MERCHANT_ID: "123",
  NEXT_PUBLIC_APP_URL: "http://localhost:3000",
  NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
  SUPABASE_SECRET_KEY: "synthetic-service-key",
  PAYMENTS_WORKER_SECRET: "a".repeat(43),
};
const id = "a1111111-1111-4111-8111-111111111111";
const claim = "b1111111-1111-4111-8111-111111111111";
const request = (authorization?: string) =>
  new Request("http://localhost/api/internal/payments", {
    method: "POST",
    headers: authorization ? { authorization } : {},
  });
const reply = (value: unknown) => Response.json(value);

it("authenticates an exact separate secret and never calls services for an unauthorized request", async () => {
  expect(
    paymentWorkerAuthorized(
      request(`Bearer ${env.PAYMENTS_WORKER_SECRET}`),
      env,
    ),
  ).toBe(true);
  for (const authorization of [
    undefined,
    "Bearer short",
    `bearer ${env.PAYMENTS_WORKER_SECRET}`,
    `Bearer ${"b".repeat(43)}`,
  ]) {
    const response = await handlePaymentChecks(request(authorization), env);
    expect(response.status).toBe(401);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  }
  expect(
    paymentWorkerAuthorized(request("Bearer short"), {
      PAYMENTS_WORKER_SECRET: "short",
    }),
  ).toBe(false);
});

it("does no work when disabled, even without operator credentials", async () => {
  const transport = vi.fn();
  expect(await processPaymentChecks({}, transport)).toEqual({
    configured: false,
  });
  expect(transport).not.toHaveBeenCalled();
});

it("reconciles already-started transactions while new checkouts are disabled", async () => {
  const transport = vi
    .fn()
    .mockResolvedValueOnce(reply([{ id, claim_token: claim }]))
    .mockResolvedValueOnce(reply(true));
  const reconcile = vi
    .fn()
    .mockResolvedValue({ state: "confirmed", changed: true });
  expect(await processPaymentChecks(env, transport, reconcile)).toEqual({
    configured: true,
    processed: 1,
    changed: 1,
    unavailable: 0,
  });
  expect(reconcile).toHaveBeenCalledExactlyOnceWith(id);
  const [url, options] = transport.mock.calls[0];
  expect(url).toBe(
    `${env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/rpc/worker_claim_online_payment_checks`,
  );
  expect(JSON.parse(options.body)).toEqual({ p_limit: 1 });
  expect(options).toMatchObject({
    redirect: "error",
    cache: "no-store",
    method: "POST",
  });
  expect(JSON.parse(transport.mock.calls[1][1].body)).toEqual({
    p_id: id,
    p_claim: claim,
    p_outcome: "confirmed",
  });
});

it("releases an operator failure as unavailable for a later retry without inventing a payment", async () => {
  const transport = vi
    .fn()
    .mockResolvedValueOnce(reply([{ id, claim_token: claim }]))
    .mockResolvedValueOnce(reply(true));
  const reconcile = vi
    .fn()
    .mockRejectedValue(new Error("operator inaccessible"));
  expect(await processPaymentChecks(env, transport, reconcile)).toMatchObject({
    processed: 1,
    changed: 0,
    unavailable: 1,
  });
  expect(JSON.parse(transport.mock.calls[1][1].body).p_outcome).toBe(
    "unavailable",
  );
});

it("treats an empty claim as idle", async () => {
  const reconcile = vi.fn();
  expect(
    await processPaymentChecks(
      env,
      vi.fn().mockResolvedValue(reply([])),
      reconcile,
    ),
  ).toMatchObject({ processed: 0, unavailable: 0 });
  expect(reconcile).not.toHaveBeenCalled();
});

it.each([
  null,
  {},
  [{ id: "invalid", claim_token: claim }],
  [{ id, claim_token: "invalid" }],
  [
    { id, claim_token: claim },
    { id, claim_token: claim },
  ],
])("rejects an invalid claim before asking the operator: %j", async (body) => {
  const reconcile = vi.fn();
  await expect(
    processPaymentChecks(
      env,
      vi.fn().mockResolvedValue(reply(body)),
      reconcile,
    ),
  ).rejects.toThrow();
  expect(reconcile).not.toHaveBeenCalled();
});

it("does not report success when the lease could not be finalized", async () => {
  const transport = vi
    .fn()
    .mockResolvedValueOnce(reply([{ id, claim_token: claim }]))
    .mockResolvedValueOnce(reply(false));
  await expect(
    processPaymentChecks(
      env,
      transport,
      vi.fn().mockResolvedValue({ state: "pending", changed: false }),
    ),
  ).rejects.toThrow();
});

it("bounds an unexpectedly large RPC response before parsing it", async () => {
  let cancelled = false;
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array(4097));
    },
    cancel() {
      cancelled = true;
    },
  });
  await expect(
    processPaymentChecks(
      env,
      vi.fn().mockResolvedValue(new Response(stream)),
      vi.fn(),
    ),
  ).rejects.toThrow();
  expect(cancelled).toBe(true);
});

it("returns a generic failure for enabled but incomplete configuration", async () => {
  const response = await handlePaymentChecks(
    request(`Bearer ${env.PAYMENTS_WORKER_SECRET}`),
    {
      PAYMENTS_WORKER_SECRET: env.PAYMENTS_WORKER_SECRET,
      TPAY_RECONCILIATION_ENABLED: "true",
    },
  );
  expect(response.status).toBe(503);
  expect(await response.json()).toEqual({
    error: "Payment checks unavailable",
  });
});
