import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  rpc: vi.fn(),
  refresh: vi.fn(),
}));
vi.mock("@/lib/auth/session", () => ({ requireSession: mocks.session }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.refresh }));
import {
  savePlan,
  saveTemplate,
  submitProgress,
  reviewProgress,
} from "../src/modules/care/actions";
import { carePage, careDate } from "../src/modules/care/types";

const dog = "20000000-0000-4000-8000-000000000001";
const planId = "30000000-0000-4000-8000-000000000001";
const entry = "40000000-0000-4000-8000-000000000001";
function form(values: Record<string, string>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
}
const plan = {
  dog_id: dog,
  consultation_id: "",
  expected_version: "4",
  title: "Plan testowy",
  body: "Treść testowa planu.",
  follow_up_on: "2026-10-01",
  intent: "publish",
};
beforeEach(() => {
  vi.resetAllMocks();
  mocks.session.mockResolvedValue({
    db: { rpc: mocks.rpc },
    role: "admin",
    user: { id: "verified-user" },
  });
  mocks.rpc.mockResolvedValue({
    data: { version: 5, published_id: planId },
    error: null,
  });
});

describe("care server actions", () => {
  it("sends validated fitness context, preserves form version on failure and exposes only the allowed completion message", async () => {
    const error =
      "Najpierw zakończ spotkanie fitness. Teraz możesz zapisać szkic.";
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { message: error } });
    expect(
      await savePlan(
        { version: 4 },
        form({
          ...plan,
          fitness_package_id: entry,
          fitness_session_id: planId,
          guardian_id: "forged",
        }),
      ),
    ).toMatchObject({ version: 4, error });
    expect(mocks.rpc).toHaveBeenCalledWith(
      "save_care_plan",
      expect.objectContaining({
        p_fitness_package: entry,
        p_fitness_session: planId,
        p_consultation: null,
      }),
    );
    expect(mocks.rpc.mock.calls[0][1]).not.toHaveProperty("guardian_id");
  });
  it("rejects ambiguous fitness sources, malformed IDs and an orphan fitness meeting before a mutation", async () => {
    const contexts: Record<string, string>[] = [
      { fitness_package_id: entry, consultation_id: planId },
      { fitness_package_id: entry, course_enrollment_id: planId },
      { fitness_package_id: "invalid" },
      { fitness_session_id: entry },
    ];
    for (const context of contexts)
      expect(
        (await savePlan({}, form({ ...plan, ...context }))).error,
      ).toBeTruthy();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("passes only validated enrollment/meeting context and keeps the course completion error", async () => {
    const enrollment = entry,
      meeting = planId;
    const error =
      "Najpierw zakończ spotkanie kursu. Teraz możesz zapisać szkic.";
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { message: error } });
    expect(
      await savePlan(
        { version: 4 },
        form({
          ...plan,
          course_enrollment_id: enrollment,
          course_session_id: meeting,
          guardian_id: "forged",
        }),
      ),
    ).toMatchObject({ version: 4, error });
    expect(mocks.rpc).toHaveBeenCalledWith(
      "save_care_plan",
      expect.objectContaining({
        p_course_enrollment: enrollment,
        p_course_session: meeting,
        p_consultation: null,
      }),
    );
  });
  it("rejects combined consultation/course sources, malformed IDs and an orphan meeting before calling the database", async () => {
    const contexts: Record<string, string>[] = [
      { consultation_id: planId, course_enrollment_id: entry },
      { course_enrollment_id: "invalid" },
      { course_session_id: planId },
    ];
    for (const context of contexts)
      expect(
        (await savePlan({}, form({ ...plan, ...context }))).error,
      ).toBeTruthy();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("passes the chosen association to the database and preserves a completion error", async () => {
    const meeting = "80000000-0000-4000-8000-000000000001";
    const error =
      "Najpierw oznacz konsultację jako zakończoną. Teraz możesz zapisać szkic.";
    mocks.rpc.mockResolvedValue({ data: null, error: { message: error } });
    const result = await savePlan(
      { version: 4 },
      form({ ...plan, consultation_id: meeting }),
    );
    expect(mocks.rpc).toHaveBeenCalledWith(
      "save_care_plan",
      expect.objectContaining({ p_consultation: meeting }),
    );
    expect(result).toMatchObject({ version: 4, error });
  });
  it("requires staff and submits the visible text and intent atomically", async () => {
    const result = await savePlan(
      {},
      form({ ...plan, author_id: "forged", practice_id: "forged" }),
    );
    expect(mocks.session).toHaveBeenCalledWith("admin");
    expect(mocks.rpc).toHaveBeenCalledWith("save_care_plan", {
      p_dog: dog,
      p_consultation: null,
      p_expected_version: 4,
      p_title: plan.title,
      p_body: plan.body,
      p_follow_up_on: "2026-10-01",
      p_publish: true,
    });
    expect(result.version).toBe(5);
    expect(result.success).toContain("opublikowany");
    expect(mocks.refresh).toHaveBeenCalledWith("/admin", "layout");
    expect(mocks.refresh).toHaveBeenCalledWith("/app", "layout");
  });
  it("saves a private draft with no follow-up date", async () => {
    await savePlan({}, form({ ...plan, intent: "draft", follow_up_on: "" }));
    expect(mocks.rpc).toHaveBeenCalledWith(
      "save_care_plan",
      expect.objectContaining({ p_publish: false, p_follow_up_on: null }),
    );
  });
  it("preserves paragraphs identically for browser forms and API retries in plans and library materials", async () => {
    const body =
      "  Pierwszy akapit.\r\nDrugi akapit.\rTrzeci akapit.\nCzwarty akapit.  ";
    const expected =
      "Pierwszy akapit.\nDrugi akapit.\nTrzeci akapit.\nCzwarty akapit.";
    await savePlan({}, form({ ...plan, body }));
    expect(mocks.rpc).toHaveBeenLastCalledWith(
      "save_care_plan",
      expect.objectContaining({ p_body: expected }),
    );
    await saveTemplate(
      {},
      form({
        id: entry,
        expected_version: "0",
        title: "Fikcyjny materiał",
        body,
      }),
    );
    expect(mocks.rpc).toHaveBeenLastCalledWith(
      "save_care_template",
      expect.objectContaining({ p_body: expected }),
    );
  });
  it("applies the body limit to the visible textarea text rather than CRLF transport bytes", async () => {
    const visible = "x\n".repeat(9999) + "xx";
    const submitted = visible.replaceAll("\n", "\r\n");
    const actions = [
      (body: string) => savePlan({}, form({ ...plan, body })),
      (body: string) =>
        saveTemplate(
          {},
          form({
            id: entry,
            expected_version: "0",
            title: "Fikcyjny materiał",
            body,
          }),
        ),
    ];
    for (const action of actions) {
      expect((await action(submitted)).error).toBeUndefined();
      expect(mocks.rpc.mock.lastCall?.[1].p_body).toBe(visible);
      mocks.rpc.mockClear();
      expect((await action(submitted + "x")).error).toBeTruthy();
      expect(mocks.rpc).not.toHaveBeenCalled();
    }
  });
  it.each([
    { body: " " },
    { title: "x" },
    { expected_version: "-1" },
    { dog_id: "other" },
    { consultation_id: "wrong-meeting" },
    { follow_up_on: "2026-02-30" },
    { intent: "email-everyone" },
  ])(
    "rejects malformed plan values without a database call: %s",
    async (change) => {
      const result = await savePlan(
        { version: 4 },
        form({ ...plan, ...change }),
      );
      expect(result.error).toBeTruthy();
      expect(result.version).toBe(4);
      expect(mocks.rpc).not.toHaveBeenCalled();
    },
  );
  it("preserves the acknowledged version and useful conflict text", async () => {
    mocks.rpc.mockResolvedValue({
      error: {
        message: "Plan zmienił się. Skopiuj swoje zmiany i odśwież widok.",
      },
    });
    const result = await savePlan({ version: 4 }, form(plan));
    expect(result.version).toBe(4);
    expect(result.error).toContain("Skopiuj");
    expect(mocks.refresh).not.toHaveBeenCalled();
  });
  it("does not leak a raw database error or lose version on a network failure", async () => {
    mocks.rpc.mockRejectedValue(new Error("secret connection details"));
    const result = await savePlan({ version: 4 }, form(plan));
    expect(result.version).toBe(4);
    expect(result.error).toContain("Twoja treść");
    expect(result.error).not.toContain("secret");
  });
  it("cannot publish when session authorization rejects the request", async () => {
    mocks.session.mockRejectedValue(new Error("Forbidden"));
    await expect(savePlan({}, form(plan))).rejects.toThrow("Forbidden");
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("requires a guardian and lets the database derive dog and author", async () => {
    const result = await submitProgress(
      {},
      form({
        id: entry,
        plan_id: planId,
        attempted: "Nasza odpowiedź",
        went_well: "",
        difficult: "Pytanie",
        dog_id: "forged",
        author_id: "forged",
      }),
    );
    expect(mocks.session).toHaveBeenCalledWith("client");
    expect(mocks.rpc).toHaveBeenCalledWith("submit_care_progress", {
      p_id: entry,
      p_plan: planId,
      p_attempted: "Nasza odpowiedź",
      p_went_well: "",
      p_difficult: "Pytanie",
    });
    expect(result.success).toContain("Odpowiedź zapisana");
  });
  it("rejects empty progress and fields over the limit", async () => {
    for (const attempted of [" ", "a".repeat(3001)]) {
      expect(
        (
          await submitProgress(
            {},
            form({
              id: entry,
              plan_id: planId,
              attempted,
              went_well: "",
              difficult: "",
            }),
          )
        ).error,
      ).toBeTruthy();
    }
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("validates library edits and requires staff", async () => {
    await saveTemplate(
      {},
      form({ id: entry, expected_version: "2", title: "Tytuł", body: "Treść" }),
    );
    expect(mocks.session).toHaveBeenCalledWith("admin");
    expect(mocks.rpc).toHaveBeenCalledWith("save_care_template", {
      p_id: entry,
      p_expected_version: 2,
      p_title: "Tytuł",
      p_body: "Treść",
    });
  });
  it("requires staff for explicit response review", async () => {
    await reviewProgress({}, form({ id: entry }));
    expect(mocks.session).toHaveBeenCalledWith("admin");
    expect(mocks.rpc).toHaveBeenCalledWith("review_care_progress", {
      p_id: entry,
    });
  });
  it("bounds pagination input and keeps calendar dates stable", () => {
    expect(carePage("-1")).toBe(1);
    expect(carePage("bad")).toBe(1);
    expect(carePage("1000000000")).toBe(1);
    expect(carePage("2")).toBe(2);
    expect(careDate("2026-10-25")).toBe("25 października 2026");
  });
});
