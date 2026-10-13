import { CalendarOfferPage } from "@/modules/calendar-offer/pages";
import type { OfferSearch } from "@/modules/calendar-offer/types";

export default function Page({
  searchParams,
}: {
  searchParams: Promise<OfferSearch>;
}) {
  return <CalendarOfferPage searchParams={searchParams} />;
}
