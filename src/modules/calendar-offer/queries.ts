import "server-only";
import { requireSession } from "@/lib/auth/session";
import { allRows } from "@/lib/data/queries";
import { monthRange } from "@/modules/calendar/dates";
import { getServices } from "@/modules/services/queries";
import { individualServices } from "./model";
import type { OfferItem } from "./types";

export async function getCalendarOffer(date: string) {
  const { db } = await requireSession("client");
  const range = monthRange(date);
  const [items, catalogue] = await Promise.all([
    allRows<OfferItem>((from, to) =>
      db
        .rpc(
          "calendar_offer",
          { p_from: range.from, p_to: range.to },
          { get: true },
        )
        .order("starts_at")
        .order("kind")
        .order("id")
        .range(from, to),
    ),
    getServices(),
  ]);
  return { items, range, services: individualServices(catalogue.services) };
}
