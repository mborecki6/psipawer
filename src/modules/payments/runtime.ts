import "server-only";
import { getTpayConfig, type TpayConfig } from "./config";
import type { OnlinePaymentEnvironment } from "./types";

export type LocalPaymentRuntime = {
  environment: OnlinePaymentEnvironment;
  appOrigin: string;
  sandbox: TpayConfig | null;
  canStart: boolean;
};

function localOrigin(value: string | undefined): string | null {
  try {
    const url = new URL(value || "");
    return ["http:", "https:"].includes(url.protocol) &&
      ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) &&
      !url.username &&
      !url.password &&
      url.pathname === "/" &&
      !url.search &&
      !url.hash
      ? url.origin
      : null;
  } catch {
    return null;
  }
}

/** Configuration permits settlement independently of starting new checkouts. */
export function getLocalPaymentRuntime(): LocalPaymentRuntime | null {
  if (!process.env.SUPABASE_SECRET_KEY) return null;
  if (process.env.TPAY_MODE === "simulator") {
    const appOrigin = localOrigin(process.env.NEXT_PUBLIC_APP_URL);
    if (
      !appOrigin ||
      !localOrigin(process.env.NEXT_PUBLIC_SUPABASE_URL) ||
      process.env.VERCEL ||
      process.env.VERCEL_ENV ||
      process.env.VERCEL_URL
    )
      return null;
    return {
      environment: "simulator",
      appOrigin,
      sandbox: null,
      canStart: process.env.TPAY_ENABLED === "true",
    };
  }
  const sandbox = getTpayConfig();
  return sandbox
    ? {
        environment: sandbox.mode,
        appOrigin: sandbox.appOrigin,
        sandbox,
        canStart: process.env.TPAY_ENABLED === "true",
      }
    : null;
}

export function requireLocalPaymentRuntime(): LocalPaymentRuntime {
  const runtime = getLocalPaymentRuntime();
  if (!runtime)
    throw new Error(
      "Obsługa płatności nie jest skonfigurowana w tym środowisku.",
    );
  return runtime;
}
