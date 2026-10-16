import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  rpc: vi.fn(),
  refresh: vi.fn(),
}));
vi.mock("@/lib/auth/session", () => ({ requireSession: mocks.session }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.refresh }));
vi.mock(
  "@/lib/validation/schemas",
  async () => import("../src/lib/validation/schemas"),
);
vi.mock("@/lib/time", async () => import("../src/lib/time"));
vi.mock("../src/lib/avatar-photo", () => ({ prepareAvatarPhoto: vi.fn() }));
import { setDogStatus } from "../src/lib/data/actions";

const dog = "82000000-0000-4000-8000-000000000001";
const request = "83000000-0000-4000-8000-000000000001";
const values = {
  dog_id: dog,
  request_id: request,
  expected_status: "new",
  expected_qualification_version: "0",
  status: "approved",
  note: "Spokojne reakcje psa.",
};
function form(overrides: Record<string, string | undefined> = {}) {
  const data = new FormData();
  for (const [key, value] of Object.entries({ ...values, ...overrides }))
    if (value !== undefined) data.set(key, value);
  return data;
}
beforeEach(() => {
  vi.resetAllMocks();
  mocks.session.mockResolvedValue({ db: { rpc: mocks.rpc } });
  mocks.rpc.mockResolvedValue({ data: 1, error: null });
});
describe("dog qualification action recovery", () => {
  it("requires admin and forwards a stable request and the observed status/version", async () => {
    const data = form({ note: " Spokojne reakcje psa. ", actor_id: "forged" });
    for (let retry = 0; retry < 2; retry++)
      expect(await setDogStatus({}, data)).toEqual({
        success: "Status psa został zmieniony.",
        qualificationStatus: "approved",
        qualificationVersion: 1,
      });
    expect(mocks.session).toHaveBeenCalledWith("admin");
    expect(mocks.rpc).toHaveBeenCalledTimes(2);
    for (const call of mocks.rpc.mock.calls)
      expect(call).toEqual([
        "qualify_dog",
        {
          p_request_id: request,
          p_dog: dog,
          p_expected_status: "new",
          p_expected_version: 0,
          p_status: "approved",
          p_note: "Spokojne reakcje psa.",
        },
      ]);
  });
  it("returns the acknowledged RPC version rather than deriving it from a newer view", async () => {
    mocks.rpc.mockResolvedValueOnce({ data: 8, error: null });
    expect(
      await setDogStatus(
        {},
        form({
          expected_status: "approved",
          expected_qualification_version: "7",
          status: "suspended",
        }),
      ),
    ).toEqual({
      success: "Status psa został zmieniony.",
      qualificationStatus: "suspended",
      qualificationVersion: 8,
    });
  });
  it.each([
    { request_id: undefined },
    { request_id: "invalid" },
    { dog_id: "invalid" },
    { expected_status: undefined },
    { expected_status: "invalid" },
    { expected_qualification_version: undefined },
    { expected_qualification_version: "" },
    { expected_qualification_version: "-1" },
    { expected_qualification_version: "1.5" },
    { expected_qualification_version: "2147483647" },
    { status: "invalid" },
    { note: "  " },
    { note: "x".repeat(8001) },
  ])(
    "rejects incomplete or invalid decisions before the RPC: %j",
    async (change) => {
      expect((await setDogStatus({}, form(change))).error).toBeTruthy();
      expect(mocks.rpc).not.toHaveBeenCalled();
      expect(mocks.refresh).not.toHaveBeenCalled();
    },
  );
  it("tells old forms to refresh", async () => {
    expect(
      (
        await setDogStatus(
          {},
          form({
            request_id: undefined,
            expected_qualification_version: undefined,
          }),
        )
      ).error,
    ).toContain("Odśwież stronę");
  });
  it.each([
    "Ten formularz kwalifikacji został już użyty do innej decyzji. Sprawdź profil psa i odśwież formularz.",
    "Kwalifikacja psa zmieniła się w międzyczasie. Sprawdź aktualny status i odśwież formularz.",
    "Nie znaleziono psa. Odśwież listę psów.",
    "Brak uprawnień do zmiany kwalifikacji psa.",
  ])(
    "returns a readable conflict without a refresh that would erase the fields: %s",
    async (message) => {
      mocks.rpc.mockResolvedValueOnce({ data: null, error: { message } });
      expect(await setDogStatus({}, form())).toEqual({ error: message });
      expect(mocks.refresh).not.toHaveBeenCalled();
    },
  );
  it.each([null, 0, "1", 1.5])(
    "does not report success without a valid receipt version: %j",
    async (data) => {
      mocks.rpc.mockResolvedValueOnce({ data, error: null });
      expect((await setDogStatus({}, form())).error).toContain(
        "potwierdzić kwalifikacji",
      );
      expect(mocks.refresh).not.toHaveBeenCalled();
    },
  );
  it("does not expose unknown database errors", async () => {
    mocks.rpc.mockResolvedValueOnce({
      data: null,
      error: { message: "private SQL detail" },
    });
    const result = await setDogStatus({}, form());
    expect(result.error).toBeTruthy();
    expect(result.error).not.toContain("private");
  });
  it("preserves auth redirects and transport failures for their existing callers", async () => {
    const interrupt = new Error("REDIRECT:/login");
    mocks.session.mockRejectedValueOnce(interrupt);
    await expect(setDogStatus({}, form())).rejects.toBe(interrupt);
    expect(mocks.rpc).not.toHaveBeenCalled();
    const failure = new TypeError("Failed to fetch");
    mocks.rpc.mockRejectedValueOnce(failure);
    await expect(setDogStatus({}, form())).rejects.toBe(failure);
    expect(mocks.refresh).not.toHaveBeenCalled();
  });
});
