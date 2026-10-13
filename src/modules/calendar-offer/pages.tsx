import { validCalendarDate } from "@/modules/calendar/dates";
import { getCalendarOffer } from "./queries";
import { offerDay, offerFilter } from "./model";
import { CalendarOfferView } from "./views";
import type { OfferSearch } from "./types";

export async function CalendarOfferPage({
  searchParams,
}: {
  searchParams: Promise<OfferSearch>;
}) {
  const search = await searchParams;
  const now = new Date().toISOString();
  const focus = validCalendarDate(
    typeof search.date === "string" ? search.date : undefined,
    new Date(now),
  );
  const data = await getCalendarOffer(focus);
  return (
    <CalendarOfferView
      {...data}
      focus={focus}
      now={now}
      category={offerFilter(search.category)}
      day={offerDay(search.day, focus)}
    />
  );
}
