import { describe, expect, it } from "vitest";
import { localDate, monthRange } from "../src/modules/calendar/dates";
import {
  arrangeServiceHref,
  individualServices,
  listOffer,
  offerBookingNote,
  offerDay,
  offerFilter,
  offerHref,
  offerStatus,
} from "../src/modules/calendar-offer/model";
import type { OfferItem } from "../src/modules/calendar-offer/types";
import type { Service } from "../src/modules/services/types";

const item: OfferItem = {
  id: "session",
  source_id: "course",
  kind: "course",
  category: "group",
  title: "Kurs",
  starts_at: "2026-10-25T01:30:00Z",
  ends_at: "2026-10-25T02:30:00Z",
  public_location: "Park",
  availability: "available",
  booking_mode: "approval",
  eligibility: "eligible",
  session_ordinal: 2,
  sessions_count: 5,
};
describe("calendar offer decisions and Warsaw dates", () => {
  it("keeps booking at the existing source detail and describes approval for the entire cycle", () => {
    expect(offerHref(item)).toBe("/app/courses/course");
    expect(offerHref({ kind: "walk", source_id: "walk" })).toBe(
      "/app/walks/walk",
    );
    expect(offerBookingNote(item)).toContain("całego kursu");
    expect(offerBookingNote(item)).toContain("decyzji");
  });
  it("never offers a new booking for closed, cancelled and past dates", () => {
    for (const availability of ["closed", "cancelled", "past"] as const) {
      expect(offerBookingNote({ ...item, availability })).toContain(
        "nie jest dostępny",
      );
      expect(offerStatus({ ...item, availability })).not.toBe("Wolne miejsca");
    }
    expect(offerStatus({ ...item, availability: "full" })).toBe(
      "Brak wolnych miejsc",
    );
    expect(
      offerBookingNote({ ...item, eligibility: "qualification_required" }),
    ).toContain("kwalifikacja");
    expect(offerBookingNote({ ...item, eligibility: "registered" })).toContain(
      "już zgłoszenie",
    );
    expect(
      offerBookingNote({ ...item, eligibility: "invitation_only" }),
    ).toContain("zaproszenie");
  });
  it("groups late UTC times by Warsaw date and keeps the default list future and inside the selected month", () => {
    const last = { ...item, id: "last", starts_at: "2026-10-31T23:30:00Z" };
    const first = { ...item, id: "first", starts_at: "2026-09-30T22:30:00Z" };
    expect(localDate(last.starts_at)).toBe("2026-11-01");
    expect(
      listOffer([last, first, item], "2026-10-01", "2026-10-02T00:00:00Z"),
    ).toEqual([item]);
    expect(
      listOffer(
        [last, first, item],
        "2026-10-01",
        "2026-10-26T00:00:00Z",
        "2026-10-25",
      ),
    ).toEqual([item]);
  });
  it("uses Warsaw midnight on both sides of autumn and spring clock changes", () => {
    const autumn = monthRange("2026-10-13");
    expect(autumn.from).toBe("2026-09-27T22:00:00.000Z");
    expect(autumn.to).toBe("2026-11-01T23:00:00.000Z");
    const spring = monthRange("2026-03-13");
    expect(spring.from).toBe("2026-02-22T23:00:00.000Z");
    expect(spring.to).toBe("2026-04-05T22:00:00.000Z");
    expect(new Set(autumn.days).size).toBe(autumn.days.length);
  });
  it("does not accept repeated or invalid category/date query parameters", () => {
    expect(offerFilter(["group", "individual"])).toBe("all");
    expect(offerFilter("toString")).toBe("all");
    expect(offerFilter("group")).toBe("group");
    expect(offerDay("2026-02-30", "2026-02-01")).toBeUndefined();
    expect(offerDay("2026-11-01", "2026-10-01")).toBeUndefined();
    expect(offerDay("2026-10-25", "2026-10-01")).toBe("2026-10-25");
  });
  it("provides a real service-specific path for individually arranged services, without inventing a slot", () => {
    const service = {
      id: "service",
      active: true,
      kind: "individual",
      booking_flow: "consultation",
    } as Service;
    expect(arrangeServiceHref(service)).toBe(
      "/app/consultations/new?service=service",
    );
    expect(arrangeServiceHref({ ...service, booking_flow: "fitness" })).toBe(
      "/app/fitness/new?service=service",
    );
    expect(arrangeServiceHref({ ...service, booking_flow: "catalogue" })).toBe(
      "/app/services/service/request",
    );
    const course = {
      ...service,
      kind: "course" as const,
      course_format: "individual" as const,
    };
    expect(
      individualServices([
        service,
        { ...service, active: false },
        { ...service, kind: "group" },
        course,
      ]),
    ).toEqual([service, course]);
  });
});
