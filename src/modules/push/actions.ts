"use server";

import { requireSession } from "@/lib/auth/session";
import {
  allowedPushEndpoint,
  validPushSubscription,
  pushConfiguration,
} from "@/lib/push-policy.mjs";

type BrowserSubscription = {
  endpoint: string;
  keys: { p256dh: string; auth: string };
};
const failure = {
  error: "Nie udało się zapisać ustawienia. Spróbuj ponownie.",
};

export async function saveDevicePush(
  subscription: BrowserSubscription,
): Promise<{ success: true } | { error: string }> {
  const { db } = await requireSession();
  if (!pushConfiguration(process.env))
    return {
      error: "Powiadomienia na urządzeniu nie są jeszcze skonfigurowane.",
    };
  if (!validPushSubscription(subscription))
    return { error: "Ta subskrypcja przeglądarki nie jest obsługiwana." };
  try {
    const { data, error } = await db.rpc("save_push_subscription", {
      p_endpoint: subscription.endpoint,
      p_p256dh: subscription.keys.p256dh,
      p_auth: subscription.keys.auth,
    });
    if (error || typeof data !== "string") return failure;
    return { success: true };
  } catch {
    return failure;
  }
}

export async function disableDevicePush(
  endpoint: string,
): Promise<{ success: true } | { error: string }> {
  const { db } = await requireSession();
  if (!allowedPushEndpoint(endpoint)) return failure;
  try {
    const { data, error } = await db.rpc("disable_push_subscription", {
      p_endpoint: endpoint,
    });
    if (error || data !== true) return failure;
    return { success: true };
  } catch {
    return failure;
  }
}

export async function devicePushStatus(
  endpoint: string,
): Promise<"enabled" | "disabled" | "expired" | "error"> {
  const { db } = await requireSession();
  if (!allowedPushEndpoint(endpoint)) return "disabled";
  try {
    const { data, error } = await db.rpc("push_subscription_status", {
      p_endpoint: endpoint,
    });
    if (error || !["enabled", "disabled", "expired"].includes(data))
      return "error";
    return data;
  } catch {
    return "error";
  }
}
