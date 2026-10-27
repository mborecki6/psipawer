import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { Consultation } from "../src/modules/consultations/types";
import type {
  FitnessPackage,
  FitnessSession,
  FitnessBalance,
} from "../src/modules/fitness/types";
import type { getFitnessPackage } from "../src/modules/fitness/queries";

vi.mock("@/lib/domain", async () => import("../src/lib/domain"));
vi.mock(
  "@/components/progressive-details",
  async () => import("../src/components/progressive-details"),
);
vi.mock("@/components/action-form", () => ({
  ActionForm: ({ children, label }: { children: ReactNode; label: string }) =>
    createElement("form", null, children, createElement("button", null, label)),
}));
vi.mock("@/modules/services/selection", () => ({
  ConsultationServicePicker: () => null,
}));
vi.mock("../src/modules/consultations/actions", () => ({
  requestConsultation: vi.fn(),
  closeConsultation: vi.fn(),
}));
vi.mock("../src/modules/consultations/editor", () => ({
  ScheduleEditor: () =>
    createElement("form", { "data-editor": "schedule" }, "Formularz terminu"),
}));
vi.mock("../src/modules/consultations/price-editor", () => ({
  ConsultationPriceEditor: () =>
    createElement(
      "form",
      { "data-editor": "legacy-price" },
      "Uzgodniona kwota",
    ),
}));
vi.mock("../src/modules/consultations/billing", () => ({
  ConsultationBilling: () =>
    createElement("section", { id: "rozliczenie" }, "Saldo konsultacji"),
}));
vi.mock("../src/modules/fitness/forms", () => ({
  FitnessCommandForm: ({
    session,
    admin,
  }: {
    session?: FitnessSession;
    admin: boolean;
  }) =>
    createElement(
      "form",
      { "data-command": session?.id || "package", "data-admin": admin },
      "Działanie",
    ),
  FitnessScheduleForm: ({
    session,
    enabled,
  }: {
    session: FitnessSession;
    enabled: boolean;
  }) =>
    createElement(
      "form",
      { "data-schedule": session.id, "data-enabled": enabled },
      "Termin fitness",
    ),
}));
vi.mock("../src/modules/fitness/billing", () => ({
  FitnessBilling: ({ balance }: { balance: FitnessBalance }) =>
    createElement(
      "section",
      { id: `rozliczenie-${balance.id}` },
      "Pełne rozliczenie fitness",
    ),
}));
import { ConsultationView } from "../src/modules/consultations/views";
import { FitnessDetailView } from "../src/modules/fitness/views";

const consultation: Consultation = {
  id: "consultation",
  dog_id: "dog",
  dogs: { name: "Figa" },
  topic: "Potrzeby Figi",
  availability: "Po południu",
  status: "scheduled",
  starts_at: "2030-01-01T10:00:00Z",
  duration_minutes: 60,
  meeting_mode: "in_person",
  location: "Park",
  version: 3,
  created_at: "2029-12-01T10:00:00Z",
  service_name: "Konsultacja",
  agreed_price_cents: 10000,
  service_duration_minutes: 60,
  service_meeting_mode: "in_person",
  is_test_price: true,
};
const pack: FitnessPackage = {
  id: "package",
  dog_id: "dog",
  guardian_id: "guardian",
  service_id: "service",
  service_version: 2,
  service_name: "Fitness",
  sessions_count: 5,
  duration_minutes: 45,
  agreed_price_cents: 10000,
  is_test_price: true,
  topic: "Współpraca",
  availability: "Wtorki",
  status: "active",
  charge_cents: 10000,
  accepted_at: "2030-01-01T10:00:00Z",
  settled_at: null,
  version: 2,
  created_at: "2030-01-01T10:00:00Z",
  updated_at: "2030-01-01T10:00:00Z",
  dogs: { name: "Figa" },
};
const sessions: FitnessSession[] = [
  {
    id: "done",
    ordinal: 1,
    status: "completed",
    starts_at: "2030-01-01T10:00:00Z",
    attendance: "absent",
  },
  {
    id: "overdue",
    ordinal: 2,
    status: "scheduled",
    starts_at: "2030-01-02T10:00:00Z",
    attendance: null,
  },
  {
    id: "future",
    ordinal: 3,
    status: "scheduled",
    starts_at: "2030-02-01T10:00:00Z",
    attendance: null,
  },
  {
    id: "pending",
    ordinal: 4,
    status: "pending",
    starts_at: null,
    attendance: null,
  },
  {
    id: "cancelled",
    ordinal: 5,
    status: "cancelled",
    starts_at: null,
    attendance: null,
  },
].map((session) => ({
  ...session,
  package_id: "package",
  duration_minutes: 45,
  version: 1,
  fitness_session_private_details: null,
})) as FitnessSession[];
const balance: FitnessBalance = {
  id: pack.id,
  dog_id: "dog",
  guardian_id: "guardian",
  service_name: pack.service_name,
  status: "active",
  version: 2,
  created_at: pack.created_at,
  agreed_price_cents: 10000,
  charge_cents: 10000,
  is_test_price: true,
  sessions_count: 5,
  duration_minutes: 45,
  settled_at: null,
  paid_cents: 4000,
  refunded_cents: 0,
  completed_sessions: 1,
  next_starts_at: "2030-02-01T10:00:00Z",
  due_cents: 6000,
  refund_due_cents: 0,
  needs_settlement: false,
  needs_review: false,
  can_pay: true,
};
function fitness(
  role: "admin" | "client",
  sessionRows = sessions,
  overrides: Partial<FitnessBalance> = {},
) {
  const data = {
    pack,
    sessions: sessionRows,
    balance: { ...balance, ...overrides },
    payments: [],
    refunds: [],
    history: [],
    historyMore: false,
    role,
  } as Awaited<ReturnType<typeof getFitnessPackage>>;
  return renderToStaticMarkup(
    createElement(FitnessDetailView, {
      data,
      historyPage: 1,
      now: "2030-01-15T12:00:00Z",
      care: { plans: [], more: false, hasDraft: false, canPrepare: false },
      plansPage: 1,
    }),
  );
}
function detailTag(html: string, id: string) {
  const tag = html.match(new RegExp(`<details[^>]*id="${id}"[^>]*>`))?.[0];
  if (!tag) throw new Error(`Missing disclosure ${id}`);
  return tag;
}
describe("consultation hierarchy", () => {
  it("opens requested scheduling and preserves legacy price before the scheduling form", () => {
    const html = renderToStaticMarkup(
      createElement(ConsultationView, {
        role: "admin",
        consultation: {
          ...consultation,
          status: "requested",
          agreed_price_cents: null,
          starts_at: null,
        },
        history: [],
        page: 1,
        more: false,
        now: "2030-01-15T12:00:00Z",
        priceRequestId: "request",
      }),
    );
    expect(detailTag(html, "termin-consultation")).toContain('open=""');
    expect(html.indexOf('data-editor="legacy-price"')).toBeLessThan(
      html.indexOf('data-editor="schedule"'),
    );
  });
  it("collapses scheduled editing and places completion and plans before history", () => {
    const html = renderToStaticMarkup(
      createElement(ConsultationView, {
        role: "admin",
        consultation,
        history: [],
        page: 1,
        more: false,
        now: "2030-01-15T12:00:00Z",
      }),
    );
    expect(detailTag(html, "termin-consultation")).not.toContain('open=""');
    expect(detailTag(html, "historia-konsultacji")).not.toContain('open=""');
    expect(html.indexOf("Oznacz jako zakończoną")).toBeLessThan(
      html.indexOf('id="historia-konsultacji"'),
    );
    expect(html.indexOf("Wasz plan po konsultacji")).toBeLessThan(
      html.indexOf('id="historia-konsultacji"'),
    );
  });
  it("does not offer editing or staff completion to a guardian", () => {
    const html = renderToStaticMarkup(
      createElement(ConsultationView, {
        role: "client",
        consultation,
        history: [],
        page: 1,
        more: false,
        now: "2030-01-15T12:00:00Z",
      }),
    );
    expect(html).not.toContain('data-editor="schedule"');
    expect(html).not.toContain("Oznacz jako zakończoną");
    expect(html).toContain("Wasz plan po konsultacji");
  });
});
describe.each(["admin", "client"] as const)(
  "fitness hierarchy for %s",
  (role) => {
    it("selects overdue attendance before a future appointment, exposes all exceptions and both anchor formats", () => {
      const html = fitness(role);
      expect(detailTag(html, "spotkanie-overdue")).toContain('open=""');
      for (const id of ["done", "future", "pending", "cancelled"])
        expect(detailTag(html, `spotkanie-${id}`)).not.toContain('open=""');
      expect(html).toContain("Oczekują na zakończenie: 1");
      expect(html).toContain("Do umówienia: 1");
      expect(html).toContain("Odwołane: 1");
      expect(html).toContain("Nieobecny");
      for (let n = 1; n <= 5; n++)
        expect(html).toContain(`id="spotkanie-${n}"`);
      expect(html.indexOf('id="rozliczenie-pakietu"')).toBeLessThan(
        html.indexOf('id="fitness-meetings"'),
      );
      expect(html).toContain('id="rozliczenie-package"');
      expect(html).toContain("Do zapłaty:");
      expect(detailTag(html, "warunki-pakietu")).not.toContain('open=""');
      expect(detailTag(html, "historia-pakietu")).not.toContain('open=""');
      if (role === "client") expect(html).not.toContain("data-schedule");
    });
    it("selects the next scheduled meeting while keeping unscheduled and cancelled meetings in the list", () => {
      const html = fitness(
        role,
        sessions.filter((s) => s.id !== "overdue"),
      );
      expect(detailTag(html, "spotkanie-future")).toContain('open=""');
      expect(html).toContain('id="spotkanie-pending"');
      expect(html).toContain('id="spotkanie-cancelled"');
    });
    it("opens settlement or refunds early and renders an honest empty schedule", () => {
      const html = fitness(role, [], {
        needs_review: true,
        needs_settlement: true,
      });
      expect(detailTag(html, "rozliczenie-pakietu")).toContain('open=""');
      expect(html).toContain("Kwota po rezygnacji do uzgodnienia");
      expect(html).toContain("Spotkania pojawią się po przyjęciu zgłoszenia");
      expect(fitness(role, [], { refund_due_cents: 2500 })).toContain(
        "Do zwrotu:",
      );
    });
  },
);
