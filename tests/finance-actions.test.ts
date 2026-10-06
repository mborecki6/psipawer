import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  rpc: vi.fn(),
  refresh: vi.fn(),
}));
vi.mock("@/lib/auth/session", () => ({ requireSession: mocks.session }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.refresh }));
vi.mock(
  "@/lib/validation/schemas",
  async () => import("../src/lib/validation/schemas"),
);
vi.mock("@/lib/finance", async () => import("../src/lib/finance"));
vi.mock("@/lib/time", async () => import("../src/lib/time"));
import { recordPayment, voidPayment } from "../src/lib/data/finance-actions";

const id = "11000000-0000-4000-8000-000000000001";
const key = "11000000-0000-4000-8000-000000000002";
function form(overrides: Record<string, string> = {}) {
  const data = new FormData();
  for (const [k, v] of Object.entries({
    target_kind: "consultation",
    target_id: id,
    amount: "40,25",
    method: "transfer",
    note: " Część należności ",
    request_id: key,
    ...overrides,
  }))
    data.set(k, v);
  return data;
}
beforeEach(() => {
  vi.resetAllMocks();
  mocks.session.mockResolvedValue({ db: { rpc: mocks.rpc } });
  mocks.rpc.mockResolvedValue({ data: id, error: null });
});
it("records a consultation receipt through the staff action, preserving the request key and ignoring forged identity and price", async () => {
  expect(
    (
      await recordPayment(
        {},
        form({ guardian_id: "forged", author_id: "forged", price_cents: "1" }),
      )
    ).success,
  ).toBeTruthy();
  expect(mocks.session).toHaveBeenCalledWith("admin");
  expect(mocks.rpc).toHaveBeenCalledWith("record_payment", {
    p_registration: null,
    p_package: null,
    p_consultation: id,
    p_amount_cents: 4025,
    p_method: "transfer",
    p_note: "Część należności",
    p_request_id: key,
  });
  expect(mocks.refresh).toHaveBeenCalledWith("/admin", "layout");
  expect(mocks.refresh).toHaveBeenCalledWith("/app", "layout");
});
it.each(["registration", "package", "course"])(
  "keeps the existing %s target exclusive",
  async (target_kind) => {
    await recordPayment({}, form({ target_kind }));
    expect(mocks.rpc).toHaveBeenCalledWith(
      "record_payment",
      expect.objectContaining({
        p_consultation: null,
        p_registration: target_kind === "registration" ? id : null,
        p_package: target_kind === "package" ? id : null,
        ...(target_kind === "course" ? { p_course_enrollment: id } : {}),
      }),
    );
  },
);
it("denies access before calling the receipt operation", async () => {
  mocks.session.mockRejectedValueOnce(new Error("FORBIDDEN"));
  await expect(recordPayment({}, form())).rejects.toThrow("FORBIDDEN");
  expect(mocks.rpc).not.toHaveBeenCalled();
});
it("rejects malformed payments before contacting the database", async () => {
  const invalid: Record<string, string>[] = [
    { amount: "0" },
    { amount: "100.001" },
    { target_kind: "voucher" },
    { target_id: "x" },
    { request_id: "x" },
    { method: "x" },
  ];
  for (const values of invalid)
    expect((await recordPayment({}, form(values))).error).toBeTruthy();
  expect(mocks.rpc).not.toHaveBeenCalled();
});
it("preserves a useful cancelled-appointment error without exposing database details", async () => {
  const message =
    "Wpłatę można zapisać tylko dla umówionej lub zakończonej konsultacji.";
  mocks.rpc.mockResolvedValueOnce({ error: { message } });
  expect((await recordPayment({}, form())).error).toBe(message);
  mocks.rpc.mockResolvedValueOnce({
    error: { message: "private SQL details" },
  });
  expect((await recordPayment({}, form())).error).not.toContain("private");
  mocks.rpc.mockRejectedValueOnce(new Error("private network details"));
  expect((await recordPayment({}, form())).error).not.toContain("private");
  expect(mocks.refresh).not.toHaveBeenCalled();
});
it("requires a reason for a refund and refreshes both panels after recording it", async () => {
  expect(
    (await voidPayment({}, form({ payment_id: id, note: "" }))).error,
  ).toBeTruthy();
  expect(mocks.rpc).not.toHaveBeenCalled();
  expect(
    (await voidPayment({}, form({ payment_id: id, note: "Uzgodniony zwrot" })))
      .success,
  ).toContain("nie przelewa");
  expect(mocks.session).toHaveBeenCalledWith("admin");
  expect(mocks.rpc).toHaveBeenCalledWith("void_payment", {
    p_payment: id,
    p_note: "Uzgodniony zwrot",
  });
  expect(mocks.refresh).toHaveBeenCalledWith("/app", "layout");
});
it("handles a network failure during correction with a recoverable message", async () => {
  mocks.rpc.mockRejectedValueOnce(new Error("private network details"));
  expect(
    (await voidPayment({}, form({ payment_id: id, note: "Zwrot wpłaty" })))
      .error,
  ).not.toContain("private");
  expect(mocks.refresh).not.toHaveBeenCalled();
});
it("does not claim success without the saved receipt identifier", async () => {
  mocks.rpc.mockResolvedValue({ data: null, error: null });
  expect((await recordPayment({}, form())).error).toBeTruthy();
  expect(
    (await voidPayment({}, form({ payment_id: id, note: "Zwrot wpłaty" })))
      .error,
  ).toBeTruthy();
  expect(mocks.refresh).not.toHaveBeenCalled();
});
