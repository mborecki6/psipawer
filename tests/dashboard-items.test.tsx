import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import type { Snapshot, Walk, Registration } from "../src/lib/data/types";
import type { DashboardFinanceSummary } from "../src/lib/data/finance-queries";
import type { DashboardActivities } from "../src/modules/dashboard/types";
vi.mock("@/lib/domain", async () => import("../src/lib/domain"));
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
  hasFinancialIssue,
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
  const finance: DashboardFinanceSummary = {
    chargeCount: 0,
    charges: [],
    reviewPayments: [],
    packages: [],
    totals: { dueCents: 0, availableEntries: 0, reservedEntries: 0 },
  };
  return { snapshot, activities, finance, now };
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

it("keeps late cancellation debt, cancelled paid consultation, unsettled zero-debt course and refund visible", () => {
  const input = setup();
  input.snapshot.walks = [walk("late")];
  input.snapshot.registrations = [
    registration("late", { status: "cancelled_late" }),
  ];
  input.activities.consultations = [
    {
      id: "cancelled",
      dog_id: "dog",
      service_name: "Konsultacja",
      status: "cancelled",
      starts_at: past,
      created_at: past,
    },
  ];
  input.activities.enrollments = ["settlement", "refund"].map((id) => ({
    id,
    dog_id: "dog",
    course_id: id,
    status: "cancelled",
    created_at: past,
    courses: { title: id, service_name: "Kurs", status: "cancelled" },
  }));
  input.finance.charges = [
    {
      id: "late",
      kind: "registration",
      dogName: "Figa",
      title: "Spacer",
      date: past,
      href: "/app/walks/late",
      dueCents: 6000,
    },
    {
      id: "settlement",
      kind: "course",
      dogName: "Figa",
      title: "Kurs",
      date: past,
      href: "/app/courses/settlement?enrollment=settlement#rozliczenie-settlement",
      dueCents: 0,
      reviewReason: "settlement",
      refundDueCents: 0,
    },
    {
      id: "refund",
      kind: "course",
      dogName: "Figa",
      title: "Kurs",
      date: past,
      href: "/app/courses/refund?enrollment=refund#rozliczenie-refund",
      dueCents: 0,
      reviewReason: "refund",
      refundDueCents: 2500,
    },
  ];
  input.finance.reviewPayments = [
    {
      id: "paid",
      dogName: "Figa",
      title: "Konsultacja",
      href: "/app/consultations/cancelled",
      paidAt: past,
      amountCents: 10000,
      sourceKey: "consultation:cancelled",
    },
  ];
  const result = buildDashboardItems(input);
  expect(result.current).toHaveLength(4);
  expect(result.current.every(hasFinancialIssue)).toBe(true);
  expect(result.history).toEqual([]);
  expect(
    result.current.find((item) => item.key === "consultation:cancelled")
      ?.status,
  ).toBe("Odwołana");
  const html = renderToStaticMarkup(<DashboardRegistrations {...result} />);
  expect(html).toContain("Do zapłaty: 60,00");
  expect(html).toContain("Do zwrotu: 25,00");
  expect(html).toContain("Rozliczenie po rezygnacji do uzgodnienia");
  expect(html).toContain("Wpłata 100,00");
  expect(html).not.toContain("Pozostałe bieżące");
});

it("never hides financial exceptions behind the ordinary preview limit and never presents unsettled amounts as final", () => {
  const input = setup();
  input.finance.charges = Array.from({ length: 8 }, (_, i) => ({
    id: String(i),
    kind: "course" as const,
    dogName: "Figa",
    title: `Sprawa ${i}`,
    date: past,
    href: `/app/courses/${i}?enrollment=${i}`,
    dueCents: 99999,
    reviewReason: "settlement" as const,
  }));
  const result = buildDashboardItems(input);
  const html = renderToStaticMarkup(<DashboardRegistrations {...result} />);
  expect(html.match(/Rozliczenie po rezygnacji do uzgodnienia/g)).toHaveLength(
    8,
  );
  expect(html).not.toContain("999,99");
  expect(html).not.toContain("Pozostałe bieżące zgłoszenia");
});

it("attaches a reviewed payment to its registration even when two dogs share a name and walk URL", () => {
  const input = setup();
  input.snapshot.dogs.push({
    id: "second-dog",
    name: "Figa",
  } as Snapshot["dogs"][number]);
  input.snapshot.walks = [walk("shared")];
  input.snapshot.registrations = [
    registration("first", { walk_id: "shared", status: "cancelled_on_time" }),
    registration("second", {
      walk_id: "shared",
      dog_id: "second-dog",
      status: "cancelled_on_time",
    }),
  ];
  input.finance.reviewPayments = [
    {
      id: "payment",
      dogName: "Figa",
      title: "Spacer",
      href: "/app/walks/shared",
      paidAt: past,
      amountCents: 6000,
      sourceKey: "registration:second",
    },
  ];
  const result = buildDashboardItems(input);
  expect(result.current.map((item) => item.key)).toEqual([
    "registration:second",
  ]);
  expect(result.history.map((item) => item.key)).toEqual([
    "registration:first",
  ]);
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
  expect(html).toContain(
    "Nie masz teraz otwartych zgłoszeń ani spraw rozliczeniowych.",
  );
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
