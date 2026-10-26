import "server-only";
import { isConfigured } from "@/lib/supabase/config";

export type AuthEmailDelivery = {
  origin: string;
  databaseOrigin: string;
  mode: "local" | "smtp";
};

// Sending and the hosted environment are separate, deliberate switches. SMTP
// credentials/templates stay in Supabase Auth; these flags never prove delivery.
// Never derive a link destination from form input, Host or forwarded headers.
export function authEmailDelivery(): AuthEmailDelivery | null {
  if (process.env.AUTH_EMAIL_ENABLED !== "true" || !isConfigured()) return null;
  try {
    const app = new URL(process.env.NEXT_PUBLIC_APP_URL || "");
    const db = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL || "");
    const loopback = (url: URL) =>
      ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    for (const url of [app, db])
      if (
        url.username ||
        url.password ||
        url.pathname !== "/" ||
        url.search ||
        url.hash ||
        !["http:", "https:"].includes(url.protocol)
      )
        return null;
    if (loopback(app) !== loopback(db)) return null;
    if (loopback(app)) {
      if (process.env.VERCEL || process.env.VERCEL_ENV) return null;
      return {
        origin: app.origin,
        databaseOrigin: db.origin,
        mode: "local",
      };
    }
    if (
      process.env.AUTH_EMAIL_HOSTED_ENABLED !== "true" ||
      process.env.NODE_ENV !== "production" ||
      (process.env.VERCEL_ENV && process.env.VERCEL_ENV !== "production") ||
      app.protocol !== "https:" ||
      app.port ||
      db.protocol !== "https:" ||
      db.port ||
      !/^[a-z0-9]{20}\.supabase\.co$/.test(db.hostname) ||
      process.env.AUTH_EMAIL_APP_ORIGIN !== app.origin
    )
      return null;
    return { origin: app.origin, databaseOrigin: db.origin, mode: "smtp" };
  } catch {
    return null;
  }
}

export function authEmailOrigin(): string | null {
  return authEmailDelivery()?.origin || null;
}
