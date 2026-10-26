// Never borrow a hosted SMTP identity through Next's dotenv fallback.
export const localEmailKeys = [
  "BUSINESS_EMAIL_ENABLED",
  "BUSINESS_EMAIL_DEPLOYMENT",
  "BUSINESS_EMAIL_HOSTED_ENABLED",
  "BUSINESS_EMAIL_SMTP_HOST",
  "BUSINESS_EMAIL_SMTP_PORT",
  "BUSINESS_EMAIL_SMTP_USER",
  "BUSINESS_EMAIL_SMTP_PASSWORD",
  "BUSINESS_EMAIL_SMTP_FROM",
  "BUSINESS_EMAIL_SMTP_SECURE",
  "BUSINESS_EMAIL_REPLY_TO",
  "BUSINESS_EMAIL_SECRET",
];
export function localEmailConfig(values = {}) {
  if (
    values.BUSINESS_EMAIL_HOSTED_ENABLED ||
    (values.BUSINESS_EMAIL_DEPLOYMENT &&
      values.BUSINESS_EMAIL_DEPLOYMENT !== "local") ||
    (values.BUSINESS_EMAIL_SMTP_HOST &&
      !["localhost", "127.0.0.1", "::1", "[::1]"].includes(
        values.BUSINESS_EMAIL_SMTP_HOST,
      )) ||
    (values.BUSINESS_EMAIL_ENABLED &&
      !["true", "false"].includes(values.BUSINESS_EMAIL_ENABLED))
  )
    throw new Error("Only a local email sink is supported");
  return Object.fromEntries(
    localEmailKeys.map((key) => [
      key,
      key === "BUSINESS_EMAIL_ENABLED"
        ? values[key] === "true"
          ? "true"
          : "false"
        : values[key] || "",
    ]),
  );
}
