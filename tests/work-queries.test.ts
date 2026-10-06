import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({
  session: vi.fn(),
  rpc: vi.fn(),
  report: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/session", () => ({ requireSession: m.session }));
vi.mock("@/lib/observability/server-errors", () => ({
  reportDataReadError: m.report,
}));
import { getWorkQueue } from "../src/modules/work/queries";
vi.mock(
  "@/lib/data/read-retry",
  async () => import("../src/lib/data/read-retry"),
);
beforeEach(() => {
  vi.resetAllMocks();
  m.session.mockResolvedValue({ db: { rpc: m.rpc } });
  m.rpc.mockResolvedValue({ data: [], error: null, status: 200 });
});
it("recovers one gateway failure for items while reading staff identity and counts once", async () => {
  m.rpc.mockResolvedValueOnce({
    data: null,
    error: { message: "Bad Gateway" },
    status: 502,
  });
  expect(await getWorkQueue("fitness", 2)).toEqual({
    items: [],
    more: false,
    counts: [],
  });
  expect(m.session).toHaveBeenCalledTimes(1);
  expect(
    m.rpc.mock.calls.filter(([name]) => name === "staff_work_queue"),
  ).toEqual([
    ["staff_work_queue", { p_filter: "fitness", p_offset: 20 }],
    ["staff_work_queue", { p_filter: "fitness", p_offset: 20 }],
  ]);
  expect(
    m.rpc.mock.calls.filter(([name]) => name === "staff_work_counts"),
  ).toHaveLength(1);
  expect(m.report).toHaveBeenCalledWith(
    "work.items",
    expect.any(Object),
    502,
    true,
  );
});
it("requires staff access and keeps the complete counts with a bounded page of work", async () => {
  const rows = Array.from({ length: 21 }, (_, n) => ({
    id: String(n),
    kind: "fitness",
  }));
  const counts = [{ kind: "fitness", total: 50, overdue: 3 }];
  m.rpc.mockImplementation(async (name: string) => ({
    data: name === "staff_work_queue" ? rows : counts,
    error: null,
    status: 200,
  }));
  expect(await getWorkQueue("fitness", 2)).toEqual({
    items: rows.slice(0, 20),
    more: true,
    counts,
  });
  expect(m.session).toHaveBeenCalledWith("admin");
  expect(m.rpc).toHaveBeenCalledWith("staff_work_queue", {
    p_filter: "fitness",
    p_offset: 20,
  });
  expect(m.report).not.toHaveBeenCalled();
});
it("keeps a successful empty queue distinct from a failed or malformed response", async () => {
  expect(await getWorkQueue("all", 1)).toEqual({
    items: [],
    more: false,
    counts: [],
  });
  for (const data of [null, {}, false]) {
    m.rpc.mockResolvedValueOnce({ data, error: null, status: 200 });
    await expect(getWorkQueue("all", 1)).rejects.toThrow(
      "Nie udało się pobrać listy spraw",
    );
    expect(m.report).toHaveBeenLastCalledWith("work.items", null, 200);
  }
});
it("identifies whether items or counts failed while retaining the safe public error", async () => {
  const error = { code: "PGRST003", message: "Private connection detail" };
  for (const failed of ["staff_work_queue", "staff_work_counts"]) {
    m.rpc.mockImplementation(async (name: string) =>
      name === failed
        ? { data: null, error, status: 504 }
        : { data: [], error: null, status: 200 },
    );
    await expect(getWorkQueue("all", 1)).rejects.toThrow(
      "Nie udało się pobrać listy spraw",
    );
    expect(m.report).toHaveBeenLastCalledWith(
      failed === "staff_work_queue" ? "work.items" : "work.counts",
      error,
      504,
    );
  }
});
it("reports a rejected read without leaking its cause to the page or pretending the queue is empty", async () => {
  const error = new Error("Private request and token");
  m.rpc.mockRejectedValueOnce(error);
  await expect(getWorkQueue("all", 1)).rejects.toThrow(
    "Nie udało się pobrać listy spraw",
  );
  expect(m.report).toHaveBeenCalledWith("work.queue", error);
});
