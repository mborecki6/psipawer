import { createClient } from "@supabase/supabase-js";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ session: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/session", () => ({ requireSession: mocks.session }));
vi.mock(
  "@/lib/data/read-retry",
  async () => import("../src/lib/data/read-retry"),
);
vi.mock(
  "@/lib/observability/server-errors",
  async () => import("../src/lib/observability/server-errors"),
);
import { getCareOverview } from "../src/modules/care/queries";

const message = "Nie udało się pobrać planów pracy.";
type Reply = {
  status?: number;
  data?: unknown;
  body?: string;
  error?: Error;
  count?: number;
};
type Captured = { url: URL; method: string; headers: Headers; body: string };

function response(reply: Reply) {
  if (reply.error) throw reply.error;
  return new Response(reply.body ?? JSON.stringify(reply.data), {
    status: reply.status ?? 200,
    headers: {
      "Content-Type": "application/json",
      ...(reply.count === undefined
        ? {}
        : { "Content-Range": `0-10/${reply.count}` }),
    },
  });
}

function fixture({
  role = "admin",
  identity = "PRIVATE identity-a",
  summaries = [{ data: [] }],
  inbox = { data: [], count: 0 },
  inboxGate,
}: {
  role?: "admin" | "client";
  identity?: string;
  summaries?: Reply[];
  inbox?: Reply;
  inboxGate?: Promise<void>;
} = {}) {
  const requests: Captured[] = [];
  const pendingReplies = [...summaries];
  const fetcher = vi.fn(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init);
      const url = new URL(request.url);
      requests.push({
        url,
        method: request.method,
        headers: new Headers(request.headers),
        body: await request.text(),
      });
      if (url.pathname === "/rest/v1/rpc/care_plan_summaries") {
        const next = pendingReplies.shift();
        if (!next) throw new Error("Unexpected extra summary attempt");
        return response(next);
      }
      if (url.pathname === "/rest/v1/care_progress") {
        await inboxGate;
        return response(inbox);
      }
      throw new Error(
        "Unexpected endpoint: no Auth or command requests are permitted",
      );
    },
  );
  const db = createClient("https://care.example.test", "test-publishable-key", {
    accessToken: async () => identity,
    global: { fetch: fetcher },
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
  const rpc = vi.spyOn(db, "rpc");
  return { session: { db, role }, requests, rpc };
}

function install(options: Parameters<typeof fixture>[0] = {}) {
  const test = fixture(options);
  mocks.session.mockResolvedValue(test.session);
  return test;
}

const summaryReads = (test: ReturnType<typeof fixture>) =>
  test.requests.filter((read) =>
    read.url.pathname.endsWith("/rpc/care_plan_summaries"),
  );
const inboxReads = (test: ReturnType<typeof fixture>) =>
  test.requests.filter((read) => read.url.pathname.endsWith("/care_progress"));
const gateway: Reply = { status: 502, body: "PRIVATE Kong upstream body" };

beforeEach(() => {
  mocks.session.mockReset();
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

it.each(["admin", "client"] as const)(
  "preserves normal %s summary rows and the requested pagination using the installed SDK",
  async (role) => {
    const plans = Array.from({ length: 21 }, (_, i) => ({
      id: `plan-${40 + i}`,
    }));
    const progress = Array.from({ length: 11 }, (_, i) => ({
      id: `reply-${20 + i}`,
    }));
    const test = install({
      role,
      summaries: [{ data: plans }],
      inbox: { data: progress, count: 83 },
    });
    const result = await getCareOverview(3, 3);
    expect(result.role).toBe(role);
    expect(result.plans).toEqual(plans.slice(0, 20));
    expect(result.morePlans).toBe(true);
    expect(summaryReads(test)).toHaveLength(1);
    expect(summaryReads(test)[0]).toMatchObject({
      method: "POST",
      body: '{"p_offset":40}',
    });
    if (role === "admin") {
      expect(result.inbox).toEqual(progress.slice(0, 10));
      expect(result.moreInbox).toBe(true);
      expect(result.inboxCount).toBe(83);
      const [read] = inboxReads(test);
      expect(inboxReads(test)).toHaveLength(1);
      expect(read.method).toBe("GET");
      expect(read.url.searchParams.get("reviewed_at")).toBe("is.null");
      expect(read.url.searchParams.get("order")).toBe("created_at.asc,id.asc");
      expect(read.url.searchParams.get("offset")).toBe("20");
      expect(read.url.searchParams.get("limit")).toBe("11");
      expect(read.headers.get("Prefer")).toBe("count=exact");
    } else {
      expect(result.inbox).toEqual([]);
      expect(result.moreInbox).toBe(false);
      expect(result.inboxCount).toBe(0);
      expect(inboxReads(test)).toEqual([]);
    }
    expect(console.error).not.toHaveBeenCalled();
  },
);

it("retries a real SDK summary 502 once with a fresh identical POST while the single inbox read stays parallel", async () => {
  let release!: () => void;
  const inboxGate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const plans = Array.from({ length: 21 }, (_, i) => ({ id: `plan-${i}` }));
  const test = install({
    summaries: [gateway, { data: plans }],
    inbox: { data: [{ id: "reply" }], count: 1 },
    inboxGate,
  });
  const pending = getCareOverview(2, 2);
  await vi.waitFor(() => expect(summaryReads(test)).toHaveLength(2));
  expect(inboxReads(test)).toHaveLength(1);
  expect(test.rpc).toHaveBeenCalledTimes(2);
  expect(test.rpc.mock.results[0].value).not.toBe(
    test.rpc.mock.results[1].value,
  );
  const [first, second] = summaryReads(test);
  expect(first.method).toBe("POST");
  expect(first.body).toBe('{"p_offset":20}');
  expect(second.url.href).toBe(first.url.href);
  expect(second.method).toBe(first.method);
  expect(second.body).toBe(first.body);
  expect([...second.headers]).toEqual([...first.headers]);
  release();
  const result = await pending;
  expect(mocks.session).toHaveBeenCalledTimes(1);
  expect(result.plans).toEqual(plans.slice(0, 20));
  expect(result.morePlans).toBe(true);
  expect(result.inbox).toEqual([{ id: "reply" }]);
  expect(result.inboxCount).toBe(1);
  expect(console.error).toHaveBeenCalledTimes(1);
  expect(JSON.parse(vi.mocked(console.error).mock.calls[0][0])).toEqual({
    event: "data_read_failed",
    operation: "care.summaries",
    retrying: true,
    code: "unclassified",
    status: 502,
  });
  expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toMatch(
    /PRIVATE|identity|Authorization|Kong|upstream/,
  );
});

it("surfaces a persistent 502 after exactly two real SDK POST requests", async () => {
  const test = install({ summaries: [gateway, gateway] });
  await expect(getCareOverview(1, 1)).rejects.toThrow(message);
  expect(summaryReads(test)).toHaveLength(2);
  expect(inboxReads(test)).toHaveLength(1);
  expect(console.error).toHaveBeenCalledTimes(2);
  expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain(
    "PRIVATE",
  );
});

it.each([
  {
    status: 403,
    data: {
      code: "42501",
      message: "PRIVATE policy",
      details: "PRIVATE detail",
      hint: "PRIVATE hint",
    },
  },
  { status: 500, data: { code: "XX000", message: "PRIVATE SQL" } },
  { status: 400, data: { code: "23514", message: "PRIVATE SQL" } },
  { error: new TypeError("PRIVATE network failure") },
])(
  "does not retry a summary denial, SQL error or rejected POST fetch: %j",
  async (reply) => {
    const test = install({ summaries: [reply] });
    await expect(getCareOverview(1, 1)).rejects.toThrow(message);
    expect(summaryReads(test)).toHaveLength(1);
    expect(inboxReads(test)).toHaveLength(1);
    expect(console.error).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain(
      "PRIVATE",
    );
  },
);

it.each([null, {}, { rows: [] }, "PRIVATE non-array", false])(
  "fails closed for a successful non-array RPC payload without retry: %j",
  async (data) => {
    const test = install({ summaries: [{ data }] });
    await expect(getCareOverview(1, 1)).rejects.toThrow(message);
    expect(summaryReads(test)).toHaveLength(1);
    expect(console.error).toHaveBeenCalledTimes(1);
    expect(JSON.parse(vi.mocked(console.error).mock.calls[0][0])).toEqual({
      event: "data_read_failed",
      operation: "care.summaries",
      code: "unclassified",
      status: 200,
    });
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain(
      "PRIVATE",
    );
  },
);

it("keeps an inbox 502 visible after one unchanged GET and does not repeat the successful RPC", async () => {
  const test = install({ inbox: gateway });
  await expect(getCareOverview(1, 1)).rejects.toThrow(message);
  expect(summaryReads(test)).toHaveLength(1);
  expect(inboxReads(test)).toHaveLength(1);
});

it("fails closed if the one gateway retry returns a malformed success", async () => {
  const test = install({ summaries: [gateway, { data: null }] });
  await expect(getCareOverview(1, 1)).rejects.toThrow(message);
  expect(summaryReads(test)).toHaveLength(2);
  expect(inboxReads(test)).toHaveLength(1);
  expect(mocks.session).toHaveBeenCalledTimes(1);
  expect(console.error).toHaveBeenCalledTimes(2);
  expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain(
    "PRIVATE",
  );
});

it("accepts real empty arrays as an empty page without retry", async () => {
  const test = install();
  expect(await getCareOverview(1, 1)).toEqual({
    role: "admin",
    plans: [],
    morePlans: false,
    inbox: [],
    moreInbox: false,
    inboxCount: 0,
  });
  expect(summaryReads(test)).toHaveLength(1);
  expect(inboxReads(test)).toHaveLength(1);
  expect(console.error).not.toHaveBeenCalled();
});

it("keeps each identity's Authorization on both fresh attempts and returns only its own rows", async () => {
  const first = fixture({
    role: "client",
    identity: "PRIVATE first-token",
    summaries: [gateway, { data: [{ id: "first-plan" }] }],
  });
  const second = fixture({
    role: "client",
    identity: "PRIVATE second-token",
    summaries: [gateway, { data: [{ id: "second-plan" }] }],
  });
  mocks.session
    .mockResolvedValueOnce(first.session)
    .mockResolvedValueOnce(second.session);
  const [a, b] = await Promise.all([
    getCareOverview(1, 1),
    getCareOverview(1, 1),
  ]);
  expect(a.plans).toEqual([{ id: "first-plan" }]);
  expect(b.plans).toEqual([{ id: "second-plan" }]);
  for (const [test, token] of [
    [first, "PRIVATE first-token"],
    [second, "PRIVATE second-token"],
  ] as const) {
    expect(summaryReads(test)).toHaveLength(2);
    expect(
      summaryReads(test).map((read) => read.headers.get("Authorization")),
    ).toEqual([`Bearer ${token}`, `Bearer ${token}`]);
    expect(inboxReads(test)).toEqual([]);
    expect(
      test.requests.every(
        (read) => read.url.pathname === "/rest/v1/rpc/care_plan_summaries",
      ),
    ).toBe(true);
  }
  expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toMatch(
    /PRIVATE|token|Authorization/,
  );
});
