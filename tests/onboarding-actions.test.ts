import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  rpc: vi.fn(),
  refresh: vi.fn(),
  redirect: vi.fn(),
}));
vi.mock("@/lib/auth/session", () => ({ requireSession: mocks.session }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.refresh }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
import { saveOnboarding } from "../src/modules/onboarding/actions";
import {
  createOnboardingAnswers,
  ONBOARDING_CONFLICT,
  ONBOARDING_FAILURE,
  ONBOARDING_INVALID,
  type SaveOnboardingInput,
} from "../src/modules/onboarding/types";

const owner = "81000000-0000-4000-8000-000000000001";
const answers = {
  ...createOnboardingAnswers(),
  age: "unknown" as const,
  goal: "walks" as const,
  format: "individual" as const,
};
const input: SaveOnboardingInput = {
  revision: 0,
  answers,
  step: "plan",
  paused: false,
  complete: true,
};
const record = {
  guardian_id: owner,
  answers,
  current_step: "plan",
  paused: false,
  completed_at: "2026-10-26T10:00:00+00:00",
  revision: 1,
  created_at: "2026-10-26T09:00:00+00:00",
  updated_at: "2026-10-26T10:00:00+00:00",
};
const session = () => ({
  db: { rpc: mocks.rpc },
  user: { id: owner },
  role: "client",
  profile: { full_name: "Opiekun", phone: "123456789", area: "Wrocław" },
  onboarding: { ...record, completed_at: null, revision: 0 },
});

beforeEach(() => {
  vi.resetAllMocks();
  mocks.session.mockResolvedValue(session());
  mocks.rpc.mockResolvedValue({ data: record, error: null });
  mocks.redirect.mockImplementation((path) => {
    throw new Error(`redirect:${path}`);
  });
});

describe("owner onboarding saves", () => {
  it("uses the onboarding-safe session and only sends the strict request to RPC", async () => {
    expect(await saveOnboarding(input)).toEqual({ ok: true, record });
    expect(mocks.session).toHaveBeenCalledWith("client", false);
    expect(mocks.rpc).toHaveBeenCalledWith("save_guardian_onboarding", {
      p_revision: 0,
      p_answers: answers,
      p_step: "plan",
      p_paused: false,
      p_complete: true,
    });
    expect(mocks.refresh.mock.calls).toEqual([
      ["/onboarding"],
      ["/app", "layout"],
    ]);
    expect(mocks.redirect).not.toHaveBeenCalled();
  });

  it("permits a partial draft and trims optional fields before saving", async () => {
    const draft = {
      ...input,
      answers: { ...createOnboardingAnswers(), dogName: " Figa " },
      step: "dog" as const,
      paused: true,
      complete: false,
    };
    const savedDraft = {
      ...record,
      answers: { ...createOnboardingAnswers(), dogName: "Figa" },
      current_step: "dog",
      paused: true,
      completed_at: null,
    };
    mocks.rpc.mockResolvedValueOnce({ data: savedDraft, error: null });
    expect(await saveOnboarding(draft)).toEqual({
      ok: true,
      record: savedDraft,
    });
    expect(mocks.rpc.mock.calls[0][1]).toMatchObject({
      p_answers: { ...createOnboardingAnswers(), dogName: "Figa" },
      p_step: "dog",
      p_paused: true,
      p_complete: false,
    });
    expect(draft.answers.dogName).toBe(" Figa ");
  });

  it("accepts the singleton row shape from a composite PostgREST response", async () => {
    mocks.rpc.mockResolvedValueOnce({ data: [record], error: null });
    expect(await saveOnboarding(input)).toEqual({ ok: true, record });
  });

  it("keeps incomplete contact-profile redirects outside the failure handler", async () => {
    mocks.session.mockResolvedValue({
      ...session(),
      profile: { full_name: "Opiekun", phone: "", area: "Wrocław" },
    });
    await expect(saveOnboarding(input)).rejects.toThrow(
      "redirect:/complete-profile",
    );
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  it("does not enroll an old account or swallow a session redirect", async () => {
    mocks.session.mockResolvedValue({ ...session(), onboarding: null });
    expect(await saveOnboarding(input)).toMatchObject({ ok: false });
    expect(mocks.rpc).not.toHaveBeenCalled();
    mocks.session.mockRejectedValue(new Error("redirect:/login"));
    await expect(saveOnboarding(input)).rejects.toThrow("redirect:/login");
  });

  it.each([
    { ...input, guardian_id: "other" },
    { ...input, answers: { ...answers, note: "x".repeat(241) } },
    { ...input, answers: { ...answers, age: null } },
    { ...input, paused: true },
    { ...input, revision: "0" },
  ])("rejects malformed input without mutation: %j", async (value) => {
    expect(await saveOnboarding(value as SaveOnboardingInput)).toEqual({
      ok: false,
      error: ONBOARDING_INVALID,
    });
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  it("distinguishes a revision conflict while leaving stale content unsaved", async () => {
    mocks.rpc.mockResolvedValue({
      data: null,
      error: { message: ONBOARDING_CONFLICT },
    });
    expect(await saveOnboarding(input)).toEqual({
      ok: false,
      error: ONBOARDING_CONFLICT,
      conflict: true,
    });
    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  it("hides database internals and transport failures without claiming success", async () => {
    for (const message of ["private SQL information", "Brak uprawnień."]) {
      mocks.rpc.mockResolvedValueOnce({ data: null, error: { message } });
      expect(await saveOnboarding(input)).toEqual({
        ok: false,
        error: ONBOARDING_FAILURE,
      });
    }
    mocks.rpc.mockRejectedValueOnce(new Error("offline"));
    expect(await saveOnboarding(input)).toEqual({
      ok: false,
      error: ONBOARDING_FAILURE,
    });
    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  it("returns a public validation error but rejects malformed or foreign acknowledgements", async () => {
    mocks.rpc.mockResolvedValueOnce({
      data: null,
      error: { message: ONBOARDING_INVALID },
    });
    expect(await saveOnboarding(input)).toEqual({
      ok: false,
      error: ONBOARDING_INVALID,
    });
    for (const data of [
      null,
      {},
      [],
      [record, record],
      { ...record, guardian_id: "81000000-0000-4000-8000-000000000002" },
      { ...record, revision: 0 },
      { ...record, current_step: "style" },
      { ...record, paused: true },
      { ...record, answers: { ...answers, dogName: "Other" } },
      { ...record, completed_at: null },
      { ...record, completed_at: "yesterday" },
    ]) {
      mocks.rpc.mockResolvedValueOnce({ data, error: null });
      expect(await saveOnboarding(input)).toEqual({
        ok: false,
        error: ONBOARDING_FAILURE,
      });
    }
    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  it("does not acknowledge a later edit that loses the original completion history", async () => {
    mocks.session.mockResolvedValue({ ...session(), onboarding: record });
    const edited = { ...input, revision: 1, complete: false };
    mocks.rpc.mockResolvedValueOnce({
      data: { ...record, revision: 2, completed_at: null },
      error: null,
    });
    expect(await saveOnboarding(edited)).toEqual({
      ok: false,
      error: ONBOARDING_FAILURE,
    });
    mocks.rpc.mockResolvedValueOnce({
      data: {
        ...record,
        revision: 2,
        completed_at: "2026-10-26T11:00:00+00:00",
      },
      error: null,
    });
    expect(await saveOnboarding(edited)).toEqual({
      ok: false,
      error: ONBOARDING_FAILURE,
    });
    mocks.rpc.mockResolvedValueOnce({
      data: { ...record, revision: 2 },
      error: null,
    });
    expect(await saveOnboarding(edited)).toEqual({
      ok: true,
      record: { ...record, revision: 2 },
    });
  });
});
