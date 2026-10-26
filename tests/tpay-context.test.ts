import { afterEach, beforeEach, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  runtime: vi.fn(),
  settings: vi.fn(),
  attempts: vi.fn(),
}));
vi.mock("@/lib/auth/session", () => ({ requireSession: mocks.session }));
vi.mock(
  "@/lib/validation/schemas",
  async () => import("../src/lib/validation/schemas"),
);
vi.mock("@/lib/data/finance-queries", () => ({ getFinanceData: vi.fn() }));
vi.mock("../src/modules/payments/runtime", () => ({
  getLocalPaymentRuntime: mocks.runtime,
  requireLocalPaymentRuntime: mocks.runtime,
}));
vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    from: () => ({
      select: () => ({ limit: () => ({ maybeSingle: mocks.settings }) }),
    }),
  }),
}));
import { getOnlinePaymentContext } from "../src/modules/payments/server";
beforeEach(() => {
  vi.resetAllMocks();
  mocks.runtime.mockReturnValue({ environment: "simulator", canStart: true });
  mocks.session.mockResolvedValue({
    db: {
      from: () => ({
        select: () => ({
          order: () => ({ order: () => ({ range: mocks.attempts }) }),
        }),
      }),
    },
  });
  mocks.settings.mockResolvedValue({
    data: { enabled: true, walk_gate: "accepted" },
    error: null,
  });
  mocks.attempts.mockResolvedValue({ data: [], error: null });
});
it("reads RLS history without provider configuration while keeping checkout off", async () => {
  mocks.runtime.mockReturnValue(null);
  expect((await getOnlinePaymentContext()).enabled).toBe(false);
  expect(mocks.settings).not.toHaveBeenCalled();
  expect(mocks.attempts).toHaveBeenCalled();
});
it.each(["42P01", "PGRST205"])(
  "distinguishes missing migration (%s) from a connection failure",
  async (code) => {
    mocks.settings.mockResolvedValue({
      error: { code, message: "missing table" },
      data: null,
    });
    expect(await getOnlinePaymentContext()).toMatchObject({
      enabled: false,
      notice: expect.stringContaining("konfiguracji"),
    });
    expect(mocks.attempts).toHaveBeenCalled();
  },
);
it("reports failed settings read as an error, not disabled or missing configuration", async () => {
  mocks.settings.mockResolvedValue({
    error: { code: "", message: "TypeError: fetch failed" },
    data: null,
  });
  await expect(getOnlinePaymentContext()).rejects.toThrow(
    "Nie udało się odczytać konfiguracji",
  );
  expect(mocks.attempts).toHaveBeenCalled();
});
it("does not present a failed history read as an empty list", async () => {
  mocks.attempts.mockResolvedValue({
    error: { message: "offline" },
    data: null,
  });
  await expect(getOnlinePaymentContext()).rejects.toThrow(
    "Nie udało się pobrać prób",
  );
});
it("keeps all unresolved received-money reviews, including those older than the latest20", async () => {
  const attempts = Array.from({ length: 28 }, (_, i) => ({
    id: String(i),
    status: i === 26 ? "requires_review" : "paid",
  }));
  mocks.attempts.mockResolvedValue({ data: attempts, error: null });
  const context = await getOnlinePaymentContext();
  expect(context.enabled).toBe(true);
  expect(context.attempts).toHaveLength(21);
  expect(context.attempts.at(-1)?.id).toBe("26");
});

it("keeps old active attempts and history visible with checkout disabled", async () => {
  const attempts = Array.from({ length: 28 }, (_, i) => ({
    id: String(i),
    status: i === 26 ? "uncertain" : "paid",
  }));
  mocks.attempts.mockResolvedValue({ data: attempts, error: null });
  mocks.settings.mockResolvedValue({
    data: { enabled: false, walk_gate: "accepted" },
    error: null,
  });
  const context = await getOnlinePaymentContext();
  expect(context.enabled).toBe(false);
  expect(context.canProcess).toBe(true);
  expect(context.attempts.map((a) => a.id)).toContain("26");
});
it("distinguishes a missing payment schema from an actual failed history read", async () => {
  mocks.attempts.mockResolvedValue({ data: null, error: { code: "PGRST205" } });
  expect((await getOnlinePaymentContext()).notice).toContain("Baza");
  mocks.attempts.mockResolvedValue({ data: null, error: { code: "XX000" } });
  await expect(getOnlinePaymentContext()).rejects.toThrow("pobrać prób");
});

afterEach(() => vi.unstubAllEnvs());
it("retains simulator processing after checkout is disabled but never permits a hosted simulator", async () => {
  const { getLocalPaymentRuntime } = await vi.importActual<
    typeof import("../src/modules/payments/runtime")
  >("../src/modules/payments/runtime");
  for (const [key, value] of Object.entries({
    TPAY_MODE: "simulator",
    TPAY_ENABLED: "false",
    NEXT_PUBLIC_APP_URL: "http://localhost:3000",
    NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
    SUPABASE_SECRET_KEY: "synthetic-service-key",
  }))
    vi.stubEnv(key, value);
  for (const key of ["VERCEL", "VERCEL_ENV", "VERCEL_URL"])
    vi.stubEnv(key, undefined);
  expect(getLocalPaymentRuntime()).toMatchObject({
    environment: "simulator",
    canStart: false,
  });
  vi.stubEnv("VERCEL_ENV", "preview");
  expect(getLocalPaymentRuntime()).toBeNull();
});
