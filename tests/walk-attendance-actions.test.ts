import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  rpc: vi.fn(),
  refresh: vi.fn(),
}));
vi.mock("@/lib/auth/session", () => ({ requireSession: mocks.session }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.refresh }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock(
  "@/lib/validation/schemas",
  async () => import("../src/lib/validation/schemas"),
);
vi.mock("@/lib/time", async () => import("../src/lib/time"));
import { markAttendance } from "../src/lib/data/actions";

const id = "11000000-0000-4000-8000-000000000001";
function form(attendance = "present", registration = id) {
  const data = new FormData();
  data.set("id", registration);
  data.set("attendance", attendance);
  return data;
}
beforeEach(() => {
  vi.resetAllMocks();
  mocks.session.mockResolvedValue({ db: { rpc: mocks.rpc } });
  mocks.rpc.mockResolvedValue({ error: null });
});
it("refreshes both roles after staff attendance is saved", async () => {
  expect((await markAttendance({}, form())).success).toContain(
    "Obecność zapisana",
  );
  expect(mocks.session).toHaveBeenCalledWith("admin");
  expect(mocks.rpc).toHaveBeenCalledWith("mark_attendance", {
    p_registration: id,
    p_attendance: "present",
  });
  expect(mocks.refresh).toHaveBeenCalledWith("/admin", "layout");
  expect(mocks.refresh).toHaveBeenCalledWith("/app", "layout");
});
it("requires staff access before attempting a financial attendance change", async () => {
  mocks.session.mockRejectedValueOnce(new Error("FORBIDDEN"));
  await expect(markAttendance({}, form())).rejects.toThrow("FORBIDDEN");
  expect(mocks.rpc).not.toHaveBeenCalled();
});
it("refuses an invalid registration or attendance before calling the database", async () => {
  for (const data of [form("invalid"), form("present", "invalid")])
    expect((await markAttendance({}, data)).error).toBeTruthy();
  expect(mocks.rpc).not.toHaveBeenCalled();
});
it.each([
  ["Brak dostępnych wejść w pakiecie.", "przypisane spacery"],
  ["Pakiet nie jest aktywny lub utracił ważność.", "jego rozliczenie"],
])(
  "explains the recoverable package conflict: %s",
  async (message, nextStep) => {
    mocks.rpc.mockResolvedValueOnce({ error: { message } });
    const result = await markAttendance({}, form());
    expect(result.error).toContain(message.slice(0, -1));
    expect(result.error).toContain(nextStep);
    expect(result.success).toBeUndefined();
    expect(mocks.refresh).not.toHaveBeenCalled();
  },
);
it("retains a clear rule when the walk has not yet started", async () => {
  mocks.rpc.mockResolvedValueOnce({
    error: { message: "Spacer jeszcze się nie rozpoczął." },
  });
  expect((await markAttendance({}, form())).error).toBe(
    "Spacer jeszcze się nie rozpoczął.",
  );
});
it("does not reveal unexpected database details", async () => {
  mocks.rpc.mockResolvedValueOnce({
    error: { message: "private SQL and identifiers" },
  });
  expect((await markAttendance({}, form())).error).not.toContain("private");
  expect(mocks.refresh).not.toHaveBeenCalled();
});
it("offers recovery after a connection failure without claiming success", async () => {
  mocks.rpc.mockRejectedValueOnce(new Error("private connection details"));
  const result = await markAttendance({}, form());
  expect(result.error).toContain("Sprawdź aktualny stan");
  expect(result.error).not.toContain("private");
  expect(result.success).toBeUndefined();
  expect(mocks.refresh).not.toHaveBeenCalled();
});
