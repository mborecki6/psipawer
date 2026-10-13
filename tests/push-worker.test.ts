import { expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
import type { request as httpsRequest } from "node:https";
import webpush from "web-push";
import { randomBytes } from "node:crypto";
import {
  allowedPushEndpoint,
  validPushSubscription,
  pushConfiguration,
  pushOutcome,
  privatePushPayload,
} from "../src/lib/push-policy.mjs";
import {
  isPublicPushAddress,
  sendPrivatePush,
  processPushDeliveries,
} from "../src/lib/push-worker.mjs";
import { processLocalPush } from "../scripts/push.mjs";
const vapid = webpush.generateVAPIDKeys();
const config = { ...vapid, subject: "https://psipawer.vercel.app" };
const values = {
  NEXT_PUBLIC_VAPID_PUBLIC_KEY: vapid.publicKey,
  VAPID_PRIVATE_KEY: vapid.privateKey,
  VAPID_SUBJECT: config.subject,
};
const subscription = {
  endpoint: "https://fcm.googleapis.com/fcm/send/test",
  keys: {
    p256dh: webpush.generateVAPIDKeys().publicKey,
    auth: randomBytes(16).toString("base64url"),
  },
};
const connection = { origin: "http://127.0.0.1:54321", key: "local-fake-key" };
const job = {
  id: "50000000-0000-4000-8000-000000000001",
  claim_token: "50000000-0000-4000-8000-000000000002",
  notification_id: "50000000-0000-4000-8000-000000000003",
  recipient_role: "client",
  endpoint: subscription.endpoint,
  ...subscription.keys,
};
const ok = (data: unknown) => ({ ok: true, json: async () => data });

it("accepts only the supported HTTPS push providers", () => {
  for (const host of [
    "fcm.googleapis.com",
    "updates.push.services.mozilla.com",
    "web.push.apple.com",
  ])
    expect(allowedPushEndpoint(`https://${host}/token`)).toBe(true);
  for (const endpoint of [
    "http://fcm.googleapis.com/token",
    "https://fcm.googleapis.com.evil.test/token",
    "https://user@fcm.googleapis.com/token",
    "https://fcm.googleapis.com:8443/token",
    "https://127.0.0.1/token",
    "https://[::1]/token",
    "https://169.254.169.254/token",
    "https://example.org/token",
    "https://fcm.googleapis.com/token#hash",
    "https://fcm.googleapis.com/token?redirect=evil",
  ])
    expect(allowedPushEndpoint(endpoint)).toBe(false);
  expect(validPushSubscription(subscription)).toBe(true);
  expect(
    validPushSubscription({
      ...subscription,
      keys: { ...subscription.keys, auth: "wrong" },
    }),
  ).toBe(false);
});
it("rejects nonpublic resolved addresses including mixed DNS responses", async () => {
  for (const ip of [
    "127.0.0.1",
    "10.0.0.1",
    "169.254.169.254",
    "172.16.1.1",
    "192.168.0.2",
    "100.64.1.1",
    "224.0.0.1",
    "0.0.0.0",
    "198.18.0.1",
    "::1",
    "::ffff:127.0.0.1",
    "fc00::1",
    "fe80::1",
    "2001:db8::1",
    "invalid",
  ])
    expect(isPublicPushAddress(ip)).toBe(false);
  expect(isPublicPushAddress("142.250.1.1")).toBe(true);
  expect(isPublicPushAddress("2607:f8b0:4004:809::200e")).toBe(true);
  const request = vi.fn();
  expect(
    await sendPrivatePush(
      subscription,
      "hello",
      config,
      vi.fn().mockResolvedValue([
        { address: "142.250.1.1", family: 4 },
        { address: "127.0.0.1", family: 4 },
      ]),
      request,
    ),
  ).toBe(400);
  expect(request).not.toHaveBeenCalled();
});
it("encrypts through web-push, pins DNS and returns redirects without following them", async () => {
  const req = new EventEmitter() as EventEmitter & {
    end: ReturnType<typeof vi.fn>;
  };
  req.end = vi.fn();
  const request = vi.fn((url, options, callback) => {
    expect(url).toBe(subscription.endpoint);
    expect(options.method).toBe("POST");
    expect(options.headers["Content-Encoding"]).toBe("aes128gcm");
    const done = vi.fn();
    options.lookup("fcm.googleapis.com", { all: false }, done);
    expect(done).toHaveBeenCalledWith(null, "142.250.1.1", 4);
    callback({ statusCode: 302, resume: vi.fn(), destroy: vi.fn() });
    return req;
  });
  expect(
    await sendPrivatePush(
      subscription,
      "PRIVATE-PLAINTEXT",
      config,
      vi.fn().mockResolvedValue([{ address: "142.250.1.1", family: 4 }]),
      request as unknown as typeof httpsRequest,
    ),
  ).toBe(302);
  expect(request).toHaveBeenCalledTimes(1);
  expect(req.end.mock.calls[0][0].toString()).not.toContain(
    "PRIVATE-PLAINTEXT",
  );
});
it("classifies accepted, transient, expired and permanent responses", () => {
  for (const code of [200, 201, 204])
    expect(pushOutcome(code)).toBe("accepted");
  for (const code of [0, 408, 409, 425, 429, 500, 503])
    expect(pushOutcome(code)).toBe("retry");
  for (const code of [404, 410]) expect(pushOutcome(code)).toBe("expired");
  for (const code of [301, 302, 400, 401, 403, 413])
    expect(pushOutcome(code)).toBe("failed");
});
it("uses no dog, advice, contact or event details in the payload", () => {
  expect(JSON.parse(privatePushPayload("admin", job.notification_id))).toEqual({
    title: "Psi Pawer",
    body: "Masz nową wiadomość w aplikacji.",
    url: "/admin/notifications",
    tag: `psi-${job.notification_id}`,
  });
});
it("does not claim jobs with absent or incomplete VAPID configuration", async () => {
  const request = vi.fn();
  expect(await processPushDeliveries(connection, {}, request)).toMatchObject({
    configured: false,
  });
  expect(request).not.toHaveBeenCalled();
  expect(
    pushConfiguration({ ...values, VAPID_SUBJECT: "https://localhost" }),
  ).toBeNull();
});
it("acknowledges only a matching claim and never writes to the inbox", async () => {
  const request = vi
    .fn()
    .mockResolvedValueOnce(ok([job]))
    .mockResolvedValueOnce(ok(true));
  const send = vi.fn().mockResolvedValue(201);
  expect(
    await processPushDeliveries(connection, values, request, send),
  ).toEqual({
    configured: true,
    accepted: 1,
    retry: 0,
    failed: 0,
    expired: 0,
    skipped: 0,
  });
  expect(JSON.parse(request.mock.calls[0][1].body)).toEqual({ p_limit: 3 });
  expect(JSON.parse(request.mock.calls[1][1].body)).toEqual({
    p_id: job.id,
    p_claim: job.claim_token,
    p_outcome: "accepted",
    p_status: 201,
  });
  expect(request.mock.calls.map(([url]) => url)).toEqual([
    `${connection.origin}/rest/v1/rpc/worker_claim_push_deliveries`,
    `${connection.origin}/rest/v1/rpc/worker_finish_push_delivery`,
  ]);
  expect(
    request.mock.calls.every(([, options]) => options.redirect === "error"),
  ).toBe(true);
});
it("sanitizes provider exceptions and uses the durable retry outcome", async () => {
  const request = vi
    .fn()
    .mockResolvedValueOnce(ok([job]))
    .mockResolvedValueOnce(ok(true));
  const result = await processPushDeliveries(
    connection,
    values,
    request,
    vi.fn().mockRejectedValue(new Error("SECRET provider response")),
  );
  expect(result.retry).toBe(1);
  expect(request.mock.calls[1][1].body).not.toContain("SECRET");
  expect(JSON.parse(request.mock.calls[1][1].body).p_outcome).toBe("retry");
});
it("rejects cloud configuration in the local command and performs no sends", async () => {
  const request = vi.fn();
  await expect(
    processLocalPush(
      {
        ...values,
        NEXT_PUBLIC_SUPABASE_URL: "https://cloud.supabase.co",
        SUPABASE_SECRET_KEY: "fake",
      },
      request,
    ),
  ).rejects.toThrow("Local configuration required");
  expect(request).not.toHaveBeenCalled();
});
