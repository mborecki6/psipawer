import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import type { Snapshot, Walk, Registration } from "../src/lib/data/types";
import type { DashboardActivities } from "../src/modules/dashboard/types";
vi.mock("@/lib/domain", async () => import("../src/lib/domain"));
vi.mock(
  "@/modules/calendar-offer/model",
  async () => import("../src/modules/calendar-offer/model"),
);
vi.mock(
  "@/modules/consultations/types",
  async () => import("../src/modules/consultations/types"),
);
vi.mock(
  "@/modules/courses/types",
  async () => import("../src/modules/courses/types"),
);
vi.mock(
  "@/modules/fitness/types",
  async () => import("../src/modules/fitness/types"),
);
vi.mock(
  "@/modules/service-requests/types",
  async () => import("../src/modules/service-requests/types"),
);
vi.mock(
  "@/components/progressive-details",
  async () => import("../src/components/progressive-details"),
);
import {
  buildDashboardItems,
  dashboardSuggestions,
} from "../src/modules/dashboard/model";
import { DashboardRegistrations } from "../src/modules/dashboard/views";

const now = Date.parse("2030-01-10T12:00:00Z");
const past = "2029-01-01T12:00:00Z";
function setup() {
  const snapshot: Snapshot = {
    dogs: [{ id: "dog", name: "Figa" } as Snapshot["dogs"][number]],
    walks: [],
    registrations: [],
  };
  const activities: DashboardActivities = {
    consultations: [],
    enrollments: [],
    courseSessions: [],
    fitness: [],
    requests: [],
  };
  return { snapshot, activities, now };
}
function walk(id: string, overrides: Partial<Walk> = {}): Walk {
  return {
    id,
    type: "Spacer",
    public_location: "Park",
    status: "open",
    starts_at: past,
    duration_minutes: 60,
    ...overrides,
  } as Walk;
}
function registration(
  id: string,
  overrides: Partial<Registration> = {},
): Registration {
  return {
    id,
    walk_id: id,
    dog_id: "dog",
    status: "accepted",
    attendance: "present",
    ...overrides,
  } as Registration;
}

it("keeps past but unresolved consultations, fitness, date requests and course enrollment states", () => {
  const input = setup();
  input.activities.consultations = [
    {
      id: "c-requested",
      dog_id: "dog",
      service_name: "Konsultacja",
      status: "requested",
      starts_at: null,
      created_at: past,
    },
    {
      id: "c-scheduled",
      dog_id: "dog",
      service_name: "Kontrola",
      status: "scheduled",
      starts_at: past,
      created_at: past,
    },
  ];
  input.activities.fitness = [
    {
      id: "f-active",
      dog_id: "dog",
      service_name: "PSI FITNESS",
      status: "active",
      next_starts_at: past,
      created_at: past,
    },
    {
      id: "f-requested",
      dog_id: "dog",
      service_name: "PSI FITNESS",
      status: "requested",
      next_starts_at: null,
      created_at: past,
    },
  ];
  input.activities.requests = [
    {
      id: "r",
      dog_id: "dog",
      service_id: "service",
      service_name: "Trening",
      status: "open",
      created_at: past,
    },
  ];
  input.activities.enrollments = ["requested", "waitlisted", "accepted"].map(
    (status) => ({
      id: status,
      dog_id: "dog",
      course_id: "cycle",
      status: status as "requested" | "waitlisted" | "accepted",
      created_at: past,
      courses: { title: "Przedszkole", service_name: "Kurs", status: "closed" },
    }),
  );
  const result = buildDashboardItems(input);
  expect(result.current).toHaveLength(8);
  expect(result.history).toEqual([]);
  expect(
    result.current.find((item) => item.key === "consultation:c-scheduled")
      ?.startsAt,
  ).toBe(past);
  const html = renderToStaticMarkup(<DashboardRegistrations {...result} />);
  expect(html).toContain("Termin do ustalenia");
  expect(html).toContain(
    'href="/app/services/service/request?request=r#request-r"',
  );
  expect(html).toContain('href="/app/courses/cycle?enrollment=accepted"');
  expect(html).toContain("Pozostałe bieżące zgłoszenia (4)");
});

it("uses the next scheduled course date, preserves undated courses and excludes completed sessions", () => {
  const input = setup();
  input.activities.enrollments = [
    {
      id: "enrollment",
      dog_id: "dog",
      course_id: "cycle",
      status: "accepted",
      created_at: past,
      courses: { title: "Kurs", service_name: "Usługa", status: "closed" },
    },
  ];
  input.activities.courseSessions = [
    { id: "old", course_id: "cycle", status: "completed", starts_at: past },
    {
      id: "second",
      course_id: "cycle",
      status: "scheduled",
      starts_at: "2030-02-01T12:00:00Z",
    },
    {
      id: "first",
      course_id: "cycle",
      status: "scheduled",
      starts_at: "2030-01-11T12:00:00Z",
    },
  ];
  expect(buildDashboardItems(input).current[0].startsAt).toBe(
    "2030-01-11T12:00:00Z",
  );
  input.activities.courseSessions = [];
  expect(buildDashboardItems(input).current[0].startsAt).toBeNull();
});

it("keeps pending attendance after the walk ends and pending/waitlisted decisions until cancellation or completion", () => {
  const input = setup();
  input.snapshot.walks = [
    walk("attendance", { status: "completed" }),
    walk("pending"),
    walk("waitlisted"),
    walk("cancelled", { status: "cancelled" }),
    walk("completed", { status: "completed" }),
    walk("settled"),
    walk("in-progress", { starts_at: "2030-01-10T11:30:00Z" }),
  ];
  input.snapshot.registrations = [
    registration("attendance", { attendance: "pending" }),
    registration("pending", { status: "pending" }),
    registration("waitlisted", { status: "waitlisted" }),
    registration("cancelled", { status: "pending" }),
    registration("completed", { status: "waitlisted" }),
    registration("settled"),
    registration("in-progress"),
  ];
  const result = buildDashboardItems(input);
  expect(result.current.map((item) => item.key).sort()).toEqual([
    "registration:attendance",
    "registration:in-progress",
    "registration:pending",
    "registration:waitlisted",
  ]);
  expect(result.history.map((item) => item.key).sort()).toEqual([
    "registration:cancelled",
    "registration:completed",
    "registration:settled",
  ]);
  expect(
    result.current.find((item) => item.key === "registration:attendance")
      ?.status,
  ).toContain("zamknięcie obecności");
});

it("keeps closed participation in history without creating a financial home feed", () => {
  const input = setup();
  input.snapshot.walks = [walk("late")];
  input.snapshot.registrations = [
    registration("late", { status: "cancelled_late" }),
  ];
  input.activities.enrollments = [
    {
      id: "cancelled",
      dog_id: "dog",
      course_id: "cycle",
      status: "cancelled",
      created_at: past,
      courses: { title: "Kurs", service_name: "Usługa", status: "cancelled" },
    },
  ];
  const result = buildDashboardItems(input);
  expect(result.current).toEqual([]);
  expect(result.history).toHaveLength(2);
  const html = renderToStaticMarkup(<DashboardRegistrations {...result} />);
  expect(html).toContain('href="/app/walks/late"');
  expect(html).toContain('href="/app/courses/cycle?enrollment=cancelled"');
  expect(html).not.toMatch(/Do zapłaty|Do zwrotu|Sprawdź rozliczenie/);
});

it("keeps the first four organizational next steps and makes the rest available", () => {
  const input = setup();
  input.activities.requests = Array.from({ length: 7 }, (_, i) => ({
    id: String(i),
    dog_id: "dog",
    service_id: "service",
    service_name: `Spotkanie ${i}`,
    status: "open",
    created_at: past,
  }));
  const result = buildDashboardItems(input);
  expect(result.current.map((item) => item.key)).toEqual(
    Array.from({ length: 7 }, (_, i) => `request:${i}`),
  );
  const html = renderToStaticMarkup(<DashboardRegistrations {...result} />);
  expect(html).toContain("Pozostałe bieżące zgłoszenia (3)");
  expect(html).toContain("Spotkanie 6");
});

it("moves closed and settled services to history, including a fully refunded cancellation", () => {
  const input = setup();
  input.snapshot.walks = [walk("closed")];
  input.snapshot.registrations = [registration("closed")];
  input.activities.consultations = [
    {
      id: "c",
      dog_id: "dog",
      service_name: "Konsultacja",
      status: "cancelled",
      starts_at: past,
      created_at: past,
    },
  ];
  input.activities.fitness = [
    {
      id: "f",
      dog_id: "dog",
      service_name: "Fitness",
      status: "completed",
      next_starts_at: null,
      created_at: past,
    },
  ];
  input.activities.enrollments = [
    {
      id: "e",
      dog_id: "dog",
      course_id: "cycle",
      status: "accepted",
      created_at: past,
      courses: { title: "Kurs", service_name: "Usługa", status: "completed" },
    },
  ];
  input.activities.requests = [
    {
      id: "r",
      dog_id: "dog",
      service_id: "service",
      service_name: "Trening",
      status: "handled",
      created_at: past,
    },
  ];
  const result = buildDashboardItems(input);
  expect(result.current).toEqual([]);
  expect(result.history).toHaveLength(5);
  const html = renderToStaticMarkup(<DashboardRegistrations {...result} />);
  expect(html).toContain("Nie masz teraz otwartych zgłoszeń.");
  expect(html).toContain("Historia zgłoszeń (5)");
  expect(html).toContain('href="/app/consultations/c"');
  expect(html).toContain('href="/app/service-requests?filter=history"');
});

it("shows a true empty state without calling it a completed collaboration", () => {
  const result = buildDashboardItems(setup());
  expect(result).toEqual({ current: [], history: [] });
  const html = renderToStaticMarkup(<DashboardRegistrations {...result} />);
  expect(html).toContain("Nie masz jeszcze zgłoszeń.");
  expect(html).not.toContain("Nie masz teraz otwartych");
});

it("offers two different upcoming available activities, excluding own multi-dog registrations and unavailable offers", () => {
  const make = (id: string, overrides = {}) =>
    ({
      id,
      source_id: id,
      kind: "course",
      category: "group",
      title: id,
      starts_at: "2030-01-11T12:00:00Z",
      ends_at: "2030-01-11T13:00:00Z",
      public_location: "Park",
      availability: "available",
      booking_mode: "approval",
      eligibility: "eligible",
      session_ordinal: 1,
      sessions_count: 5,
      ...overrides,
    }) as import("../src/modules/calendar-offer/types").OfferItem;
  const result = dashboardSuggestions(
    [
      make("later", { starts_at: "2030-01-15T12:00:00Z" }),
      make("first"),
      make("duplicate", {
        source_id: "first",
        starts_at: "2030-01-18T12:00:00Z",
      }),
      make("full", { availability: "full" }),
      make("closed", { availability: "closed" }),
      make("cancelled", { availability: "cancelled" }),
      make("past", { starts_at: past }),
      make("bad-date", { starts_at: "invalid" }),
      make("registered", { eligibility: "registered" }),
      make("invited", { eligibility: "invitation_only" }),
      make("own", { starts_at: "2030-01-10T13:00:00Z" }),
    ],
    now,
    new Set(["course:own"]),
  );
  expect(result.map((item) => item.id)).toEqual(["first", "later"]);
});

it("does not claim qualification or a dog profile that is still needed to join", () => {
  const item = {
    id: "walk",
    source_id: "walk",
    kind: "walk",
    category: "group",
    title: "Wspólny spacer",
    starts_at: "2030-01-11T12:00:00Z",
    ends_at: "2030-01-11T13:00:00Z",
    public_location: "Park",
    availability: "available",
    booking_mode: "automatic",
    eligibility: "qualification_required",
    session_ordinal: null,
    sessions_count: null,
  } as import("../src/modules/calendar-offer/types").OfferItem;
  expect(dashboardSuggestions([item], now)).toHaveLength(1);
});
