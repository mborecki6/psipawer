import { randomUUID } from "node:crypto";
import { getCalendar } from "./queries";
import { CalendarView } from "./views";
export async function CalendarPage({
  admin,
  searchParams,
}: {
  admin: boolean;
  searchParams: Promise<{ date?: string }>;
}) {
  const { date } = await searchParams;
  const data = await getCalendar(admin, date);
  return (
    <CalendarView
      {...data}
      admin={admin}
      now={new Date().toISOString()}
      newBlockId={randomUUID()}
    />
  );
}
