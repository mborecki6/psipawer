import { randomUUID } from "node:crypto";
import { getCalendar } from "./queries";
import { CalendarView } from "./views";
import { calendarViewMode, validCalendarDate } from "./dates";
export type CalendarSearch = {
  date?: string;
  view?: string;
  event?: string;
  staff?: string;
};
export async function CalendarPage({
  admin,
  searchParams,
}: {
  admin: boolean;
  searchParams: Promise<CalendarSearch>;
}) {
  const { date, view, event, staff } = await searchParams;
  const now = new Date().toISOString();
  const focusDate = validCalendarDate(
    typeof date === "string" ? date : undefined,
    new Date(now),
  );
  const selectedEvent =
    typeof event === "string" &&
    /^(walk|consultation|course|fitness|block):[0-9a-f-]{36}:\d{12,13}$/i.test(
      event,
    )
      ? event
      : undefined;
  const mode = calendarViewMode(admin, view, selectedEvent);
  const data = await getCalendar(admin, focusDate, mode);
  const selectedStaff =
    admin &&
    (staff === "unassigned" ||
      data.members.some((member) => member.user_id === staff))
      ? staff
      : "all";
  return (
    <CalendarView
      {...data}
      admin={admin}
      view={mode}
      selectedStaff={selectedStaff}
      selectedEvent={selectedEvent}
      focusDate={focusDate}
      now={now}
      newBlockId={randomUUID()}
    />
  );
}
