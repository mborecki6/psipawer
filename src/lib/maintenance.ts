import "server-only";
import { timingSafeEqual } from "node:crypto";

type Values = Record<string, string | undefined>;

export function maintenanceAuthorized(request: Request, values: Values) {
  const secret = values.MAINTENANCE_SECRET;
  if (!secret || !/^[A-Za-z0-9_-]{43,128}$/.test(secret)) return false;
  const supplied = request.headers.get("authorization") || "";
  const expected = `Bearer ${secret}`;
  return (
    supplied.length === expected.length &&
    Buffer.byteLength(supplied) === Buffer.byteLength(expected) &&
    timingSafeEqual(Buffer.from(supplied), Buffer.from(expected))
  );
}

function maintenanceConfig(values: Values) {
  const url = new URL(values.NEXT_PUBLIC_SUPABASE_URL || "");
  const key = values.SUPABASE_SECRET_KEY?.trim();
  if (
    values.VERCEL_ENV !== "production" ||
    url.protocol !== "https:" ||
    !/^[a-z0-9]{20}\.supabase\.co$/.test(url.hostname) ||
    url.port ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash ||
    !key
  )
    throw new Error("Maintenance configuration unavailable");
  return { origin: url.origin, key };
}

export async function processMaintenance(values: Values, request = fetch) {
  const config = maintenanceConfig(values);
  const deadline = AbortSignal.timeout(45000);
  const send = (path: string, body: unknown, method = "POST") =>
    request(`${config.origin}${path}`, {
      method,
      redirect: "error",
      cache: "no-store",
      signal: AbortSignal.any([deadline, AbortSignal.timeout(5000)]),
      headers: {
        "Content-Type": "application/json",
        apikey: config.key,
        Authorization: `Bearer ${config.key}`,
      },
      body: JSON.stringify(body),
    });
  // Reminder jobs have durable claims and retries in PostgreSQL. An overlapping
  // scheduler request cannot deliver a reminder twice.
  const reminderResponse = await send(
    "/rest/v1/rpc/worker_process_due_reminders",
    { p_limit: 50 },
  );
  if (!reminderResponse.ok) throw new Error("Reminder processing unavailable");
  const counts = await reminderResponse.json();
  if (
    !counts ||
    !["sent", "failed", "cancelled", "skipped"].every(
      (k) =>
        Number.isSafeInteger(counts[k]) && counts[k] >= 0 && counts[k] <= 50,
    )
  )
    throw new Error("Invalid reminder response");
  const reminder = {
    sent: counts.sent,
    failed: counts.failed,
    cancelled: counts.cancelled,
    skipped: counts.skipped,
  };

  return { reminder };
}

export async function handleMaintenance(
  request: Request,
  values: Values = process.env,
  send = fetch,
) {
  const headers = { "Cache-Control": "private, no-store" };
  if (!maintenanceAuthorized(request, values))
    return Response.json({ error: "Unauthorized" }, { status: 401, headers });
  try {
    const result = await processMaintenance(values, send);
    return Response.json(result, {
      headers,
      status: result.reminder.failed ? 503 : 200,
    });
  } catch {
    return Response.json(
      { error: "Maintenance unavailable" },
      { status: 503, headers },
    );
  }
}
