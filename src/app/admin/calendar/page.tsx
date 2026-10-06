import { CalendarPage } from "@/modules/calendar/pages";
export default function Page({
  searchParams,
}: {
  searchParams: Promise<{ date?: string }>;
}) {
  return <CalendarPage admin searchParams={searchParams} />;
}
