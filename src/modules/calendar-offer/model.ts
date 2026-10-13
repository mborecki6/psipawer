import { localDate, validCalendarDate } from "../calendar/dates";
import { serviceCategory } from "../services/catalogue";
import type { Service } from "../services/types";
import { offerCategories, type OfferCategory, type OfferItem } from "./types";

export function offerFilter(value?: string | string[]): OfferCategory {
  return typeof value === "string" && Object.hasOwn(offerCategories, value)
    ? (value as OfferCategory)
    : "all";
}
export function offerDay(value: string | string[] | undefined, focus: string) {
  return typeof value === "string" &&
    validCalendarDate(value) === value &&
    value.slice(0, 7) === focus.slice(0, 7)
    ? value
    : undefined;
}
export function offerHref(item: Pick<OfferItem, "kind" | "source_id">) {
  return `/app/${item.kind === "walk" ? "walks" : "courses"}/${item.source_id}`;
}
export function offerStatus(item: OfferItem) {
  return {
    available: "Wolne miejsca",
    full: "Brak wolnych miejsc",
    closed: "Zapisy zamknięte",
    cancelled: "Odwołane",
    past: "Termin minął",
  }[item.availability];
}
export function offerBookingNote(item: OfferItem) {
  if (item.availability !== "available")
    return item.availability === "full"
      ? "Szczegóły i ewentualną listę rezerwową sprawdzisz w zapisach."
      : "Nowy zapis na ten termin nie jest dostępny.";
  if (item.eligibility === "invitation_only")
    return "Spacer na zaproszenie. Sprawdź swoje zgłoszenie.";
  if (item.eligibility === "registered")
    return "Twoje psy mają już zgłoszenie. Sprawdź jego status w szczegółach.";
  if (item.eligibility === "needs_dog")
    return "Przed zgłoszeniem dodaj profil swojego psa.";
  if (item.eligibility === "qualification_required")
    return "Przed zgłoszeniem potrzebna jest kwalifikacja psa przez prowadzącą.";
  return item.kind === "course"
    ? "Zgłoszenie dotyczy całego kursu i wymaga decyzji prowadzącej."
    : item.booking_mode === "approval"
      ? "Zgłoszenie wymaga decyzji prowadzącej."
      : "Dostępność i kwalifikację potwierdzimy przy zapisie.";
}
export function listOffer(
  items: OfferItem[],
  focus: string,
  now: string,
  day?: string,
) {
  return items.filter((item) =>
    day
      ? localDate(item.starts_at) === day
      : localDate(item.starts_at).slice(0, 7) === focus.slice(0, 7) &&
        Date.parse(item.starts_at) > Date.parse(now),
  );
}
export function individualServices(services: Service[]) {
  return services.filter(
    (service) => service.active && serviceCategory(service) === "individual",
  );
}
export function arrangeServiceHref(
  service: Pick<Service, "id" | "booking_flow" | "kind">,
) {
  if (service.kind === "course") return `/app/services/${service.id}/request`;
  if (service.booking_flow === "consultation")
    return `/app/consultations/new?service=${service.id}`;
  if (service.booking_flow === "fitness")
    return `/app/fitness/new?service=${service.id}`;
  return `/app/services/${service.id}/request`;
}
