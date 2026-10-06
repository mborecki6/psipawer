import "server-only";
import { reportDataReadError } from "@/lib/observability/server-errors";

// Callers supply a fresh, read-only query or stable read RPC. This lives outside
// the transport so commands and Auth operations cannot inherit it. Only the
// observed HTTP gateway failure is retried, with two attempts in total.
export async function readWithGatewayRetry<
  T extends { status?: number; error?: unknown },
>(
  operation: Parameters<typeof reportDataReadError>[0],
  read: () => PromiseLike<T>,
): Promise<T> {
  const first = await read();
  if (first.status !== 502 || !first.error) return first;
  reportDataReadError(operation, first.error, first.status, true);
  return await read();
}
