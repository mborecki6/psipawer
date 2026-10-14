import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { beforeAll, beforeEach, afterAll, describe, it, expect } from "vitest";
let db: PGlite;
const owner = "70000000-0000-4000-8000-000000000001";
const other = "70000000-0000-4000-8000-000000000002";
const admin = "70000000-0000-4000-8000-000000000003";
const session = "71000000-0000-4000-8000-000000000001";
const otherSession = "71000000-0000-4000-8000-000000000002";
const adminSession = "71000000-0000-4000-8000-000000000003";
const dog = "72000000-0000-4000-8000-000000000001";
const endpoint = "https://fcm.googleapis.com/fcm/send/device-token";
type Claim = {
  id: string;
  claim_token: string;
  notification_id: string;
  endpoint: string;
};
async function asUser<T>(
  userId: string,
  sessionId: string,
  operation: () => Promise<T>,
) {
  await db.exec("begin; set local role authenticated");
  await db.query(
    "select set_config('request.jwt.claim.sub',$1,true),set_config('request.jwt.claims',$2,true)",
    [userId, JSON.stringify({ session_id: sessionId })],
  );
  try {
    const result = await operation();
    await db.exec("commit");
    return result;
  } catch (error) {
    await db.exec("rollback");
    throw error;
  }
}
async function subscribe(
  userId = owner,
  sessionId = session,
  target = endpoint,
) {
  return asUser(
    userId,
    sessionId,
    async () =>
      (
        await db.query<{ id: string }>(
          "select public.save_push_subscription($1,$2,$3) id",
          [target, "B".repeat(87), "a".repeat(22)],
        )
      ).rows[0].id,
  );
}
async function notice(userId = owner, age = "0 seconds") {
  const id = randomUUID();
  await db.query(
    "insert into public.notifications(id,recipient_id,recipient_role,dog_id,created_at) values($1,$2,$3,$4,clock_timestamp()-$5::interval)",
    [id, userId, userId === admin ? "admin" : "client", dog, age],
  );
  return id;
}
async function claim() {
  return (
    await db.query<Claim>(
      "select * from public.worker_claim_push_deliveries(20)",
    )
  ).rows;
}
async function finish(job: Claim, outcome: string, status = 201) {
  return (
    await db.query<{ done: boolean }>(
      "select public.worker_finish_push_delivery($1,$2,$3,$4) done",
      [job.id, job.claim_token, outcome, status],
    )
  ).rows[0].done;
}
beforeAll(async () => {
  db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create role service_role; create schema auth;
    create type public.app_role as enum('admin','client');
    create table public.profiles(id uuid primary key);
    create table public.user_roles(user_id uuid primary key references public.profiles,role public.app_role);
    create table public.dogs(id uuid primary key,guardian_id uuid references public.profiles);
    create table public.notifications(id uuid primary key,recipient_id uuid references public.profiles,recipient_role public.app_role,dog_id uuid references public.dogs,created_at timestamptz,read_at timestamptz);
    create table auth.sessions(id uuid primary key,user_id uuid,not_after timestamptz);
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    grant usage on schema public,auth to anon,authenticated,service_role;
    grant execute on function auth.uid() to authenticated;`);
  await db.exec(
    readFileSync("supabase/migrations/202610130002_push_delivery.sql", "utf8"),
  );
  await db.query("insert into public.profiles values($1),($2),($3)", [
    owner,
    other,
    admin,
  ]);
  await db.query(
    "insert into public.user_roles values($1,'client'),($2,'client'),($3,'admin')",
    [owner, other, admin],
  );
  await db.query("insert into public.dogs values($1,$2)", [dog, owner]);
});
beforeEach(async () => {
  await db.exec(
    "truncate public.push_subscriptions,public.notifications,auth.sessions cascade",
  );
  await db.query(
    "insert into auth.sessions(id,user_id) values($1,$2),($3,$4),($5,$6)",
    [session, owner, otherSession, other, adminSession, admin],
  );
  await db.query("update public.dogs set guardian_id=$1", [owner]);
});
afterAll(async () => {
  await db?.close();
});

describe.sequential("private push subscriptions and outbox", () => {
  it("never exposes subscription keys or worker functions to authenticated accounts", async () => {
    await subscribe();
    for (const query of [
      "select * from public.push_subscriptions",
      "select * from public.push_deliveries",
      "select * from public.worker_claim_push_deliveries(1)",
    ])
      await expect(
        asUser(owner, session, () => db.exec(query)),
      ).rejects.toThrow(/permission denied/);
    const result = await asUser(other, otherSession, () =>
      db.query<{ status: string }>(
        "select public.push_subscription_status($1) status",
        [endpoint],
      ),
    );
    expect(result.rows[0].status).toBe("disabled");
  });
  it("requires a session and rejects arbitrary, private and credential-bearing endpoints", async () => {
    for (const target of [
      "https://127.0.0.1/send",
      "https://169.254.169.254/send",
      "https://user@fcm.googleapis.com/send",
      "https://example.com/send",
      "http://fcm.googleapis.com/send",
    ])
      await expect(subscribe(owner, session, target)).rejects.toThrow(
        "Nieprawidłowa",
      );
    await expect(subscribe(owner, "")).rejects.toThrow("Zaloguj");
  });
  it("queues only new unread notifications after opt-in and claims once", async () => {
    const historic = await notice(owner, "1 day");
    await subscribe();
    const fresh = await notice();
    const read = await notice();
    await db.query(
      "update public.notifications set read_at=clock_timestamp() where id=$1",
      [read],
    );
    const jobs = await claim();
    expect(jobs.map((j) => j.notification_id)).toEqual([fresh]);
    expect(await claim()).toEqual([]);
    expect(await finish(jobs[0], "accepted")).toBe(true);
    expect(await finish(jobs[0], "accepted")).toBe(false);
    expect(await claim()).toEqual([]);
    expect(
      (
        await db.query("select id from public.notifications where id=$1", [
          historic,
        ])
      ).rows,
    ).toHaveLength(1);
    expect(
      (
        await db.query<{ read_at: string | null }>(
          "select read_at from public.notifications where id=$1",
          [fresh],
        )
      ).rows[0].read_at,
    ).toBeNull();
  });
  it("preserves opt-in time on a repeated save and forbids archive replay after re-enabling", async () => {
    const id = await subscribe();
    // Keep a deterministic timeline around PGlite's millisecond clock:
    // first opt-in < disabled-period notice < renewed opt-in.
    await db.query(
      "update public.push_subscriptions set enabled_at=clock_timestamp()-interval '2 seconds' where id=$1",
      [id],
    );
    const enabledAt = async () =>
      (
        await db.query<{ enabled_at: string }>(
          "select enabled_at from public.push_subscriptions where id=$1",
          [id],
        )
      ).rows[0].enabled_at;
    const firstOptIn = await enabledAt();
    const fresh = await notice();
    expect(await subscribe()).toBe(id);
    expect(await enabledAt()).toBe(firstOptIn);
    expect((await claim()).map((j) => j.notification_id)).toEqual([fresh]);
    await asUser(owner, session, () =>
      db.query("select public.disable_push_subscription($1)", [endpoint]),
    );
    // Give the archive an explicit age: PGlite can record adjacent calls in
    // the same millisecond, which is the valid inclusive opt-in boundary.
    await notice(owner, "1 second");
    await subscribe();
    expect(Date.parse(await enabledAt())).toBeGreaterThan(
      Date.parse(firstOptIn),
    );
    expect(await claim()).toEqual([]);
  });
  it("binds one endpoint to the new account/session and cancels the previous outbox", async () => {
    const previous = await subscribe();
    await notice();
    const [job] = await claim();
    const next = await subscribe(other, otherSession);
    expect(next).not.toBe(previous);
    expect(
      (await db.query("select user_id from public.push_subscriptions")).rows,
    ).toEqual([{ user_id: other }]);
    expect(await finish(job, "accepted")).toBe(false);
    expect(await claim()).toEqual([]);
  });
  it("supports both roles but never delivers to a former guardian", async () => {
    await subscribe();
    await subscribe(
      admin,
      adminSession,
      "https://web.push.apple.com/admin-token",
    );
    await notice();
    const adminNotice = await notice(admin);
    await db.query("update public.dogs set guardian_id=$1", [other]);
    expect((await claim()).map((j) => j.notification_id)).toEqual([
      adminNotice,
    ]);
  });
  it("stops revoked auth sessions even when explicit logout cleanup never ran", async () => {
    await subscribe();
    await notice();
    await db.query("delete from auth.sessions where id=$1", [session]);
    expect(await claim()).toEqual([]);
    expect(
      (await db.query("select disabled_reason from public.push_subscriptions"))
        .rows,
    ).toEqual([{ disabled_reason: "logout" }]);
  });
  it("stops all current-session jobs on logout while keeping another device active", async () => {
    const second = randomUUID();
    await db.query("insert into auth.sessions(id,user_id) values($1,$2)", [
      second,
      owner,
    ]);
    await subscribe();
    await subscribe(
      owner,
      second,
      "https://fcm.googleapis.com/fcm/send/second-device",
    );
    await notice();
    await asUser(owner, session, () =>
      db.query("select public.disable_session_push_subscriptions()"),
    );
    const jobs = await claim();
    expect(jobs).toHaveLength(1);
    expect(jobs[0].endpoint).toContain("second-device");
  });
  it("limits retries to five attempts with backoff and permanent failures stop immediately", async () => {
    await subscribe();
    await notice();
    for (let attempt = 1; attempt <= 5; attempt++) {
      const [job] = await claim();
      expect(job).toBeTruthy();
      expect(await finish(job, "retry", 503)).toBe(true);
      const [state] = (
        await db.query<{ status: string; attempts: number }>(
          "select status,attempts from public.push_deliveries",
        )
      ).rows;
      expect(state.attempts).toBe(attempt);
      expect(state.status).toBe(attempt === 5 ? "failed" : "retry");
      expect(await claim()).toEqual([]);
      await db.exec(
        "update public.push_deliveries set next_attempt_at=clock_timestamp()-interval '1 second'",
      );
    }
    const extra = await notice();
    const [job] = await claim();
    expect(job.notification_id).toBe(extra);
    await finish(job, "failed", 403);
    expect(await claim()).toEqual([]);
    expect(
      (await db.query("select id from public.notifications")).rows,
    ).toHaveLength(2);
  });
  it("disables expired devices and rejects a stale completion token after re-claim", async () => {
    await subscribe();
    await notice();
    const [stale] = await claim();
    await db.exec(
      "update public.push_deliveries set claimed_at=clock_timestamp()-interval '3 minutes'",
    );
    const [current] = await claim();
    expect(current.claim_token).not.toBe(stale.claim_token);
    expect(await finish(stale, "accepted")).toBe(false);
    expect(await finish(current, "expired", 410)).toBe(true);
    await notice();
    expect(await claim()).toEqual([]);
    const status = await asUser(owner, session, () =>
      db.query<{ value: string }>(
        "select public.push_subscription_status($1) value",
        [endpoint],
      ),
    );
    expect(status.rows[0].value).toBe("expired");
  });
});
