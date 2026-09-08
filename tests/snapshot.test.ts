import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ requireSession: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/session", () => ({ requireSession: mocks.requireSession }));
import { getSnapshot } from "../src/lib/data/queries";

type Row = Record<string, string>;
function api(tables: Record<string, Row[]>, failingTable?: string) {
  return {
    from: vi.fn((table: string) => {
      const ordering: string[] = [];
      let start = 0;
      let end = 999;
      const query = {
        select() {
          return query;
        },
        order(column: string) {
          ordering.push(column);
          return query;
        },
        range(from: number, to: number) {
          start = from;
          end = to;
          return query;
        },
        then(
          resolve: (result: { data: Row[] | null; error: unknown }) => unknown,
        ) {
          const rows = [...(tables[table] || [])].sort((a, b) => {
            for (const column of ordering) {
              const comparison = (a[column] || "").localeCompare(
                b[column] || "",
              );
              if (comparison) return comparison;
            }
            return 0;
          });
          const result =
            table === failingTable && start > 0
              ? { data: null, error: { message: "Private API diagnostics" } }
              : {
                  data: rows.slice(start, Math.min(end + 1, start + 1000)),
                  error: null,
                };
          return Promise.resolve(resolve(result));
        },
      };
      return query;
    }),
  };
}

beforeEach(() => vi.clearAllMocks());

it("retains dogs, future walks and accepted registrations beyond one API response", async () => {
  const rows = Array.from({ length: 1007 }, (_, i) => ({
    id: String(i).padStart(5, "0"),
    name: "Pies o tym samym imieniu",
    starts_at: "2030-01-01T10:00:00Z",
    created_at: "2026-01-01T10:00:00Z",
  })).reverse();
  const db = api({
    dogs: rows,
    walks: rows,
    walk_registrations: rows.map((r) => ({
      ...r,
      dog_id: r.id,
      walk_id: r.id,
      status: "accepted",
    })),
  });
  mocks.requireSession.mockResolvedValue({
    db,
    role: "admin",
    user: { id: "tester" },
  });
  const snapshot = await getSnapshot();
  for (const collection of [
    snapshot.dogs,
    snapshot.walks,
    snapshot.registrations,
  ]) {
    expect(collection).toHaveLength(1007);
    expect(new Set(collection.map((r) => r.id)).size).toBe(1007);
    expect(collection[0].id).toBe("00000");
    expect(collection.at(-1)?.id).toBe("01006");
  }
  expect(
    snapshot.registrations.find((r) => r.walk_id === "01006")?.status,
  ).toBe("accepted");
  expect(snapshot).toMatchObject({ role: "admin", userId: "tester" });
});

it("fails the whole snapshot when a later page fails instead of displaying partial counts", async () => {
  const rows = Array.from({ length: 1007 }, (_, i) => ({ id: String(i) }));
  mocks.requireSession.mockResolvedValue({
    db: api(
      { dogs: rows, walks: rows, walk_registrations: rows },
      "walk_registrations",
    ),
    role: "client",
    user: { id: "tester" },
  });
  const outcome = await getSnapshot().then(
    () => "partial success",
    (error: Error) => error.message,
  );
  expect(outcome).toBe("Nie udało się pobrać danych. Spróbuj ponownie.");
});

it("does not read application data without a verified session", async () => {
  mocks.requireSession.mockRejectedValueOnce(new Error("REDIRECT:/login"));
  await expect(getSnapshot()).rejects.toThrow("REDIRECT:/login");
});
