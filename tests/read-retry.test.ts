import { beforeEach, expect, it, vi } from "vitest";
import { createClient } from "@supabase/supabase-js";
const m = vi.hoisted(() => ({ report: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/observability/server-errors", () => ({
  reportDataReadError: m.report,
}));
import { readWithGatewayRetry } from "../src/lib/data/read-retry";
const success = { data: [], error: null, status: 200 };
const gateway = { data: null, error: { message: "Bad Gateway" }, status: 502 };
beforeEach(() => vi.clearAllMocks());
it("returns a successful empty read without another request", async () => {
  const read = vi.fn(async () => success);
  expect(await readWithGatewayRetry("work.items", read)).toBe(success);
  expect(read).toHaveBeenCalledTimes(1);
  expect(m.report).not.toHaveBeenCalled();
});
it("recreates a read after an actual gateway response and reports its retry without changing data", async () => {
  const read = vi
    .fn()
    .mockResolvedValueOnce(gateway)
    .mockResolvedValueOnce(success);
  expect(await readWithGatewayRetry("work.items", read)).toBe(success);
  expect(read).toHaveBeenCalledTimes(2);
  expect(m.report).toHaveBeenCalledWith("work.items", gateway.error, 502, true);
});
it("keeps a persistent gateway failure visible and never makes a third attempt", async () => {
  const read = vi.fn(async () => gateway);
  expect(await readWithGatewayRetry("notifications.feed", read)).toBe(gateway);
  expect(read).toHaveBeenCalledTimes(2);
});
it("does not retry permissions, validation, rate limits, SQL errors or an unclassified network response", async () => {
  for (const status of [0, 400, 401, 403, 409, 429, 500, 503, 504]) {
    const result = { data: null, error: { code: "42501" }, status };
    const read = vi.fn(async () => result);
    expect(await readWithGatewayRetry("work.items", read)).toBe(result);
    expect(read).toHaveBeenCalledTimes(1);
  }
  expect(m.report).not.toHaveBeenCalled();
});
it("does not repeat an exception with an unknown outcome", async () => {
  const read = vi
    .fn()
    .mockRejectedValue(new Error("Unknown transport outcome"));
  await expect(readWithGatewayRetry("work.items", read)).rejects.toThrow(
    "Unknown transport outcome",
  );
  expect(read).toHaveBeenCalledTimes(1);
});
it("uses the real SDK's non-JSON 502 result and repeats the same read RPC and cursor", async () => {
  const received: { url: string; body: unknown; method: string | undefined }[] =
    [];
  const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    received.push({
      url: String(input),
      body: JSON.parse(String(init?.body)),
      method: init?.method,
    });
    return received.length === 1
      ? new Response("Bad Gateway", { status: 502 })
      : new Response(JSON.stringify([{ id: "read-row" }]), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
  });
  const client = createClient("http://127.0.0.1:54321", "fictional-local-key", {
    global: { fetch },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const parameters = {
    p_filter: "unread",
    p_before: "13000000-0000-4000-8000-000000000001",
  };
  const result = await readWithGatewayRetry("notifications.feed", () =>
    client.rpc("notification_feed", parameters),
  );
  expect(result).toMatchObject({
    data: [{ id: "read-row" }],
    error: null,
    status: 200,
  });
  expect(received).toEqual(
    Array.from({ length: 2 }, () => ({
      url: "http://127.0.0.1:54321/rest/v1/rpc/notification_feed",
      body: parameters,
      method: "POST",
    })),
  );
  expect(m.report).toHaveBeenCalledWith(
    "notifications.feed",
    expect.any(Object),
    502,
    true,
  );
});
