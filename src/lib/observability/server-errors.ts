import "server-only";

// Only explicit operation names and standard database/API codes reach logs.
// Supabase message/details/hint can contain private data and must be omitted.
export function reportDataReadError(
  operation:
    | "calendar.next"
    | "calendar.settings"
    | "work.queue"
    | "work.items"
    | "work.counts"
    | "notifications.feed"
    | "notifications.count",
  error: unknown,
  status?: number,
  retrying = false,
) {
  const code =
    error && typeof error === "object" && "code" in error
      ? error.code
      : undefined;
  const details =
    error &&
    typeof error === "object" &&
    "details" in error &&
    typeof error.details === "string"
      ? error.details
      : "";
  const networkCause = [
    "UND_ERR_SOCKET",
    "UND_ERR_CONNECT_TIMEOUT",
    "UND_ERR_HEADERS_TIMEOUT",
    "UND_ERR_HEADERS_OVERFLOW",
    "ECONNRESET",
    "ECONNREFUSED",
    "ENOTFOUND",
    "ABORT_ERR",
  ].find((value) => details.includes(value));
  console.error(
    JSON.stringify({
      event: "data_read_failed",
      operation,
      ...(retrying ? { retrying: true } : {}),
      code:
        typeof code === "string" && /^(?:[0-9A-Z]{5}|PGRST\d{3})$/.test(code)
          ? code
          : "unclassified",
      ...(typeof status === "number" &&
      Number.isInteger(status) &&
      status >= 0 &&
      status <= 599
        ? {
            status,
            ...(status === 0
              ? { network_cause: networkCause || "unclassified" }
              : {}),
          }
        : {}),
    }),
  );
}
