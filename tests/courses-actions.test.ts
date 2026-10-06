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
import {
  createCourse,
  requestEnrollment,
  decideEnrollment,
  rescheduleSession,
  recordAttendance,
  changeCourse,
  changeSession,
  editCourse,
  correctAttendance,
  reopenEnrollment,
} from "../src/modules/courses/actions";
const id = "93000000-0000-4000-8000-000000000001",
  service = "60000000-0000-4000-8000-000000000001",
  dog = "92000000-0000-4000-8000-000000000001";
function form(values: Record<string, string | string[]>) {
  const result = new FormData();
  for (const [key, value] of Object.entries(values))
    for (const item of Array.isArray(value) ? value : [value])
      result.append(key, item);
  return result;
}
const create = {
  id,
  service_id: service,
  service_version: "2",
  title: "Cykl próbny",
  capacity: "4",
  public_location: "Okolica parku",
  exact_location: "Prywatna zbiórka",
  starts: ["2028-01-15T14:00", "2028-01-22T14:00"],
};
beforeEach(() => {
  vi.resetAllMocks();
  mocks.session.mockResolvedValue({ db: { rpc: mocks.rpc }, role: "admin" });
  mocks.rpc.mockResolvedValue({ data: 2, error: null });
  mocks.redirect.mockImplementation(() => {
    throw new Error("redirect");
  });
});
describe("course server action boundary", () => {
  it("restricts reopening to staff and strips forged price, guardian and settlement fields", async () => {
    await expect(
      reopenEnrollment(
        {},
        form({
          id,
          expected_version: "3",
          intent: "restore",
          note: "Powrót do udziału",
          charge_cents: "1",
          guardian_id: dog,
          settled_at: "forged",
        }),
      ),
    ).resolves.toMatchObject({ version: 2, success: expect.any(String) });
    expect(mocks.session).toHaveBeenCalledWith("admin");
    expect(mocks.rpc).toHaveBeenCalledWith("reopen_course_enrollment", {
      p_id: id,
      p_expected_version: 3,
      p_action: "restore",
      p_note: "Powrót do udziału",
    });
  });
  it("requires a reason and preserves actionable reopening errors", async () => {
    expect(
      (
        await reopenEnrollment(
          {},
          form({ id, expected_version: "3", intent: "reconsider", note: "" }),
        )
      ).error,
    ).toBeTruthy();
    expect(mocks.rpc).not.toHaveBeenCalled();
    mocks.rpc.mockResolvedValue({
      data: null,
      error: {
        message:
          "Opiekun psa zmienił się. Historycznego zgłoszenia nie można przywrócić.",
      },
    });
    expect(
      (
        await reopenEnrollment(
          {},
          form({
            id,
            expected_version: "3",
            intent: "restore",
            note: "Powrót do udziału",
          }),
        )
      ).error,
    ).toContain("Opiekun psa zmienił");
  });
  it("edits settings with a stable receipt and strips forged prices and status", async () => {
    await expect(
      editCourse(
        {},
        form({
          id,
          expected_version: "2",
          request_id: dog,
          title: "Nowa nazwa",
          capacity: "3",
          note: "Mniejsza grupa",
          price_cents: "1",
          status: "completed",
        }),
      ),
    ).resolves.toMatchObject({ version: 2, success: expect.any(String) });
    expect(mocks.session).toHaveBeenCalledWith("admin");
    expect(mocks.rpc).toHaveBeenCalledWith("edit_course", {
      p_id: id,
      p_expected_version: 2,
      p_request_id: dog,
      p_title: "Nowa nazwa",
      p_capacity: 3,
      p_note: "Mniejsza grupa",
    });
  });
  it("requires a reason and existing version for an attendance correction", async () => {
    const fields = {
      session_id: id,
      enrollment_id: dog,
      expected_version: "1",
      attendance: "excused",
      note: "Usprawiedliwiona nieobecność",
    };
    expect(
      (await correctAttendance({}, form({ ...fields, note: "" }))).error,
    ).toBeTruthy();
    expect(
      (await correctAttendance({}, form({ ...fields, expected_version: "0" })))
        .error,
    ).toBeTruthy();
    expect(mocks.rpc).not.toHaveBeenCalled();
    await correctAttendance({}, form(fields));
    expect(mocks.rpc).toHaveBeenCalledWith("correct_course_attendance", {
      p_session: id,
      p_enrollment: dog,
      p_expected_version: 1,
      p_attendance: "excused",
      p_note: fields.note,
    });
    expect(mocks.session).toHaveBeenCalledWith("admin");
  });
  it("creates from repeated Warsaw dates with session authority and no client-supplied price", async () => {
    mocks.rpc.mockResolvedValue({ data: id, error: null });
    await expect(
      createCourse(
        {},
        form({
          ...create,
          price_cents: "1",
          practice_id: "forged",
          created_by: "forged",
        }),
      ),
    ).rejects.toThrow("redirect");
    expect(mocks.session).toHaveBeenCalledWith("admin");
    expect(mocks.rpc).toHaveBeenCalledWith("create_course", {
      p_id: id,
      p_service: service,
      p_expected_service_version: 2,
      p_title: create.title,
      p_capacity: 4,
      p_public_location: create.public_location,
      p_exact_location: create.exact_location,
      p_starts: ["2028-01-15T13:00:00.000Z", "2028-01-22T13:00:00.000Z"],
    });
    expect(mocks.redirect).toHaveBeenCalledWith(`/admin/courses/${id}`);
  });
  it.each([
    { starts: [] },
    { starts: ["2027-03-28T02:30"] },
    { starts: ["2028-02-30T14:00"] },
    { capacity: "0" },
    { exact_location: "" },
    { service_version: "0" },
  ])("rejects invalid cycle data before writes: %s", async (change) => {
    expect(
      (await createCourse({}, form({ ...create, ...change }))).error,
    ).toBeTruthy();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("requests with a frozen cycle version, strips forged guardian and charge, and requires a client", async () => {
    mocks.rpc.mockResolvedValue({ data: id, error: null });
    expect(
      (
        await requestEnrollment(
          {},
          form({
            id,
            course_id: service,
            course_version: "7",
            dog_id: dog,
            guardian_id: "forged",
            charge_cents: "1",
          }),
        )
      ).success,
    ).toBeTruthy();
    expect(mocks.session).toHaveBeenCalledWith("client");
    expect(mocks.rpc).toHaveBeenCalledWith("request_course_enrollment", {
      p_id: id,
      p_course: service,
      p_dog: dog,
      p_expected_course_version: 7,
    });
  });
  it("restricts decisions to staff and leaves owner cancellation authority to the database", async () => {
    await decideEnrollment(
      {},
      form({ id, expected_version: "1", intent: "accept", note: "" }),
    );
    expect(mocks.session).toHaveBeenLastCalledWith("admin");
    await decideEnrollment(
      {},
      form({
        id,
        expected_version: "2",
        intent: "cancel",
        note: "Zmiana planów",
      }),
    );
    expect(mocks.session).toHaveBeenLastCalledWith(undefined);
  });
  it("requires reasons for refusals and all cancellation scopes", async () => {
    for (const action of [decideEnrollment, changeCourse, changeSession])
      expect(
        (
          await action(
            {},
            form({ id, expected_version: "1", intent: "cancel", note: " " }),
          )
        ).error,
      ).toBeTruthy();
    expect(
      (
        await decideEnrollment(
          {},
          form({ id, expected_version: "1", intent: "reject", note: " " }),
        )
      ).error,
    ).toBeTruthy();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("updates a single meeting and acknowledges only the server's version", async () => {
    expect(
      (
        await rescheduleSession(
          {},
          form({
            id,
            expected_version: "1",
            starts_at: "2028-06-12T14:00",
            public_location: "Park miejski",
            exact_location: "Inny prywatny punkt",
            note: "Uzgodniona zmiana",
          }),
        )
      ).version,
    ).toBe(2);
    expect(mocks.rpc).toHaveBeenCalledWith("reschedule_course_session", {
      p_id: id,
      p_expected_version: 1,
      p_starts_at: "2028-06-12T12:00:00.000Z",
      p_public_location: "Park miejski",
      p_exact_location: "Inny prywatny punkt",
      p_note: "Uzgodniona zmiana",
    });
  });
  it("allows first attendance version zero, without accepting forged staff IDs", async () => {
    await recordAttendance(
      {},
      form({
        session_id: id,
        enrollment_id: dog,
        expected_version: "0",
        attendance: "present",
        updated_by: "forged",
      }),
    );
    expect(mocks.session).toHaveBeenCalledWith("admin");
    expect(mocks.rpc).toHaveBeenCalledWith("record_course_attendance", {
      p_session: id,
      p_enrollment: dog,
      p_expected_version: 0,
      p_attendance: "present",
    });
  });
  it("retains meaningful conflicts and suppresses infrastructure details and ambiguous responses", async () => {
    const fields = form({
      id,
      expected_version: "1",
      intent: "publish",
      note: "",
    });
    mocks.rpc.mockResolvedValueOnce({
      error: { message: "Brak wolnych miejsc na kursie." },
    });
    expect((await changeCourse({}, fields)).error).toContain("Brak wolnych");
    mocks.rpc.mockRejectedValueOnce(new Error("network secret"));
    expect((await changeCourse({}, fields)).error).not.toContain("secret");
    mocks.rpc.mockResolvedValueOnce({ data: null, error: null });
    expect((await changeCourse({}, fields)).version).toBeUndefined();
    mocks.rpc.mockResolvedValueOnce({
      error: { message: "postgres password=private" },
    });
    expect((await changeCourse({}, fields)).error).not.toContain("private");
  });
});
