import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({
  session: vi.fn(),
  from: vi.fn(),
  rpc: vi.fn(),
  select: vi.fn(),
  order: vi.fn(),
  range: vi.fn(),
  eq: vi.fn(),
  one: vi.fn(),
  notFound: vi.fn((): never => {
    throw new Error("NOT_FOUND");
  }),
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/session", () => ({ requireSession: m.session }));
vi.mock("next/navigation", () => ({ notFound: m.notFound }));
import {
  getReminderQueue,
  getReminderDetail,
} from "../src/modules/reminders/queries";
const id = "15000000-0000-4000-8000-000000000001";
const chain = {
  select: m.select,
  order: m.order,
  range: m.range,
  eq: m.eq,
  maybeSingle: m.one,
  then: (resolve: (v: object) => unknown) =>
    Promise.resolve(
      resolve({
        data: Array.from({ length: 21 }, (_, i) => ({ id: String(i) })),
        error: null,
      }),
    ),
};
beforeEach(() => {
  vi.clearAllMocks();
  m.session.mockResolvedValue({ db: { from: m.from, rpc: m.rpc } });
  for (const f of [m.from, m.select, m.order, m.range, m.eq])
    f.mockReturnValue(chain);
  m.one.mockResolvedValue({ data: null, error: null });
  m.rpc.mockResolvedValue({
    data: [{ status: "failed", total: 1005, due: 0 }],
    error: null,
  });
});
it("requires staff and returns 20 rows plus continuation with full aggregate counts", async () => {
  const result = await getReminderQueue("failed", 3);
  expect(m.session).toHaveBeenCalledWith("admin");
  expect(m.range).toHaveBeenCalledWith(40, 60);
  expect(m.eq).toHaveBeenCalledWith("status", "failed");
  expect(result.items).toHaveLength(20);
  expect(result.more).toBe(true);
  expect(result.counts[0].total).toBe(1005);
  expect(result.worker).toBeNull();
});
it("does not disguise missing counts or worker-state errors as healthy zeroes", async () => {
  m.rpc.mockResolvedValueOnce({ data: null, error: { message: "PRIVATE" } });
  await expect(getReminderQueue("all", 1)).rejects.toThrow(
    "Nie udało się pobrać kolejki",
  );
  m.one.mockResolvedValueOnce({ data: null, error: { message: "PRIVATE" } });
  await expect(getReminderQueue("all", 1)).rejects.toThrow(
    "Nie udało się pobrać kolejki",
  );
});
it("validates detail IDs, handles missing jobs and pages attempt history", async () => {
  await expect(getReminderDetail("bad", 1)).rejects.toThrow("NOT_FOUND");
  expect(m.from).not.toHaveBeenCalled();
  await expect(getReminderDetail(id, 1)).rejects.toThrow("NOT_FOUND");
  m.one.mockResolvedValueOnce({ data: { id }, error: null });
  const result = await getReminderDetail(id, 2);
  expect(result.history).toHaveLength(20);
  expect(result.more).toBe(true);
  expect(m.eq).toHaveBeenCalledWith("job_id", id);
  expect(m.range).toHaveBeenCalledWith(20, 40);
});
