import { beforeEach, afterEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ calendar: vi.fn() }));
vi.mock("../src/modules/calendar/queries", () => ({
  getCalendar: mocks.calendar,
}));
vi.mock("../src/modules/calendar/views", () => ({ CalendarView: () => null }));
import { CalendarPage } from "../src/modules/calendar/pages";

const event = "course:10000000-0000-4000-8000-000000000010:1791874800000";
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-14T08:00:00Z"));
  mocks.calendar.mockReset().mockResolvedValue({ members: [] });
});
afterEach(() => vi.useRealTimers());

it("opens the administrator's calendar in the month and keeps the client's weekly default", async () => {
  expect(
    (await CalendarPage({ admin: true, searchParams: Promise.resolve({}) }))
      .props.view,
  ).toBe("month");
  expect(
    (await CalendarPage({ admin: false, searchParams: Promise.resolve({}) }))
      .props.view,
  ).toBe("week");
});

it("opens a linked session in its selected day and preserves the event identity", async () => {
  const result = await CalendarPage({
    admin: true,
    searchParams: Promise.resolve({ date: "2026-10-13", event }),
  });
  expect(result.props).toMatchObject({
    view: "week",
    focusDate: "2026-10-13",
    selectedEvent: event,
  });
  expect(mocks.calendar).toHaveBeenCalledWith(true, "2026-10-13", "week");
});

it("respects an explicit view and normalizes invalid dates before querying", async () => {
  const result = await CalendarPage({
    admin: true,
    searchParams: Promise.resolve({
      date: "2026-02-30",
      view: "week",
      event: "forged",
    }),
  });
  expect(result.props).toMatchObject({
    view: "week",
    focusDate: "2026-10-14",
    selectedEvent: undefined,
  });
  expect(mocks.calendar).toHaveBeenCalledWith(true, "2026-10-14", "week");
});
