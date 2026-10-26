import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  runtime: vi.fn(),
  verify: vi.fn(),
  read: vi.fn(),
  rpc: vi.fn(),
  refresh: vi.fn(),
}));
vi.mock("next/cache", () => ({ revalidatePath: mocks.refresh }));
vi.mock("@/modules/payments/runtime", () => ({
  getLocalPaymentRuntime: mocks.runtime,
}));
vi.mock("@/modules/payments/notifications", () => ({
  verifyTpayNotification: mocks.verify,
}));
vi.mock("@/modules/payments/server", () => ({
  privilegedPaymentsClient: () => ({
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: mocks.read }) }),
    }),
    rpc: mocks.rpc,
  }),
}));
import { POST } from "../src/app/api/payments/tpay/notification/route";
const id = "11000000-0000-4000-8000-000000000001";
const notification = {
  attemptId: id,
  transactionTitle: "TR123",
  merchantId: "123",
  amountCents: 6000,
  paidCents: 6000,
  currency: "PLN",
  status: "paid",
};
function request(
  body: string | Uint8Array = `tr_crc=${id}`,
  contentType = "application/x-www-form-urlencoded",
) {
  return new Request("http://localhost:3000/api/payments/tpay/notification", {
    method: "POST",
    headers: {
      "content-type": contentType,
      "x-jws-signature": "test-signature",
    },
    body: body as BodyInit,
  });
}
beforeEach(() => {
  vi.resetAllMocks();
  mocks.runtime.mockReturnValue({
    environment: "sandbox",
    sandbox: { merchantId: "123" },
  });
  mocks.verify.mockResolvedValue({ ...notification });
  mocks.read.mockResolvedValue({
    data: {
      id,
      environment: "sandbox",
      amount_cents: 6000,
      transaction_id: "TX123",
      transaction_title: "TR123",
      merchant_id: "123",
    },
    error: null,
  });
  mocks.rpc.mockResolvedValue({ data: { id, status: "paid" }, error: null });
});
it("does not acknowledge payment before verification and durable accounting", async () => {
  mocks.verify.mockRejectedValueOnce(new Error("invalid signature"));
  expect((await POST(request())).status).toBe(400);
  expect(mocks.read).not.toHaveBeenCalled();
  expect(mocks.rpc).not.toHaveBeenCalled();
  mocks.rpc.mockResolvedValueOnce({
    error: { message: "internal database detail" },
    data: null,
  });
  const failed = await POST(request());
  expect(failed.status).toBe(503);
  expect(await failed.text()).toBe("FALSE");
  expect(mocks.refresh).not.toHaveBeenCalled();
});
it("books only verified normalized data and acknowledges after successful persistence", async () => {
  const response = await POST(request());
  expect(response.status).toBe(200);
  expect(await response.text()).toBe("TRUE");
  expect(mocks.rpc).toHaveBeenCalledWith(
    "record_online_payment_notification",
    expect.objectContaining({
      p_attempt: id,
      p_transaction_id: "TX123",
      p_transaction_title: "TR123",
      p_status: "paid",
      p_amount_cents: 6000,
      p_paid_cents: 6000,
      p_environment: "sandbox",
      p_payload_sha256: expect.stringMatching(/^[0-9a-f]{64}$/),
    }),
  );
});
it.each([null, { environment: "simulator" }])(
  "does no work when a sandbox handler is unavailable",
  async (runtime) => {
    mocks.runtime.mockReturnValue(runtime);
    expect((await POST(request())).status).toBe(503);
    expect(mocks.verify).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
  },
);
it.each(["application/json", "application/x-www-form-urlencodedevil"])(
  "rejects non-form content type %s",
  async (type) => {
    expect((await POST(request("{}", type))).status).toBe(415);
    expect(mocks.verify).not.toHaveBeenCalled();
  },
);
it("bounds actual request bytes and rejects malformed UTF-8 instead of changing signed bytes", async () => {
  expect((await POST(request("x".repeat(32_769)))).status).toBe(413);
  expect((await POST(request(new Uint8Array([0xff, 0xfe])))).status).toBe(400);
  expect(mocks.verify).not.toHaveBeenCalled();
});
it.each(["merchantId", "transactionTitle", "amountCents"])(
  "does not book a signed but mismatched %s",
  async (key) => {
    mocks.verify.mockResolvedValue({
      ...notification,
      [key]: key === "amountCents" ? 1 : "different",
    });
    expect((await POST(request())).status).toBe(400);
    expect(mocks.rpc).not.toHaveBeenCalled();
  },
);

it("processes an already-started live transaction while new checkout is disabled", async () => {
  mocks.runtime.mockReturnValue({
    environment: "live",
    canStart: false,
    sandbox: { merchantId: "123" },
  });
  mocks.read.mockResolvedValue({
    data: { ...(await mocks.read()).data, environment: "live" },
    error: null,
  });
  const response = await POST(request());
  expect(response.status).toBe(200);
  expect(mocks.rpc).toHaveBeenCalledWith(
    "record_online_payment_notification",
    expect.objectContaining({
      p_environment: "live",
      p_payload_sha256: expect.stringMatching(/^[0-9a-f]{64}$/),
    }),
  );
});
