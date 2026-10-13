import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { request as httpsRequest } from "node:https";
import webpush from "web-push";
import {
  allowedPushEndpoint,
  validPushSubscription,
  pushConfiguration,
  pushOutcome,
  privatePushPayload,
} from "./push-policy.mjs";

export function isPublicPushAddress(address) {
  const kind = isIP(address);
  if (kind === 6) {
    const [first, second = "0"] = address.toLowerCase().split(":");
    const prefix = Number.parseInt(first, 16);
    const next = Number.parseInt(second || "0", 16);
    return (
      prefix >= 0x2000 &&
      prefix <= 0x3fff &&
      prefix !== 0x2002 &&
      prefix !== 0x3fff &&
      !(prefix === 0x2001 && (next < 0x200 || next === 0xdb8))
    );
  }
  if (kind !== 4) return false;
  const [a, b, c] = address.split(".").map(Number);
  return !(
    a === 0 ||
    a === 10 ||
    a === 127 ||
    a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && (b === 168 || b === 0 || (b === 88 && c === 99))) ||
    (a === 192 && b === 0 && c === 2) ||
    (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) ||
    (a === 203 && b === 0 && c === 113)
  );
}

export async function sendPrivatePush(
  subscription,
  payload,
  config,
  resolve = lookup,
  request = httpsRequest,
) {
  if (!validPushSubscription(subscription)) return 400;
  const hostname = new URL(subscription.endpoint).hostname;
  let timer;
  const addresses = await Promise.race([
    resolve(hostname, { all: true, verbatim: true }),
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error("Push DNS timeout")), 2000);
    }),
  ]).finally(() => clearTimeout(timer));
  if (
    !addresses.length ||
    addresses.some(({ address }) => !isPublicPushAddress(address))
  )
    return 400;
  const pinned = addresses[0];
  const details = webpush.generateRequestDetails(subscription, payload, {
    vapidDetails: config,
    TTL: 3600,
    urgency: "normal",
    contentEncoding: "aes128gcm",
  });
  if (!allowedPushEndpoint(details.endpoint)) return 400;
  // Native https never follows redirects. Pin DNS for the actual connection;
  // hostname/TLS verification still use the provider name, not the chosen IP.
  return await new Promise((resolveStatus, reject) => {
    const req = request(
      details.endpoint,
      {
        method: "POST",
        headers: details.headers,
        agent: false,
        signal: AbortSignal.timeout(5000),
        lookup(_hostname, options, callback) {
          if (options.all) callback(null, [pinned]);
          else callback(null, pinned.address, pinned.family);
        },
      },
      (response) => {
        const status = response.statusCode || 0;
        response.resume();
        resolveStatus(status);
        response.destroy();
      },
    );
    req.once("error", reject);
    req.end(details.body);
  });
}

export async function processPushDeliveries(
  connection,
  values,
  request = fetch,
  send = sendPrivatePush,
) {
  const config = pushConfiguration(values);
  const counts = {
    configured: Boolean(config),
    accepted: 0,
    retry: 0,
    failed: 0,
    expired: 0,
    skipped: 0,
  };
  if (!config) return counts;
  const deadline = AbortSignal.timeout(40000);
  const rpc = async (name, body) => {
    const response = await request(`${connection.origin}/rest/v1/rpc/${name}`, {
      method: "POST",
      redirect: "error",
      cache: "no-store",
      signal: AbortSignal.any([deadline, AbortSignal.timeout(5000)]),
      headers: {
        "Content-Type": "application/json",
        apikey: connection.key,
        Authorization: `Bearer ${connection.key}`,
      },
      body: JSON.stringify(body),
    });
    if (!response.ok) throw new Error("Push queue unavailable");
    return await response.json();
  };
  // Three claims include bounded DNS, provider and acknowledgement timeouts.
  const jobs = await rpc("worker_claim_push_deliveries", { p_limit: 3 });
  if (!Array.isArray(jobs) || jobs.length > 3)
    throw new Error("Invalid push queue response");
  for (const job of jobs) {
    if (
      !/^[0-9a-f-]{36}$/i.test(job.id || "") ||
      !/^[0-9a-f-]{36}$/i.test(job.claim_token || "")
    )
      throw new Error("Invalid push claim");
    let outcome = "failed";
    let code = 400;
    const subscription = {
      endpoint: job.endpoint,
      keys: { p256dh: job.p256dh, auth: job.auth },
    };
    if (validPushSubscription(subscription)) {
      try {
        code = await send(
          subscription,
          privatePushPayload(job.recipient_role, job.notification_id),
          config,
        );
      } catch {
        code = 0;
      }
      outcome = pushOutcome(code);
    }
    const applied = await rpc("worker_finish_push_delivery", {
      p_id: job.id,
      p_claim: job.claim_token,
      p_outcome: outcome,
      p_status:
        Number.isInteger(code) && code >= 100 && code <= 599 ? code : null,
    });
    if (applied === true) counts[outcome] += 1;
    else if (applied === false) counts.skipped += 1;
    else throw new Error("Invalid push delivery response");
  }
  return counts;
}
