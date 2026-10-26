// Only the explicit private local file can enable payments in the local runner.
// Explicit empty strings also prevent Next dotenv from borrowing hosted keys.
export const localTpayKeys = [
  "TPAY_ENABLED",
  "TPAY_MODE",
  "TPAY_CLIENT_ID",
  "TPAY_CLIENT_SECRET",
  "TPAY_MERCHANT_ID",
  "TPAY_SECURITY_CODE",
  "TPAY_API_URL",
  "TPAY_BASE_URL",
  "TPAY_ENVIRONMENT",
  "TPAY_API_BASE_URL",
  "TPAY_API_ORIGIN",
  "TPAY_HOSTED_ENABLED",
  "TPAY_LIVE_ENABLED",
  "TPAY_APP_ORIGIN",
];
export function localTpayConfig(values = {}) {
  if (values.TPAY_ENABLED && !["true", "false"].includes(values.TPAY_ENABLED))
    throw new Error("Invalid local payment flag");
  if (
    values.TPAY_ENABLED === "true" &&
    !["sandbox", "simulator"].includes(values.TPAY_MODE)
  )
    throw new Error("Only local payment tests are supported");
  if (
    values.TPAY_API_URL ||
    values.TPAY_BASE_URL ||
    values.TPAY_ENVIRONMENT ||
    values.TPAY_API_BASE_URL ||
    values.TPAY_API_ORIGIN ||
    values.TPAY_HOSTED_ENABLED ||
    values.TPAY_LIVE_ENABLED ||
    values.TPAY_APP_ORIGIN
  )
    throw new Error("Payment endpoints cannot be overridden");
  return Object.fromEntries(
    localTpayKeys.map((key) => [
      key,
      key === "TPAY_ENABLED"
        ? values[key] === "true"
          ? "true"
          : "false"
        : values[key] || "",
    ]),
  );
}
