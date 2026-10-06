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
import {
  settleFitnessPackage,
  refundFitnessPayment,
} from "../src/modules/fitness/finance-actions";
const id = "93000000-0000-4000-8000-000000000001",
  key = "94000000-0000-4000-8000-000000000001";
function form(overrides: Record<string, string> = {}) {
  const f = new FormData();
  for (const [k, v] of Object.entries({
    package_id: id,
    payment_id: id,
    expected_version: "4",
    request_id: key,
    amount: "30,00",
    note: " Uzgodniono rozliczenie ",
    ...overrides,
  }))
    f.set(k, v);
  return f;
}
beforeEach(() => {
  vi.resetAllMocks();
  mocks.session.mockResolvedValue({ db: { rpc: mocks.rpc } });
});
it.each(["0", "0,00", "00.0", "30,00"])(
  "accepts an explicit zero or decimal settlement: %s",
  async (amount) => {
    mocks.rpc.mockResolvedValue({ data: 5, error: null });
    expect(
      (
        await settleFitnessPackage(
          {},
          form({ amount, guardian_id: "forged", charge_cents: "1" }),
        )
      ).version,
    ).toBe(5);
    expect(mocks.session).toHaveBeenCalledWith("admin");
    expect(mocks.rpc).toHaveBeenCalledWith("settle_fitness_package", {
      p_id: id,
      p_expected_version: 4,
      p_amount_cents: amount === "30,00" ? 3000 : 0,
      p_note: "Uzgodniono rozliczenie",
      p_request_id: key,
    });
    expect(mocks.refresh).toHaveBeenCalledWith("/app", "layout");
  },
);
it("validates the partial refund acknowledgement and preserves the request key", async () => {
  mocks.rpc.mockResolvedValue({ data: key, error: null });
  expect(
    (await refundFitnessPayment({}, form({ amount: "12,34" }))).success,
  ).toContain("nie wykonuje przelewu");
  expect(mocks.rpc).toHaveBeenCalledWith("refund_fitness_payment", {
    p_payment: id,
    p_amount_cents: 1234,
    p_note: "Uzgodniono rozliczenie",
    p_request_id: key,
  });
  mocks.rpc.mockResolvedValueOnce({ data: id, error: null });
  expect((await refundFitnessPayment({}, form())).error).toBeTruthy();
});
it("rejects malformed monetary input, missing versions and invalid keys before mutation", async () => {
  const invalid: Record<string, string>[] = [
    { amount: "-1" },
    { amount: "0.001" },
    { amount: "10000,01" },
    { expected_version: "0" },
    { request_id: "x" },
    { note: " " },
  ];
  for (const values of invalid)
    expect((await settleFitnessPackage({}, form(values))).error).toBeTruthy();
  for (const amount of ["0", "-1", "10000,01", "0.001"])
    expect(
      (await refundFitnessPayment({}, form({ amount }))).error,
    ).toBeTruthy();
  expect(mocks.rpc).not.toHaveBeenCalled();
});
it("requires staff for both financial actions", async () => {
  mocks.session.mockRejectedValue(new Error("FORBIDDEN"));
  await expect(settleFitnessPackage({}, form())).rejects.toThrow("FORBIDDEN");
  await expect(refundFitnessPayment({}, form())).rejects.toThrow("FORBIDDEN");
  expect(mocks.rpc).not.toHaveBeenCalled();
});
it("keeps safe useful errors and hides unknown database or network details", async () => {
  const message = "Pakiet zmienił się. Odśwież widok przed zapisem.";
  mocks.rpc.mockResolvedValueOnce({ data: null, error: { message } });
  expect((await settleFitnessPackage({}, form())).error).toBe(message);
  mocks.rpc.mockResolvedValueOnce({
    data: null,
    error: { message: "private SQL details" },
  });
  expect((await refundFitnessPayment({}, form())).error).not.toContain(
    "private",
  );
  mocks.rpc.mockRejectedValue(new Error("private network details"));
  expect((await settleFitnessPackage({}, form())).error).not.toContain(
    "private",
  );
  expect(mocks.refresh).not.toHaveBeenCalled();
});
it("does not acknowledge a settlement with an invalid or unchanged version", async () => {
  for (const data of [null, "5", 4, 3, 4.5]) {
    mocks.rpc.mockResolvedValueOnce({ data, error: null });
    expect((await settleFitnessPackage({}, form())).error).toBeTruthy();
  }
  expect(mocks.refresh).not.toHaveBeenCalled();
});
