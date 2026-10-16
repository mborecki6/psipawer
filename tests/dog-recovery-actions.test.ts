import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  rpc: vi.fn(),
  from: vi.fn(),
  update: vi.fn(),
  refresh: vi.fn(),
  redirect: vi.fn(),
}));
vi.mock("@/lib/auth/session", () => ({ requireSession: mocks.session }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.refresh }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock(
  "@/lib/validation/schemas",
  async () => import("../src/lib/validation/schemas"),
);
vi.mock("@/lib/time", async () => import("../src/lib/time"));
vi.mock("../src/lib/avatar-photo", () => ({ prepareAvatarPhoto: vi.fn() }));
import { saveDog } from "../src/lib/data/actions";

const owner = "81000000-0000-4000-8000-000000000001";
const stranger = "81000000-0000-4000-8000-000000000002";
const dog = "82000000-0000-4000-8000-000000000001";
const request = "83000000-0000-4000-8000-000000000001";
const values = {
  creation_request_id: request,
  name: "Figa",
  breed: "Mieszaniec",
  approximate_age: "3 lata",
  sex: "female",
  weight_kg: "12.5",
  color: "Ruda",
};
function form(overrides: Record<string, string | undefined> = {}) {
  const data = new FormData();
  for (const [key, value] of Object.entries({ ...values, ...overrides }))
    if (value !== undefined) data.set(key, value);
  return data;
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.session.mockResolvedValue({
    db: { rpc: mocks.rpc, from: mocks.from },
    user: { id: owner },
    role: "client",
  });
  mocks.rpc.mockResolvedValue({ data: dog, error: null });
  mocks.redirect.mockImplementation((path: string) => {
    throw new Error(`REDIRECT:${path}`);
  });
  mocks.from.mockReturnValue({
    select: () => ({
      eq: () => ({
        single: async () => ({ data: { id: dog, guardian_id: owner } }),
      }),
    }),
    update: mocks.update,
  });
  mocks.update.mockReturnValue({ eq: async () => ({ error: null }) });
});

describe("dog form recovery", () => {
  it("sends the same operation key and normalized six-field payload on retry", async () => {
    for (let attempt = 0; attempt < 2; attempt++)
      await expect(
        saveDog(
          {},
          form({ name: " Figa ", guardian_id: stranger, status: "approved" }),
        ),
      ).rejects.toThrow(`REDIRECT:/app/dogs/${dog}?saved=1`);
    expect(mocks.rpc).toHaveBeenCalledTimes(2);
    for (const call of mocks.rpc.mock.calls)
      expect(call).toEqual([
        "create_dog_profile",
        {
          p_request_id: request,
          p_payload: {
            name: "Figa",
            breed: "Mieszaniec",
            approximate_age: "3 lata",
            sex: "female",
            weight_kg: 12.5,
            color: "Ruda",
          },
        },
      ]);
    expect(mocks.from).not.toHaveBeenCalled();
  });
  it.each([
    { creation_request_id: undefined },
    { creation_request_id: "invalid" },
    { name: "" },
    { sex: "other" },
    { color: undefined },
    { weight_kg: "151" },
  ])("rejects invalid new form before a database write: %j", async (change) => {
    expect((await saveDog({}, form(change))).error).toBeTruthy();
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.from).not.toHaveBeenCalled();
  });
  it.each([
    "Ten formularz został już zapisany z innymi danymi. Sprawdź profil psa na liście przed dodaniem nowego.",
    "Nie można ponowić zapisu tego formularza. Sprawdź listę psów i swój dostęp.",
  ])("shows the explicit safe conflict: %s", async (message) => {
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { message } });
    expect(await saveDog({}, form())).toEqual({ error: message });
    expect(mocks.refresh).not.toHaveBeenCalled();
    expect(mocks.redirect).not.toHaveBeenCalled();
  });
  it("does not navigate or expose private details without a valid acknowledgement", async () => {
    mocks.rpc.mockResolvedValueOnce({
      data: null,
      error: { message: "private SQL detail" },
    });
    const error = await saveDog({}, form());
    expect(error.error).toBeTruthy();
    expect(error.error).not.toContain("private");
    mocks.rpc.mockResolvedValueOnce({ data: null, error: null });
    expect((await saveDog({}, form())).error).toContain("potwierdzić zapisu");
    expect(mocks.refresh).not.toHaveBeenCalled();
    expect(mocks.redirect).not.toHaveBeenCalled();
  });
  it("leaves a rejected transport for the opted-in form to recover", async () => {
    const failure = new TypeError("Failed to fetch");
    mocks.rpc.mockRejectedValueOnce(failure);
    await expect(saveDog({}, form())).rejects.toBe(failure);
    expect(mocks.refresh).not.toHaveBeenCalled();
  });
  it("propagates authentication redirects before validating or writing", async () => {
    const interrupt = new Error("REDIRECT:/login");
    mocks.session.mockRejectedValueOnce(interrupt);
    await expect(saveDog({}, form())).rejects.toBe(interrupt);
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.from).not.toHaveBeenCalled();
  });
  it.each(["client", "admin"])(
    "keeps existing %s profile edits on their own path",
    async (role) => {
      mocks.session.mockResolvedValueOnce({
        db: { rpc: mocks.rpc, from: mocks.from },
        user: { id: owner },
        role,
      });
      await expect(
        saveDog({}, form({ id: dog, creation_request_id: undefined })),
      ).rejects.toThrow(
        `REDIRECT:/${role === "admin" ? "admin" : "app"}/dogs/${dog}?saved=1`,
      );
      expect(mocks.rpc).not.toHaveBeenCalled();
      expect(mocks.update).toHaveBeenCalledWith(
        expect.objectContaining({ name: "Figa" }),
      );
    },
  );
  it("rejects a guardian editing someone else's existing dog", async () => {
    mocks.from.mockReturnValueOnce({
      select: () => ({
        eq: () => ({
          single: async () => ({ data: { id: dog, guardian_id: stranger } }),
        }),
      }),
    });
    expect((await saveDog({}, form({ id: dog }))).error).toContain(
      "Nie masz dostępu",
    );
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});
