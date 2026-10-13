import {
  ServiceRequestFormPage,
  type RequestSearch,
} from "@/modules/service-requests/pages";
export default function Page({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<RequestSearch>;
}) {
  return <ServiceRequestFormPage params={params} searchParams={searchParams} />;
}
