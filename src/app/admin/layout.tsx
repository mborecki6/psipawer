export const dynamic = "force-dynamic";
import { requireSession } from "@/lib/auth/session";
import { Shell } from "@/components/shell";
import { getUnreadCount } from "@/modules/notifications/queries";
export default async function Layout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { profile, db } = await requireSession("admin");
  return (
    <Shell
      role="admin"
      name={profile.full_name}
      unreadNotifications={await getUnreadCount(db)}
    >
      {children}
    </Shell>
  );
}
