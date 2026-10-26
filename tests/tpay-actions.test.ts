import { beforeEach, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  rpc: vi.fn(),
  privileged: vi.fn(),
  runtime: vi.fn(),
  attempt: vi.fn(),
  create: vi.fn(),
  get: vi.fn(),
  refresh: vi.fn(),
}));
vi.mock("@/lib/auth/session", () => ({ requireSession: mocks.session }));
vi.mock(
  "@/lib/validation/schemas",
  async () => import("../src/lib/validation/schemas"),
);
vi.mock("next/cache", () => ({ revalidatePath: mocks.refresh }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT:${url}`);
  },
}));
vi.mock("../src/modules/payments/runtime", () => ({
  requireLocalPaymentRuntime: mocks.runtime,
  getLocalPaymentRuntime: mocks.runtime,
}));
vi.mock("../src/modules/payments/server", () => ({
  getOnlinePaymentAttempt: mocks.attempt,
  privilegedPaymentsClient: () => ({
    rpc: mocks.privileged,
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({
            data: await mocks.attempt(),
            error: null,
          }),
        }),
      }),
    }),
  }),
}));
vi.mock("../src/modules/payments/provider", () => ({
  isTrustedTpayCheckoutUrl: (value: string) =>
    value.startsWith("https://secure.sandbox.tpay.com/"),
  createTpayTransaction: mocks.create,
  getTpayTransaction: mocks.get,
  TpayProviderError: class extends Error {
    kind = "uncertain";
  },
}));
import {
  startOnlinePayment,
  checkOnlinePayment,
  simulateOnlinePayment,
  continueOnlinePayment,
  recoverOnlinePayment,
} from "../src/modules/payments/actions";
const id = "11000000-0000-4000-8000-000000000001";
const target = "11000000-0000-4000-8000-000000000002";
const request = "11000000-0000-4000-8000-000000000003";
const attempt = {
  id,
  target_kind: "consultation",
  target_id: target,
  environment: "sandbox",
  amount_cents: 6000,
  merchant_id: "123",
  transaction_id: "TX123",
  transaction_title: "TR123",
  checkout_url: "https://secure.sandbox.tpay.com/?title=TR123",
  status: "pending",
};
function form(values: Record<string, string> = {}) {
  const form = new FormData();
  Object.entries({
    target_kind: "consultation",
    target_id: target,
    request_id: request,
    expected_due_cents: "6000",
    attempt_id: id,
    ...values,
  }).forEach(([key, value]) => form.set(key, value));
  return form;
}
beforeEach(() => {
  vi.resetAllMocks();
  mocks.session.mockResolvedValue({
    db: { rpc: mocks.rpc },
    profile: { full_name: "Opiekun testowy" },
    user: { id: "guardian", email: "test@example.test" },
  });
  mocks.runtime.mockReturnValue({
    environment: "sandbox",
    canStart: true,
    appOrigin: "http://localhost:3000",
    sandbox: { merchantId: "123" },
  });
  mocks.attempt.mockResolvedValue({ ...attempt });
  mocks.rpc.mockResolvedValue({
    data: { attempt, created: true },
    error: null,
  });
  mocks.privileged.mockImplementation(async (name) =>
    name === "begin_online_payment"
      ? mocks.rpc()
      : { data: { ...attempt }, error: null },
  );
  mocks.create.mockResolvedValue({
    transactionId: "TX123",
    transactionTitle: "TR123",
    checkoutUrl: attempt.checkout_url,
  });
  mocks.get.mockResolvedValue({
    transactionId: "TX123",
    transactionTitle: "TR123",
    attemptId: id,
    merchantId: "123",
    amountCents: 6000,
    paidCents: 6000,
    currency: "PLN",
    status: "paid",
  });
});
it("gets the payer and 60zł outstanding amount from trusted session/DB, ignoring forged price and identity", async () => {
  await expect(
    startOnlinePayment(
      {},
      form({
        amount_cents: "1",
        guardian_id: "other",
        payerEmail: "attacker@example.test",
      }),
    ),
  ).rejects.toThrow(`REDIRECT:${attempt.checkout_url}`);
  expect(mocks.session).toHaveBeenCalledWith("client");
  expect(mocks.create).toHaveBeenCalledWith(expect.anything(), {
    attemptId: id,
    amountCents: 6000,
    payerName: "Opiekun testowy",
    payerEmail: "test@example.test",
  });
  expect(mocks.privileged.mock.calls[0][0]).toBe("begin_online_payment");
  expect(mocks.privileged).toHaveBeenCalledWith(
    "begin_online_payment",
    expect.objectContaining({
      p_guardian: "guardian",
      p_expected_due_cents: 6000,
      p_environment: "sandbox",
      p_merchant_id: "123",
    }),
  );
});
it("does not call the provider again when another tab already owns an active attempt", async () => {
  mocks.rpc.mockResolvedValue({
    data: { attempt, created: false },
    error: null,
  });
  await expect(startOnlinePayment({}, form())).rejects.toThrow(
    `REDIRECT:/app/payments/${id}`,
  );
  expect(mocks.create).not.toHaveBeenCalled();
});
it("retains uncertain creation after a timeout, without exposing details or retrying a charge", async () => {
  mocks.create.mockRejectedValue(new Error("private operator response/token"));
  await expect(startOnlinePayment({}, form())).rejects.toThrow(
    `REDIRECT:/app/payments/${id}`,
  );
  expect(mocks.create).toHaveBeenCalledTimes(1);
  expect(mocks.privileged).toHaveBeenCalledWith(
    "record_online_payment_outcome",
    expect.objectContaining({ p_status: "uncertain" }),
  );
});
it("refuses before starting or finalizing when session or local configuration is invalid", async () => {
  mocks.session.mockRejectedValueOnce(new Error("FORBIDDEN"));
  await expect(startOnlinePayment({}, form())).rejects.toThrow("FORBIDDEN");
  expect(mocks.rpc).not.toHaveBeenCalled();
  mocks.runtime.mockImplementation(() => {
    throw new Error("disabled");
  });
  expect((await startOnlinePayment({}, form())).error).toBeTruthy();
  expect(mocks.rpc).not.toHaveBeenCalled();
  expect(mocks.create).not.toHaveBeenCalled();
});
it.each([
  "transactionId",
  "transactionTitle",
  "attemptId",
  "merchantId",
  "currency",
  "amountCents",
])("does not book a provider response with mismatched %s", async (key) => {
  mocks.get.mockResolvedValue({
    ...(await mocks.get()),
    [key]: key === "amountCents" ? 1 : "forged",
  });
  mocks.get.mockClear();
  expect((await checkOnlinePayment({}, form())).error).toBeTruthy();
  expect(mocks.privileged).not.toHaveBeenCalled();
});
it("records actual received amount, allowing the DB to preserve a mismatch as an exception", async () => {
  mocks.get.mockResolvedValue({ ...(await mocks.get()), paidCents: 8000 });
  expect(
    (await checkOnlinePayment({}, form({ paid_cents: "1" }))).success,
  ).toBeTruthy();
  expect(mocks.privileged).toHaveBeenCalledWith(
    "record_online_payment_outcome",
    expect.objectContaining({
      p_amount_cents: 6000,
      p_paid_cents: 8000,
      p_status: "paid",
    }),
  );
});
it.each(["paid", "requires_review", "failed"])(
  "rechecks an existing %s transaction without starting another payment",
  async (status) => {
    mocks.attempt.mockResolvedValue({ ...attempt, status });
    expect((await checkOnlinePayment({}, form())).success).toBeTruthy();
    expect(mocks.get).toHaveBeenCalledWith(expect.anything(), "TX123");
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.privileged).toHaveBeenCalledWith(
      "record_online_payment_outcome",
      expect.objectContaining({ p_status: "paid" }),
    );
  },
);
it("never finalizes another guardian's inaccessible attempt", async () => {
  mocks.attempt.mockResolvedValue(null);
  expect((await checkOnlinePayment({}, form())).error).toBeTruthy();
  expect(mocks.get).not.toHaveBeenCalled();
  expect(mocks.privileged).not.toHaveBeenCalled();
});
it("does not expose the simulator to sandbox mode and does not continue an arbitrary checkout URL", async () => {
  expect(
    (await simulateOnlinePayment({}, form({ outcome: "success" }))).error,
  ).toBeTruthy();
  mocks.attempt.mockResolvedValue({
    ...attempt,
    checkout_url: "https://secure.sandbox.tpay.com.attacker.test/",
  });
  expect((await continueOnlinePayment({}, form())).error).toBeTruthy();
  expect(mocks.privileged).not.toHaveBeenCalled();
});
it("simulates only an owned simulator attempt and reports that no Tpay request or money transfer occurred", async () => {
  mocks.runtime.mockReturnValue({ environment: "simulator" });
  mocks.attempt.mockResolvedValue({ ...attempt, environment: "simulator" });
  expect(
    (
      await simulateOnlinePayment(
        {},
        form({ outcome: "success", amount_cents: "1" }),
      )
    ).success,
  ).toContain("Nie pobrano");
  expect(mocks.create).not.toHaveBeenCalled();
  expect(mocks.get).not.toHaveBeenCalled();
  expect(mocks.privileged).toHaveBeenCalledWith(
    "record_online_payment_outcome",
    expect.objectContaining({ p_paid_cents: 6000 }),
  );
});

it("requires renewed confirmation after a stale balance and does not contact the provider", async () => {
  mocks.rpc.mockResolvedValue({
    data: null,
    error: {
      message:
        "Należność zmieniła się. Otwórz podsumowanie i potwierdź aktualną kwotę.",
    },
  });
  expect((await startOnlinePayment({}, form())).error).toContain(
    "Należność zmieniła się",
  );
  expect(mocks.create).not.toHaveBeenCalled();
});
it("never settles paid GET metadata without an actual received amount", async () => {
  mocks.get.mockResolvedValue({ ...(await mocks.get()), paidCents: null });
  expect((await checkOnlinePayment({}, form())).error).toContain(
    "otrzymanej kwoty",
  );
  expect(mocks.privileged).not.toHaveBeenCalled();
});
it("stops new checkouts while preserving checks on an existing bound attempt", async () => {
  mocks.runtime.mockReturnValue({
    environment: "sandbox",
    canStart: false,
    sandbox: { merchantId: "123" },
  });
  expect((await startOnlinePayment({}, form())).error).toContain("wyłączone");
  expect(mocks.create).not.toHaveBeenCalled();
  expect((await checkOnlinePayment({}, form())).success).toBeTruthy();
});
it("lets only an admin recover a matching operator transaction and keeps missing money evidence unconfirmed", async () => {
  mocks.attempt.mockResolvedValue({
    ...attempt,
    transaction_id: null,
    transaction_title: null,
    status: "uncertain",
  });
  mocks.get.mockResolvedValue({ ...(await mocks.get()), paidCents: null });
  expect(
    (await recoverOnlinePayment({}, form({ transaction_id: "TX123" }))).success,
  ).toContain("nie jest potwierdzona");
  expect(mocks.session).toHaveBeenCalledWith("admin");
  expect(mocks.privileged).toHaveBeenCalledWith(
    "recover_online_payment_binding",
    expect.objectContaining({ p_actor: "guardian", p_transaction_id: "TX123" }),
  );
  expect(mocks.privileged).not.toHaveBeenCalledWith(
    "record_online_payment_outcome",
    expect.anything(),
  );
});
it("does not recover a mismatched transaction", async () => {
  mocks.attempt.mockResolvedValue({
    ...attempt,
    transaction_id: null,
    transaction_title: null,
  });
  mocks.get.mockResolvedValue({ ...(await mocks.get()), attemptId: request });
  expect(
    (await recoverOnlinePayment({}, form({ transaction_id: "TX123" }))).error,
  ).toContain("nie odpowiada");
  expect(mocks.privileged).not.toHaveBeenCalled();
});

it("reconciles a bound attempt with the same identity rules even while checkout is off", async () => {
  const { reconcileBoundPayment } =
    await import("../src/modules/payments/reconciliation");
  mocks.runtime.mockReturnValue({
    environment: "sandbox",
    canStart: false,
    sandbox: { merchantId: "123" },
  });
  mocks.privileged.mockResolvedValue({
    data: { ...attempt, status: "paid" },
    error: null,
  });
  expect(await reconcileBoundPayment(id)).toEqual({
    state: "confirmed",
    changed: true,
  });
  expect(mocks.create).not.toHaveBeenCalled();
});
it("leaves reconciliation unavailable without received-money evidence or with a mismatched environment", async () => {
  const { reconcileBoundPayment } =
    await import("../src/modules/payments/reconciliation");
  mocks.get.mockResolvedValue({ ...(await mocks.get()), paidCents: null });
  expect((await reconcileBoundPayment(id)).state).toBe("unavailable");
  expect(mocks.privileged).not.toHaveBeenCalled();
  mocks.runtime.mockReturnValue({
    environment: "live",
    sandbox: { merchantId: "123" },
  });
  mocks.get.mockClear();
  expect((await reconcileBoundPayment(id)).state).toBe("unavailable");
  expect(mocks.get).not.toHaveBeenCalled();
});
