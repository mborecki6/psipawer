import { requireSession } from "@/lib/auth/session";
import { AdminActivities } from "@/components/admin-workspace";
import { getOpenServiceRequestCount } from "@/modules/service-requests/queries";
import { ServiceRequestsActivityCard } from "@/modules/service-requests/views";
export default async function Page() {
  await requireSession("admin");
  const count = await getOpenServiceRequestCount();
  return (
    <div className="stack">
      <AdminActivities />
      <ServiceRequestsActivityCard count={count} />
    </div>
  );
}
