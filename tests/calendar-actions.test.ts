import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  rpc: vi.fn(),
  refresh: vi.fn(),
}));
vi.mock("@/lib/auth/session", () => ({ requireSession: mocks.session }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.refresh }));
import {
  saveBlock,
  cancelBlock,
  saveCalendarSettings,
} from "../src/modules/calendar/actions";
import { weekRange, onDay, localDate } from "../src/modules/calendar/dates";
const input = {
  id: "90000000-0000-4000-8000-000000000001",
  expected_version: "0",
  title: "Prywatna przerwa",
  starts_at: "2026-10-01T10:00",
  ends_at: "2026-10-01T11:00",
};
function form(overrides: Record<string, string | undefined> = {}) {
  const f = new FormData();
  for (const [key, value] of Object.entries({ ...input, ...overrides }))
    if (value !== undefined) f.set(key, value);
  return f;
}
beforeEach(() => {
  vi.resetAllMocks();
  mocks.session.mockResolvedValue({ db: { rpc: mocks.rpc } });
  mocks.rpc.mockResolvedValue({ data: 1, error: null });
});
describe("calendar actions", () => {
  it("requires staff, uses Polish time and ignores forged authors", async () => {
    expect(await saveBlock({}, form({ updated_by: "forged" }))).toMatchObject({
      version: 1,
    });
    expect(mocks.session).toHaveBeenCalledWith("admin");
    expect(mocks.rpc).toHaveBeenCalledWith("save_calendar_block", {
      p_id: input.id,
      p_expected_version: 0,
      p_title: input.title,
      p_starts_at: "2026-10-01T08:00:00.000Z",
      p_ends_at: "2026-10-01T09:00:00.000Z",
    });
  });
  it.each([
    { starts_at: "2027-03-28T02:30" },
    { ends_at: "2026-10-01T09:00" },
    { ends_at: "2026-10-01T10:00" },
    { ends_at: "2028-10-01T11:00" },
    { starts_at: "2026-02-30T10:00" },
    { title: "a" },
    { expected_version: "-1" },
  ])("rejects invalid block input: %s", async (change) => {
    expect((await saveBlock({}, form(change))).error).toBeTruthy();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("requires a valid saved version to remove a block", async () => {
    expect((await cancelBlock({}, form())).error).toBeTruthy();
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(
      await cancelBlock({}, form({ expected_version: "1" })),
    ).toMatchObject({ cancelled: true });
    expect(mocks.rpc).toHaveBeenCalledWith("cancel_calendar_block", {
      p_id: input.id,
      p_expected_version: 1,
    });
  });
  it("shows actionable conflicts without leaking infrastructure details", async () => {
    mocks.rpc.mockResolvedValueOnce({
      error: {
        message:
          "Ten czas jest już zajęty przez spacer, konsultację lub blokadę. Sprawdź kalendarz.",
      },
    });
    expect((await saveBlock({}, form())).error).toContain("Sprawdź kalendarz");
    mocks.rpc.mockRejectedValueOnce(new Error("private data"));
    expect((await saveBlock({}, form())).error).not.toContain("private");
  });
});

describe("calendar settings actions", () => {
  const week = Array.from({ length: 7 }, (_, n) => ({
    weekday: n + 1,
    enabled: n < 5,
    start_minute: 540,
    end_minute: 1020,
  }));
  function policyForm(overrides: Record<string, string | undefined> = {}) {
    const f = new FormData();
    for (const [key, value] of Object.entries({
      expected_version: "1",
      hours_enabled: "true",
      before_minutes: "15",
      after_minutes: "20",
      week: JSON.stringify(week),
      ...overrides,
    }))
      if (value !== undefined) f.set(key, value);
    return f;
  }
  it("requires staff and uses the displayed version rather than accepting an injected author", async () => {
    expect(
      await saveCalendarSettings({}, policyForm({ updated_by: "forged" })),
    ).toMatchObject({ version: 1 });
    expect(mocks.session).toHaveBeenCalledWith("admin");
    expect(mocks.rpc).toHaveBeenCalledWith("save_calendar_settings", {
      p_expected_version: 1,
      p_hours_enabled: true,
      p_before_minutes: 15,
      p_after_minutes: 20,
      p_week: week,
    });
  });
  it.each([
    { before_minutes: "" },
    { after_minutes: "121" },
    { hours_enabled: "on" },
    { expected_version: "0" },
    { week: "not JSON" },
    { week: JSON.stringify(week.map((d) => ({ ...d, enabled: false }))) },
    { week: JSON.stringify(week.map((d) => ({ ...d, start_minute: 541 }))) },
    { week: JSON.stringify(week.map((d) => ({ ...d, end_minute: 540 }))) },
    { week: JSON.stringify(week.map(() => week[0])) },
  ])(
    "rejects an incomplete or unsafe policy before calling the database (%j)",
    async (change) => {
      expect(
        (await saveCalendarSettings({}, policyForm(change))).error,
      ).toBeTruthy();
      expect(mocks.rpc).not.toHaveBeenCalled();
    },
  );
  it("shows known conflicts and keeps private response details out of the form", async () => {
    mocks.rpc.mockResolvedValueOnce({
      error: {
        message:
          "Nowe przerwy powodują kolizję istniejących terminów. Najpierw przełóż spotkania lub zmniejsz przerwy.",
      },
    });
    expect((await saveCalendarSettings({}, policyForm())).error).toContain(
      "przełóż spotkania",
    );
    mocks.rpc.mockRejectedValueOnce(new Error("private internal response"));
    expect((await saveCalendarSettings({}, policyForm())).error).not.toContain(
      "private",
    );
    expect(mocks.refresh).not.toHaveBeenCalled();
  });
});
describe("calendar dates in Europe/Warsaw", () => {
  it("uses a real calendar week across both daylight saving changes", () => {
    const spring = weekRange("2027-03-28"),
      autumn = weekRange("2026-10-25");
    expect(spring.start).toBe("2027-03-22");
    expect((Date.parse(spring.to) - Date.parse(spring.from)) / 3600000).toBe(
      167,
    );
    expect((Date.parse(autumn.to) - Date.parse(autumn.from)) / 3600000).toBe(
      169,
    );
  });
  it("falls back on the Polish current date for malformed or impossible dates", () => {
    const now = new Date("2026-09-20T22:10:00Z");
    expect(localDate(now)).toBe("2026-09-21");
    expect(weekRange("2026-02-30", now).start).toBe("2026-09-21");
    expect(weekRange("javascript:foo", now).days).toHaveLength(7);
  });
  it("includes multi-day appointments but does not carry an exact midnight end into the following day", () => {
    const item = {
      starts_at: "2026-09-21T21:00:00Z",
      ends_at: "2026-09-22T22:00:00Z",
    };
    expect(onDay(item, "2026-09-21")).toBe(true);
    expect(onDay(item, "2026-09-22")).toBe(true);
    expect(onDay(item, "2026-09-23")).toBe(false);
  });
});
