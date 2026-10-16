import { expect } from "@playwright/test";
import { randomBytes, randomUUID } from "node:crypto";
import webpush from "web-push";
import { processPushDeliveries } from "../../src/lib/push-worker.mjs";
import { localServiceConfig } from "../../scripts/lib/local-service-config.mjs";
import {
  test,
  account,
  checked,
  disposeCareFixtures,
  localClients,
} from "./local-fixtures";

// Real local Auth/PostgREST/SQL, no browser and no requests to a push provider.
// Never record credentials, session objects or subscription encryption keys.
test.use({ trace: "off" });
test("local push: opt-in, private delivery, durable retry and revoked Auth session", async ({
  baseURL,
}) => {
  const { db, client } = localClients(baseURL);
  const staff = client(),
    ownerApi = client(),
    outsiderApi = client();
  const users: string[] = [],
    dogs: string[] = [];
  const endpoint = `https://fcm.googleapis.com/fcm/send/psi-local-mock-${randomUUID()}`;
  const applicationKeys = webpush.generateVAPIDKeys();
  const subscriptionKey = webpush.generateVAPIDKeys().publicKey;
  const apiOrigin = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL!).origin;
  const values = {
    NEXT_PUBLIC_SUPABASE_URL: apiOrigin,
    SUPABASE_SECRET_KEY: process.env.SUPABASE_SECRET_KEY!,
    NEXT_PUBLIC_VAPID_PUBLIC_KEY: applicationKeys.publicKey,
    VAPID_PRIVATE_KEY: applicationKeys.privateKey,
    VAPID_SUBJECT: "https://psipawer.vercel.app",
  };
  let providerStatus = 201;
  const deliveredPayloads: string[] = [];
  const mockSend = async (
    subscription: { endpoint: string },
    payload: string,
  ) => {
    if (subscription.endpoint !== endpoint)
      throw new Error("The mock transport refuses a non-fixture device");
    deliveredPayloads.push(payload);
    return providerStatus;
  };
  const localFetch: typeof fetch = async (input, options) => {
    const target = new URL(
      input instanceof Request ? input.url : String(input),
    );
    if (target.origin !== apiOrigin)
      throw new Error("Push integration refuses external network access");
    return fetch(input, { ...options, redirect: "error" });
  };
  // Always supply mockSend explicitly. The production provider sender is never
  // called, even if an assertion fails or the database contains unexpected data.
  const runWorker = () =>
    processPushDeliveries(
      localServiceConfig(values),
      values,
      localFetch,
      mockSend,
    );
  try {
    const [active, pending] = await Promise.all([
      db
        .from("push_subscriptions")
        .select("id", { count: "exact", head: true })
        .is("disabled_at", null),
      db
        .from("push_deliveries")
        .select("id", { count: "exact", head: true })
        .in("status", ["pending", "retry", "sending"]),
    ]);
    if (active.error || pending.error)
      throw new Error(
        "Local push schema is unavailable; apply the local migration first",
      );
    if (active.count !== 0 || pending.count !== 0)
      throw new Error(
        "Push integration requires no other active local devices or pending jobs",
      );

    const admin = await account(db, users, "admin");
    const owner = await account(db, users, "client");
    const outsider = await account(db, users, "client");
    for (const [api, person] of [
      [staff, admin],
      [ownerApi, owner],
      [outsiderApi, outsider],
    ] as const)
      await checked(
        api.auth.signInWithPassword({
          email: person.email,
          password: person.password,
        }),
      );
    const dog = await checked(
      ownerApi
        .from("dogs")
        .insert({
          guardian_id: owner.id,
          name: `Fikcyjny pies push ${randomUUID().slice(0, 8)}`,
        })
        .select("id")
        .single(),
    );
    if (!dog) throw new Error("Local push fixture dog is missing");
    dogs.push(dog.id);

    const publish = async (version: number) => {
      const result = await checked(
        staff.rpc("save_care_plan", {
          p_dog: dog.id,
          p_expected_version: version,
          p_title: `Fikcyjna publikacja push ${version + 1}`,
          p_body: `Prywatna fikcyjna treść do testu push numer ${version + 1}.`,
          p_follow_up_on: null,
          p_publish: true,
        }),
      );
      if (!result || typeof result.published_id !== "string")
        throw new Error("Local publication did not return an identifier");
      const notice = await checked(
        ownerApi
          .from("notifications")
          .select("id,read_at")
          .eq("recipient_id", owner.id)
          .eq("dog_id", dog.id)
          .eq("kind", "plan_published")
          .eq("entity_id", result.published_id)
          .single(),
      );
      if (!notice)
        throw new Error(
          "Local publication did not create an inbox notification",
        );
      return notice.id as string;
    };

    const archivedNotice = await publish(0);
    const subscriptionId = await checked(
      ownerApi.rpc("save_push_subscription", {
        p_endpoint: endpoint,
        p_p256dh: subscriptionKey,
        p_auth: randomBytes(16).toString("base64url"),
      }),
    );
    if (typeof subscriptionId !== "string")
      throw new Error(
        "Local authenticated opt-in did not return an identifier",
      );
    expect(
      await checked(
        ownerApi.rpc("push_subscription_status", { p_endpoint: endpoint }),
      ),
    ).toBe("enabled");
    expect(
      await checked(
        outsiderApi.rpc("push_subscription_status", { p_endpoint: endpoint }),
      ),
    ).toBe("disabled");
    expect(
      Boolean((await ownerApi.from("push_subscriptions").select("id")).error),
    ).toBe(true);
    expect(
      Boolean(
        (await outsiderApi.rpc("worker_claim_push_deliveries", { p_limit: 1 }))
          .error,
      ),
    ).toBe(true);
    expect(
      await checked(
        outsiderApi.from("notifications").select("id").eq("dog_id", dog.id),
      ),
    ).toEqual([]);

    const jobs = async () =>
      await checked(
        db
          .from("push_deliveries")
          .select("id,notification_id,status,attempts,accepted_at")
          .eq("subscription_id", subscriptionId)
          .order("created_at"),
      );
    expect((await runWorker()).accepted).toBe(0);
    expect(deliveredPayloads).toHaveLength(0);
    expect(await jobs()).toEqual([]);

    const firstNotice = await publish(1);
    expect(await runWorker()).toEqual({
      configured: true,
      accepted: 1,
      retry: 0,
      failed: 0,
      expired: 0,
      skipped: 0,
    });
    expect(deliveredPayloads).toHaveLength(1);
    expect(JSON.parse(deliveredPayloads[0])).toEqual({
      title: "Psi Pawer",
      body: "Masz nową wiadomość w aplikacji.",
      url: "/app/notifications",
      tag: `psi-${firstNotice}`,
    });
    expect(deliveredPayloads[0]).not.toContain("Prywatna fikcyjna treść");
    expect(deliveredPayloads[0]).not.toContain(dog.id);
    expect(await jobs()).toEqual([
      expect.objectContaining({
        notification_id: firstNotice,
        status: "accepted",
        attempts: 1,
        accepted_at: expect.any(String),
      }),
    ]);
    expect((await runWorker()).accepted).toBe(0);
    expect(deliveredPayloads).toHaveLength(1);

    const retryNotice = await publish(2);
    providerStatus = 503;
    expect((await runWorker()).retry).toBe(1);
    const retryJob = (await jobs())!.find(
      (job) => job.notification_id === retryNotice,
    );
    expect(retryJob).toMatchObject({
      status: "retry",
      attempts: 1,
      accepted_at: null,
    });
    const sendsBeforeBackoff = deliveredPayloads.length;
    expect((await runWorker()).retry).toBe(0);
    expect(deliveredPayloads).toHaveLength(sendsBeforeBackoff);
    // Move only this fixture's retry deadline; no sleep or global queue mutation.
    await checked(
      db
        .from("push_deliveries")
        .update({ next_attempt_at: new Date(Date.now() - 60000).toISOString() })
        .eq("id", retryJob!.id)
        .eq("subscription_id", subscriptionId),
    );
    providerStatus = 201;
    expect((await runWorker()).accepted).toBe(1);
    const afterRetry = await jobs();
    expect(afterRetry).toHaveLength(2);
    expect(
      afterRetry!.find((job) => job.notification_id === retryNotice),
    ).toMatchObject({ id: retryJob!.id, status: "accepted", attempts: 2 });
    expect(deliveredPayloads.at(-1)).toBe(deliveredPayloads.at(-2));
    expect(
      afterRetry!.some((job) => job.notification_id === archivedNotice),
    ).toBe(false);

    const cancelledNotice = await publish(3);
    providerStatus = 503;
    expect((await runWorker()).retry).toBe(1);
    const sendsBeforeLogout = deliveredPayloads.length;
    // Intentionally omit the application cleanup RPC. Auth must revoke its real
    // session, and the worker must detect that revocation in auth.sessions.
    const signout = await ownerApi.auth.signOut({ scope: "local" });
    if (signout.error) throw new Error("Local fixture sign-out failed");
    expect((await runWorker()).accepted).toBe(0);
    expect(deliveredPayloads).toHaveLength(sendsBeforeLogout);
    expect(
      (await jobs())!.find((job) => job.notification_id === cancelledNotice),
    ).toMatchObject({ status: "cancelled", attempts: 1 });
    expect(
      await checked(
        db
          .from("push_subscriptions")
          .select("disabled_reason")
          .eq("id", subscriptionId)
          .single(),
      ),
    ).toEqual({ disabled_reason: "logout" });
    const inbox = await checked(
      db
        .from("notifications")
        .select("id,read_at")
        .eq("recipient_id", owner.id)
        .eq("dog_id", dog.id)
        .eq("kind", "plan_published"),
    );
    expect(inbox).toHaveLength(4);
    expect(inbox!.every((notification) => notification.read_at === null)).toBe(
      true,
    );
  } finally {
    for (const api of [staff, ownerApi, outsiderApi]) await api.auth.signOut();
    // Scoped cleanup removes only this test's dog/history and accounts. Profile
    // and notification foreign keys cascade through subscriptions and outbox.
    await disposeCareFixtures(db, users, dogs);
  }
});
