import { getReminderDetail, getReminderQueue } from "./queries";
import { reminderFilter } from "./types";
import { ReminderQueueView, ReminderDetailView } from "./views";
function pageNumber(raw?: string) {
  return raw && /^\d{1,5}$/.test(raw) ? Math.max(1, Number(raw)) : 1;
}
export async function ReminderQueuePage({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string; page?: string }>;
}) {
  const search = await searchParams;
  const filter = reminderFilter(search.filter);
  const page = pageNumber(search.page);
  return (
    <ReminderQueueView
      {...await getReminderQueue(filter, page)}
      filter={filter}
      page={page}
    />
  );
}
export async function ReminderDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ page?: string }>;
}) {
  const page = pageNumber((await searchParams).page);
  return (
    <ReminderDetailView
      {...await getReminderDetail((await params).id, page)}
      page={page}
    />
  );
}
