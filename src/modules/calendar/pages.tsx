import { randomUUID } from "node:crypto";
import { getCalendar } from "./queries";
import { CalendarView } from "./views";
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
  const mode = view === "month" ? "month" : "week";
  const data = await getCalendar(admin, date, mode);
  const selectedStaff =
    admin &&
    (staff === "unassigned" ||
      data.members.some((member) => member.user_id === staff))
      ? staff
      : "all";
  const selectedEvent =
    typeof event === "string" &&
    /^(walk|consultation|course|fitness|block):[0-9a-f-]{36}:\d{12,13}$/i.test(
      event,
    )
      ? event
      : undefined;
  return (
    <CalendarView
      {...data}
      admin={admin}
      view={mode}
      selectedStaff={selectedStaff}
      selectedEvent={selectedEvent}
      focusDate={typeof date === "string" ? date : undefined}
      now={new Date().toISOString()}
      newBlockId={randomUUID()}
    />
  );
}
