import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  from: vi.fn(),
  finance: vi.fn(),
  services: vi.fn(),
  missing: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/session", () => ({ requireSession: mocks.session }));
vi.mock("next/navigation", () => ({ notFound: mocks.missing }));
vi.mock("@/lib/data/finance-queries", () => ({
  getFinanceData: mocks.finance,
}));
vi.mock("@/modules/services/queries", () => ({ getServices: mocks.services }));
vi.mock("@/lib/data/queries", () => ({
  allRows: async (
    query: (
      from: number,
      to: number,
    ) => Promise<{ data: unknown[]; error: unknown }>,
  ) => {
    const data: unknown[] = [];
    for (let a = 0; ; a += 500) {
      const r = await query(a, a + 499);
      if (r.error || !r.data) throw new Error("Read failed");
      data.push(...r.data);
      if (r.data.length < 500) return data;
    }
  },
}));
import {
  getGiftCard,
  getGiftCards,
  getGiftRedemptionData,
  giftPage,
} from "../src/modules/gifts/queries";
const id = "d5000000-0000-4000-8000-000000000001",
  owner = "owner",
  specific = "catalogue";
const card = {
  id,
  beneficiary_id: owner,
  service_id: null,
  balance_cents: 10000,
  usable: true,
};
let rows: Record<string, unknown[]>, failed: string;
const ranges: { table: string; from: number; to: number }[] = [];
beforeEach(() => {
  vi.resetAllMocks();
  ranges.length = 0;
  failed = "";
  rows = {
    gift_card_balances: [card],
    gift_card_ledger: [],
    gift_card_history: [],
    gift_card_codes: [{ code: "PRIVATE" }],
    gift_card_sales: [{ amount_cents: 10000 }],
    profiles: [{ id: owner, full_name: "Opiekun" }],
    user_roles: [{ user_id: owner }],
  };
  mocks.missing.mockImplementation(() => {
    throw new Error("NOT_FOUND");
  });
  mocks.from.mockImplementation((table: string) => {
    const single = () =>
      Promise.resolve({
        data: rows[table]?.[0] || null,
        error: failed === table ? { message: "private" } : null,
      });
    const builder = {
      select: vi.fn(() => builder),
      order: vi.fn(() => builder),
      eq: vi.fn(() => builder),
      maybeSingle: vi.fn(single),
      single: vi.fn(single),
      range: vi.fn(async (a: number, b: number) => {
        ranges.push({ table, from: a, to: b });
        return {
          data: (rows[table] || []).slice(a, b + 1),
          error: failed === table ? { message: "private" } : null,
        };
      }),
    };
    return builder;
  });
  mocks.session.mockResolvedValue({ db: { from: mocks.from }, role: "client" });
  mocks.services.mockResolvedValue({ services: [] });
  mocks.finance.mockResolvedValue({ charges: [] });
});
it("returns client balance and ledger without even querying private codes, sales or staff history", async () => {
  const result = await getGiftCard(id, 1);
  expect(result.code).toBeUndefined();
  expect(result.sale).toBeUndefined();
  expect(result.history).toEqual([]);
  for (const table of [
    "gift_card_codes",
    "gift_card_sales",
    "gift_card_history",
  ])
    expect(mocks.from).not.toHaveBeenCalledWith(table);
});
it("fails closed for an invalid or inaccessible card", async () => {
  await expect(getGiftCard("invalid", 1)).rejects.toThrow("NOT_FOUND");
  expect(mocks.from).not.toHaveBeenCalled();
  rows.gift_card_balances = [];
  await expect(getGiftCard(id, 1)).rejects.toThrow("NOT_FOUND");
  expect(mocks.from).not.toHaveBeenCalledWith("gift_card_codes");
});
it("uses a sentinel for a twenty-row list and preserves the requested next-page range", async () => {
  rows.gift_card_balances = Array.from({ length: 41 }, (_, i) => ({
    ...card,
    id: `card-${i}`,
  }));
  const result = await getGiftCards(2);
  expect(result.cards).toHaveLength(20);
  expect(result.more).toBe(true);
  expect(ranges).toEqual([{ table: "gift_card_balances", from: 20, to: 40 }]);
});
it("fails visibly on ledger errors instead of presenting an empty history", async () => {
  failed = "gift_card_ledger";
  await expect(getGiftCard(id, 1)).rejects.toThrow(
    "Nie udało się pobrać historii",
  );
});
it("requires every private staff read before presenting a complete card for printing", async () => {
  mocks.session.mockResolvedValue({ db: { from: mocks.from }, role: "admin" });
  for (const table of [
    "gift_card_history",
    "gift_card_codes",
    "gift_card_sales",
  ]) {
    failed = table;
    await expect(getGiftCard(id, 1)).rejects.toThrow(
      "Nie udało się pobrać historii",
    );
  }
});
it("selects only payable debts of the frozen card guardian, including another dog's debt", async () => {
  mocks.session.mockResolvedValue({ db: { from: mocks.from }, role: "admin" });
  mocks.finance.mockResolvedValue({
    charges: [
      {
        id: "a",
        kind: "fitness",
        guardianId: owner,
        dogId: "original-dog",
        canPay: true,
        dueCents: 10000,
      },
      {
        id: "b",
        kind: "fitness",
        guardianId: owner,
        dogId: "another-dog",
        canPay: true,
        dueCents: 4000,
      },
      {
        id: "c",
        kind: "fitness",
        guardianId: "foreign",
        canPay: true,
        dueCents: 10000,
      },
      {
        id: "d",
        kind: "fitness",
        guardianId: owner,
        canPay: false,
        dueCents: 10000,
      },
    ],
  });
  const result = await getGiftRedemptionData(card);
  expect(result.charges.map((c) => c.id)).toEqual(["a", "b"]);
});
it("uses real service identifiers and explicit links rather than matching equal prices or names", async () => {
  mocks.session.mockResolvedValue({ db: { from: mocks.from }, role: "admin" });
  mocks.services.mockResolvedValue({
    services: [{ id: specific, kind: "group", active: false }],
  });
  mocks.finance.mockResolvedValue({
    charges: [
      {
        id: "consult",
        kind: "consultation",
        guardianId: owner,
        canPay: true,
        dueCents: 10000,
      },
      {
        id: "walk",
        kind: "registration",
        guardianId: owner,
        canPay: true,
        dueCents: 10000,
      },
      {
        id: "bound",
        kind: "registration",
        guardianId: owner,
        canPay: true,
        dueCents: 10000,
      },
      {
        id: "wrong",
        kind: "registration",
        guardianId: owner,
        canPay: true,
        dueCents: 10000,
      },
    ],
  });
  rows.consultations = [{ id: "consult", service_id: "unrelated" }];
  rows.gift_card_service_links = [
    {
      registration_id: "bound",
      package_id: null,
      service_id: specific,
      version: 1,
    },
    {
      registration_id: "wrong",
      package_id: null,
      service_id: "unrelated",
      version: 1,
    },
  ];
  const result = await getGiftRedemptionData({ ...card, service_id: specific });
  expect(
    result.charges.map((c) => ({ id: c.id, needsBinding: c.needsBinding })),
  ).toEqual([
    { id: "walk", needsBinding: true },
    { id: "bound", needsBinding: false },
    { id: "wrong", needsBinding: true },
  ]);
  const correction = result.charges.find((c) => c.id === "wrong")!;
  expect(correction.bindingVersion).toBe(1);
  expect(correction.boundServiceName).toBe("wcześniej wskazana usługa");
  expect(result.charges.find((c) => c.id === "walk")!.bindingVersion).toBe(0);
});
it("recognizes a course's catalogue service through its enrollment rather than a free-form title", async () => {
  mocks.session.mockResolvedValue({ db: { from: mocks.from }, role: "admin" });
  mocks.finance.mockResolvedValue({
    charges: [
      {
        id: "enrollment",
        kind: "course",
        guardianId: owner,
        canPay: true,
        dueCents: 10000,
      },
    ],
  });
  rows.course_enrollments = [{ id: "enrollment", course_id: "cycle" }];
  rows.courses = [{ id: "cycle", service_id: specific }];
  expect(
    (await getGiftRedemptionData({ ...card, service_id: specific })).charges,
  ).toHaveLength(1);
});
it("normalizes invalid pagination inputs without accepting unbounded offsets", () => {
  for (const value of [undefined, "0", "-1", "1.5", "100000", "all"])
    expect(giftPage(value)).toBe(1);
  expect(giftPage("2")).toBe(2);
});
