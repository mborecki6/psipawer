import { getNotificationInbox } from "./queries";
import { NotificationInboxView } from "./views";
import { notificationFilter } from "./types";
import { requireSession } from "@/lib/auth/session";
import { pushConfiguration } from "@/lib/push-policy.mjs";
import { PushSettings } from "@/modules/push/settings";
export async function NotificationsPage({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string; before?: string }>;
}) {
  const search = await searchParams;
  const filter = notificationFilter(search.filter);
  const { user } = await requireSession();
  const push = pushConfiguration(process.env);
  return (
    <NotificationInboxView
      {...await getNotificationInbox(filter, search.before)}
      filter={filter}
      deviceSettings={
        <details>
          <summary>Ustawienia powiadomień na urządzeniu</summary>
          <PushSettings userId={user.id} publicKey={push?.publicKey || null} />
        </details>
      }
    />
  );
}
