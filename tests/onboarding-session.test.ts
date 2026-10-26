import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  getUser: vi.fn(),
  configured: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("react", () => ({ cache: (fn: unknown) => fn }));
vi.mock("next/navigation", () => ({
  redirect: (path: string) => {
    throw new Error(`REDIRECT:${path}`);
  },
}));
vi.mock("@/lib/supabase/config", () => ({ isConfigured: mocks.configured }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: mocks.from,
    auth: { getUser: mocks.getUser },
  }),
}));
vi.mock(
  "@/modules/onboarding/schemas",
  async () => import("../src/modules/onboarding/schemas"),
);

import { requireSession } from "../src/lib/auth/session";

const record = () => ({
  guardian_id: "6fd44813-62d1-4c60-b3e3-17d5421711f4",
  answers: {
    dogName: "",
    age: null,
    goal: null,
    format: null,
    note: "",
    collaboration: "unknown",
    rhythm: "unknown",
  },
  current_step: "welcome",
  paused: false,
  completed_at: null,
  revision: 0,
  created_at: "2026-10-26T12:00:00Z",
  updated_at: "2026-10-26T12:00:00Z",
});
let role: string;
let profile: Record<string, unknown> | null;
let profileError: unknown;

beforeEach(() => {
  vi.resetAllMocks();
  role = "client";
  profileError = null;
  profile = {
    id: record().guardian_id,
    full_name: "Opiekun",
    phone: "000",
    area: "Okolica",
    guardian_onboarding: null,
  };
  mocks.configured.mockReturnValue(true);
  mocks.getUser.mockResolvedValue({
    data: { user: { id: record().guardian_id } },
    error: null,
  });
  mocks.from.mockImplementation((table: string) => {
    const chain = {
      select: () => chain,
      eq: () => chain,
      single: async () =>
        table === "user_roles"
          ? { data: { role }, error: null }
          : { data: profile, error: profileError },
    };
    return chain;
  });
});

it("permanently exempts existing accounts while retaining the contact requirement", async () => {
  expect((await requireSession("client")).onboarding).toBeNull();
  profile!.phone = "";
  await expect(requireSession("client")).rejects.toThrow(
    "REDIRECT:/complete-profile",
  );
  expect((await requireSession("client", false)).onboarding).toBeNull();
});

it("gates a new client even when requesting a business action directly", async () => {
  profile!.guardian_onboarding = record();
  await expect(requireSession("client")).rejects.toThrow(
    "REDIRECT:/onboarding",
  );
  const session = await requireSession("client", false);
  expect(session.onboarding?.current_step).toBe("welcome");
  expect(session.profile).not.toHaveProperty("guardian_onboarding");
  profile!.area = "";
  await expect(requireSession("client")).rejects.toThrow(
    "REDIRECT:/complete-profile",
  );
});

it("accepts completed onboarding and bypasses the new gate for administrators", async () => {
  profile!.guardian_onboarding = {
    ...record(),
    completed_at: "2026-10-26T12:01:00Z",
    current_step: "plan",
    answers: {
      ...record().answers,
      age: "unknown",
      goal: "unknown",
      format: "unknown",
    },
  };
  expect(
    (await requireSession("client")).onboarding?.completed_at,
  ).toBeTruthy();
  role = "admin";
  profile!.guardian_onboarding = null;
  expect((await requireSession("admin")).role).toBe("admin");
  await expect(requireSession("client")).rejects.toThrow("REDIRECT:/admin");
});

it.each([
  undefined,
  { ...record(), guardian_id: "1fd44813-62d1-4c60-b3e3-17d5421711f4" },
  { revision: 0 },
  [record(), record()],
])(
  "fails closed for an invalid or absent relationship payload (%j)",
  async (value) => {
    profile!.guardian_onboarding = value;
    await expect(requireSession("client")).rejects.toThrow(
      "Nie udało się pobrać karty startu",
    );
  },
);

it("does not mistake a failed profile read for an old account exemption", async () => {
  profile = null;
  profileError = { message: "private database details" };
  await expect(requireSession()).rejects.toThrow(
    "Nie udało się pobrać profilu",
  );
});
