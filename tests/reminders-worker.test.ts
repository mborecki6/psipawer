import { expect, it, vi } from "vitest";
// JS command module deliberately has no side effect when imported by tests.
import {
  localReminderConfig,
  processLocalReminders,
} from "../scripts/reminders.mjs";
const values = {
  NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
  SUPABASE_SECRET_KEY: "fake-local-test-key",
};
it("accepts only explicit loopback endpoints without redirects, paths or embedded credentials", () => {
  for (const host of [
    "http://localhost:54321",
    "https://127.0.0.1:54321",
    "http://[::1]:54321",
  ])
    expect(
      localReminderConfig({ ...values, NEXT_PUBLIC_SUPABASE_URL: host }).origin,
    ).toBe(host);
  for (const host of [
    "https://project.supabase.co",
    "http://localhost.evil.test",
    "http://user:pass@localhost",
    "http://localhost/path",
    "http://localhost?next=evil",
    "http://localhost#hash",
    "file:///tmp",
    "not-a-url",
  ])
    expect(() =>
      localReminderConfig({ ...values, NEXT_PUBLIC_SUPABASE_URL: host }),
    ).toThrow();
  expect(() =>
    localReminderConfig({ ...values, SUPABASE_SECRET_KEY: "" }),
  ).toThrow();
});
it("does not issue a request if local configuration is absent or hosted", async () => {
  const fetcher = vi.fn();
  await expect(processLocalReminders({}, fetcher)).rejects.toThrow();
  await expect(
    processLocalReminders(
      { ...values, NEXT_PUBLIC_SUPABASE_URL: "https://project.supabase.co" },
      fetcher,
    ),
  ).rejects.toThrow();
  expect(fetcher).not.toHaveBeenCalled();
});
it("calls only the worker RPC with a bounded batch and returns sanitized counters", async () => {
  const fetcher = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({
      sent: 1,
      failed: 2,
      cancelled: 3,
      skipped: 4,
      private: "secret",
    }),
  });
  expect(await processLocalReminders(values, fetcher)).toEqual({
    sent: 1,
    failed: 2,
    cancelled: 3,
    skipped: 4,
  });
  expect(fetcher).toHaveBeenCalledWith(
    "http://127.0.0.1:54321/rest/v1/rpc/worker_process_due_reminders",
    expect.objectContaining({
      method: "POST",
      redirect: "error",
      body: '{"p_limit":50}',
    }),
  );
});
it("rejects HTTP errors and invalid result counters without leaking their body", async () => {
  const body = vi.fn();
  await expect(
    processLocalReminders(
      values,
      vi.fn().mockResolvedValue({ ok: false, json: body }),
    ),
  ).rejects.toThrow("Local reminder delivery failed");
  expect(body).not.toHaveBeenCalled();
  for (const result of [
    null,
    {},
    { sent: -1, failed: 0, cancelled: 0, skipped: 0 },
    { sent: 0, failed: "SECRET", cancelled: 0, skipped: 0 },
  ])
    await expect(
      processLocalReminders(
        values,
        vi.fn().mockResolvedValue({ ok: true, json: async () => result }),
      ),
    ).rejects.toThrow("Invalid delivery response");
});
