import { expect, it, vi } from "vitest";
import { processLocalAvatarCleanup } from "../scripts/avatar-cleanup.mjs";
const values = {
  NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
  SUPABASE_SECRET_KEY: "fake-local-key",
};
const job = {
  bucket_id: "dog-avatars",
  object_path: `${crypto.randomUUID()}/${crypto.randomUUID()}/photo.webp`,
};
it("rejects hosted configuration before requesting anything", async () => {
  const request = vi.fn();
  await expect(
    processLocalAvatarCleanup(
      { ...values, NEXT_PUBLIC_SUPABASE_URL: "https://project.supabase.co" },
      request,
    ),
  ).rejects.toThrow();
  expect(request).not.toHaveBeenCalled();
});
it("removes through Storage API and acknowledges without exposing job details", async () => {
  const request = vi
    .fn()
    .mockResolvedValueOnce({ ok: true, json: async () => [job] })
    .mockResolvedValue({ ok: true });
  expect(await processLocalAvatarCleanup(values, request)).toEqual({
    completed: 1,
    failed: 0,
  });
  expect(request.mock.calls[1]).toMatchObject([
    "http://127.0.0.1:54321/storage/v1/object/dog-avatars",
    {
      method: "DELETE",
      redirect: "error",
      body: JSON.stringify({ prefixes: [job.object_path] }),
    },
  ]);
  expect(JSON.parse(request.mock.calls[2][1].body).p_failed).toBe(false);
});
it.each(["remove", "acknowledge"])(
  "records a retry after an unconfirmed %s and continues",
  async (stage) => {
    const request = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => [job, { ...job, bucket_id: "community-avatars" }],
    });
    if (stage === "remove")
      request.mockRejectedValueOnce(new Error("private transport detail"));
    else
      request
        .mockResolvedValueOnce({ ok: true })
        .mockResolvedValueOnce({ ok: false });
    request.mockResolvedValue({ ok: true });
    expect(await processLocalAvatarCleanup(values, request)).toEqual({
      completed: 1,
      failed: 1,
    });
    expect(
      request.mock.calls.filter(
        ([, options]) => JSON.parse(options.body).p_failed === true,
      ),
    ).toHaveLength(1);
  },
);
it.each([
  { jobs: [{ ...job, object_path: "../../escape" }] },
  { jobs: [{ ...job, bucket_id: "other" }] },
  { jobs: Array(21).fill(job) },
])(
  "validates the complete batch before deleting any object",
  async ({ jobs }) => {
    const request = vi
      .fn()
      .mockResolvedValue({ ok: true, json: async () => jobs });
    await expect(processLocalAvatarCleanup(values, request)).rejects.toThrow(
      "Invalid cleanup response",
    );
    expect(request).toHaveBeenCalledTimes(1);
  },
);
