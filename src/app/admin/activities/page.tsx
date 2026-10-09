import { requireSession } from "@/lib/auth/session";
import { AdminActivities } from "@/components/admin-workspace";
export default async function Page() {
  await requireSession("admin");
  return <AdminActivities />;
}
