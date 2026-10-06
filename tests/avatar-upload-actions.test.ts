import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  rpc: vi.fn(),
  upload: vi.fn(),
  remove: vi.fn(),
  refresh: vi.fn(),
  decode: vi.fn(),
}));
vi.mock("@/lib/auth/session", () => ({ requireSession: mocks.session }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.refresh }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock(
  "@/lib/validation/schemas",
  async () => import("../src/lib/validation/schemas"),
);
vi.mock("@/lib/time", async () => import("../src/lib/time"));
vi.mock("@/lib/community", async () => import("../src/lib/community"));
vi.mock("../src/lib/avatar-photo", () => ({
  prepareAvatarPhoto: mocks.decode,
}));
vi.mock("@/lib/community-photo", () => ({
  prepareCommunityPhoto: mocks.decode,
}));
import { uploadAvatar } from "../src/lib/data/actions";
import { uploadCommunityAvatar } from "../src/lib/data/community-actions";

const owner = "81000000-0000-4000-8000-000000000002";
const dog = "82000000-0000-4000-8000-000000000001";
const stamp = "2026-10-02T12:00:00.123456+00:00";
const dogRow = { guardian_id: owner, avatar_path: null };

beforeEach(() => {
  vi.resetAllMocks();
  mocks.decode.mockResolvedValue(Buffer.from("decoded fixture"));
  mocks.upload.mockResolvedValue({ data: {}, error: null });
  mocks.remove.mockResolvedValue({ data: [], error: null });
  mocks.rpc.mockImplementation(async (name: string) => ({
    data:
      name === "reserve_avatar_upload"
        ? stamp
        : name === "set_community_avatar"
          ? stamp
          : name === "retire_avatar_upload"
            ? false
            : null,
    error: null,
  }));
  mocks.session.mockResolvedValue({
    user: { id: owner },
    role: "client",
    db: {
      rpc: mocks.rpc,
      storage: { from: () => ({ upload: mocks.upload, remove: mocks.remove }) },
      from: (table: string) => ({
        select: () => ({
          eq: () => ({
            single: async () => ({ data: dogRow, error: null }),
            maybeSingle: async () => ({
              data:
                table === "dogs"
                  ? dogRow
                  : { avatar_path: null, updated_at: stamp },
              error: null,
            }),
          }),
        }),
      }),
    },
  });
});

describe.each([
  {
    label: "private",
    bucket: "dog-avatars",
    action: uploadAvatar,
    field: "photo",
  },
  {
    label: "community",
    bucket: "community-avatars",
    action: uploadCommunityAvatar,
    field: "file",
  },
])("$label upload recovery", ({ bucket, action, field }) => {
  const form = () => {
    const data = new FormData();
    data.set("dog_id", dog);
    data.set("expected_avatar_path", "");
    data.set("expected_updated_at", stamp);
    data.set("consent", "yes");
    data.set(field, new File(["fixture"], "photo.png", { type: "image/png" }));
    return data;
  };
  it.each([
    { data: null, error: null },
    { data: null, error: { message: "private database detail" } },
  ])(
    "stops before bytes when the durable reservation is not acknowledged: %j",
    async (response) => {
      mocks.rpc.mockResolvedValueOnce(response);
      const result = await action({}, form());
      expect(result.error).toContain("Nie udało się potwierdzić");
      expect(result.error).not.toContain("private");
      expect(result.success).toBeUndefined();
      expect(mocks.upload).not.toHaveBeenCalled();
      expect(mocks.refresh).not.toHaveBeenCalled();
    },
  );
  it("waits for the reservation before uploading and attaching the same key", async () => {
    let acknowledge!: (value: { data: string; error: null }) => void;
    const reservation = new Promise<{ data: string; error: null }>(
      (resolve) => {
        acknowledge = resolve;
      },
    );
    mocks.rpc.mockReturnValueOnce(reservation);
    const pending = action({}, form());
    await vi.waitFor(() =>
      expect(mocks.rpc).toHaveBeenCalledWith(
        "reserve_avatar_upload",
        expect.objectContaining({ p_dog: dog, p_bucket: bucket }),
      ),
    );
    expect(mocks.upload).not.toHaveBeenCalled();
    const path = mocks.rpc.mock.calls[0][1].p_path;
    expect(path).toMatch(new RegExp(`^${owner}/${dog}/[a-f0-9-]+\\.webp$`));
    acknowledge({ data: stamp, error: null });
    expect((await pending).success).toBeTruthy();
    expect(mocks.upload).toHaveBeenCalledWith(path, expect.any(Buffer), {
      contentType: "image/webp",
      upsert: false,
    });
    expect(mocks.rpc).toHaveBeenCalledWith(
      bucket === "dog-avatars" ? "set_dog_avatar" : "set_community_avatar",
      expect.objectContaining({ p_dog: dog, p_path: path }),
    );
  });
  it("does not erase a photo whose successful attachment response was lost", async () => {
    mocks.rpc.mockImplementation(async (name: string) => {
      if (name.startsWith("set_"))
        throw new Error("Fixture lost successful response");
      return {
        data: name === "reserve_avatar_upload" ? stamp : false,
        error: null,
      };
    });
    const result = await action({}, form());
    expect(result.error).toContain("Sprawdź");
    expect(result.success).toBeUndefined();
    expect(mocks.upload).toHaveBeenCalledOnce();
    expect(mocks.rpc).toHaveBeenCalledWith(
      "retire_avatar_upload",
      expect.objectContaining({ p_bucket: bucket }),
    );
    expect(mocks.remove).not.toHaveBeenCalled();
    expect(mocks.refresh).not.toHaveBeenCalled();
  });
  it("leaves recovery to the durable reservation if both acknowledgement and cleanup lose connection", async () => {
    mocks.rpc.mockRejectedValue(new Error("Fixture connection lost"));
    expect((await action({}, form())).error).toContain(
      "Nie udało się potwierdzić",
    );
    expect(mocks.upload).not.toHaveBeenCalled();
    expect(mocks.remove).not.toHaveBeenCalled();
  });
});
