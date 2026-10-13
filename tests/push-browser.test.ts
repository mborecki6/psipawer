import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { afterEach, expect, it, vi } from "vitest";
import {
  clearBrowserPush,
  inspectDevicePush,
  reconcilePushOwner,
} from "../src/modules/push/browser";
afterEach(() => vi.unstubAllGlobals());

it("reports a saved active device as suspended while delivery configuration is missing", async () => {
  const endpoint = "https://fcm.googleapis.com/fcm/send/device";
  const readStatus = vi.fn().mockResolvedValue("enabled");
  const unsubscribe = vi.fn();
  vi.stubGlobal("window", {
    localStorage: { getItem: () => "same-account" },
    PushManager: {},
    Notification: {},
    isSecureContext: true,
  });
  vi.stubGlobal("Notification", { permission: "granted" });
  vi.stubGlobal("navigator", {
    serviceWorker: {
      getRegistration: async () => ({
        pushManager: {
          getSubscription: async () => ({ endpoint, unsubscribe }),
        },
      }),
    },
  });
  expect(await inspectDevicePush("same-account", null, readStatus)).toBe(
    "enabled_unconfigured",
  );
  expect(readStatus).toHaveBeenCalledWith(endpoint);
  expect(unsubscribe).not.toHaveBeenCalled();
  expect(
    await inspectDevicePush("same-account", "public-key", readStatus),
  ).toBe("enabled");
  readStatus.mockResolvedValue("disabled");
  expect(await inspectDevicePush("same-account", null, readStatus)).toBe(
    "unconfigured",
  );
});

it("clears subscription and visible messages on account change without asking permission", async () => {
  const unsubscribe = vi.fn().mockResolvedValue(true);
  const close = vi.fn();
  const removeItem = vi.fn();
  const requestPermission = vi.fn();
  vi.stubGlobal("window", {
    localStorage: { getItem: () => "previous-account", removeItem },
  });
  vi.stubGlobal("navigator", {
    serviceWorker: {
      getRegistration: vi.fn().mockResolvedValue({
        getNotifications: async () => [{ close }],
        pushManager: { getSubscription: async () => ({ unsubscribe }) },
      }),
    },
  });
  vi.stubGlobal("Notification", { requestPermission });
  await reconcilePushOwner("new-account");
  expect(unsubscribe).toHaveBeenCalledOnce();
  expect(close).toHaveBeenCalledOnce();
  expect(removeItem).toHaveBeenCalledWith("psi-push-owner");
  expect(requestPermission).not.toHaveBeenCalled();
});
it("does not delete this account's subscription during ordinary navigation", async () => {
  const getRegistration = vi.fn();
  vi.stubGlobal("window", { localStorage: { getItem: () => "same-account" } });
  vi.stubGlobal("navigator", { serviceWorker: { getRegistration } });
  await reconcilePushOwner("same-account");
  expect(getRegistration).not.toHaveBeenCalled();
});
it("supports logout on a browser without service workers", async () => {
  vi.stubGlobal("navigator", {});
  await expect(clearBrowserPush()).resolves.toBeUndefined();
});
it("service worker displays fixed private-safe text, confines navigation and never caches pages", async () => {
  const handlers = new Map<
    string,
    (event: {
      data?: { json: () => unknown };
      notification?: unknown;
      waitUntil: (promise: Promise<unknown>) => void;
    }) => void
  >();
  const showNotification = vi.fn().mockResolvedValue(undefined);
  const openWindow = vi.fn().mockResolvedValue(undefined);
  const tasks: Promise<unknown>[] = [];
  runInNewContext(readFileSync("public/sw.js", "utf8"), {
    URL,
    self: {
      addEventListener: (
        name: string,
        handler: typeof handlers extends Map<string, infer T> ? T : never,
      ) => handlers.set(name, handler),
      registration: { showNotification },
      clients: { openWindow, claim: vi.fn() },
      location: { origin: "https://psipawer.vercel.app" },
      skipWaiting: vi.fn(),
    },
  });
  const waitUntil = (task: Promise<unknown>) => {
    tasks.push(task);
  };
  handlers.get("push")!({
    data: {
      json: () => ({
        title: "PRIVATE",
        body: "PRIVATE advice",
        url: "/app/notifications",
        tag: "psi-70000000-0000-4000-8000-000000000001",
      }),
    },
    waitUntil,
  });
  expect(showNotification).toHaveBeenCalledWith(
    "Psi Pawer",
    expect.objectContaining({
      body: "Masz nową wiadomość w aplikacji.",
      data: { url: "/app/notifications" },
    }),
  );
  handlers.get("push")!({
    data: { json: () => ({ url: "https://evil.test" }) },
    waitUntil,
  });
  expect(showNotification).toHaveBeenCalledOnce();
  handlers.get("notificationclick")!({
    notification: { close: vi.fn(), data: { url: "https://evil.test" } },
    waitUntil,
  });
  await Promise.all(tasks);
  expect(openWindow).toHaveBeenCalledWith("https://psipawer.vercel.app/");
  expect(handlers.has("fetch")).toBe(false);
});
