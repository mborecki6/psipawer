import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Dog, Registration, Walk } from "../src/lib/data/types";
import type {
  ConsultationBalance,
  CourseBalance,
  FinanceData,
  PackageRecord,
  PackageTransaction,
  PaymentRecord,
} from "../src/lib/finance";
import type { FitnessBalance } from "../src/modules/fitness/types";

const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  snapshot: vi.fn(),
  from: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/session", () => ({ requireSession: mocks.session }));
vi.mock("@/lib/finance", async () => import("../src/lib/finance"));
vi.mock("../src/lib/data/queries", () => ({ getSnapshot: mocks.snapshot }));
vi.mock("@/lib/data/queries", () => ({ getSnapshot: mocks.snapshot }));
vi.mock(
  "@/lib/data/finance-queries",
  async () => import("../src/lib/data/finance-queries"),
);
vi.mock("@/lib/domain", async () => import("../src/lib/domain"));
vi.mock(
  "@/lib/finance-pagination",
  async () => import("../src/lib/finance-pagination"),
);
vi.mock("@/lib/qualification", async () => import("../src/lib/qualification"));
vi.mock("@/components/ui", async () => import("../src/components/ui"));
vi.mock(
  "@/components/qualification-alert",
  async () => import("../src/components/qualification-alert"),
);
vi.mock("@/modules/calendar/queries", () => ({
  getNextAppointment: async () => null,
}));
vi.mock("@/modules/calendar/next-appointment", () => ({
  NextAppointment: () => null,
}));
vi.mock("@/modules/work/queries", () => ({
  getWorkQueue: async () => ({ items: [], counts: [] }),
}));
vi.mock("@/modules/work/views", () => ({ WorkPreview: () => null }));
import {
  getDashboardFinanceSummary,
  getFinanceData,
} from "../src/lib/data/finance-queries";
import ClientPage from "../src/app/app/page";
import AdminPage from "../src/app/admin/page";

const now = Date.parse("2030-01-10T12:00:00Z");
const at = "2030-01-01T10:00:00Z";
const needed = [
  "packages",
  "package_transactions",
  "payments",
  "consultation_balances",
  "course_balances",
  "fitness_balances",
] as const;
type Source = (typeof needed)[number];
type Role = "client" | "admin";
type Row = Record<string, unknown>;
let rows: Record<string, unknown[]>;
let failed: { table: string; from: number } | undefined;
const reads: { table: string; from: number; to: number }[] = [];
const dog = {
  id: "dog",
  name: "Figa",
  guardian_id: "owner",
  status: "approved",
} as Dog;
const walk = {
  id: "walk",
  type: "Spacer",
  public_location: "Park",
  starts_at: "2031-01-01T12:00:00Z",
  price_cents: 6000,
  capacity: 8,
  status: "open",
} as Walk;
const registration = (
  id: string,
  overrides: Partial<Registration> = {},
): Registration => ({
  id,
  walk_id: walk.id,
  dog_id: dog.id,
  status: "accepted",
  payment_status: "due",
  attendance: "pending",
  package_id: null,
  decision_note: null,
  cancellation_free_until: null,
  created_at: at,
  ...overrides,
});
const pack = (
  id: string,
  overrides: Partial<PackageRecord> = {},
): PackageRecord => ({
  id,
  dog_id: dog.id,
  name: id,
  price_cents: 0,
  purchased_at: at,
  expires_at: null,
  status: "active",
  ...overrides,
});
const transaction = (
  id: string,
  package_id: string,
  available_delta: number,
  reserved_delta = 0,
  used_delta = 0,
): PackageTransaction => ({
  id,
  package_id,
  available_delta,
  reserved_delta,
  used_delta,
  reason: "Operacja",
  registration_id: null,
  created_at: at,
});
const payment = (
  id: string,
  amount_cents: number,
  overrides: Partial<PaymentRecord> = {},
): PaymentRecord => ({
  id,
  guardian_id: "owner",
  dog_id: dog.id,
  registration_id: null,
  package_id: null,
  amount_cents,
  status: "paid",
  method: "transfer",
  paid_at: null,
  created_at: at,
  note: null,
  ...overrides,
});
const consultation = (id: string, due_cents = 0): ConsultationBalance => ({
  id,
  dog_id: dog.id,
  status: "scheduled",
  starts_at: walk.starts_at,
  created_at: at,
  service_name: "Konsultacja",
  agreed_price_cents: 12000,
  is_test_price: true,
  paid_cents: 12000 - due_cents,
  due_cents,
  needs_review: false,
});
const course = (
  id: string,
  overrides: Partial<CourseBalance> = {},
): CourseBalance => ({
  id,
  course_id: `course-${id}`,
  dog_id: dog.id,
  guardian_id: "owner",
  course_title: "Kurs",
  service_name: "Kurs",
  course_status: "open",
  status: "accepted",
  version: 1,
  agreed_price_cents: 10000,
  charge_cents: 10000,
  is_test_price: true,
  created_at: at,
  starts_at: walk.starts_at,
  settled_at: null,
  paid_cents: 10000,
  refunded_cents: 0,
  due_cents: 0,
  refund_due_cents: 0,
  needs_settlement: false,
  needs_review: false,
  can_pay: false,
  ...overrides,
});
const fitness = (
  id: string,
  overrides: Partial<FitnessBalance> = {},
): FitnessBalance => ({
  id,
  dog_id: dog.id,
  guardian_id: "owner",
  service_name: "Fitness",
  status: "active",
  version: 1,
  agreed_price_cents: 10000,
  is_test_price: true,
  sessions_count: 4,
  duration_minutes: 30,
  settled_at: null,
  charge_cents: 10000,
  paid_cents: 10000,
  refunded_cents: 0,
  completed_sessions: 0,
  due_cents: 0,
  refund_due_cents: 0,
  can_pay: false,
  needs_review: false,
  needs_settlement: false,
  created_at: at,
  next_starts_at: walk.starts_at,
  ...overrides,
});

function session(role: Role) {
  mocks.session.mockResolvedValue({
    db: { from: mocks.from },
    role,
    profile: { id: role === "admin" ? "staff" : "owner", full_name: "Opiekun" },
  });
}

function populate() {
  mocks.snapshot.mockResolvedValue({
    dogs: [dog],
    walks: [walk, { ...walk, id: "cancelled-walk", status: "cancelled" }],
    registrations: [
      registration("partial"),
      registration("restored"),
      registration("cancelled", { walk_id: "cancelled-walk" }),
      registration("absent", { attendance: "absent" }),
      registration("on-time", { status: "cancelled_on_time" }),
      registration("package-booking", {
        package_id: "package-new",
        payment_status: "none",
      }),
    ],
  });
  rows = {
    profiles: [{ id: "owner", full_name: "Opiekun" }],
    packages: [
      pack("package-old", { name: "Starszy aktywny", price_cents: 8000 }),
      pack("package-cancelled", {
        name: "Anulowany",
        price_cents: 9000,
        status: "cancelled",
        purchased_at: "2030-01-02T10:00:00Z",
      }),
      pack("package-expired", {
        name: "Wygasły",
        price_cents: 5000,
        expires_at: new Date(now).toISOString(),
        purchased_at: "2030-01-03T10:00:00Z",
      }),
      pack("package-new", {
        name: "Nowszy aktywny",
        price_cents: 10000,
        purchased_at: "2030-01-04T10:00:00Z",
      }),
    ],
    package_transactions: [
      transaction("n-buy", "package-new", 4),
      transaction("n-reserve", "package-new", -1, 1),
      transaction("n-use", "package-new", 0, -1, 1),
      transaction("n-reserve-again", "package-new", -1, 1),
      transaction("n-restore", "package-new", 1, -1),
      transaction("o-buy", "package-old", 2),
      transaction("o-reserve", "package-old", -1, 1),
      transaction("e-buy", "package-expired", 6),
      transaction("e-reserve", "package-expired", -1, 1),
      transaction("c-buy", "package-cancelled", 2),
      transaction("c-cancel", "package-cancelled", -2),
    ],
    payments: [
      payment("p-partial", 2000, { registration_id: "partial" }),
      payment("p-restored", 1000, { registration_id: "restored" }),
      payment("p-new", 4000, { package_id: "package-new" }),
      payment("p-old", 8000, { package_id: "package-old" }),
      payment("p-expired", 1000, { package_id: "package-expired" }),
      payment("p-course", 3000, { course_enrollment_id: "course-debt" }),
      payment("p-course-review", 10000, {
        course_enrollment_id: "course-review",
      }),
      payment("p-course-refund", 10000, {
        course_enrollment_id: "course-refund",
      }),
      payment("p-fitness-card", 7000, {
        fitness_package_id: "fitness-debt",
        gift_card_id: "gift",
        method: "gift_card",
      }),
      payment("p-fitness-review", 10000, {
        fitness_package_id: "fitness-review",
      }),
      payment("p-consultation", 7000, { consultation_id: "consultation-debt" }),
      payment("p-refunded", 999, {
        registration_id: "partial",
        status: "refunded",
      }),
    ],
    consultation_balances: [
      consultation("consultation-debt", 5000),
      {
        ...consultation("consultation-cancelled"),
        status: "cancelled",
        needs_review: true,
      },
    ],
    course_balances: [
      course("course-debt", {
        paid_cents: 3000,
        due_cents: 7000,
        can_pay: true,
      }),
      course("course-review", {
        status: "cancelled",
        needs_review: true,
        needs_settlement: true,
      }),
      course("course-refund", { refund_due_cents: 2000, needs_review: true }),
    ],
    fitness_balances: [
      fitness("fitness-debt", {
        paid_cents: 7000,
        due_cents: 3000,
        can_pay: true,
      }),
      fitness("fitness-review", {
        status: "cancelled",
        refund_due_cents: 1500,
        needs_review: true,
      }),
    ],
    course_payment_refunds: [
      {
        id: "course-return",
        payment_id: "p-course-review",
        enrollment_id: "course-review",
        amount_cents: 3000,
        note: "Uzgodniony zwrot",
        created_at: at,
      },
      {
        id: "course-partial-return",
        payment_id: "p-course-refund",
        enrollment_id: "course-refund",
        amount_cents: 2000,
        note: "Częściowy zwrot",
        created_at: at,
      },
    ],
    fitness_payment_refunds: [
      {
        id: "credit-return",
        payment_id: "p-fitness-card",
        package_id: "fitness-debt",
        amount_cents: 1000,
        note: "Zwrot na kartę",
        created_at: at,
      },
      {
        id: "fitness-return",
        payment_id: "p-fitness-review",
        package_id: "fitness-review",
        amount_cents: 1500,
        note: "Zwrot gotówki",
        created_at: at,
      },
    ],
    gift_card_sales: [
      {
        card_id: "gift",
        amount_cents: 10000,
        method: "transfer",
        note: "Sprzedaż karty",
        created_at: at,
        gift_cards: {
          sender_label: "PRIVATE sender",
          recipient_label: "PRIVATE recipient",
        },
      },
    ],
    gift_card_ledger: [
      { card_id: "gift", kind: "cash_refund", delta_cents: -4000 },
    ],
  };
}

function project(data: FinanceData) {
  return {
    chargeCount: data.charges.length,
    totals: {
      dueCents: data.totals.dueCents,
      availableEntries: data.totals.availableEntries,
      reservedEntries: data.totals.reservedEntries,
    },
    packages: data.packages.map(
      ({ id, dogName, name, status, available, reserved, used }) => ({
        id,
        dogName,
        name,
        status,
        available,
        reserved,
        used,
      }),
    ),
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.spyOn(Date, "now").mockReturnValue(now);
  failed = undefined;
  reads.length = 0;
  session("client");
  populate();
  mocks.from.mockImplementation((table: string) => {
    const filters: [string, unknown][] = [];
    const orders: string[] = [];
    const query = {
      select: () => query,
      eq: (key: string, value: unknown) => {
        filters.push([key, value]);
        return query;
      },
      order: (key: string) => {
        orders.push(key);
        return query;
      },
      range: async (from: number, to: number) => {
        reads.push({ table, from, to });
        if (failed?.table === table && failed.from === from)
          return { data: null, error: { message: "PRIVATE failure" } };
        const result = (rows[table] || []).filter((row) =>
          filters.every(([key, value]) => (row as Row)[key] === value),
        );
        result.sort((a, b) => {
          for (const key of orders) {
            const left = (a as Row)[key] as string;
            const right = (b as Row)[key] as string;
            if (left !== right) return left < right ? -1 : 1;
          }
          return 0;
        });
        return { data: result.slice(from, to + 1), error: null };
      },
    };
    return query;
  });
});
afterEach(() => vi.restoreAllMocks());

it.each<Role>(["client", "admin"])(
  "keeps exact %s dashboard values while full finance retains refunds, gift credits and cash history",
  async (role) => {
    session(role);
    const full = await getFinanceData();
    const summary = await getDashboardFinanceSummary();
    expect(summary).toEqual(project(full));
    expect(summary.chargeCount).toBe(10);
    expect(summary.totals).toEqual({
      dueCents: 34000,
      availableEntries: 4,
      reservedEntries: 2,
    });
    expect(summary.packages).toEqual([
      {
        id: "package-new",
        dogName: "Figa",
        name: "Nowszy aktywny",
        status: "active",
        available: 3,
        reserved: 0,
        used: 1,
      },
      {
        id: "package-expired",
        dogName: "Figa",
        name: "Wygasły",
        status: "expired",
        available: 5,
        reserved: 1,
        used: 0,
      },
      {
        id: "package-cancelled",
        dogName: "Figa",
        name: "Anulowany",
        status: "cancelled",
        available: 0,
        reserved: 0,
        used: 0,
      },
      {
        id: "package-old",
        dogName: "Figa",
        name: "Starszy aktywny",
        status: "active",
        available: 1,
        reserved: 1,
        used: 0,
      },
    ]);
    expect(
      full.charges
        .filter((charge) => charge.dueCents === 0)
        .map((charge) => charge.id)
        .sort(),
    ).toEqual(["course-refund", "course-review", "fitness-review"]);
    expect(full.payments).toHaveLength(role === "admin" ? 13 : 12);
    expect(full.totals.paidCents).toBe(role === "admin" ? 55500 : 49500);
    expect(full.payments.find((p) => p.id === "p-course-review")).toMatchObject(
      {
        refundedCents: 3000,
        remainingCents: 7000,
        refunds: [expect.objectContaining({ id: "course-return" })],
      },
    );
    expect(full.payments.find((p) => p.id === "p-fitness-card")).toMatchObject({
      giftCardId: "gift",
      refundedCents: 1000,
      remainingCents: 6000,
    });
    expect(Object.keys(summary).sort()).toEqual([
      "chargeCount",
      "packages",
      "totals",
    ]);
    expect(JSON.stringify(summary)).not.toMatch(
      /paidCents|payments|refunds|PRIVATE/,
    );
  },
);

it.each<Role>(["client", "admin"])(
  "removes only unused reads for the %s dashboard",
  async (role) => {
    session(role);
    await getFinanceData();
    const fullReads = reads.length;
    expect(fullReads).toBe(role === "admin" ? 11 : 8);
    reads.length = 0;
    await getDashboardFinanceSummary();
    expect(reads.map((read) => read.table).sort()).toEqual([...needed].sort());
    expect(fullReads - reads.length).toBe(role === "admin" ? 5 : 2);
  },
);

it("renders the client amounts, active package order and focused links while preserving every registration", async () => {
  const html = renderToStaticMarkup(await ClientPage());
  expect(html).toContain("4 dostępnych wejść · 2 zarezerwowanych");
  expect(html).toContain("340,00");
  expect(html).toContain("3 dostępnych · 0 zarezerwowanych · 1 wykorzystanych");
  expect(html).toContain(
    'href="/app/finance?package=package-new#package-package-new"',
  );
  expect(html).toContain(
    'href="/app/finance?package=package-old#package-package-old"',
  );
  expect(html.indexOf("Nowszy aktywny")).toBeLessThan(
    html.indexOf("Starszy aktywny"),
  );
  expect(html).not.toContain("Wygasły");
  expect(html).not.toContain("Anulowany");
  expect(html.match(/class="list-row" href="\/app\/walks\//g)).toHaveLength(6);
});

it("renders the admin count including three zero-debt review items and the original finance destination", async () => {
  session("admin");
  const html = renderToStaticMarkup(await AdminPage());
  expect(html).toMatch(
    /Do rozliczenia<\/span>[\s\S]*?<strong class="kpi-value">10<\/strong>/,
  );
  expect(html).toContain("4 wolnych wejść w pakietach");
  expect(html).toContain('href="/admin/finance"');
});

it("preserves empty summaries and both dashboard empty states", async () => {
  rows = {};
  mocks.snapshot.mockResolvedValue({ dogs: [], walks: [], registrations: [] });
  expect(await getDashboardFinanceSummary()).toEqual({
    chargeCount: 0,
    packages: [],
    totals: { dueCents: 0, availableEntries: 0, reservedEntries: 0 },
  });
  const client = renderToStaticMarkup(await ClientPage());
  expect(client).toContain("Nie macie jeszcze aktywnego pakietu");
  expect(client).not.toContain("Do rozliczenia:");
  session("admin");
  const admin = renderToStaticMarkup(await AdminPage());
  expect(admin).toMatch(
    /Do rozliczenia<\/span>[\s\S]*?<strong class="kpi-value">0<\/strong>/,
  );
});

it.each<Source>(needed)(
  "includes meaningful %s entries after both 500 and 1000 without truncating input",
  async (table) => {
    rows = {};
    mocks.snapshot.mockResolvedValue({
      dogs: [dog],
      walks: [],
      registrations: [],
    });
    let count = 0,
      due = 0,
      available = 0,
      reserved = 0;
    if (table === "packages") {
      rows.packages = Array.from({ length: 1005 }, (_, i) =>
        pack(`p-${String(i).padStart(4, "0")}`, {
          status: i === 1004 ? "active" : "cancelled",
          price_cents: 10000,
        }),
      );
      count = 1;
      due = 10000;
    } else if (table === "package_transactions") {
      rows.packages = [pack("target")];
      rows.package_transactions = Array.from({ length: 1005 }, (_, i) =>
        transaction(
          `t-${String(i).padStart(4, "0")}`,
          "target",
          i === 500 ? 1 : i === 1000 ? -1 : i === 1004 ? 2 : 0,
          i === 1000 ? 1 : 0,
        ),
      );
      available = 2;
      reserved = 1;
    } else if (table === "payments") {
      rows.packages = [pack("target", { price_cents: 100000 })];
      rows.payments = Array.from({ length: 1005 }, (_, i) =>
        payment(`p-${String(i).padStart(4, "0")}`, i === 1004 ? 5000 : 1, {
          package_id: "target",
        }),
      );
      count = 1;
      due = 93996;
    } else if (table === "consultation_balances") {
      rows[table] = Array.from({ length: 1005 }, (_, i) =>
        consultation(
          `c-${String(i).padStart(4, "0")}`,
          i === 500 ? 200 : i === 1000 ? 300 : i === 1004 ? 400 : 0,
        ),
      );
      count = 3;
      due = 900;
    } else {
      const make = table === "course_balances" ? course : fitness;
      rows[table] = Array.from({ length: 1005 }, (_, i) =>
        make(`item-${String(i).padStart(4, "0")}`, {
          due_cents: i === 500 ? 200 : i === 1004 ? 400 : 0,
          needs_review: i === 1000,
        }),
      );
      count = 3;
      due = 600;
    }
    const summary = await getDashboardFinanceSummary();
    expect(summary.chargeCount).toBe(count);
    expect(summary.totals).toEqual({
      dueCents: due,
      availableEntries: available,
      reservedEntries: reserved,
    });
    if (table === "packages") expect(summary.packages).toHaveLength(1005);
    expect(reads.filter((read) => read.table === table)).toEqual(
      [0, 500, 1000].map((from) => ({ table, from, to: from + 499 })),
    );
  },
);

it.each(
  needed.flatMap((table) => [0, 500, 1000].map((from) => ({ table, from }))),
)(
  "does not invent a zero summary when $table page $from fails",
  async ({ table, from }) => {
    rows[table] = Array.from({ length: from }, (_, i) => ({
      id: String(i).padStart(4, "0"),
    }));
    failed = { table, from };
    await expect(getDashboardFinanceSummary()).rejects.toThrow(
      "Nie udało się pobrać rozliczeń",
    );
  },
);

it("uses each verified session's client and snapshot without retaining another client's result", async () => {
  expect((await getDashboardFinanceSummary()).packages[0].dogName).toBe("Figa");
  mocks.session.mockResolvedValue({
    db: { from: mocks.from },
    role: "client",
    profile: { id: "second", full_name: "Drugi opiekun" },
  });
  mocks.snapshot.mockResolvedValue({
    dogs: [{ ...dog, id: "second-dog", name: "Luna", guardian_id: "second" }],
    walks: [],
    registrations: [],
  });
  rows = {
    packages: [
      pack("second-package", { dog_id: "second-dog", price_cents: 1234 }),
    ],
  };
  const next = await getDashboardFinanceSummary();
  expect(next.chargeCount).toBe(1);
  expect(next.totals.dueCents).toBe(1234);
  expect(next.packages[0].dogName).toBe("Luna");
  expect(JSON.stringify(next)).not.toMatch(/Figa|package-new/);
  reads.length = 0;
  mocks.session.mockRejectedValue(new Error("authentication-required"));
  await expect(getDashboardFinanceSummary()).rejects.toThrow(
    "authentication-required",
  );
  expect(reads).toEqual([]);
});
