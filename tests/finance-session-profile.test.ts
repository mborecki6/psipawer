import { beforeEach, expect, it, vi } from "vitest";
import type { ConsultationBalance } from "../src/lib/finance";

const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  snapshot: vi.fn(),
  from: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/session", () => ({ requireSession: mocks.session }));
vi.mock("@/lib/finance", async () => import("../src/lib/finance"));
vi.mock("../src/lib/data/queries", () => ({ getSnapshot: mocks.snapshot }));
import { getFinanceData } from "../src/lib/data/finance-queries";

const balance: ConsultationBalance = {
  id: "meeting",
  dog_id: "dog",
  status: "scheduled",
  starts_at: "2030-10-10T10:00:00Z",
  created_at: "2030-10-01T10:00:00Z",
  service_name: "Konsultacja",
  agreed_price_cents: 10000,
  is_test_price: true,
  paid_cents: 0,
  due_cents: 10000,
  needs_review: false,
};
let rows: Record<string, unknown[]>;
let failedProfilePage: number | undefined;
const profilePages: [number, number][] = [];

beforeEach(() => {
  vi.resetAllMocks();
  rows = { consultation_balances: [balance] };
  profilePages.length = 0;
  failedProfilePage = undefined;
  mocks.snapshot.mockResolvedValue({
    dogs: [{ id: "dog", name: "Figa", guardian_id: "owner" }],
    walks: [],
    registrations: [],
  });
  mocks.session.mockResolvedValue({
    db: { from: mocks.from },
    role: "client",
    profile: {
      id: "owner",
      full_name: "Alicja Opiekunka",
      phone: "PRIVATE phone",
      area: "PRIVATE area",
    },
  });
  mocks.from.mockImplementation((table: string) => {
    const query = {
      select: () => query,
      eq: () => query,
      order: () => query,
      range: async (from: number, to: number) => {
        if (table === "profiles") {
          profilePages.push([from, to]);
          if (from === failedProfilePage)
            return { data: null, error: { message: "PRIVATE failure" } };
        }
        return { data: (rows[table] || []).slice(from, to + 1), error: null };
      },
    };
    return query;
  });
});

it("uses only the client's verified profile for names without a second profile read or extra profile fields", async () => {
  rows.profiles = [{ id: "foreign", full_name: "PRIVATE foreign person" }];
  const result = await getFinanceData();
  expect(mocks.from).not.toHaveBeenCalledWith("profiles");
  expect(result.dogs).toEqual([
    { id: "dog", name: "Figa", guardianName: "Alicja Opiekunka" },
  ]);
  expect(result.charges[0]).toMatchObject({
    guardianName: "Alicja Opiekunka",
    dueCents: 10000,
    href: "/app/consultations/meeting",
  });
  expect(result.totals.dueCents).toBe(10000);
  expect(JSON.stringify(result)).not.toContain("PRIVATE");

  mocks.session.mockResolvedValue({
    db: { from: mocks.from },
    role: "client",
    profile: { id: "next-owner", full_name: "Bartosz Opiekun" },
  });
  mocks.snapshot.mockResolvedValue({
    dogs: [{ id: "dog", name: "Figa", guardian_id: "next-owner" }],
    walks: [],
    registrations: [],
  });
  const next = await getFinanceData();
  expect(next.charges[0].guardianName).toBe("Bartosz Opiekun");
  expect(JSON.stringify(next)).not.toContain("Alicja Opiekunka");
});

it("retains every client's balance beyond 500 rows while reusing their verified name", async () => {
  rows.consultation_balances = Array.from({ length: 1005 }, (_, i) => ({
    ...balance,
    id: `meeting-${i}`,
  }));
  const result = await getFinanceData();
  expect(result.charges).toHaveLength(1005);
  expect(
    result.charges.every(
      (charge) => charge.guardianName === "Alicja Opiekunka",
    ),
  ).toBe(true);
  expect(result.totals.dueCents).toBe(10050000);
  expect(profilePages).toEqual([]);
});

it("keeps all admin profile pages and resolves a guardian from the last page", async () => {
  mocks.session.mockResolvedValue({
    db: { from: mocks.from },
    role: "admin",
    profile: { id: "staff", full_name: "Prowadząca" },
  });
  mocks.snapshot.mockResolvedValue({
    dogs: [{ id: "dog", name: "Figa", guardian_id: "owner-1004" }],
    walks: [],
    registrations: [],
  });
  rows.profiles = Array.from({ length: 1005 }, (_, i) => ({
    id: `owner-${i}`,
    full_name: `Opiekun ${i}`,
  }));
  const result = await getFinanceData();
  expect(result.charges[0].guardianName).toBe("Opiekun 1004");
  expect(profilePages).toEqual([
    [0, 499],
    [500, 999],
    [1000, 1499],
  ]);
});

it("fails visibly when a later admin profile page fails", async () => {
  mocks.session.mockResolvedValue({ db: { from: mocks.from }, role: "admin" });
  rows.profiles = Array.from({ length: 500 }, (_, i) => ({
    id: `owner-${i}`,
    full_name: `Opiekun ${i}`,
  }));
  failedProfilePage = 500;
  await expect(getFinanceData()).rejects.toThrow(
    "Nie udało się pobrać rozliczeń",
  );
  expect(profilePages).toEqual([
    [0, 499],
    [500, 999],
  ]);
});
