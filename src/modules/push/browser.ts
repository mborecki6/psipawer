"use client";

const ownerKey = "psi-push-owner";
export type PushSettingsStatus =
  | "checking"
  | "unsupported"
  | "unconfigured"
  | "enabled_unconfigured"
  | "denied"
  | "disabled"
  | "enabled"
  | "expired"
  | "error";
export function pushOwner() {
  try {
    return window.localStorage.getItem(ownerKey);
  } catch {
    return null;
  }
}
export function setPushOwner(userId: string | null) {
  try {
    if (userId) window.localStorage.setItem(ownerKey, userId);
    else window.localStorage.removeItem(ownerKey);
  } catch {
    /* Server ownership remains authoritative when storage is unavailable. */
  }
}

export async function clearBrowserPush() {
  if (!("serviceWorker" in navigator)) return;
  const registration = await navigator.serviceWorker.getRegistration("/");
  if (registration) {
    const notifications = await registration.getNotifications();
    notifications.forEach((notification) => notification.close());
    const subscription = await registration.pushManager?.getSubscription();
    if (subscription) await subscription.unsubscribe();
  }
  setPushOwner(null);
}

// Never request permission here; only the explicit settings button may do so.
export async function reconcilePushOwner(userId: string) {
  const previous = pushOwner();
  if (previous && previous !== userId) await clearBrowserPush();
}

export async function inspectDevicePush(
  userId: string,
  publicKey: string | null,
  readStatus: (
    endpoint: string,
  ) => Promise<"enabled" | "disabled" | "expired" | "error">,
): Promise<PushSettingsStatus> {
  if (
    !("serviceWorker" in navigator) ||
    !("PushManager" in window) ||
    !("Notification" in window) ||
    !window.isSecureContext
  )
    return "unsupported";
  await reconcilePushOwner(userId);
  if (Notification.permission === "denied") return "denied";
  const registration = await navigator.serviceWorker.getRegistration("/");
  const subscription = await registration?.pushManager.getSubscription();
  if (subscription) {
    const status = await readStatus(subscription.endpoint);
    if (status === "enabled" && !publicKey) return "enabled_unconfigured";
    if (status !== "disabled") return status;
  }
  return publicKey ? "disabled" : "unconfigured";
}

export function applicationServerKey(value: string) {
  const decoded = window.atob(
    value.replace(/-/g, "+").replace(/_/g, "/") +
      "=".repeat((4 - (value.length % 4)) % 4),
  );
  return Uint8Array.from(decoded, (character) => character.charCodeAt(0));
}
