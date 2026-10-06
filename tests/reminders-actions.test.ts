import { beforeEach, it, expect, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  rpc: vi.fn(),
  refresh: vi.fn(),
  redirect: vi.fn(),
}));
vi.mock("@/lib/auth/session", () => ({ requireSession: mocks.session }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.refresh }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
import {
  processReminders,
  retryReminder,
} from "../src/modules/reminders/actions";
import { notificationHref } from "../src/modules/notifications/types";
import { reminderFilter, reminderHref } from "../src/modules/reminders/types";
const id = "15000000-0000-4000-8000-000000000001";
function form() {
  const f = new FormData();
  f.set("id", id);
  f.set("attempts", "5");
  return f;
}
beforeEach(() => {
  vi.resetAllMocks();
  mocks.session.mockResolvedValue({ db: { rpc: mocks.rpc } });
  mocks.redirect.mockImplementation(() => {
    throw new Error("redirect");
  });
});
it("requires staff, bounds manual processing and invalidates both inboxes", async () => {
  mocks.rpc.mockResolvedValue({
    data: { sent: 2, failed: 1, cancelled: 3, skipped: 4 },
    error: null,
  });
  expect((await processReminders()).success).toContain("W skrzynkach: 2");
  expect(mocks.session).toHaveBeenCalledWith("admin");
  expect(mocks.rpc).toHaveBeenCalledWith("process_due_reminders", {
    p_limit: 50,
  });
  expect(mocks.refresh).toHaveBeenCalledWith("/app", "layout");
});
it("does not report successful delivery for invalid or failed responses and never exposes provider details", async () => {
  for (const data of [
    null,
    {},
    { sent: 1, failed: -1, cancelled: 0, skipped: 0 },
    { sent: 1000, failed: 0, cancelled: 0, skipped: 0 },
  ]) {
    mocks.rpc.mockResolvedValue({ data, error: null });
    expect((await processReminders()).error).toBeTruthy();
  }
  mocks.rpc.mockRejectedValue(new Error("PRIVATE token"));
  expect(JSON.stringify(await processReminders())).not.toContain("PRIVATE");
  expect(mocks.refresh).not.toHaveBeenCalled();
});
it("passes a versioned retry without accepting forged recipients or scheduling times", async () => {
  mocks.rpc.mockResolvedValue({ data: true, error: null });
  const f = form();
  f.set("recipient", "stranger");
  f.set("next_attempt_at", "2020-01-01");
  await expect(retryReminder({}, f)).rejects.toThrow("redirect");
  expect(mocks.redirect).toHaveBeenCalledWith(`/admin/reminders/${id}`);
  expect(mocks.rpc).toHaveBeenCalledWith("retry_reminder", {
    p_id: id,
    p_expected_attempts: 5,
  });
  expect(mocks.session).toHaveBeenCalledWith("admin");
  expect(mocks.refresh).toHaveBeenCalledWith("/admin/reminders");
});
it("accepts a no-op retry and rejects stale, malformed or failed requests", async () => {
  mocks.rpc.mockResolvedValue({ data: false, error: null });
  await expect(retryReminder({}, form())).rejects.toThrow("redirect");
  expect(mocks.redirect).toHaveBeenCalledWith(`/admin/reminders/${id}`);
  mocks.redirect.mockClear();
  mocks.rpc.mockClear();
  for (const value of ["", "0", "-1", "Infinity", "1.5"]) {
    const f = form();
    f.set("attempts", value);
    expect((await retryReminder({}, f)).error).toBeTruthy();
  }
  const f = form();
  f.set("id", "invalid");
  expect((await retryReminder({}, f)).error).toBeTruthy();
  expect(mocks.rpc).not.toHaveBeenCalled();
  mocks.rpc.mockResolvedValue({ data: null, error: { message: "PRIVATE" } });
  expect((await retryReminder({}, form())).error).not.toContain("PRIVATE");
  expect(mocks.redirect).not.toHaveBeenCalled();
});
it("rejects unauthorized actions before any database operation", async () => {
  mocks.session.mockRejectedValue(new Error("denied"));
  await expect(processReminders()).rejects.toThrow("denied");
  await expect(retryReminder({}, form())).rejects.toThrow("denied");
  expect(mocks.rpc).not.toHaveBeenCalled();
});
it("routes all reminder types to their current source and normalizes filters", () => {
  expect(
    notificationHref(
      { kind: "walk_reminder", entity_id: id, dog_id: "dog" },
      "client",
    ),
  ).toBe(`/app/walks/${id}`);
  expect(
    notificationHref(
      { kind: "consultation_reminder", entity_id: id, dog_id: "dog" },
      "client",
    ),
  ).toBe(`/app/consultations/${id}`);
  expect(
    notificationHref(
      { kind: "follow_up_reminder", entity_id: id, dog_id: "dog" },
      "admin",
    ),
  ).toBe(`/admin/work/follow-ups/${id}`);
  expect(reminderHref({ kind: "walk", entity_id: id })).toBe(
    `/admin/walks/${id}`,
  );
  expect(reminderFilter("failed")).toBe("failed");
  expect(reminderFilter("__proto__")).toBe("all");
});
