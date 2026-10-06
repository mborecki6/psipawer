import "server-only";
import { isConfigured } from "@/lib/supabase/config";

// The current phase permits local mailbox tests only. Enabling external client
// invitations is a separate deployment decision, not implied by an SMTP flag.
export function invitationDeliveryConfig() {
  if (
    process.env.CLIENT_INVITATIONS_ENABLED !== "true" ||
    process.env.AUTH_EMAIL_ENABLED !== "true" ||
    !isConfigured()
  )
    return null;
  try {
    const app = new URL(process.env.NEXT_PUBLIC_APP_URL || "");
    const db = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL || "");
    const key = process.env.SUPABASE_SECRET_KEY?.trim();
    for (const u of [app, db]) {
      if (
        !["localhost", "127.0.0.1", "[::1]"].includes(u.hostname) ||
        !["http:", "https:"].includes(u.protocol) ||
        u.username ||
        u.password ||
        u.pathname !== "/" ||
        u.search ||
        u.hash
      )
        return null;
    }
    return key ? { origin: app.origin, url: db.origin, key } : null;
  } catch {
    return null;
  }
}
