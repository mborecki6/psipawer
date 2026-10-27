import { randomUUID } from "node:crypto";
import { redirect } from "next/navigation";
import {
  getConsultations,
  getConsultation,
  getConsultationDogs,
  getControlInvitation,
} from "./queries";
import {
  ConsultationView,
  ConsultationListView,
  ConsultationRequestView,
} from "./views";
import { consultationFilter, consultationPage } from "./types";
import { getServices } from "@/modules/services/queries";
import { getConsultationCare } from "@/modules/care/queries";
import { WorkReturnLink } from "@/modules/work/return-link";
export async function ConsultationsPage({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string; page?: string; dog?: string }>;
}) {
  const search = await searchParams;
  const filter = consultationFilter(search.filter),
    page = consultationPage(search.page);
  return (
    <ConsultationListView
      {...await getConsultations(filter, page, search.dog)}
      filter={filter}
      page={page}
      dogId={search.dog}
    />
  );
}
export async function ConsultationPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{
    page?: string;
    plans?: string;
    price_saved?: string;
    returnTo?: string;
  }>;
}) {
  const { id } = await params;
  const search = await searchParams;
  const page = consultationPage(search.page),
    plansPage = consultationPage(search.plans);
  const [data, care] = await Promise.all([
    getConsultation(id, page),
    getConsultationCare(id, plansPage),
  ]);
  const priceVersion =
    search.price_saved && /^\d{1,10}$/.test(search.price_saved)
      ? Number(search.price_saved)
      : null;
  const priceSaved =
    priceVersion !== null &&
    data.history.some(
      (h) => h.action === "price_agreed" && h.version === priceVersion,
    );
  return (
    <>
      {data.role === "admin" && <WorkReturnLink target={search.returnTo} />}
      <ConsultationView
        {...data}
        care={care}
        plansPage={plansPage}
        priceRequestId={randomUUID()}
        priceSaved={priceSaved}
        confirmedPriceVersion={
          priceSaved && data.consultation.version === priceVersion
            ? priceVersion!
            : undefined
        }
        page={page}
        now={new Date().toISOString()}
      />
    </>
  );
}
export async function ConsultationRequestPage({
  searchParams,
}: {
  searchParams: Promise<{ dog?: string; service?: string; control?: string }>;
}) {
  const [dogs, { services }, search] = await Promise.all([
    getConsultationDogs(),
    getServices(false, "consultation"),
    searchParams,
  ]);
  const invitation = search.control
    ? await getControlInvitation(search.control)
    : null;
  if (invitation?.consultation_id)
    redirect(`/app/consultations/${invitation.consultation_id}`);
  return (
    <ConsultationRequestView
      dogs={invitation ? dogs.filter((d) => d.id === invitation.dog_id) : dogs}
      controlInvitation={invitation}
      services={services}
      serviceId={search.service}
      id={randomUUID()}
      dogId={invitation?.dog_id || search.dog}
    />
  );
}
