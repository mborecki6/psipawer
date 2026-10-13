export const dynamic = "force-dynamic";
import { requireSession } from "@/lib/auth/session";
import { Shell } from "@/components/shell";
import { getUnreadCount } from "@/modules/notifications/queries";
import { PushSessionGuard } from "@/modules/push/session-guard";
export default async function Layout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { profile, db, user } = await requireSession("client");
  return (
    <Shell
      role="client"
      name={profile.full_name}
      unreadNotifications={await getUnreadCount(db)}
    >
      <PushSessionGuard userId={user.id} />
      {children}
    </Shell>
  );
}
