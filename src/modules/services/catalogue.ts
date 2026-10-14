import type { Service } from "./types";

export const serviceCategories = {
  all: "Wszystkie",
  individual: "Indywidualne",
  group: "Grupowe",
  voucher: "Karty podarunkowe",
  other: "Pozostałe",
};
export type ServiceCategory = keyof typeof serviceCategories;
export type ClientServiceCategory = Exclude<ServiceCategory, "all" | "voucher">;

export function serviceFilter(value?: string | string[]): ServiceCategory {
  return typeof value === "string" && Object.hasOwn(serviceCategories, value)
    ? (value as ServiceCategory)
    : "all";
}

export function clientServiceFilter(
  value?: string | string[],
): ClientServiceCategory | null {
  const category = serviceFilter(value);
  return category === "individual" ||
    category === "group" ||
    category === "other"
    ? category
    : null;
}

export function serviceCategory(
  service: Pick<Service, "kind" | "course_format" | "booking_flow">,
): Exclude<ServiceCategory, "all"> {
  if (service.kind === "course") return service.course_format ?? "other";
  if (service.kind !== "package") return service.kind;
  if (service.booking_flow === "fitness") return "individual";
  if (service.booking_flow === "walk") return "group";
  return "other";
}
