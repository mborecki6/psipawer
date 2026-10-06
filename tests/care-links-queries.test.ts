import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ session: vi.fn(), rpc: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/session", () => ({ requireSession: mocks.session }));
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
const dog = "20000000-0000-4000-8000-000000000001";
const meeting = "80000000-0000-4000-8000-000000000001";
const plan = "30000000-0000-4000-8000-000000000001";
type Reply = { data: unknown; error: null | { message: string } };
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
beforeEach(() => {
  for (const key of Object.keys(replies)) delete replies[key];
  calls.length = 0;
  mocks.session.mockResolvedValue({ db, role: "admin" });
  mocks.rpc.mockReset();
  replies.dogs = [ok({ id: dog, name: "Kluska" })];
});
it("offers only current-owner active/completed fitness packages and never changes the saved draft from a link", async () => {
  replies.dogs = [ok({ id: dog, name: "Kluska", guardian_id: "guardian" })];
  replies.care_drafts = [
    ok({ dog_id: dog, fitness_package_id: "older", fitness_session_id: null }),
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
  expect(result.draft?.fitness_package_id).toBe("older");
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
    const result = await getDogCare(
      dog,
      1,
      1,
      consultation,
      undefined,
      undefined,
      plan,
      meeting,
    );
    expect(result.requestedFitness).toBeNull();
    expect(result.requestedFitnessUnavailable).toBe(true);
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
it("loads only this dog's accepted courses for its current guardian and preserves a saved draft association", async () => {
  replies.dogs = [ok({ id: dog, name: "Kluska", guardian_id: "guardian" })];
  replies.care_drafts = [
    ok({ dog_id: dog, course_enrollment_id: "older", course_session_id: null }),
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
  expect(result.draft?.course_enrollment_id).toBe("older");
  expect(calls).toContainEqual({
    table: "course_enrollments",
    method: "eq",
    args: ["dog_id", dog],
  });
});
it("does not request course choices or drafts for a guardian and flags an unavailable staff deep link", async () => {
  mocks.session.mockResolvedValue({ db, role: "client" });
  const own = await getDogCare(dog, 1, 1, undefined, plan, meeting);
  expect(own.courses).toEqual([]);
  expect(calls.some((c) => c.table === "course_enrollments")).toBe(false);
  mocks.session.mockResolvedValue({ db, role: "admin" });
  replies.dogs = [ok({ id: dog, name: "Kluska" })];
  const staff = await getDogCare(dog, 1, 1, undefined, plan, meeting);
  expect(staff.requestedCourseUnavailable).toBe(true);
  expect(staff.requestedCourse).toBeNull();
});
it("rejects ambiguous consultation and course links without rebinding the existing draft", async () => {
  replies.consultations = [ok([{ id: meeting, status: "completed" }])];
  replies.care_drafts = [ok({ dog_id: dog, consultation_id: meeting })];
  const result = await getDogCare(dog, 1, 1, meeting, plan);
  expect(result.requestedConsultation).toBeNull();
  expect(result.requestedCourse).toBeNull();
  expect(result.requestedUnavailable).toBe(true);
  expect(result.requestedCourseUnavailable).toBe(true);
  expect(result.draft?.consultation_id).toBe(meeting);
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
it("keeps saved draft association while offering a separately validated requested meeting", async () => {
  replies.care_drafts = [
    ok({ dog_id: dog, consultation_id: null, title: "Existing" }),
  ];
  replies.consultations = [ok([{ id: meeting, status: "completed" }])];
  const data = await getDogCare(dog, 1, 1, meeting);
  expect(data.draft?.consultation_id).toBeNull();
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
  "ignores an unavailable requested association %s without mutating a draft",
  async (id) => {
    replies.consultations = [ok([{ id: meeting, status: "cancelled" }])];
    const data = await getDogCare(dog, 1, 1, id);
    expect(data.requestedConsultation).toBeNull();
    expect(data.requestedUnavailable).toBe(true);
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
