import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ session: vi.fn(), rpc: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock(
  "@/lib/data/read-retry",
  async () => import("../src/lib/data/read-retry"),
);
vi.mock(
  "@/lib/observability/server-errors",
  async () => import("../src/lib/observability/server-errors"),
);
vi.mock("@/lib/auth/session", () => ({ requireSession: mocks.session }));
vi.mock("@/modules/calendar/booking-queries", () => ({
  getBookingChoices: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("not-found");
  },
}));
import {
  getDogCare,
  getConsultationCare,
  getCarePublication,
  getCourseCare,
  getFitnessCare,
} from "../src/modules/care/queries";
import { getControlInvitation } from "../src/modules/consultations/queries";
const dog = "20000000-0000-4000-8000-000000000001";
const meeting = "80000000-0000-4000-8000-000000000001";
const plan = "30000000-0000-4000-8000-000000000001";
type Reply = {
  data: unknown;
  error: null | { message: string };
  status?: number;
};
const replies: Record<string, Reply[]> = {};
const calls: { table: string; method: string; args: unknown[] }[] = [];
const db = {
  rpc: mocks.rpc,
  from(table: string) {
    calls.push({ table, method: "from", args: [] });
    const q: Record<string, unknown> = {};
    for (const method of [
      "select",
      "eq",
      "in",
      "order",
      "range",
      "limit",
      "maybeSingle",
    ]) {
      q[method] = (...args: unknown[]) => {
        calls.push({ table, method, args });
        return q;
      };
    }
    q.then = (resolve: (v: Reply) => void, reject: (e: unknown) => void) =>
      Promise.resolve(
        replies[table]?.shift() || { data: null, error: null },
      ).then(resolve, reject);
    return q;
  },
};
const ok = (data: unknown): Reply => ({ data, error: null });
afterEach(() => vi.restoreAllMocks());
beforeEach(() => {
  for (const key of Object.keys(replies)) delete replies[key];
  calls.length = 0;
  mocks.session.mockResolvedValue({ db, role: "admin" });
  mocks.rpc.mockReset();
  mocks.rpc.mockImplementation(async (name: string) => ({
    data:
      name === "care_reporting_access" ? { included: true, allowed: true } : [],
    error: null,
  }));
  replies.dogs = [ok({ id: dog, name: "Kluska" })];
});
it("offers only current-owner active/completed fitness and selects the exact requested draft", async () => {
  replies.dogs = [ok({ id: dog, name: "Kluska", guardian_id: "guardian" })];
  replies.care_drafts = [
    ok({ dog_id: dog, fitness_package_id: plan, fitness_session_id: meeting }),
  ];
  const valid = {
    id: plan,
    guardian_id: "guardian",
    status: "active",
    service_name: "Fitness",
    fitness_sessions: [
      { id: meeting, ordinal: 1, status: "scheduled", starts_at: "2030-01-01" },
    ],
  };
  replies.fitness_packages = [
    ok([
      valid,
      { ...valid, id: "old-owner", guardian_id: "previous" },
      { ...valid, id: "cancelled", status: "cancelled" },
    ]),
  ];
  const result = await getDogCare(
    dog,
    1,
    1,
    undefined,
    undefined,
    undefined,
    plan,
    meeting,
  );
  expect(result.fitness).toHaveLength(1);
  expect(result.requestedFitness?.id).toBe(plan);
  expect(result.requestedFitnessSession).toBe(meeting);
  expect(result.draft?.fitness_package_id).toBe(plan);
  expect(calls).toContainEqual({
    table: "care_drafts",
    method: "eq",
    args: ["context_key", `fitness:${plan}:${meeting}`],
  });
});
it("rejects ambiguous or unbooked fitness deep links and does not load choices for a client", async () => {
  const pack = {
    id: plan,
    guardian_id: "guardian",
    status: "active",
    service_name: "Fitness",
    fitness_sessions: [
      { id: meeting, ordinal: 1, status: "pending", starts_at: null },
    ],
  };
  for (const consultation of [undefined, meeting]) {
    replies.dogs = [ok({ id: dog, name: "Kluska", guardian_id: "guardian" })];
    replies.fitness_packages = [ok([pack])];
    await expect(
      getDogCare(dog, 1, 1, consultation, undefined, undefined, plan, meeting),
    ).rejects.toThrow("not-found");
  }
  calls.length = 0;
  replies.dogs = [ok({ id: dog, name: "Kluska" })];
  mocks.session.mockResolvedValue({ db, role: "client" });
  expect((await getDogCare(dog, 1, 1)).fitness).toEqual([]);
  expect(calls.some((c) => c.table === "fitness_packages")).toBe(false);
});
it("pages fitness publications without swallowing read failures or an unavailable package", async () => {
  mocks.rpc.mockResolvedValueOnce({
    data: [
      {
        plans: Array.from({ length: 6 }, (_, n) => ({ id: `plan-${n}` })),
        has_draft: false,
        can_prepare: false,
      },
    ],
    error: null,
  });
  expect(await getFitnessCare(plan, 2)).toMatchObject({
    plans: expect.any(Array),
    more: true,
    hasDraft: false,
    canPrepare: false,
  });
  expect(mocks.rpc).toHaveBeenCalledWith("fitness_care_feed", {
    p_package: plan,
    p_offset: 5,
  });
  mocks.rpc.mockResolvedValueOnce({
    data: null,
    error: { message: "PRIVATE" },
  });
  await expect(getFitnessCare(plan, 1)).rejects.toThrow(
    "Nie udało się pobrać zaleceń fitness",
  );
  mocks.rpc.mockResolvedValueOnce({ data: [], error: null });
  await expect(getFitnessCare(plan, 1)).rejects.toThrow("not-found");
  await expect(getFitnessCare("invalid", 1)).rejects.toThrow("not-found");
});
it("loads only current-guardian accepted courses and selects the exact requested draft", async () => {
  replies.dogs = [ok({ id: dog, name: "Kluska", guardian_id: "guardian" })];
  replies.care_drafts = [
    ok({ dog_id: dog, course_enrollment_id: plan, course_session_id: meeting }),
  ];
  replies.course_enrollments = [
    ok([
      {
        id: plan,
        guardian_id: "guardian",
        courses: {
          id: meeting,
          title: "Kurs",
          status: "open",
          course_sessions: [
            {
              id: meeting,
              ordinal: 1,
              status: "scheduled",
              starts_at: "2030-01-01",
            },
          ],
        },
      },
      {
        id: "previous-owner",
        guardian_id: "other",
        courses: {
          id: meeting,
          title: "Kurs",
          status: "open",
          course_sessions: [],
        },
      },
    ]),
  ];
  const result = await getDogCare(dog, 1, 1, undefined, plan, meeting);
  expect(result.courses).toHaveLength(1);
  expect(result.requestedCourse?.id).toBe(plan);
  expect(result.requestedSession).toBe(meeting);
  expect(result.draft?.course_enrollment_id).toBe(plan);
  expect(calls).toContainEqual({
    table: "care_drafts",
    method: "eq",
    args: ["context_key", `course:${plan}:${meeting}`],
  });
  expect(calls).toContainEqual({
    table: "course_enrollments",
    method: "eq",
    args: ["dog_id", dog],
  });
});
it("rejects unavailable course links for both roles without loading client draft choices", async () => {
  mocks.session.mockResolvedValue({ db, role: "client" });
  await expect(getDogCare(dog, 1, 1, undefined, plan, meeting)).rejects.toThrow(
    "not-found",
  );
  expect(
    calls.some((c) => ["course_enrollments", "care_drafts"].includes(c.table)),
  ).toBe(false);
  mocks.session.mockResolvedValue({ db, role: "admin" });
  replies.dogs = [ok({ id: dog, name: "Kluska" })];
  await expect(getDogCare(dog, 1, 1, undefined, plan, meeting)).rejects.toThrow(
    "not-found",
  );
});
it("rejects ambiguous consultation and course links before reading a draft", async () => {
  await expect(getDogCare(dog, 1, 1, meeting, plan)).rejects.toThrow(
    "not-found",
  );
  expect(calls.some((c) => c.table === "care_drafts")).toBe(false);
});
it("gets independent five-plan pages per course participant without leaking draft state from rendering", async () => {
  mocks.rpc.mockResolvedValue({
    data: [
      {
        enrollment_id: plan,
        has_draft: false,
        plans: Array.from({ length: 6 }, (_, n) => ({ id: `plan-${n}` })),
      },
    ],
    error: null,
  });
  const result = await getCourseCare(meeting, [plan], 2);
  expect(result[plan].plans).toHaveLength(5);
  expect(result[plan].more).toBe(true);
  expect(result[plan].hasDraft).toBe(false);
  expect(mocks.rpc).toHaveBeenCalledWith("course_care_feed", {
    p_course: meeting,
    p_enrollments: [plan],
    p_offset: 5,
  });
  expect(await getCourseCare(meeting, [], 1)).toEqual({});
});
it("makes course-care failures visible and rejects malformed association targets", async () => {
  mocks.rpc.mockResolvedValue({ data: null, error: { message: "PRIVATE" } });
  await expect(getCourseCare(meeting, [plan], 1)).rejects.toThrow(
    "Nie udało się pobrać zaleceń kursowych",
  );
  await expect(getCourseCare(meeting, ["invalid"], 1)).rejects.toThrow(
    "not-found",
  );
});
it("reads a separate blank meeting draft without borrowing the general draft", async () => {
  replies.care_drafts = [ok(null)];
  replies.consultations = [ok([{ id: meeting, status: "completed" }])];
  const data = await getDogCare(dog, 1, 1, meeting);
  expect(data.draft).toBeNull();
  expect(calls).toContainEqual({
    table: "care_drafts",
    method: "eq",
    args: ["context_key", `consultation:${meeting}`],
  });
  expect(data.requestedConsultation?.id).toBe(meeting);
  expect(data.requestedUnavailable).toBe(false);
  expect(calls).toContainEqual({
    table: "consultations",
    method: "eq",
    args: ["dog_id", dog],
  });
  expect(
    calls.every((c) => !["insert", "update", "rpc"].includes(c.method)),
  ).toBe(true);
});
it("never requests draft, library or meeting choices for a guardian, even with a supplied deep link", async () => {
  mocks.rpc.mockResolvedValueOnce({
    data: [
      {
        context_key: `consultation:${meeting}`,
        consultation_id: meeting,
        published_id: plan,
        title: "Published",
      },
    ],
    error: null,
  });
  mocks.session.mockResolvedValue({ db, role: "client" });
  const data = await getDogCare(dog, 1, 1, meeting);
  expect(data.draft).toBeNull();
  expect(data.consultations).toEqual([]);
  expect(data.requestedConsultation).toBeNull();
  expect(
    calls.filter((c) =>
      ["consultations", "care_drafts", "care_templates"].includes(c.table),
    ),
  ).toEqual([]);
});
it.each(["invalid", meeting])(
  "rejects an unavailable requested association %s without mutating a draft",
  async (id) => {
    replies.consultations = [ok([{ id: meeting, status: "cancelled" }])];
    await expect(getDogCare(dog, 1, 1, id)).rejects.toThrow("not-found");
  },
);
it("reads all meeting choices beyond an API page, with a deterministic dog-scoped order", async () => {
  replies.consultations = Array.from({ length: 10 }, () =>
    ok(Array.from({ length: 100 }, () => ({ id: "old", status: "completed" }))),
  );
  replies.consultations.push(ok([{ id: meeting, status: "completed" }]));
  const data = await getDogCare(dog, 1, 1, meeting);
  expect(data.consultations).toHaveLength(1001);
  expect(data.requestedConsultation?.id).toBe(meeting);
  expect(calls).toContainEqual({
    table: "consultations",
    method: "range",
    args: [1000, 1099],
  });
});
it("paginates publications for this consultation and does not disclose draft existence to guardians", async () => {
  mocks.session.mockResolvedValue({ db, role: "client" });
  replies.care_plan_versions = [
    ok(Array.from({ length: 6 }, (_, i) => ({ id: `plan-${i}` }))),
  ];
  const result = await getConsultationCare(meeting, 2);
  expect(result.plans).toHaveLength(5);
  expect(result.more).toBe(true);
  expect(result.hasDraft).toBe(false);
  expect(calls).toContainEqual({
    table: "care_plan_versions",
    method: "eq",
    args: ["consultation_id", meeting],
  });
  expect(calls).toContainEqual({
    table: "care_plan_versions",
    method: "range",
    args: [5, 10],
  });
  expect(calls.some((c) => c.table === "care_drafts")).toBe(false);
});
it("makes lookup failures visible instead of showing an empty publication section", async () => {
  replies.care_plan_versions = [
    { data: null, error: { message: "private database failure" } },
  ];
  await expect(getConsultationCare(meeting, 1)).rejects.toThrow(
    "Nie udało się pobrać zaleceń ze spotkania",
  );
});
it("loads a publication by its own immutable id and marks it historical when a newer plan exists", async () => {
  replies.care_plan_versions = [
    ok({
      id: plan,
      dog_id: dog,
      consultation_id: meeting,
      dogs: { name: "Kluska" },
    }),
    ok({ id: "newer" }),
  ];
  const result = await getCarePublication(plan);
  expect(result.current).toBe(false);
  expect(result.plan.consultation_id).toBe(meeting);
  expect(calls).toContainEqual({
    table: "care_plan_versions",
    method: "eq",
    args: ["id", plan],
  });
  expect(calls.some((c) => c.table === "care_drafts")).toBe(false);
});
it("returns not-found for inaccessible or malformed publication ids", async () => {
  await expect(getCarePublication(plan)).rejects.toThrow("not-found");
  calls.length = 0;
  await expect(getCarePublication("bad")).rejects.toThrow("not-found");
  expect(calls).toHaveLength(0);
});

it("keeps current, history and responses restricted to the selected context", async () => {
  const context = {
    context_key: `consultation:${meeting}`,
    consultation_id: meeting,
    published_id: plan,
    title: "Current",
  };
  mocks.rpc.mockResolvedValueOnce({ data: [context], error: null });
  const result = await getDogCare(dog, 2, 3);
  expect(result.contextKey).toBe(context.context_key);
  expect(
    calls.filter(
      (call) =>
        call.table === "care_plan_versions" &&
        call.method === "eq" &&
        call.args[0] === "context_key",
    ),
  ).toHaveLength(2);
  expect(calls).toContainEqual({
    table: "care_progress",
    method: "eq",
    args: ["care_plan_versions.context_key", context.context_key],
  });
  expect(
    calls.find(
      (call) => call.table === "care_progress" && call.method === "select",
    )?.args[0],
  ).toContain("care_plan_versions!inner(");
});
it("makes a failed context lookup visible instead of selecting another plan", async () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  mocks.rpc.mockResolvedValueOnce({
    data: null,
    error: { message: "PRIVATE" },
  });
  await expect(getDogCare(dog, 1, 1)).rejects.toThrow(
    "Nie udało się pobrać planów psa",
  );
});

it("recovers one actual gateway failure without changing the dog or context and logs no private values", async () => {
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  const context = {
    context_key: `consultation:${meeting}`,
    consultation_id: meeting,
    published_id: plan,
    title: "Current",
  };
  mocks.rpc
    .mockResolvedValueOnce({
      data: null,
      error: {
        message: "PRIVATE body and token",
        details: "PRIVATE link",
        hint: "PRIVATE",
      },
      status: 502,
    })
    .mockResolvedValueOnce({ data: [context], error: null, status: 200 });
  const result = await getDogCare(dog, 1, 1);
  expect(result.contextKey).toBe(context.context_key);
  expect(mocks.rpc.mock.calls).toEqual([
    ["dog_care_contexts", { p_dog: dog }],
    ["dog_care_contexts", { p_dog: dog }],
  ]);
  expect(log).toHaveBeenCalledWith(
    JSON.stringify({
      event: "data_read_failed",
      operation: "care.contexts",
      retrying: true,
      code: "unclassified",
      status: 502,
    }),
  );
  expect(JSON.stringify(log.mock.calls)).not.toMatch(
    /PRIVATE|token|body|hint|link/,
  );
});
it("keeps a persistent gateway failure visible after exactly two context reads", async () => {
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  mocks.rpc.mockResolvedValue({
    data: null,
    error: { message: "PRIVATE" },
    status: 502,
  });
  await expect(getDogCare(dog, 1, 1)).rejects.toThrow(
    "Nie udało się pobrać planów psa",
  );
  expect(mocks.rpc).toHaveBeenCalledTimes(2);
  expect(log).toHaveBeenCalledTimes(2);
  expect(calls.some((c) => c.table === "care_plan_versions")).toBe(false);
});
it.each([
  {
    data: null,
    error: { code: "42501", message: "PRIVATE policy" },
    status: 403,
  },
  {
    data: null,
    error: { code: "PGRST202", message: "PRIVATE RPC" },
    status: 404,
  },
  { data: { unexpected: "PRIVATE" }, error: null, status: 200 },
])(
  "does not hide denied, broken or malformed context reads: $status",
  async (reply) => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.rpc.mockResolvedValue(reply);
    await expect(getDogCare(dog, 1, 1)).rejects.toThrow(
      "Nie udało się pobrać planów psa",
    );
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(log.mock.calls)).not.toContain("PRIVATE");
  },
);

it("opens an owned historical context even when it is absent from the context-list page", async () => {
  mocks.session.mockResolvedValue({ db, role: "client" });
  replies.care_plan_versions = [
    ok({
      id: plan,
      consultation_id: meeting,
      context_key: `consultation:${meeting}`,
    }),
    ok([]),
  ];
  const result = await getDogCare(dog, 1, 1, meeting);
  expect(result.latest?.id).toBe(plan);
  expect(result.contextKey).toBe(`consultation:${meeting}`);
  expect(result.draft).toBeNull();
});

it("retries reporting and invitation reads for the same publication without opening a closed entitlement", async () => {
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  const gateway = {
    data: null,
    error: { message: "PRIVATE gateway" },
    status: 502,
  };
  replies.care_plan_versions = [ok({ id: plan }), ok([])];
  replies.care_control_invitations = [
    gateway,
    ok({ id: meeting, plan_id: plan }),
  ];
  mocks.rpc
    .mockResolvedValueOnce(ok([]))
    .mockResolvedValueOnce(gateway)
    .mockResolvedValueOnce(ok({ included: true, allowed: false }));
  const result = await getDogCare(dog, 1, 1);
  expect(result.reporting).toMatchObject({ included: true, allowed: false });
  expect(result.controlInvitation).toMatchObject({
    id: meeting,
    plan_id: plan,
  });
  expect(mocks.rpc.mock.calls.slice(1)).toEqual([
    ["care_reporting_access", { p_plan: plan }],
    ["care_reporting_access", { p_plan: plan }],
  ]);
  expect(
    calls.filter(
      (c) => c.table === "care_control_invitations" && c.method === "eq",
    ),
  ).toEqual(
    Array.from({ length: 2 }, () => ({
      table: "care_control_invitations",
      method: "eq",
      args: ["plan_id", plan],
    })),
  );
  expect(log).toHaveBeenCalledTimes(2);
  expect(JSON.stringify(log.mock.calls)).not.toContain("PRIVATE");
});

it.each([null, [], { included: true }, { included: true, allowed: "true" }])(
  "keeps malformed reporting data from granting access: %j",
  async (payload) => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    replies.care_plan_versions = [ok({ id: plan }), ok([])];
    mocks.rpc.mockResolvedValueOnce(ok([])).mockResolvedValueOnce(ok(payload));
    await expect(getDogCare(dog, 1, 1)).rejects.toThrow(
      "Nie udało się pobrać zaproszenia i dostępu do raportowania",
    );
    expect(mocks.rpc).toHaveBeenCalledTimes(2);
  },
);

it("retries the guardian invitation read once and leaves a persistent failure visible", async () => {
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  const gateway = { data: null, error: { message: "PRIVATE" }, status: 502 };
  replies.care_control_invitations = [
    gateway,
    ok({ id: meeting, dog_id: dog }),
    gateway,
    gateway,
  ];
  expect(await getControlInvitation(meeting)).toMatchObject({
    id: meeting,
    dog_id: dog,
  });
  expect(mocks.session).toHaveBeenCalledWith("client");
  await expect(getControlInvitation(meeting)).rejects.toThrow(
    "Nie udało się pobrać zaproszenia do kontroli",
  );
  expect(
    calls.filter(
      (c) => c.table === "care_control_invitations" && c.method === "eq",
    ),
  ).toEqual(
    Array.from({ length: 4 }, () => ({
      table: "care_control_invitations",
      method: "eq",
      args: ["id", meeting],
    })),
  );
  expect(log).toHaveBeenCalledTimes(3);
  expect(JSON.stringify(log.mock.calls)).not.toContain("PRIVATE");
});

it("keeps a missing invitation distinct from a transport failure without another request", async () => {
  replies.care_control_invitations = [ok(null)];
  await expect(getControlInvitation(meeting)).rejects.toThrow("not-found");
  expect(
    calls.filter(
      (c) => c.table === "care_control_invitations" && c.method === "from",
    ),
  ).toHaveLength(1);
});
