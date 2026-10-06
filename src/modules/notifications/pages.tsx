import { getNotificationInbox } from "./queries";
import { NotificationInboxView } from "./views";
import { notificationFilter } from "./types";
export async function NotificationsPage({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string; before?: string }>;
}) {
  const search = await searchParams;
  const filter = notificationFilter(search.filter);
  return (
    <NotificationInboxView
      {...await getNotificationInbox(filter, search.before)}
      filter={filter}
    />
  );
}
