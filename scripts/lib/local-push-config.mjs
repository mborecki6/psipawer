import webpush from "web-push";
import { pushConfiguration } from "../../src/lib/push-policy.mjs";
import { localServiceConfig } from "./local-service-config.mjs";

// Recreating local Supabase env must not rotate the identity of devices that
// already opted in. Never inherit a hosted project's keys or process.env.
export function localPushValues(
  previous,
  origin,
  generate = webpush.generateVAPIDKeys,
) {
  let saved = null;
  try {
    if (localServiceConfig(previous).origin === origin)
      saved = pushConfiguration(previous);
  } catch {
    /* Missing or non-local prior config cannot supply push keys. */
  }
  const { publicKey, privateKey } = saved || generate();
  return {
    NEXT_PUBLIC_VAPID_PUBLIC_KEY: publicKey,
    VAPID_PRIVATE_KEY: privateKey,
    VAPID_SUBJECT: saved?.subject || "https://psipawer.vercel.app",
  };
}
