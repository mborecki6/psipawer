import { beforeEach, it, expect, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  rpc: vi.fn(),
  from: vi.fn(),
  select: vi.fn(),
  is: vi.fn(),
  report: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/session", () => ({ requireSession: mocks.session }));
vi.mock("@/lib/observability/server-errors", () => ({
  reportDataReadError: mocks.report,
}));
vi.mock(
  "@/lib/data/read-retry",
  async () => import("../src/lib/data/read-retry"),
);
import {
  getNotificationInbox,
  getUnreadCount,
} from "../src/modules/notifications/queries";
const id = "13000000-0000-4000-8000-000000000001";
const db = { from: mocks.from, rpc: mocks.rpc } as unknown as Parameters<
  typeof getUnreadCount
>[0];
beforeEach(() => {
  vi.resetAllMocks();
  mocks.session.mockResolvedValue({ db, role: "client" });
  mocks.from.mockReturnValue({ select: mocks.select });
  mocks.select.mockReturnValue({ is: mocks.is });
  mocks.is.mockResolvedValue({ count: 1005, error: null });
  mocks.rpc.mockResolvedValue({ data: [], error: null });
});
it("recovers a gateway feed error with the original cursor and a single unread count", async () => {
  mocks.rpc.mockResolvedValueOnce({
    data: null,
    error: { message: "Bad Gateway" },
    status: 502,
  });
  expect(await getNotificationInbox("all", id)).toMatchObject({
    items: [],
    count: 1005,
    before: id,
  });
  expect(mocks.rpc.mock.calls).toEqual(
    Array.from({ length: 2 }, () => [
      "notification_feed",
      { p_filter: "all", p_before: id },
    ]),
  );
  expect(mocks.is).toHaveBeenCalledTimes(1);
  expect(mocks.report).toHaveBeenCalledWith(
    "notifications.feed",
    expect.any(Object),
    502,
    true,
  );
});
it("recreates the read-only count after a gateway response without reporting an unavailable counter", async () => {
  mocks.is.mockResolvedValueOnce({
    count: null,
    error: { message: "Bad Gateway" },
    status: 502,
  });
  expect(await getUnreadCount(db)).toBe(1005);
  expect(mocks.is).toHaveBeenCalledTimes(2);
  expect(mocks.report).toHaveBeenCalledWith(
    "notifications.count",
    expect.any(Object),
    502,
    true,
  );
});
it("loads 20 visible rows plus a continuation flag and the full unread count", async () => {
  mocks.rpc.mockResolvedValue({
    data: Array.from({ length: 21 }, (_, i) => ({ id: `id-${i}` })),
    error: null,
  });
  const result = await getNotificationInbox("all", id);
  expect(result.items).toHaveLength(20);
  expect(result).toMatchObject({
    more: true,
    count: 1005,
    role: "client",
    before: id,
  });
  expect(mocks.rpc).toHaveBeenCalledWith("notification_feed", {
    p_filter: "all",
    p_before: id,
  });
  expect(mocks.select).toHaveBeenCalledWith("id", {
    count: "exact",
    head: true,
  });
  expect(mocks.is).toHaveBeenCalledWith("read_at", null);
});
it("resets malformed cursors and makes inaccessible cursor errors recoverable", async () => {
  await getNotificationInbox("unread", "invalid");
  expect(mocks.rpc).toHaveBeenCalledWith("notification_feed", {
    p_filter: "unread",
    p_before: null,
  });
  mocks.rpc.mockResolvedValueOnce({
    data: null,
    error: { message: "Wróć do początku listy powiadomień." },
  });
  expect(await getNotificationInbox("all", id)).toMatchObject({
    items: [],
    count: 1005,
    resetRequired: true,
  });
});
it("keeps an unavailable counter distinct from zero and fails the inbox visibly", async () => {
  for (const count of [null, -1, NaN]) {
    mocks.is.mockResolvedValueOnce({ count, error: null });
    expect(await getUnreadCount(db)).toBeNull();
  }
  mocks.is.mockResolvedValue({
    count: null,
    error: { message: "private detail" },
  });
  expect(await getUnreadCount(db)).toBeNull();
  await expect(getNotificationInbox("unread")).rejects.toThrow(
    "Nie udało się pobrać powiadomień",
  );
  mocks.is.mockRejectedValueOnce(new Error("network"));
  expect(await getUnreadCount(db)).toBeNull();
});
it("does not turn a feed failure into an empty inbox", async () => {
  mocks.rpc.mockResolvedValueOnce({
    data: null,
    error: { message: "private detail" },
  });
  await expect(getNotificationInbox("unread")).rejects.toThrow(
    "Nie udało się pobrać powiadomień",
  );
  mocks.rpc.mockRejectedValueOnce(new Error("private network detail"));
  await expect(getNotificationInbox("unread")).rejects.toThrow(
    "Nie udało się pobrać powiadomień",
  );
});
