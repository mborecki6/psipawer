import "server-only";
import { isIP } from "node:net";

export const TPAY_SANDBOX_API_ORIGIN = "https://openapi.sandbox.tpay.com";
export const TPAY_SANDBOX_CHECKOUT_ORIGIN = "https://secure.sandbox.tpay.com";
export const TPAY_LIVE_API_ORIGIN = "https://api.tpay.com";
export const TPAY_LIVE_CHECKOUT_ORIGIN = "https://secure.tpay.com";

export type TpayConfig = Readonly<{
  mode: "sandbox" | "live";
  deployment: "local" | "hosted";
  appOrigin: string;
  supabaseOrigin: string;
  apiOrigin: typeof TPAY_SANDBOX_API_ORIGIN | typeof TPAY_LIVE_API_ORIGIN;
  checkoutOrigin:
    typeof TPAY_SANDBOX_CHECKOUT_ORIGIN | typeof TPAY_LIVE_CHECKOUT_ORIGIN;
  notificationUrl?: string;
  merchantId: string;
  clientId: string;
  clientSecret: string;
  // Missing differs from an explicitly empty merchant confirmation code.
  securityCode?: string;
}>;

export class TpayConfigurationError extends Error {
  constructor() {
    super("Płatności Tpay wymagają poprawnej konfiguracji środowiska.");
    this.name = "TpayConfigurationError";
  }
}

function loopbackOrigin(value: string | undefined): string | null {
  try {
    if (!value || value.length > 2048 || /[\u0000-\u0020\\]/.test(value))
      return null;
    const url = new URL(value || "");
    if (
      !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) ||
      !["http:", "https:"].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.pathname !== "/" ||
      url.search ||
      url.hash
    )
      return null;
    return url.origin;
  } catch {
    return null;
  }
}

function hostedOrigin(value: string | undefined): string | null {
  try {
    if (!value || value.length > 2048 || /[\u0000-\u0020\\]/.test(value))
      return null;
    const url = new URL(value);
    if (
      url.protocol !== "https:" ||
      url.port ||
      url.username ||
      url.password ||
      url.pathname !== "/" ||
      url.search ||
      url.hash ||
      !url.hostname.includes(".") ||
      url.hostname.endsWith(".") ||
      isIP(url.hostname.replace(/^\[|\]$/g, "")) ||
      /(^|\.)(localhost|local|internal)$/.test(url.hostname)
    )
      return null;
    return url.origin;
  } catch {
    return null;
  }
}

function validCredentials(
  config: Pick<
    TpayConfig,
    "clientId" | "clientSecret" | "merchantId" | "securityCode"
  >,
): boolean {
  return (
    typeof config.clientId === "string" &&
    config.clientId.length > 0 &&
    config.clientId.length <= 1024 &&
    config.clientId === config.clientId.trim() &&
    typeof config.clientSecret === "string" &&
    config.clientSecret.length > 0 &&
    config.clientSecret.length <= 4096 &&
    config.clientSecret === config.clientSecret.trim() &&
    !/[\u0000-\u001f\u007f]/.test(config.clientId + config.clientSecret) &&
    typeof config.merchantId === "string" &&
    /^[1-9]\d{0,19}$/.test(config.merchantId) &&
    (config.securityCode === undefined ||
      (typeof config.securityCode === "string" &&
        config.securityCode.length <= 4096 &&
        !/[\u0000-\u001f\u007f]/.test(config.securityCode)))
  );
}

/** Processing configuration survives disabling new checkouts with TPAY_ENABLED. */
export function loadTpayConfig(
  env: Readonly<Record<string, string | undefined>> = process.env,
): TpayConfig | null {
  if (
    (env.TPAY_MODE !== "sandbox" && env.TPAY_MODE !== "live") ||
    [
      "TPAY_API_URL",
      "TPAY_API_BASE_URL",
      "TPAY_BASE_URL",
      "TPAY_API_ORIGIN",
    ].some((name) => env[name])
  )
    return null;
  const mode = env.TPAY_MODE;
  const localApp = loopbackOrigin(env.NEXT_PUBLIC_APP_URL);
  const localDatabase = loopbackOrigin(env.NEXT_PUBLIC_SUPABASE_URL);
  const local = Boolean(localApp && localDatabase);
  if (
    local &&
    (mode !== "sandbox" || env.VERCEL || env.VERCEL_ENV || env.VERCEL_URL)
  )
    return null;
  const appOrigin = local ? localApp : hostedOrigin(env.TPAY_APP_ORIGIN);
  const supabaseOrigin = local
    ? localDatabase
    : hostedOrigin(env.NEXT_PUBLIC_SUPABASE_URL);
  if (
    !local &&
    (env.TPAY_HOSTED_ENABLED !== "true" ||
      appOrigin !== hostedOrigin(env.NEXT_PUBLIC_APP_URL) ||
      env.TPAY_SECURITY_CODE === undefined)
  )
    return null;
  if (
    mode === "live" &&
    (local ||
      env.TPAY_LIVE_ENABLED !== "true" ||
      env.NODE_ENV !== "production" ||
      (env.VERCEL_ENV !== undefined && env.VERCEL_ENV !== "production") ||
      ((env.VERCEL || env.VERCEL_URL) && env.VERCEL_ENV !== "production"))
  )
    return null;
  const clientId = env.TPAY_CLIENT_ID?.trim();
  const clientSecret = env.TPAY_CLIENT_SECRET?.trim();
  const merchantId = env.TPAY_MERCHANT_ID?.trim();
  if (
    !appOrigin ||
    !supabaseOrigin ||
    !clientId ||
    !clientSecret ||
    !merchantId
  )
    return null;
  if (
    !validCredentials({
      clientId,
      clientSecret,
      merchantId,
      securityCode: env.TPAY_SECURITY_CODE,
    })
  )
    return null;
  return Object.freeze({
    mode,
    deployment: local ? "local" : "hosted",
    appOrigin,
    supabaseOrigin,
    apiOrigin: mode === "live" ? TPAY_LIVE_API_ORIGIN : TPAY_SANDBOX_API_ORIGIN,
    checkoutOrigin:
      mode === "live"
        ? TPAY_LIVE_CHECKOUT_ORIGIN
        : TPAY_SANDBOX_CHECKOUT_ORIGIN,
    ...(local
      ? {}
      : { notificationUrl: `${appOrigin}/api/payments/tpay/notification` }),
    clientId,
    clientSecret,
    merchantId,
    securityCode: env.TPAY_SECURITY_CODE,
  });
}

export const getTpayConfig = loadTpayConfig;

export function assertTpayConfig(config: TpayConfig): void {
  if (
    (config.mode !== "sandbox" && config.mode !== "live") ||
    config.apiOrigin !==
      (config.mode === "live"
        ? TPAY_LIVE_API_ORIGIN
        : TPAY_SANDBOX_API_ORIGIN) ||
    config.checkoutOrigin !==
      (config.mode === "live"
        ? TPAY_LIVE_CHECKOUT_ORIGIN
        : TPAY_SANDBOX_CHECKOUT_ORIGIN) ||
    !validCredentials(config) ||
    (config.deployment === "local"
      ? config.mode !== "sandbox" ||
        !loopbackOrigin(config.appOrigin) ||
        !loopbackOrigin(config.supabaseOrigin) ||
        config.notificationUrl !== undefined
      : config.deployment === "hosted"
        ? !hostedOrigin(config.appOrigin) ||
          !hostedOrigin(config.supabaseOrigin) ||
          config.securityCode === undefined ||
          config.notificationUrl !==
            `${config.appOrigin}/api/payments/tpay/notification`
        : true)
  )
    throw new TpayConfigurationError();
}
