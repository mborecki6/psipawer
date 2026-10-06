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
  requestConsultation,
  scheduleConsultation,
  closeConsultation,
  agreeConsultationPrice,
} from "../src/modules/consultations/actions";
const id = "30000000-0000-4000-8000-000000000001";
const dog = "20000000-0000-4000-8000-000000000001";
function form(values: Record<string, string>) {
  const result = new FormData();
  for (const [key, value] of Object.entries(values)) result.set(key, value);
  return result;
}
const schedule = {
  id,
  expected_version: "1",
  starts_at: "2026-10-01T10:00",
  duration_minutes: "60",
  meeting_mode: "online",
  location: "Instrukcja połączenia",
  note: "Uzgodniony termin",
};
beforeEach(() => {
  vi.resetAllMocks();
  mocks.session.mockResolvedValue({ db: { rpc: mocks.rpc }, role: "admin" });
  mocks.rpc.mockResolvedValue({ data: 2, error: null });
  mocks.redirect.mockImplementation(() => {
    throw new Error("redirect");
  });
});
describe("consultation actions", () => {
  const price = {
    id,
    expected_version: "2",
    request_id: "33000000-0000-4000-8000-000000000001",
    amount: "175,50",
    is_test_price: "false",
    note: "Kwota uzgodniona telefonicznie z opiekunem",
  };
  it("agrees a historical amount as staff using the session actor and a persistent request key", async () => {
    await expect(
      agreeConsultationPrice(
        {},
        form({
          ...price,
          actor_id: "forged",
          service_id: "forged",
          guardian_id: "forged",
        }),
      ),
    ).rejects.toThrow("redirect");
    expect(mocks.session).toHaveBeenCalledWith("admin");
    expect(mocks.rpc).toHaveBeenCalledWith("agree_consultation_price", {
      p_id: id,
      p_expected_version: 2,
      p_request_id: price.request_id,
      p_amount_cents: 17550,
      p_is_test_price: false,
      p_note: price.note,
    });
    expect(mocks.refresh).toHaveBeenCalledWith("/app", "layout");
    expect(mocks.redirect).toHaveBeenCalledWith(
      `/admin/consultations/${id}?price_saved=2#rozliczenie`,
    );
  });
  it.each([
    { amount: "0" },
    { amount: "10000,01" },
    { amount: "10.999" },
    { note: "" },
    { request_id: "" },
    { expected_version: "0" },
    { is_test_price: "on" },
  ])(
    "rejects an invalid historical price without writing: %s",
    async (change) => {
      expect(
        (await agreeConsultationPrice({}, form({ ...price, ...change }))).error,
      ).toBeTruthy();
      expect(mocks.rpc).not.toHaveBeenCalled();
    },
  );
  it("keeps historical price conflicts useful and hides backend details", async () => {
    mocks.rpc.mockResolvedValueOnce({
      error: {
        message:
          "Ta konsultacja ma już ustaloną cenę. Zachowujemy wcześniejsze uzgodnienie.",
      },
    });
    expect((await agreeConsultationPrice({}, form(price))).error).toContain(
      "wcześniejsze uzgodnienie",
    );
    mocks.rpc.mockResolvedValueOnce({ error: { message: "database secret" } });
    expect((await agreeConsultationPrice({}, form(price))).error).not.toContain(
      "secret",
    );
    mocks.rpc.mockRejectedValueOnce(new Error("network secret"));
    expect((await agreeConsultationPrice({}, form(price))).error).not.toContain(
      "secret",
    );
  });
  it("uses a verified guardian and strips forged ownership fields", async () => {
    await expect(
      requestConsultation(
        {},
        form({
          id,
          dog_id: dog,
          service_id: "60000000-0000-4000-8000-000000000011",
          service_version: "1",
          topic: "Potrzeba konsultacji",
          availability: "Po południu",
          requested_by: "forged",
          practice_id: "forged",
          agreed_price_cents: "1",
          service_name: "forged cheaper service",
        }),
      ),
    ).rejects.toThrow("redirect");
    expect(mocks.session).toHaveBeenCalledWith("client");
    expect(mocks.rpc).toHaveBeenCalledWith("request_consultation", {
      p_id: id,
      p_dog: dog,
      p_service: "60000000-0000-4000-8000-000000000011",
      p_expected_service_version: 1,
      p_topic: "Potrzeba konsultacji",
      p_availability: "Po południu",
    });
    expect(mocks.redirect).toHaveBeenCalledWith(`/app/consultations/${id}`);
  });
  it("converts Warsaw time, requires staff, and acknowledges the saved version", async () => {
    const result = await scheduleConsultation({}, form(schedule));
    expect(mocks.session).toHaveBeenCalledWith("admin");
    expect(mocks.rpc).toHaveBeenCalledWith("change_consultation", {
      p_id: id,
      p_expected_version: 1,
      p_action: "schedule",
      p_starts_at: "2026-10-01T08:00:00.000Z",
      p_duration: 60,
      p_mode: "online",
      p_location: schedule.location,
      p_note: schedule.note,
    });
    expect(result.version).toBe(2);
    expect(mocks.refresh).toHaveBeenCalledWith("/app", "layout");
  });
  it.each([
    { starts_at: "2027-03-28T02:30" },
    { starts_at: "2026-02-30T10:00" },
    { duration_minutes: "" },
    { duration_minutes: "241" },
    { meeting_mode: "other" },
    { location: "" },
    { expected_version: "0" },
  ])("rejects malformed fields without writing: %s", async (change) => {
    const result = await scheduleConsultation(
      {},
      form({ ...schedule, ...change }),
    );
    expect(result.error).toBeTruthy();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("keeps useful conflict errors but hides infrastructure errors", async () => {
    mocks.rpc.mockResolvedValueOnce({
      error: {
        message: "Konsultacja zmieniła się. Odśwież widok przed zapisem.",
      },
    });
    expect((await scheduleConsultation({}, form(schedule))).error).toContain(
      "zmieniła się",
    );
    mocks.rpc.mockResolvedValueOnce({
      error: { message: "postgres password=private" },
    });
    expect(
      (await scheduleConsultation({}, form(schedule))).error,
    ).not.toContain("private");
    mocks.rpc.mockRejectedValueOnce(new Error("network secret"));
    expect(
      (await scheduleConsultation({}, form(schedule))).error,
    ).not.toContain("secret");
  });
  it("requires staff for completion", async () => {
    await expect(
      closeConsultation(
        {},
        form({ id, expected_version: "2", intent: "complete", note: "" }),
      ),
    ).rejects.toThrow("redirect");
    expect(mocks.session).toHaveBeenCalledWith("admin");
    expect(mocks.rpc).toHaveBeenCalledWith(
      "change_consultation",
      expect.objectContaining({ p_action: "complete", p_starts_at: null }),
    );
  });
  it("uses the session role for cancellation destination, without accepting arbitrary redirects", async () => {
    mocks.session.mockResolvedValueOnce({
      db: { rpc: mocks.rpc },
      role: "client",
    });
    await expect(
      closeConsultation(
        {},
        form({
          id,
          expected_version: "2",
          intent: "cancel",
          note: "Zmiana planów",
          next: "https://evil.test",
        }),
      ),
    ).rejects.toThrow("redirect");
    expect(mocks.redirect).toHaveBeenCalledWith(`/app/consultations/${id}`);
  });
  it("requires a cancellation reason", async () => {
    const result = await closeConsultation(
      {},
      form({ id, expected_version: "2", intent: "cancel", note: "" }),
    );
    expect(result.error).toBeTruthy();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});
