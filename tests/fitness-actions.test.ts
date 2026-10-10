import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  rpc: vi.fn(),
  refresh: vi.fn(),
  redirect: vi.fn(),
}));
vi.mock("@/lib/auth/session", () => ({ requireSession: mocks.session }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.refresh }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("@/lib/time", async () => import("../src/lib/time"));
vi.mock("@/lib/finance", async () => import("../src/lib/finance"));
vi.mock(
  "@/lib/validation/schemas",
  async () => import("../src/lib/validation/schemas"),
);
import {
  requestFitness,
  changeFitnessPackage,
  saveFitnessSession,
  changeFitnessSession,
} from "../src/modules/fitness/actions";
import { recordPayment } from "../src/lib/data/finance-actions";
const id = "a3000000-0000-4000-8000-000000000001",
  dog = "a2000000-0000-4000-8000-000000000001",
  service = "60000000-0000-4000-8000-000000000006",
  key = "a4000000-0000-4000-8000-000000000001";
function form(values: Record<string, string | undefined> = {}) {
  const f = new FormData();
  for (const [k, v] of Object.entries({
    id,
    dog_id: dog,
    service_id: service,
    service_version: "2",
    expected_version: "3",
    request_id: key,
    intent: "accept",
    topic: " Cel spotkań ",
    availability: " Po południu ",
    note: " Uzgodniona zmiana ",
    ...values,
  }))
    if (v !== undefined) f.set(k, v);
  return f;
}
beforeEach(() => {
  vi.resetAllMocks();
  mocks.session.mockResolvedValue({ db: { rpc: mocks.rpc } });
  mocks.rpc.mockResolvedValue({ data: 4, error: null });
  mocks.redirect.mockImplementation(() => {
    throw new Error("REDIRECT");
  });
});
it("requests the owned dog using a catalogue version while ignoring forged financial and guardian fields", async () => {
  mocks.rpc.mockResolvedValue({ data: id, error: null });
  await expect(
    requestFitness(
      {},
      form({ guardian_id: "forged", charge_cents: "1", sessions_count: "999" }),
    ),
  ).rejects.toThrow("REDIRECT");
  expect(mocks.session).toHaveBeenCalledWith("client");
  expect(mocks.rpc).toHaveBeenCalledWith("request_fitness_package", {
    p_id: id,
    p_dog: dog,
    p_service: service,
    p_expected_service_version: 2,
    p_topic: "Cel spotkań",
    p_availability: "Po południu",
  });
  expect(mocks.redirect).toHaveBeenCalledWith(`/app/fitness/${id}`);
});
it.each(["accept", "reject", "complete", "restore", "resume", "reconsider"])(
  "requires staff for package action %s and retains original version/key",
  async (intent) => {
    expect(
      (
        await changeFitnessPackage(
          {},
          form({ intent, guardian_id: "forged", charge_cents: "1" }),
        )
      ).version,
    ).toBe(4);
    expect(mocks.session).toHaveBeenCalledWith("admin");
    expect(mocks.rpc).toHaveBeenCalledWith("change_fitness_package", {
      p_id: id,
      p_expected_version: 3,
      p_action: intent,
      p_note: "Uzgodniona zmiana",
      p_request_id: key,
    });
  },
);
it("allows a guardian cancellation entry point but delegates actual ownership to the authenticated RPC", async () => {
  await changeFitnessPackage({}, form({ intent: "cancel" }));
  expect(mocks.session).toHaveBeenCalledWith(undefined);
  expect(mocks.rpc.mock.calls[0][1].p_action).toBe("cancel");
});
it.each(["reject", "cancel", "resume", "restore", "reconsider"])(
  "requires a reason for %s before mutation",
  async (intent) => {
    expect(
      (await changeFitnessPackage({}, form({ intent, note: " " }))).error,
    ).toBeTruthy();
    expect(mocks.rpc).not.toHaveBeenCalled();
  },
);
it("converts the Warsaw date and strips forged duration/price when scheduling", async () => {
  expect(
    (
      await saveFitnessSession(
        {},
        form({
          starts_at: "2028-01-15T14:00",
          location: " Próbny park ",
          duration_minutes: "999",
        }),
      )
    ).version,
  ).toBe(4);
  expect(mocks.session).toHaveBeenCalledWith("admin");
  expect(mocks.rpc).toHaveBeenCalledWith("calendar_write", {
    p_operation: "save_fitness_session",
    p_assignment: null,
    p_confirm_short_break: false,
    p_arguments: {
      p_id: id,
      p_expected_version: 3,
      p_starts_at: "2028-01-15T13:00:00.000Z",
      p_location: "Próbny park",
      p_note: "Uzgodniona zmiana",
      p_request_id: key,
    },
  });
});
it("rejects DST gaps, invalid points, malformed UUIDs and missing versions", async () => {
  for (const values of [
    { starts_at: "2028-03-26T02:30", location: "Park" },
    { starts_at: "2028-01-15T14:00", location: " " },
    { expected_version: "0" },
    { request_id: "bad" },
  ])
    expect((await saveFitnessSession({}, form(values))).error).toBeTruthy();
  expect(mocks.rpc).not.toHaveBeenCalled();
});
it("returns a short-break warning without acknowledging a fitness version or refreshing data", async () => {
  mocks.rpc.mockResolvedValueOnce({
    data: null,
    error: {
      message: "Short break",
      hint: "CALENDAR_SHORT_BREAK",
      details: "[]",
    },
  });
  const warning = await saveFitnessSession(
    {},
    form({ starts_at: "2028-01-15T14:00", location: "Park próbny" }),
  );
  expect(warning.calendarWarning?.signature).toMatch(/^[a-f0-9]{64}$/);
  expect(warning.version).toBeUndefined();
  expect(warning.error).toBeUndefined();
  expect(mocks.refresh).not.toHaveBeenCalled();
});
it.each(["present", "absent", "excused"])(
  "completes explicitly with attendance %s",
  async (attendance) => {
    await changeFitnessSession(
      {},
      form({ intent: "complete", attendance, note: "" }),
    );
    expect(mocks.rpc).toHaveBeenCalledWith("change_fitness_session", {
      p_id: id,
      p_expected_version: 3,
      p_action: "complete",
      p_attendance: attendance,
      p_note: "",
      p_request_id: key,
    });
  },
);
it("rejects unexpected attendance for cancellation/reopening and missing attendance for completion/correction", async () => {
  for (const values of [
    { intent: "cancel", attendance: "present" },
    { intent: "reopen", attendance: "present" },
    { intent: "complete" },
    { intent: "correct" },
    { intent: "correct", attendance: "present", note: "" },
  ])
    expect((await changeFitnessSession({}, form(values))).error).toBeTruthy();
  expect(mocks.rpc).not.toHaveBeenCalled();
});
it("uses the dedicated fitness payment RPC and exact money without sending another target or ownership", async () => {
  mocks.rpc.mockResolvedValue({ data: key, error: null });
  expect(
    (
      await recordPayment(
        {},
        form({
          target_kind: "fitness",
          target_id: id,
          amount: "12,34",
          method: "transfer",
          guardian_id: "forged",
        }),
      )
    ).success,
  ).toBeTruthy();
  expect(mocks.session).toHaveBeenCalledWith("admin");
  expect(mocks.rpc).toHaveBeenCalledWith("record_fitness_payment", {
    p_package: id,
    p_amount_cents: 1234,
    p_method: "transfer",
    p_note: "Uzgodniona zmiana",
    p_request_id: key,
  });
});
it("preserves useful conflicts, hides internal errors and never refreshes a failed write", async () => {
  const message = "Pakiet zmienił się. Odśwież widok przed zapisem.";
  mocks.rpc.mockResolvedValueOnce({ data: null, error: { message } });
  expect((await changeFitnessPackage({}, form())).error).toBe(message);
  mocks.rpc.mockRejectedValueOnce(new Error("private database details"));
  expect(
    (
      await saveFitnessSession(
        {},
        form({ starts_at: "2028-01-15T14:00", location: "Park" }),
      )
    ).error,
  ).not.toContain("private");
  expect(mocks.refresh).not.toHaveBeenCalled();
});
it("rejects invalid or unchanged acknowledgement versions and cannot bypass session authorization", async () => {
  for (const data of [null, "4", 3, 2, 3.5]) {
    mocks.rpc.mockResolvedValueOnce({ data, error: null });
    expect((await changeFitnessPackage({}, form())).error).toBeTruthy();
  }
  expect(mocks.refresh).not.toHaveBeenCalled();
  mocks.session.mockRejectedValue(new Error("FORBIDDEN"));
  await expect(
    changeFitnessSession(
      {},
      form({ intent: "complete", attendance: "present" }),
    ),
  ).rejects.toThrow("FORBIDDEN");
});
