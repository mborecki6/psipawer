import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  rpc: vi.fn(),
  refresh: vi.fn(),
}));
vi.mock("@/lib/auth/session", () => ({ requireSession: mocks.session }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.refresh }));
import { changeFollowUp } from "../src/modules/work/actions";
import {
  workFilter,
  workPage,
  workHref,
  type WorkItem,
} from "../src/modules/work/types";
const input = {
  id: "90000000-0000-4000-8000-000000000001",
  expected_version: "1",
  intent: "rescheduled",
  due_on: "2026-10-05",
  note: "Uzgodniona zmiana terminu",
};
function form(changes: Record<string, string | undefined> = {}) {
  const f = new FormData();
  for (const [k, v] of Object.entries({ ...input, ...changes }))
    if (v !== undefined) f.set(k, v);
  return f;
}
beforeEach(() => {
  vi.resetAllMocks();
  mocks.session.mockResolvedValue({ db: { rpc: mocks.rpc } });
  mocks.rpc.mockResolvedValue({ data: 2, error: null });
});
describe("work queue and follow-up actions", () => {
  it("requires staff and sends only a versioned intent with a private note", async () => {
    expect(
      await changeFollowUp(
        {},
        form({ updated_by: "forged", status: "done", dog_id: "forged" }),
      ),
    ).toMatchObject({ version: 2, status: "open" });
    expect(mocks.session).toHaveBeenCalledWith("admin");
    expect(mocks.rpc).toHaveBeenCalledWith("change_care_follow_up", {
      p_id: input.id,
      p_expected_version: 1,
      p_action: "rescheduled",
      p_due_on: "2026-10-05",
      p_note: input.note,
    });
    expect(mocks.refresh).toHaveBeenCalledWith("/app", "layout");
  });
  it("does not carry a hidden stale date when completing a contact", async () => {
    expect(
      await changeFollowUp(
        {},
        form({ intent: "completed", due_on: "2099-12-31" }),
      ),
    ).toMatchObject({ status: "done" });
    expect(mocks.rpc).toHaveBeenCalledWith(
      "change_care_follow_up",
      expect.objectContaining({ p_due_on: null, p_action: "completed" }),
    );
  });
  it.each([
    { note: "" },
    { note: "   " },
    { due_on: "2026-02-30" },
    { due_on: "2026-99-99" },
    { due_on: "" },
    { expected_version: "0" },
    { intent: "delete" },
  ])("rejects invalid inputs without database changes: %s", async (change) => {
    expect((await changeFollowUp({}, form(change))).error).toBeTruthy();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("keeps useful conflict messages and hides technical errors", async () => {
    mocks.rpc.mockResolvedValueOnce({
      error: { message: "Kontakt zmienił się. Odśwież widok przed zapisem." },
    });
    expect((await changeFollowUp({}, form())).error).toContain("zmienił się");
    mocks.rpc.mockRejectedValueOnce(new Error("private database detail"));
    expect((await changeFollowUp({}, form())).error).not.toContain("private");
  });
  it("validates filters and page bounds and creates stable links for each work type", () => {
    expect(workFilter("__proto__")).toBe("all");
    expect(workFilter("walks")).toBe("walks");
    expect(workPage("999999")).toBe(50000);
    expect(workPage("-1")).toBe(1);
    const item = { id: input.id, dog_id: "dog", source_id: "walk" } as WorkItem;
    expect(workHref({ ...item, kind: "walks" })).toBe(
      `/admin/walks/walk#registration-${input.id}`,
    );
    expect(workHref({ ...item, kind: "progress" })).toBe(
      `/admin/work/progress/${input.id}`,
    );
    expect(workHref({ ...item, kind: "followups" })).toBe(
      `/admin/work/follow-ups/${input.id}`,
    );
  });
});
