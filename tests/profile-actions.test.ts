import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  from: vi.fn(),
  update: vi.fn(),
  eq: vi.fn(),
  select: vi.fn(),
  single: vi.fn(),
  revalidate: vi.fn(),
}));

vi.mock("@/lib/auth/session", () => ({ requireSession: mocks.session }));
vi.mock(
  "@/lib/validation/schemas",
  async () => import("../src/lib/validation/schemas"),
);
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidate }));

import { updateOwnProfile } from "../src/modules/profile/actions";

const ownId = "00000000-0000-4000-8000-000000000001";
const values = {
  full_name: "Alicja Nowak",
  phone: "+48 123 456 789",
  area: "Wrocław, Krzyki",
};

function form(overrides: Record<string, string> = {}) {
  const result = new FormData();
  for (const [key, value] of Object.entries({ ...values, ...overrides }))
    result.set(key, value);
  return result;
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.session.mockResolvedValue({
    db: { from: mocks.from },
    user: { id: ownId },
    role: "client",
  });
  mocks.from.mockReturnValue({ update: mocks.update });
  mocks.update.mockReturnValue({ eq: mocks.eq });
  mocks.eq.mockReturnValue({ select: mocks.select });
  mocks.select.mockReturnValue({ single: mocks.single });
  mocks.single.mockResolvedValue({ data: { id: ownId }, error: null });
});

describe("editing one's own profile", () => {
  it.each(["client", "admin"])(
    "updates only the verified %s user's personal fields and refreshes that panel",
    async (role) => {
      mocks.session.mockResolvedValueOnce({
        db: { from: mocks.from },
        user: { id: ownId },
        role,
      });
      const result = await updateOwnProfile(
        {},
        form({
          full_name: `  ${values.full_name}  `,
          phone: ` ${values.phone} `,
          area: ` ${values.area} `,
          id: "someone-else",
          user_id: "someone-else",
          role: "admin",
          email: "different@example.com",
        }),
      );

      expect(mocks.session).toHaveBeenCalledExactlyOnceWith(undefined, false);
      expect(mocks.from).toHaveBeenCalledExactlyOnceWith("profiles");
      expect(mocks.update).toHaveBeenCalledExactlyOnceWith(values);
      expect(mocks.eq).toHaveBeenCalledExactlyOnceWith("id", ownId);
      expect(result).toEqual({ success: "Zmiany w profilu zostały zapisane." });
      expect(mocks.revalidate).toHaveBeenCalledWith("/profile");
      expect(mocks.revalidate).toHaveBeenCalledWith(
        role === "admin" ? "/admin" : "/app",
        "layout",
      );
    },
  );

  it("requires a verified session before updating anything", async () => {
    mocks.session.mockRejectedValueOnce(new Error("REDIRECT:/login"));
    await expect(updateOwnProfile({}, form())).rejects.toThrow(
      "REDIRECT:/login",
    );
    expect(mocks.from).not.toHaveBeenCalled();
    expect(mocks.revalidate).not.toHaveBeenCalled();
  });

  it.each([
    ["full_name", "  "],
    ["full_name", "a".repeat(121)],
    ["phone", "abc"],
    ["area", " "],
    ["area", "a".repeat(121)],
  ])("rejects an invalid %s without changing data", async (field, value) => {
    const result = await updateOwnProfile({}, form({ [field]: value }));
    expect(result.error).toBeTruthy();
    expect(result.fields?.[field]?.length).toBeGreaterThan(0);
    expect(mocks.from).not.toHaveBeenCalled();
    expect(mocks.revalidate).not.toHaveBeenCalled();
  });

  it.each([
    { data: null, error: { message: "private database detail" } },
    { data: null, error: null },
  ])(
    "does not report success when no saved row is returned",
    async (response) => {
      mocks.single.mockResolvedValueOnce(response);
      const result = await updateOwnProfile({}, form());
      expect(result.error).toContain("Nie udało się zapisać");
      expect(result.success).toBeUndefined();
      expect(JSON.stringify(result)).not.toContain("private");
      expect(mocks.revalidate).not.toHaveBeenCalled();
    },
  );

  it("handles a transport failure without exposing internal details", async () => {
    mocks.single.mockRejectedValueOnce(new Error("private network detail"));
    const result = await updateOwnProfile({}, form());
    expect(result.error).toContain("Nie udało się zapisać");
    expect(result.success).toBeUndefined();
    expect(JSON.stringify(result)).not.toContain("private");
    expect(mocks.revalidate).not.toHaveBeenCalled();
  });
});
