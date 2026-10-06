import { getServices, getService } from "./queries";
import { ServicesView, ServiceDetailView } from "./views";
export async function AdminServicesPage() {
  return <ServicesView services={(await getServices(true)).services} admin />;
}
export async function ClientServicesPage() {
  return (
    <ServicesView services={(await getServices()).services} admin={false} />
  );
}
export async function ServicePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ page?: string }>;
}) {
  const { id } = await params;
  const raw = (await searchParams).page;
  const page = raw && /^\d{1,5}$/.test(raw) ? Math.max(1, Number(raw)) : 1;
  return <ServiceDetailView {...await getService(id, page)} page={page} />;
}
