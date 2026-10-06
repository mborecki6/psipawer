import "server-only";
import { isConfigured } from "@/lib/supabase/config";

// A server-owned switch keeps the existing pilot's SMTP-dependent features off.
// Never derive a link destination from form input, Host or forwarded headers.
export function authEmailOrigin(): string | null {
  if (process.env.AUTH_EMAIL_ENABLED !== "true" || !isConfigured()) return null;
  try {
    const app = new URL(process.env.NEXT_PUBLIC_APP_URL || "");
    const db = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL || "");
    const loopback = (url: URL) =>
      ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    if (
      app.username ||
      app.password ||
      app.pathname !== "/" ||
      app.search ||
      app.hash ||
      !["http:", "https:"].includes(app.protocol) ||
      (!loopback(app) && app.protocol !== "https:") ||
      loopback(app) !== loopback(db) ||
      (process.env.NODE_ENV === "development" && !loopback(app))
    )
      return null;
    return app.origin;
  } catch {
    return null;
  }
}
