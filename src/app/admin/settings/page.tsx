import { requireSession } from "@/lib/auth/session";
import { AdminSettings } from "@/components/admin-workspace";
export default async function Page() {
  await requireSession("admin");
  return <AdminSettings />;
}
