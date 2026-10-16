import { renderToStaticMarkup } from "react-dom/server";
import { notFound, redirect } from "next/navigation";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ActionState, FormAction } from "../src/components/action-form";

const mocks = vi.hoisted(() => ({ reducer: null as FormAction | null }));
vi.mock("react", async () => ({
  ...(await vi.importActual<typeof import("react")>("react")),
  useActionState: (reducer: FormAction) => {
    mocks.reducer = reducer;
    return [{}, () => {}, false];
  },
}));
vi.mock("@/modules/calendar/warning", () => ({ CalendarWarning: () => null }));
import { ActionForm } from "../src/components/action-form";
import { unconfirmedFormMessage } from "../src/components/form-action-recovery";

const failureMessage = "Nie udało się potwierdzić zapisu. Spróbuj ponownie.";
function form(action: FormAction, message?: string) {
  renderToStaticMarkup(
    <ActionForm action={action} failureMessage={message}>
      <input name="name" defaultValue="Figa" />
    </ActionForm>,
  );
  if (!mocks.reducer) throw new Error("Form action was not initialized");
  return mocks.reducer;
}
beforeEach(() => {
  mocks.reducer = null;
});

describe("ActionForm failure handling", () => {
  it("returns an ordinary rejection as a form error and permits the next attempt", async () => {
    const action = vi
      .fn<FormAction>()
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValueOnce({ success: "Zapisano" });
    const execute = form(action, failureMessage);
    const data = new FormData();
    data.set("name", "Figa");
    const state = await execute({}, data);
    expect(state).toEqual({ error: failureMessage });
    expect(await execute(state, data)).toEqual({ success: "Zapisano" });
    expect(action).toHaveBeenNthCalledWith(2, state, data);
    expect(data.get("name")).toBe("Figa");
  });
  it("handles ordinary rejections by default without retaining stale feedback", async () => {
    const execute = form(async () => {
      throw new Error("unexpected failure");
    });
    const previous: ActionState = {
      success: "Poprzedni zapis",
      fields: { name: ["Poprzedni błąd"] },
      calendarWarning: { message: "Poprzednie ostrzeżenie", signature: "old" },
    };
    expect(await execute(previous, new FormData())).toEqual({
      error: unconfirmedFormMessage,
    });
  });
  it.each([
    ["redirect", () => redirect("/login")],
    ["not found", () => notFound()],
  ] as const)(
    "uses the public Next rethrow to preserve %s interrupts",
    async (_, interrupt) => {
      let thrown: unknown;
      try {
        interrupt();
      } catch (error) {
        thrown = error;
      }
      expect(thrown).toBeTruthy();
      const execute = form(async () => {
        throw thrown;
      }, failureMessage);
      await expect(execute({}, new FormData())).rejects.toBe(thrown);
    },
  );
  it("keeps expected field errors and calendar warnings intact", async () => {
    const state: ActionState = {
      error: "Sprawdź dane",
      fields: { name: ["Podaj imię"] },
      calendarWarning: { message: "Sprawdź termin", signature: "fixture" },
    };
    const execute = form(async () => state, failureMessage);
    expect(await execute({}, new FormData())).toBe(state);
  });
});
