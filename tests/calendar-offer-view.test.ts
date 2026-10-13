import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
vi.mock(
  "@/modules/calendar/dates",
  async () => import("../src/modules/calendar/dates"),
);
vi.mock(
  "@/modules/services/types",
  async () => import("../src/modules/services/types"),
);
import { CalendarOfferView } from "../src/modules/calendar-offer/views";
import { monthRange } from "../src/modules/calendar/dates";
import type { OfferItem } from "../src/modules/calendar-offer/types";

const item: OfferItem = {
  id: "first",
  source_id: "course",
  kind: "course",
  category: "group",
  title: "Spokojny kurs",
  starts_at: "2026-10-25T10:00:00Z",
  ends_at: "2026-10-25T11:00:00Z",
  public_location: "Publiczny park",
  availability: "available",
  booking_mode: "approval",
  eligibility: "eligible",
  session_ordinal: 2,
  sessions_count: 5,
};
const props = {
  items: [item],
  services: [],
  range: monthRange("2026-10-13"),
  focus: "2026-10-13",
  now: "2026-10-13T10:00:00Z",
  category: "all" as const,
};
it("keeps personal dates separate and links each session to the course enrollment flow", () => {
  const html = renderToStaticMarkup(createElement(CalendarOfferView, props));
  expect(html).toContain('href="/app/calendar"');
  expect(html).toContain('href="/app/courses/course"');
  expect(html).toContain("zapis na cały kurs");
  expect(html).toContain("Nadchodzące · październik 2026");
  expect(html).toContain('id="offer-list"');
  expect(html).toContain('aria-label="Forma zajęć"');
  expect(html).not.toContain("<form");
});
it("shows a full event honestly without an enrollment CTA", () => {
  const html = renderToStaticMarkup(
    createElement(CalendarOfferView, {
      ...props,
      items: [{ ...item, availability: "full" }],
    }),
  );
  expect(html).toContain("Brak wolnych miejsc");
  expect(html).toContain("Sprawdź szczegóły");
  expect(html).not.toContain("Szczegóły i zapisy");
});
it("makes the empty state explicitly monthly and lets categories hide unrelated dates", () => {
  const html = renderToStaticMarkup(
    createElement(CalendarOfferView, { ...props, category: "individual" }),
  );
  expect(html).toContain("Brak nadchodzących zajęć w tym miesiącu");
  expect(html).toContain("Następny miesiąc");
  expect(html).not.toContain("Spokojny kurs");
});
