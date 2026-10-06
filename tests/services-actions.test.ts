import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  rpc: vi.fn(),
  refresh: vi.fn(),
}));
vi.mock("@/lib/auth/session", () => ({ requireSession: mocks.session }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.refresh }));
import { updateService } from "../src/modules/services/actions";
import { priceToCents } from "../src/modules/services/schemas";
const input = {
  id: "60000000-0000-4000-8000-000000000011",
  expected_version: "1",
  name: "Konsultacja online",
  description: "Opis",
  price: "175,50",
  price_unit: "za spotkanie",
  duration_minutes: "90",
  sessions_count: "1",
  active: "true",
  is_test_price: "false",
};
function form(overrides: Record<string, string> = {}) {
  const result = new FormData();
  for (const [key, value] of Object.entries({ ...input, ...overrides }))
    result.set(key, value);
  return result;
}
beforeEach(() => {
  vi.resetAllMocks();
  mocks.session.mockResolvedValue({ db: { rpc: mocks.rpc } });
  mocks.rpc.mockResolvedValue({ data: 2, error: null });
});
describe("service price changes", () => {
  it("requires staff, parses PLN precisely and never trusts actor or flow from a form", async () => {
    expect(
      await updateService(
        {},
        form({ updated_by: "forged", booking_flow: "forged" }),
      ),
    ).toMatchObject({ version: 2 });
    expect(mocks.session).toHaveBeenCalledWith("admin");
    expect(mocks.rpc).toHaveBeenCalledWith("update_service", {
      p_id: input.id,
      p_expected_version: 1,
      p_name: input.name,
      p_description: input.description,
      p_price_cents: 17550,
      p_price_unit: input.price_unit,
      p_duration: 90,
      p_sessions: 1,
      p_active: true,
      p_is_test_price: false,
    });
    expect(mocks.refresh).toHaveBeenCalledWith("/app", "layout");
  });
  it.each(["0", "-1", "100.001", "1e2", "abc", "10,000.00", "10000.01"])(
    "rejects malformed or out-of-range PLN: %s",
    async (price) => {
      expect((await updateService({}, form({ price }))).error).toBeTruthy();
      expect(mocks.rpc).not.toHaveBeenCalled();
    },
  );
  it.each([
    ["0,01", 1],
    ["100", 10000],
    ["175.50", 17550],
    [" 10000,00 ", 1000000],
  ])("converts %s without currency rounding", (value, cents) => {
    expect(priceToCents(String(value))).toBe(cents);
  });
  it("allows catalogue items with unspecified duration and number of sessions", async () => {
    await updateService({}, form({ duration_minutes: "", sessions_count: "" }));
    expect(mocks.rpc).toHaveBeenCalledWith(
      "update_service",
      expect.objectContaining({ p_duration: null, p_sessions: null }),
    );
  });
  it("preserves helpful conflict messages while hiding internal errors", async () => {
    mocks.rpc.mockResolvedValueOnce({
      error: { message: "Usługa zmieniła się. Odśwież widok przed zapisem." },
    });
    expect((await updateService({}, form())).error).toContain("zmieniła się");
    mocks.rpc.mockResolvedValueOnce({
      error: { message: "private database detail" },
    });
    expect((await updateService({}, form())).error).not.toContain("private");
    mocks.rpc.mockRejectedValueOnce(new Error("private network detail"));
    expect((await updateService({}, form())).error).not.toContain("private");
  });
});
