import "server-only";
import { createClient } from "@supabase/supabase-js";
import type { invitationDeliveryConfig } from "./config";
export function invitationDeliveryClient(
  config: NonNullable<ReturnType<typeof invitationDeliveryConfig>>,
) {
  return createClient(config.url, config.key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
    global: {
      fetch: (url, init) =>
        fetch(url, {
          ...init,
          redirect: "error",
          signal: AbortSignal.timeout(20000),
        }),
    },
  });
}
