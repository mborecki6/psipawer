import "server-only";
import { timingSafeEqual } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import {
  loadBusinessEmailConfig,
  type BusinessEmailConfig,
  type EmailValues,
} from "./config";
import { buildBusinessEmail, type EmailMessageData } from "./message";
import {
  createBusinessEmailTransport,
  type BusinessEmailTransport,
  type EmailSendOutcome,
} from "./transport";

export type EmailWorkerDatabase = {
  rpc(
    name: string,
    args?: Record<string, unknown>,
  ): PromiseLike<{ data: unknown; error: unknown }>;
};
type Dependencies = {
  database?: (config: BusinessEmailConfig) => EmailWorkerDatabase;
  transport?: (config: BusinessEmailConfig) => BusinessEmailTransport;
};
type Claim = { id: string; claim_token: string };
export type EmailWorkerResult = {
  configured: boolean;
  claimed: number;
  accepted: number;
  retry: number;
  failed: number;
  uncertain: number;
  cancelled: number;
};
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function emailWorkerAuthorized(
  request: Request,
  values: EmailValues,
): boolean {
  const secret = values.BUSINESS_EMAIL_SECRET;
  if (!secret || !/^[A-Za-z0-9_-]{43,128}$/.test(secret)) return false;
  const supplied = request.headers.get("authorization") || "";
  const expected = `Bearer ${secret}`;
  return (
    Buffer.byteLength(supplied) === Buffer.byteLength(expected) &&
    timingSafeEqual(Buffer.from(supplied), Buffer.from(expected))
  );
}

export async function processBusinessEmail(
  values: EmailValues = process.env,
  dependencies: Dependencies = {},
): Promise<EmailWorkerResult> {
  const result: EmailWorkerResult = {
    configured: false,
    claimed: 0,
    accepted: 0,
    retry: 0,
    failed: 0,
    uncertain: 0,
    cancelled: 0,
  };
  if (values.BUSINESS_EMAIL_ENABLED !== "true") return result;
  const config = loadBusinessEmailConfig(values);
  if (!config) throw new Error("Email configuration unavailable");
  result.configured = true;
  const deadline = AbortSignal.timeout(40000);
  const database: EmailWorkerDatabase =
    dependencies.database?.(config) ||
    createClient(config.databaseOrigin, config.databaseKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
      global: {
        fetch: (input, init) =>
          fetch(input, {
            ...init,
            signal: AbortSignal.any([
              deadline,
              AbortSignal.timeout(5000),
              ...(init?.signal ? [init.signal] : []),
            ]),
          }),
      },
    });
  const rpc = async (name: string, args: Record<string, unknown>) => {
    const response = await database.rpc(name, args);
    if (response.error) throw new Error("Email queue unavailable");
    return response.data;
  };
  // One SMTP transaction per request bounds the scheduler's runtime and blast radius.
  const claims = await rpc("worker_claim_business_email", { p_limit: 1 });
  if (
    !Array.isArray(claims) ||
    claims.length > 1 ||
    claims.some(
      (claim: Claim) =>
        !claim || !uuid.test(claim.id) || !uuid.test(claim.claim_token),
    )
  )
    throw new Error("Invalid email claim");
  result.claimed = claims.length;
  let transport: BusinessEmailTransport | undefined;
  try {
    for (const claim of claims as Claim[]) {
      const rows = await rpc("worker_prepare_business_email", {
        p_id: claim.id,
        p_token: claim.claim_token,
      });
      if (!Array.isArray(rows) || rows.length > 1)
        throw new Error("Invalid email preparation");
      if (!rows.length) {
        result.cancelled++;
        continue;
      }
      let outcome: EmailSendOutcome;
      try {
        const message = buildBusinessEmail(
          config,
          claim.id,
          rows[0] as EmailMessageData,
        );
        transport ??= (dependencies.transport || createBusinessEmailTransport)(
          config,
        );
        // SMTP idle timeouts are not an overall deadline (a server may keep
        // trickling replies). Bound this request and conservatively retain an
        // uncertain outcome even if the transport completes later.
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
          outcome = await Promise.race([
            transport.send(message),
            new Promise<EmailSendOutcome>((resolve) => {
              timer = setTimeout(() => resolve("uncertain"), 20000);
            }),
          ]);
        } finally {
          clearTimeout(timer);
        }
        if (!["accepted", "retry", "failed", "uncertain"].includes(outcome))
          outcome = "uncertain";
      } catch {
        outcome = "uncertain";
      }
      // A failed finish leaves sending/lease → uncertain. It never resends an
      // accepted message even if the HTTP/DB response is lost after SMTP DATA.
      if (
        (await rpc("worker_finish_business_email", {
          p_id: claim.id,
          p_token: claim.claim_token,
          p_outcome: outcome,
        })) !== true
      )
        throw new Error("Email outcome unavailable");
      result[outcome]++;
    }
  } finally {
    transport?.close();
  }
  return result;
}

export async function handleBusinessEmail(
  request: Request,
  values: EmailValues = process.env,
  dependencies: Dependencies = {},
) {
  const headers = { "Cache-Control": "private, no-store" };
  if (!emailWorkerAuthorized(request, values))
    return Response.json({ error: "Unauthorized" }, { status: 401, headers });
  try {
    const result = await processBusinessEmail(values, dependencies);
    return Response.json(result, {
      headers,
      status: result.failed || result.retry || result.uncertain ? 503 : 200,
    });
  } catch {
    return Response.json(
      { error: "Email processing unavailable" },
      { status: 503, headers },
    );
  }
}
