import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ session: vi.fn(), report: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/session", () => ({ requireSession: mocks.session }));
vi.mock(
  "@/lib/data/read-retry",
  async () => import("../src/lib/data/read-retry"),
);
vi.mock("@/lib/observability/server-errors", () => ({
  reportDataReadError: mocks.report,
}));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("not-found");
  },
}));
import { getDogCare } from "../src/modules/care/queries";

const dog = "20000000-0000-4000-8000-000000000001";
const consultation = "80000000-0000-4000-8000-000000000001";
const publication = "30000000-0000-4000-8000-000000000001";
type Row = Record<string, unknown>;
type Reply = {
  data: unknown;
  error: null | { message: string };
  status?: number;
};
const rows: Record<string, Row[]> = {};
const gates: Record<string, Promise<void>> = {};
const failures = new Set<string>();
const started: { table: string; filters: [string, unknown][] }[] = [];
let contexts: Row[];
let reporting: unknown;

function gate() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

function value(row: Row, key: string): unknown {
  return key
    .split(".")
    .reduce<unknown>((item, part) => (item as Row | undefined)?.[part], row);
}

const db = {
  async rpc(name: string, args: Row): Promise<Reply> {
    started.push({ table: name, filters: Object.entries(args) });
    await gates[name];
    if (failures.has(name))
      return { data: null, error: { message: "PRIVATE failure" }, status: 403 };
    return {
      data: name === "dog_care_contexts" ? contexts : reporting,
      error: null,
    };
  },
  from(table: string) {
    const filters: [string, unknown][] = [];
    const order: { key: string; ascending: boolean }[] = [];
    let range: [number, number] | undefined;
    let limit: number | undefined;
    let single = false;
    const query = {
      select: () => query,
      eq: (key: string, expected: unknown) => {
        filters.push([key, expected]);
        return query;
      },
      order: (key: string, options?: { ascending?: boolean }) => {
        order.push({ key, ascending: options?.ascending !== false });
        return query;
      },
      range: (from: number, to: number) => {
        range = [from, to];
        return query;
      },
      limit: (count: number) => {
        limit = count;
        return query;
      },
      maybeSingle: () => {
        single = true;
        return query;
      },
      then: (
        resolve: (reply: Reply) => unknown,
        reject: (error: unknown) => unknown,
      ) => {
        const read = async (): Promise<Reply> => {
          started.push({ table, filters: [...filters] });
          await gates[table];
          if (failures.has(table))
            return { data: null, error: { message: "PRIVATE failure" } };
          let result = (rows[table] || []).filter((row) =>
            filters.every(([key, expected]) => value(row, key) === expected),
          );
          result = [...result].sort((a, b) => {
            for (const { key, ascending } of order) {
              const left = value(a, key) as string | number;
              const right = value(b, key) as string | number;
              if (left !== right)
                return (left < right ? -1 : 1) * (ascending ? 1 : -1);
            }
            return 0;
          });
          if (range) result = result.slice(range[0], range[1] + 1);
          if (limit !== undefined) result = result.slice(0, limit);
          return { data: single ? result[0] || null : result, error: null };
        };
        return read().then(resolve, reject);
      },
    };
    return query;
  },
};

const general = (history = 1, progress = 1) =>
  getDogCare(
    dog,
    history,
    progress,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    "general",
  );

beforeEach(() => {
  vi.clearAllMocks();
  for (const table of Object.keys(rows)) delete rows[table];
  for (const table of Object.keys(gates)) delete gates[table];
  failures.clear();
  started.length = 0;
  contexts = [
    {
      consultation_id: consultation,
      context_key: `consultation:${consultation}`,
    },
  ];
  reporting = { included: true, allowed: false };
  rows.dogs = [{ id: dog, name: "Kluska", guardian_id: "guardian" }];
  rows.care_plan_versions = [
    { id: publication, dog_id: dog, context_key: "general", revision: 1 },
  ];
  mocks.session.mockResolvedValue({ db, role: "client" });
});

it("waits for the dog, then overlaps explicit general reads with admin metadata and preserves page sentinels", async () => {
  mocks.session.mockResolvedValue({ db, role: "admin" });
  const dogGate = gate(),
    contextGate = gate(),
    libraryGate = gate();
  gates.dogs = dogGate.promise;
  gates.dog_care_contexts = contextGate.promise;
  gates.care_templates = libraryGate.promise;
  rows.care_plan_versions = Array.from({ length: 12 }, (_, i) => ({
    id: `plan-${12 - i}`,
    dog_id: dog,
    context_key: "general",
    revision: 12 - i,
  }));
  rows.care_plan_versions.push({
    id: "other-context",
    dog_id: dog,
    context_key: `consultation:${consultation}`,
    revision: 99,
  });
  rows.care_progress = Array.from({ length: 25 }, (_, i) => ({
    id: `progress-${String(i).padStart(2, "0")}`,
    dog_id: dog,
    created_at: "2030-01-01",
    care_plan_versions: { context_key: "general" },
  }));
  let settled = false;
  const pending = general(2, 2).finally(() => {
    settled = true;
  });
  await vi.waitFor(() => expect(started).toHaveLength(1));
  expect(started[0].table).toBe("dogs");
  dogGate.release();
  await vi.waitFor(() =>
    expect(started.some((read) => read.table === "care_progress")).toBe(true),
  );
  expect(started.map((read) => read.table)).toEqual(
    expect.arrayContaining([
      "dog_care_contexts",
      "care_templates",
      "consultations",
      "course_enrollments",
      "fitness_packages",
      "care_drafts",
    ]),
  );
  expect(settled).toBe(false);
  contextGate.release();
  libraryGate.release();
  const result = await pending;
  expect(result.contextKey).toBe("general");
  expect(result.latest?.id).toBe("plan-12");
  expect(result.history.map((plan) => plan.id)).toEqual([
    "plan-6",
    "plan-5",
    "plan-4",
    "plan-3",
    "plan-2",
  ]);
  expect(result.moreHistory).toBe(true);
  expect(result.progress.map((item) => item.id)).toEqual(
    Array.from({ length: 10 }, (_, i) => `progress-${i + 10}`),
  );
  expect(result.moreProgress).toBe(true);
});

it("keeps implicit context selection behind the context list", async () => {
  const contextGate = gate();
  gates.dog_care_contexts = contextGate.promise;
  rows.care_plan_versions = [
    {
      id: publication,
      dog_id: dog,
      context_key: `consultation:${consultation}`,
      revision: 1,
    },
  ];
  const pending = getDogCare(dog, 1, 1);
  await vi.waitFor(() =>
    expect(started.some((read) => read.table === "dog_care_contexts")).toBe(
      true,
    ),
  );
  expect(started.some((read) => read.table === "care_plan_versions")).toBe(
    false,
  );
  contextGate.release();
  const result = await pending;
  expect(result.contextKey).toBe(`consultation:${consultation}`);
  expect(result.latest?.id).toBe(publication);
});

it.each([false, true])(
  "does not read care data when the dog is unavailable or its read fails (%s)",
  async (failed) => {
    rows.dogs = [];
    if (failed) failures.add("dogs");
    await expect(general()).rejects.toThrow(
      failed ? "Nie udało się pobrać profilu psa" : "not-found",
    );
    expect(started.map((read) => read.table)).toEqual(["dogs"]);
  },
);

it("never loads admin choices or drafts for a client in explicit general", async () => {
  rows.care_drafts = [
    { id: "private-draft", dog_id: dog, context_key: "general" },
  ];
  const result = await general();
  expect(result.draft).toBeNull();
  expect(result.templates).toEqual([]);
  expect(started.map((read) => read.table)).not.toEqual(
    expect.arrayContaining(["care_drafts"]),
  );
  for (const table of [
    "care_templates",
    "consultations",
    "course_enrollments",
    "fitness_packages",
    "care_drafts",
  ])
    expect(started.some((read) => read.table === table)).toBe(false);
});

it.each(["dog_care_contexts", "care_progress"])(
  "keeps %s failures visible despite concurrent general reads",
  async (table) => {
    failures.add(table);
    await expect(general()).rejects.toThrow(
      table === "dog_care_contexts"
        ? "Nie udało się pobrać planów psa"
        : "Nie udało się pobrać planu i postępów",
    );
    expect(started.some((read) => read.table === "care_follow_ups")).toBe(
      false,
    );
  },
);

it("reads control and reporting for the same latest publication while follow-up is pending", async () => {
  const followUpGate = gate();
  gates.care_follow_ups = followUpGate.promise;
  rows.care_follow_ups = [{ id: "follow-up", plan_id: publication }];
  rows.care_control_invitations = [{ id: "invitation", plan_id: publication }];
  const pending = general();
  await vi.waitFor(() =>
    expect(started.some((read) => read.table === "care_reporting_access")).toBe(
      true,
    ),
  );
  expect(started).toContainEqual({
    table: "care_control_invitations",
    filters: [["plan_id", publication]],
  });
  expect(started).toContainEqual({
    table: "care_reporting_access",
    filters: [["p_plan", publication]],
  });
  followUpGate.release();
  const result = await pending;
  expect(result.followUp?.id).toBe("follow-up");
  expect(result.controlInvitation?.id).toBe("invitation");
  expect(result.reporting).toEqual({ included: true, allowed: false });
});

it("keeps a failed follow-up visible after parallel companion reads", async () => {
  failures.add("care_follow_ups");
  await expect(general()).rejects.toThrow(
    "Nie udało się pobrać kontaktu kontrolnego",
  );
});

it("does not request companion records without a publication", async () => {
  rows.care_plan_versions = [];
  const result = await general();
  expect(result.latest).toBeNull();
  expect(result.followUp).toBeNull();
  expect(result.controlInvitation).toBeNull();
  expect(result.reporting).toBeNull();
  for (const table of [
    "care_follow_ups",
    "care_control_invitations",
    "care_reporting_access",
  ])
    expect(started.some((read) => read.table === table)).toBe(false);
});
