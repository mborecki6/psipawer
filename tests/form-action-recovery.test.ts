import { notFound, redirect } from "next/navigation";
import { describe, expect, it, vi } from "vitest";
import {
  unconfirmedFormMessage,
  withFormActionRecovery,
} from "../src/components/form-action-recovery";
import type { ActionState } from "../src/components/action-form";

describe("form action recovery", () => {
  it("keeps the draft version after a lost response and never retries automatically", async () => {
    const data = new FormData();
    data.set("request_id", "38824be7-2597-4cb1-b9b2-f760e0662c8e");
    data.set("expected_version", "8");
    const action = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));
    const execute = withFormActionRecovery(action);
    const previous = {
      version: 8,
      success: "Zapisano poprzednią zmianę",
      fields: { note: ["Stary błąd"] },
      calendarWarning: { message: "Stare ostrzeżenie", signature: "old" },
    };

    expect(await execute(previous, data)).toEqual({
      version: 8,
      error: unconfirmedFormMessage,
    });
    expect(action).toHaveBeenCalledExactlyOnceWith(previous, data);
    expect(data.get("request_id")).toBe("38824be7-2597-4cb1-b9b2-f760e0662c8e");
    expect(data.get("expected_version")).toBe("8");
  });

  it("passes through typed conflicts, field errors, calendar warnings and success", async () => {
    const states: (ActionState & { version?: number })[] = [
      { error: "Wpis zmienił się. Odśwież widok.", version: 8 },
      { error: "Sprawdź dane", fields: { note: ["Uzupełnij powód"] } },
      { calendarWarning: { message: "Sprawdź termin", signature: "new" } },
      { success: "Zapisano", version: 9 },
    ];
    for (const result of states) {
      expect(
        await withFormActionRecovery(async () => result)(
          { version: 8 },
          new FormData(),
        ),
      ).toBe(result);
    }
  });

  it.each([
    ["redirect", () => redirect("/login")],
    ["notFound", () => notFound()],
  ] as const)(
    "preserves the public Next %s control flow",
    async (_, interrupt) => {
      let thrown: unknown;
      try {
        interrupt();
      } catch (error) {
        thrown = error;
      }
      expect(thrown).toBeTruthy();
      const execute = withFormActionRecovery(async () => {
        throw thrown;
      });
      await expect(execute({}, new FormData())).rejects.toBe(thrown);
    },
  );
});
