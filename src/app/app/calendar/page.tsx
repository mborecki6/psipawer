import { CalendarPage, type CalendarSearch } from "@/modules/calendar/pages";
export default function Page({
  searchParams,
}: {
  searchParams: Promise<CalendarSearch>;
}) {
  return <CalendarPage admin={false} searchParams={searchParams} />;
}
