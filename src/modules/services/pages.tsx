import { getServices, getService } from "./queries";
import { ServicesView, ServiceDetailView } from "./views";
import { serviceFilter } from "./catalogue";
type CataloguePageProps = {
  searchParams: Promise<{ category?: string | string[] }>;
};
export async function AdminServicesPage({ searchParams }: CataloguePageProps) {
  const filter = serviceFilter((await searchParams).category);
  return (
    <ServicesView
      services={(await getServices(true)).services}
      admin
      filter={filter}
    />
  );
}
export async function ClientServicesPage({ searchParams }: CataloguePageProps) {
  const filter = serviceFilter((await searchParams).category);
  return (
    <ServicesView
      services={(await getServices()).services}
      admin={false}
      filter={filter}
    />
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
