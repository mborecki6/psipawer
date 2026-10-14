import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
vi.mock("../src/modules/calendar/editor", () => ({
  BlockEditor: () => null,
  CreateBlockEditor: () => null,
  AssignmentEditor: () => null,
}));
import { CalendarView } from "../src/modules/calendar/views";
import {
  appointmentAnchor,
  weekRange,
  monthRange,
} from "../src/modules/calendar/dates";
import type { Appointment } from "../src/modules/calendar/types";

const monday: Appointment = {
  id: "10000000-0000-4000-8000-000000000010",
  kind: "walk",
  title: "Poniedziałkowy spacer",
  starts_at: "2026-10-12T08:00:00Z",
  ends_at: "2026-10-12T09:00:00Z",
  status: "open",
  location: "Park",
  version: null,
  assigned_staff_id: "10000000-0000-4000-8000-000000000002",
  assigned_staff_name: "Administrator",
  created_by_name: "Administrator",
  assignment_version: 1,
};
const tuesday: Appointment = {
  ...monday,
  id: "10000000-0000-4000-8000-000000000011",
  kind: "consultation",
  title: "Wtorkowa konsultacja",
  starts_at: "2026-10-13T10:00:00Z",
  ends_at: "2026-10-13T11:00:00Z",
};
const props = {
  appointments: [tuesday, monday],
  range: weekRange("2026-10-12"),
  admin: true,
  newBlockId: "10000000-0000-4000-8000-000000000020",
  now: "2026-10-12T06:00:00Z",
  focusDate: "2026-10-12",
  members: [
    { user_id: "10000000-0000-4000-8000-000000000001", full_name: "Asia" },
    {
      user_id: "10000000-0000-4000-8000-000000000002",
      full_name: "Administrator",
    },
  ],
  activeMembers: [
    { user_id: "10000000-0000-4000-8000-000000000001", full_name: "Asia" },
  ],
};

it("shows seven day choices and the selected administrator agenda without hiding historical assignments", () => {
  const html = renderToStaticMarkup(createElement(CalendarView, props));
  expect(html).toContain('aria-label="Dni tygodnia"');
  const picker = html.match(/aria-label="Dni tygodnia">([\s\S]*?)<\/nav>/)?.[1];
  expect(picker?.match(/<a /g)).toHaveLength(7);
  expect(html).toContain("Poniedziałkowy spacer");
  expect(html).not.toContain("Wtorkowa konsultacja");
  expect(html).toContain("Administrator");
  expect(html).toMatch(
    /<details><summary>Prowadzący i miejsce<\/summary>.*Przypisanie:.*Administrator.*Wpis dodał\(a\): Administrator/,
  );
});

it.each([true, false])(
  "shows a linked session on its day and preserves its exact anchor, admin=%s",
  (admin) => {
    const html = renderToStaticMarkup(
      createElement(CalendarView, {
        ...props,
        admin,
        focusDate: "2026-10-13",
        selectedEvent: `${tuesday.kind}:${tuesday.id}:${Date.parse(tuesday.starts_at)}`,
      }),
    );
    expect(html).toContain("Wtorkowa konsultacja");
    expect(html).not.toContain("Poniedziałkowy spacer");
    expect(html).toContain(`id="${appointmentAnchor(tuesday)}"`);
    expect(html).toContain(
      'aria-label="Wybrane spotkanie: Wtorkowa konsultacja"',
    );
  },
);

it("shows the same day picker and a private selected-day agenda for the client", () => {
  const html = renderToStaticMarkup(
    createElement(CalendarView, {
      ...props,
      admin: false,
    }),
  );
  expect(html).toContain('aria-label="Dni tygodnia"');
  const picker = html.match(/aria-label="Dni tygodnia">([\s\S]*?)<\/nav>/)?.[1];
  expect(picker?.match(/<a /g)).toHaveLength(7);
  expect(html).toContain("Poniedziałkowy spacer");
  expect(html).not.toContain("Wtorkowa konsultacja");
  expect(html).toContain('href="/app/calendar?date=2026-10-13&amp;view=week"');
  expect(html.match(/<section\b/g)).toHaveLength(1);
  expect(html).not.toContain("Wpis dodał(a)");
  expect(html).not.toContain("Administrator");
  expect(html).not.toContain("Filtr wpisów");
  expect(html).not.toContain("Zarezerwuj czas");
  expect(html).not.toContain("Zaplanuj spotkanie");
});

it.each([
  ["2026-10-14", "2026-10-07", "2026-10-21"],
  ["2026-10-28", "2026-10-21", "2026-11-04"],
])(
  "keeps the client's weekday across week navigation from %s and shows an empty day",
  (day, previous, next) => {
    const html = renderToStaticMarkup(
      createElement(CalendarView, {
        ...props,
        admin: false,
        focusDate: day,
        range: weekRange(day),
      }),
    );
    expect(html).toContain(
      `href="/app/calendar?date=${previous}&amp;view=week"`,
    );
    expect(html).toContain(`href="/app/calendar?date=${next}&amp;view=week"`);
    expect(html).toContain("Nie masz tutaj potwierdzonych terminów.");
    expect(html).not.toContain("<h4>Poniedziałkowy spacer</h4>");
    expect(html).not.toContain("<h4>Wtorkowa konsultacja</h4>");
  },
);

it("keeps month counts and links to the selected day without applying the primary as a filter", () => {
  const html = renderToStaticMarkup(
    createElement(CalendarView, {
      ...props,
      view: "month",
      range: monthRange("2026-10-12"),
    }),
  );
  expect(html).toContain('aria-label="Kalendarz: październik 2026"');
  expect(html).toContain(
    'aria-label="poniedziałek, 12 października: 1 zaplanowanych"',
  );
  expect(html).toContain(
    'href="/admin/calendar?date=2026-10-13&amp;view=week"',
  );
  expect(html).toContain("Poniedziałkowy spacer");
  expect(html).toContain("Wtorkowa konsultacja");
  expect(html).not.toContain('aria-label="Dni tygodnia"');
});

it("includes an overnight reservation on each occupied day, with a midnight end excluded", () => {
  const block: Appointment = {
    ...monday,
    kind: "block",
    title: "Urlop",
    starts_at: "2026-10-24T22:00:00Z",
    ends_at: "2026-10-26T23:00:00Z",
  };
  for (const [day, expected] of [
    ["2026-10-25", true],
    ["2026-10-26", true],
    ["2026-10-27", false],
  ] as const) {
    const html = renderToStaticMarkup(
      createElement(CalendarView, {
        ...props,
        appointments: [block],
        range: weekRange(day),
        focusDate: day,
      }),
    );
    expect(html.includes("<h4>Urlop</h4>")).toBe(expected);
  }
});

it("orders the selected agenda by time and keeps the empty day selectable", () => {
  const early = {
    ...monday,
    title: "Wcześniej",
    starts_at: "2026-10-12T06:00:00Z",
  };
  const html = renderToStaticMarkup(
    createElement(CalendarView, {
      ...props,
      appointments: [monday, early],
    }),
  );
  expect(html.indexOf("<h4>Wcześniej</h4>")).toBeLessThan(
    html.indexOf("<h4>Poniedziałkowy spacer</h4>"),
  );
  const empty = renderToStaticMarkup(
    createElement(CalendarView, {
      ...props,
      focusDate: "2026-10-14",
    }),
  );
  expect(empty).toContain(
    "Możesz zaplanować spotkanie lub zarezerwować czas dla siebie",
  );
  expect(empty).toContain(
    'href="/admin/calendar?date=2026-10-13&amp;view=week"',
  );
});
