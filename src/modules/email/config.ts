import "server-only";
import { isIP } from "node:net";

export type EmailValues = Readonly<Record<string, string | undefined>>;
export type BusinessEmailConfig = Readonly<{
  deployment: "local" | "hosted";
  appOrigin: string;
  databaseOrigin: string;
  databaseKey: string;
  host: string;
  port: number;
  secure: boolean;
  user?: string;
  password?: string;
  from: string;
  replyTo?: string;
}>;

const loopback = (host: string) =>
  ["localhost", "127.0.0.1", "[::1]", "::1"].includes(host);
const publicHost = (host: string) =>
  /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/.test(host) &&
  host.includes(".") &&
  !host.includes("..") &&
  !isIP(host) &&
  !/(^|\.)(localhost|local|internal|test|invalid)$/.test(host);

/** One mailbox only: no display names, lists, headers or transport URLs. */
export function validMailbox(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length <= 254 &&
    /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?$/.test(
      value,
    ) &&
    !value.includes("..") &&
    value.split("@")[0].length <= 64
  );
}

function origin(value: string | undefined, local: boolean): string | null {
  try {
    if (!value || value.length > 2048 || /[\u0000-\u0020\\]/.test(value))
      return null;
    const url = new URL(value);
    if (
      url.username ||
      url.password ||
      url.pathname !== "/" ||
      url.search ||
      url.hash
    )
      return null;
    if (
      local
        ? !loopback(url.hostname) || !["http:", "https:"].includes(url.protocol)
        : url.protocol !== "https:" ||
          Boolean(url.port) ||
          !publicHost(url.hostname)
    )
      return null;
    return url.origin;
  } catch {
    return null;
  }
}

export function loadBusinessEmailConfig(
  values: EmailValues = process.env,
): BusinessEmailConfig | null {
  if (values.BUSINESS_EMAIL_ENABLED !== "true") return null;
  const deployment = values.BUSINESS_EMAIL_DEPLOYMENT;
  if (deployment !== "local" && deployment !== "hosted") return null;
  const local = deployment === "local";
  if (
    local
      ? Boolean(values.VERCEL || values.VERCEL_ENV || values.VERCEL_URL)
      : values.BUSINESS_EMAIL_HOSTED_ENABLED !== "true" ||
        values.NODE_ENV !== "production" ||
        (values.VERCEL_ENV !== undefined &&
          values.VERCEL_ENV !== "production") ||
        Boolean(
          (values.VERCEL || values.VERCEL_URL) &&
          values.VERCEL_ENV !== "production",
        )
  )
    return null;
  const appOrigin = origin(values.NEXT_PUBLIC_APP_URL, local);
  const databaseOrigin = origin(values.NEXT_PUBLIC_SUPABASE_URL, local);
  const databaseKey = values.SUPABASE_SECRET_KEY;
  const host = values.BUSINESS_EMAIL_SMTP_HOST;
  const port = Number(values.BUSINESS_EMAIL_SMTP_PORT);
  const secureValue = values.BUSINESS_EMAIL_SMTP_SECURE;
  const from = values.BUSINESS_EMAIL_SMTP_FROM;
  const replyTo = values.BUSINESS_EMAIL_REPLY_TO || undefined;
  const user = values.BUSINESS_EMAIL_SMTP_USER;
  const password = values.BUSINESS_EMAIL_SMTP_PASSWORD;
  const credential = (v: string | undefined) =>
    Boolean(v && v.length <= 4096 && !/[\u0000-\u001f\u007f]/.test(v));
  if (
    !appOrigin ||
    !databaseOrigin ||
    !credential(databaseKey) ||
    !host ||
    (local ? !loopback(host) : !publicHost(host)) ||
    !/^[1-9]\d{0,4}$/.test(values.BUSINESS_EMAIL_SMTP_PORT || "") ||
    !Number.isSafeInteger(port) ||
    port > 65535 ||
    !["true", "false"].includes(secureValue || "") ||
    !validMailbox(from) ||
    (replyTo !== undefined && !validMailbox(replyTo)) ||
    (local
      ? Boolean(user || password) && !(credential(user) && credential(password))
      : !(credential(user) && credential(password)))
  )
    return null;
  return Object.freeze({
    deployment,
    appOrigin,
    databaseOrigin,
    databaseKey: databaseKey!,
    host,
    port,
    secure: secureValue === "true",
    from,
    ...(replyTo ? { replyTo } : {}),
    ...(user && password ? { user, password } : {}),
  });
}
