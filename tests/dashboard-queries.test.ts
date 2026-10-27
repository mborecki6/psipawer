import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ session: vi.fn(), from: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/session", () => ({ requireSession: mocks.session }));
vi.mock("@/lib/data/queries", async () => import("../src/lib/data/queries"));
import { getDashboardActivities } from "../src/modules/dashboard/queries";

let rows: Record<string, Record<string, unknown>[]>;
let failure: { table: string; from: number } | undefined;
const reads: { table: string; from: number; to: number }[] = [];
const selectedIds: string[][] = [];
beforeEach(() => {
  vi.resetAllMocks();
  rows = {};
  failure = undefined;
  reads.length = 0;
  selectedIds.length = 0;
  mocks.session.mockResolvedValue({ db: { from: mocks.from }, role: "client" });
  mocks.from.mockImplementation((table: string) => {
    let ids: string[] | undefined;
    const builder = {
      select: () => builder,
      order: () => builder,
      in: (_: string, value: string[]) => {
        ids = value;
        selectedIds.push(value);
        return builder;
      },
      range: async (from: number, to: number) => {
        reads.push({ table, from, to });
        if (failure?.table === table && failure.from === from)
          return { data: null, error: { message: "private backend failure" } };
        const data = (rows[table] || []).filter(
          (row) => !ids || ids.includes(row.course_id as string),
        );
        return { data: data.slice(from, to + 1), error: null };
      },
    };
    return builder;
  });
});

it.each([
  "consultations",
  "course_enrollments",
  "fitness_balances",
  "service_requests",
  "course_sessions",
])(
  "loads all %s rows after 500 and 1000 through the guardian session",
  async (table) => {
    rows[table] = Array.from({ length: 1005 }, (_, i) => ({
      id: String(i),
      course_id: "cycle",
    }));
    if (table === "course_sessions")
      rows.course_enrollments = [{ id: "e", course_id: "cycle" }];
    const data = await getDashboardActivities();
    expect(mocks.session).toHaveBeenCalledWith("client");
    expect(reads.filter((read) => read.table === table)).toEqual(
      [0, 500, 1000].map((from) => ({ table, from, to: from + 499 })),
    );
    const field = {
      consultations: "consultations",
      course_enrollments: "enrollments",
      fitness_balances: "fitness",
      service_requests: "requests",
      course_sessions: "courseSessions",
    }[table] as keyof typeof data;
    expect(data[field]).toHaveLength(1005);
  },
);

it("bounds course ID queries and reads schedules only for the guardian's course IDs", async () => {
  rows.course_enrollments = Array.from({ length: 205 }, (_, i) => ({
    id: `e-${i}`,
    course_id: `course-${i}`,
  }));
  rows.course_sessions = [
    ...rows.course_enrollments.map((row) => ({
      id: `s-${row.id}`,
      course_id: row.course_id,
    })),
    { id: "foreign", course_id: "foreign" },
  ];
  const data = await getDashboardActivities();
  expect(selectedIds.map((ids) => ids.length)).toEqual([100, 100, 5]);
  expect(data.courseSessions).toHaveLength(205);
  expect(data.courseSessions.some((session) => session.id === "foreign")).toBe(
    false,
  );
});

it.each([
  "consultations",
  "course_enrollments",
  "fitness_balances",
  "service_requests",
  "course_sessions",
])(
  "does not substitute an empty dashboard when a later %s page fails",
  async (table) => {
    rows[table] = Array.from({ length: 500 }, (_, i) => ({
      id: String(i),
      course_id: "cycle",
    }));
    if (table === "course_sessions")
      rows.course_enrollments = [{ id: "e", course_id: "cycle" }];
    failure = { table, from: 500 };
    await expect(getDashboardActivities()).rejects.toThrow(
      "Nie udało się pobrać danych",
    );
  },
);

it("reads no data before a client session is verified and does not cache another guardian's data", async () => {
  rows.consultations = [{ id: "first" }];
  expect((await getDashboardActivities()).consultations[0].id).toBe("first");
  rows.consultations = [{ id: "second" }];
  expect((await getDashboardActivities()).consultations[0].id).toBe("second");
  reads.length = 0;
  mocks.session.mockRejectedValue(new Error("client-session-required"));
  await expect(getDashboardActivities()).rejects.toThrow(
    "client-session-required",
  );
  expect(reads).toEqual([]);
});
