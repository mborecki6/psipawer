import { afterEach, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import {
  handleMaintenance,
  maintenanceAuthorized,
  processMaintenance,
} from "../src/lib/maintenance";

const secret = "a".repeat(43);
const values = {
  MAINTENANCE_SECRET: secret,
  VERCEL_ENV: "production",
  NEXT_PUBLIC_SUPABASE_URL: "https://aaaaaaaaaaaaaaaaaaaa.supabase.co",
  SUPABASE_SECRET_KEY: "fake-server-key",
};
const request = (authorization = `Bearer ${secret}`) =>
  new Request("https://app.test/api/internal/maintenance", {
    method: "POST",
    headers: { authorization },
  });
const counts = { sent: 1, failed: 0, cancelled: 0, skipped: 0 };
afterEach(() => vi.unstubAllEnvs());
it.each([
  "",
  "Bearer short",
  `Bearer ${"b".repeat(43)}`,
  `bearer ${secret}`,
  `Bearer ${"é".repeat(43)}`,
])("rejects unauthorized work before contacting Supabase", async (auth) => {
  const send = vi.fn();
  const response = await handleMaintenance(request(auth), values, send);
  expect(response.status).toBe(401);
  expect(send).not.toHaveBeenCalled();
});
it("fails closed without a sufficiently strong server secret", () => {
  expect(maintenanceAuthorized(request(), {})).toBe(false);
  expect(
    maintenanceAuthorized(request("Bearer short"), {
      MAINTENANCE_SECRET: "short",
    }),
  ).toBe(false);
});
it.each([
  { VERCEL_ENV: "preview" },
  { NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321" },
  {
    NEXT_PUBLIC_SUPABASE_URL:
      "https://aaaaaaaaaaaaaaaaaaaa.supabase.co.evil.test",
  },
  { NEXT_PUBLIC_SUPABASE_URL: "https://aaaaaaaaaaaaaaaaaaaa.supabase.co/path" },
  { SUPABASE_SECRET_KEY: "" },
])(
  "does not send privileged credentials to an invalid destination",
  async (override) => {
    const send = vi.fn();
    await expect(
      processMaintenance({ ...values, ...override }, send),
    ).rejects.toThrow();
    expect(send).not.toHaveBeenCalled();
  },
);
it("delivers reminders and returns only validated counters", async () => {
  const send = vi
    .fn()
    .mockResolvedValue({
      ok: true,
      json: async () => ({ ...counts, private: "hidden" }),
    });
  const response = await handleMaintenance(request(), values, send);
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(await response.json()).toEqual({ reminder: counts });
  expect(send).toHaveBeenCalledTimes(1);
  expect(send.mock.calls[0][1]).toMatchObject({
    method: "POST",
    redirect: "error",
    cache: "no-store",
    body: '{"p_limit":50}',
  });
});
it("reports a failed durable reminder attempt for operations to inspect", async () => {
  const send = vi
    .fn()
    .mockResolvedValue({
      ok: true,
      json: async () => ({ ...counts, failed: 1 }),
    });
  const response = await handleMaintenance(request(), values, send);
  expect(response.status).toBe(503);
  expect(await response.json()).toEqual({ reminder: { ...counts, failed: 1 } });
});
it("does not expose upstream errors or accept malformed reminder counts", async () => {
  for (const result of [
    null,
    { ...counts, sent: -1 },
    { ...counts, failed: "secret" },
  ]) {
    const send = vi
      .fn()
      .mockResolvedValue({ ok: true, json: async () => result });
    const response = await handleMaintenance(request(), values, send);
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "Maintenance unavailable" });
    expect(send).toHaveBeenCalledTimes(1);
  }
});
