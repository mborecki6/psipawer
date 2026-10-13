import { beforeEach, afterEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ session: vi.fn(), rpc: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ requireSession: mocks.session }));
vi.mock(
  "@/lib/push-policy.mjs",
  async () => await import("../src/lib/push-policy.mjs"),
);
import {
  saveDevicePush,
  disableDevicePush,
  devicePushStatus,
} from "../src/modules/push/actions";
const subscription = {
  endpoint: "https://fcm.googleapis.com/fcm/send/test",
  keys: { p256dh: "B".repeat(87), auth: "a".repeat(22) },
};
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("NEXT_PUBLIC_VAPID_PUBLIC_KEY", "B".repeat(87));
  vi.stubEnv("VAPID_PRIVATE_KEY", "a".repeat(43));
  vi.stubEnv("VAPID_SUBJECT", "https://psipawer.vercel.app");
  mocks.session.mockResolvedValue({
    db: { rpc: mocks.rpc },
    user: { id: "current-user" },
  });
});
afterEach(() => vi.unstubAllEnvs());
it("uses authenticated RPC ownership and never forwards a browser-supplied recipient", async () => {
  mocks.rpc.mockResolvedValue({ data: "subscription-id", error: null });
  expect(
    await saveDevicePush({
      ...subscription,
      ...{ recipient_id: "other-user", session_id: "forged" },
    }),
  ).toEqual({ success: true });
  expect(mocks.session).toHaveBeenCalled();
  expect(mocks.rpc).toHaveBeenCalledWith("save_push_subscription", {
    p_endpoint: subscription.endpoint,
    p_p256dh: subscription.keys.p256dh,
    p_auth: subscription.keys.auth,
  });
});
it("rejects unsupported providers and unavailable configuration before persistence", async () => {
  expect(
    await saveDevicePush({
      ...subscription,
      endpoint: "https://127.0.0.1/send",
    }),
  ).toHaveProperty("error");
  vi.stubEnv("VAPID_PRIVATE_KEY", "");
  expect(await saveDevicePush(subscription)).toHaveProperty("error");
  expect(mocks.rpc).not.toHaveBeenCalled();
});
it("does not expose endpoint keys or underlying SQL errors on failure", async () => {
  mocks.rpc.mockResolvedValue({
    data: null,
    error: { message: "PRIVATE subscription key" },
  });
  expect(await saveDevicePush(subscription)).toEqual({
    error: "Nie udało się zapisać ustawienia. Spróbuj ponownie.",
  });
  expect(await devicePushStatus(subscription.endpoint)).toBe("error");
  expect(await disableDevicePush(subscription.endpoint)).toHaveProperty(
    "error",
  );
});
it("returns only known device states and respects authenticated disable results", async () => {
  mocks.rpc.mockResolvedValueOnce({ data: "expired", error: null });
  expect(await devicePushStatus(subscription.endpoint)).toBe("expired");
  mocks.rpc.mockResolvedValueOnce({ data: "secret", error: null });
  expect(await devicePushStatus(subscription.endpoint)).toBe("error");
  mocks.rpc.mockResolvedValueOnce({ data: true, error: null });
  expect(await disableDevicePush(subscription.endpoint)).toEqual({
    success: true,
  });
});
