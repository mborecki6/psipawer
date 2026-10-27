import { randomUUID } from "node:crypto";
import { z } from "zod";
import { getServiceRequestForm, getServiceRequests } from "./queries";
import { RequestFormView, RequestsView } from "./views";
import { requestFilter, requestPage } from "./types";
export type RequestSearch = {
  page?: string | string[];
  filter?: string | string[];
  saved?: string | string[];
  request?: string | string[];
};
export async function ServiceRequestFormPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<RequestSearch>;
}) {
  const { id } = await params;
  const search = await searchParams;
  const page = requestPage(search.page);
  const saved =
    typeof search.saved === "string" && z.uuid().safeParse(search.saved).success
      ? search.saved
      : undefined;
  const focus =
    saved ||
    (typeof search.request === "string" &&
    z.uuid().safeParse(search.request).success
      ? search.request
      : undefined);
  const data = await getServiceRequestForm(id, page, focus);
  return (
    <RequestFormView
      {...data}
      requestId={randomUUID()}
      page={page}
      focused={Boolean(focus)}
      saved={Boolean(
        saved && data.requests.some((request) => request.id === saved),
      )}
    />
  );
}
export async function ServiceRequestsPage({
  admin,
  searchParams,
}: {
  admin: boolean;
  searchParams: Promise<RequestSearch>;
}) {
  const search = await searchParams;
  const page = requestPage(search.page),
    filter = requestFilter(search.filter);
  return (
    <RequestsView
      {...await getServiceRequests(admin, filter, page)}
      admin={admin}
      page={page}
      filter={filter}
    />
  );
}
