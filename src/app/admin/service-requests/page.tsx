import {
  ServiceRequestsPage,
  type RequestSearch,
} from "@/modules/service-requests/pages";
export default function Page({
  searchParams,
}: {
  searchParams: Promise<RequestSearch>;
}) {
  return <ServiceRequestsPage admin searchParams={searchParams} />;
}
