import {
  Children,
  isValidElement,
  type ReactElement,
  type ReactNode,
} from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  expanded: false,
  session: vi.fn(),
  snapshot: vi.fn(),
}));
vi.mock("react", async () => ({
  ...(await vi.importActual<typeof import("react")>("react")),
  useId: () => "voice-message",
  useState: () => [
    mocks.expanded,
    (next: (current: boolean) => boolean) => {
      mocks.expanded = next(mocks.expanded);
    },
  ],
}));
vi.mock("@/lib/domain", async () => import("../src/lib/domain"));
vi.mock("@/lib/time", async () => import("../src/lib/time"));
vi.mock("@/lib/walk-filters", async () => import("../src/lib/walk-filters"));
vi.mock(
  "@/lib/walk-relations",
  async () => import("../src/lib/walk-relations"),
);
vi.mock("@/lib/qualification", async () => import("../src/lib/qualification"));
vi.mock(
  "@/lib/validation/schemas",
  async () => import("../src/lib/validation/schemas"),
);
vi.mock("@/lib/auth/session", () => ({ requireSession: mocks.session }));
vi.mock("@/lib/data/queries", () => ({
  getSnapshot: mocks.snapshot,
  allRows: vi.fn().mockResolvedValue([]),
}));
vi.mock("@/lib/data/actions", () => ({
  registerDog: vi.fn(),
  decideRegistration: vi.fn(),
  cancelRegistration: vi.fn(),
  cancelWalk: vi.fn(),
  markAttendance: vi.fn(),
  createWalk: vi.fn(),
  updateWalk: vi.fn(),
  inviteDog: vi.fn(),
}));
vi.mock("@/components/action-form", () => ({
  ActionForm: () => null,
  Field: () => null,
}));
vi.mock("../src/components/action-form", () => ({
  ActionForm: () => null,
  Field: () => null,
}));
vi.mock("../src/components/reopen-registration", () => ({
  ReopenRegistration: () => null,
}));
vi.mock("@/modules/services/selection", () => ({
  WalkServiceFields: () => null,
  ConsultationServicePicker: () => null,
}));
vi.mock("@/modules/calendar/booking-choice", () => ({
  BookingChoice: () => null,
}));
vi.mock(
  "@/components/progressive-details",
  async () => import("../src/components/progressive-details"),
);
vi.mock("../src/modules/consultations/actions", () => ({
  requestConsultation: vi.fn(),
  closeConsultation: vi.fn(),
}));
vi.mock("../src/modules/consultations/editor", () => ({
  ScheduleEditor: () => null,
}));
vi.mock("../src/modules/consultations/price-editor", () => ({
  ConsultationPriceEditor: () => null,
}));
vi.mock("../src/modules/consultations/billing", () => ({
  ConsultationBilling: () => null,
}));
vi.mock("../src/modules/courses/actions", () => ({
  changeCourse: vi.fn(),
  decideEnrollment: vi.fn(),
  changeSession: vi.fn(),
}));
vi.mock("../src/modules/courses/forms", () => ({
  AttendanceForm: () => null,
  CommandForm: () => null,
  CourseCreateForm: () => null,
  EnrollmentForm: () => null,
  ReopeningPanel: () => null,
  SessionEditor: () => null,
  CourseSettingsForm: () => null,
}));
vi.mock("../src/modules/courses/billing", () => ({
  CourseBalanceSummary: () => null,
  CourseBilling: () => null,
}));
vi.mock("../src/modules/fitness/forms", () => ({
  FitnessCommandForm: () => null,
  FitnessScheduleForm: () => null,
}));
vi.mock("../src/modules/fitness/billing", () => ({
  FitnessBilling: () => null,
}));

import { VoiceNotePlaceholder } from "../src/components/voice-note-placeholder";
import { WalkDetail } from "../src/components/walks";
import { ConsultationView } from "../src/modules/consultations/views";
import { CourseDetailView } from "../src/modules/courses/views";
import { FitnessDetailView } from "../src/modules/fitness/views";

function elements(node: ReactNode): ReactElement<Record<string, unknown>>[] {
  return Children.toArray(node).flatMap((child) => {
    if (!isValidElement<Record<string, unknown>>(child)) return [];
    return [child, ...elements(child.props.children as ReactNode)];
  });
}
function voices(node: ReactNode) {
  return elements(node).filter(
    (element) => element.type === VoiceNotePlaceholder,
  );
}

beforeEach(() => {
  mocks.expanded = false;
});

describe("voice note placeholder", () => {
  it("opens honest information and closes it again without submitting a form", () => {
    for (const expanded of [false, true, false]) {
      const tree = VoiceNotePlaceholder();
      const button = elements(tree).find(
        (element) => element.type === "button",
      )!;
      const message = elements(tree).find((element) => element.type === "p")!;
      expect(button.props.type).toBe("button");
      expect(button.props["aria-expanded"]).toBe(expanded);
      expect(button.props["aria-controls"]).toBe(message.props.id);
      expect(message.props.hidden).toBe(!expanded);
      const html = renderToStaticMarkup(tree);
      expect(html).toContain("Notatka głosowa");
      expect(html).toContain("Wkrótce");
      expect(html).toContain("Teraz nic się nie nagrywa.");
      expect(html).not.toMatch(/<(form|input|audio|textarea)\b/);
      (button.props.onClick as () => void)();
    }
  });
});

const at = "2030-01-01T10:00:00Z";
const now = "2030-01-01T10:15:00Z";
const walkId = "a2000000-0000-4000-8000-000000000001";
type Role = "admin" | "client";

async function walk(role: Role) {
  const query = {
    select: () => query,
    eq: () => query,
    maybeSingle: async () => ({ data: null, error: null }),
  };
  mocks.session.mockResolvedValue({ role, db: { from: () => query } });
  mocks.snapshot.mockResolvedValue({
    role,
    dogs: [],
    registrations: [],
    walks: [
      {
        id: walkId,
        starts_at: at,
        duration_minutes: 60,
        public_location: "Park",
        type: "Spacer",
        price_cents: 6000,
        capacity: 4,
        booking_mode: "approval",
        status: "open",
        info: "Weź wodę.",
        cancellation_deadline_hours: 24,
      },
    ],
  });
  return WalkDetail({ id: walkId });
}

function consultation(role: Role) {
  return ConsultationView({
    role,
    history: [],
    page: 1,
    more: false,
    now,
    consultation: {
      id: "consultation",
      dog_id: "dog",
      dogs: { name: "Figa" },
      topic: "Wsparcie",
      availability: "",
      status: "scheduled",
      starts_at: at,
      duration_minutes: 60,
      meeting_mode: "in_person",
      location: "Park",
      version: 1,
      created_at: at,
      service_name: "Konsultacja",
      agreed_price_cents: 10000,
      service_duration_minutes: 60,
      service_meeting_mode: "in_person",
      is_test_price: false,
    },
  });
}

function course(role: Role) {
  return CourseDetailView({
    role,
    page: 1,
    filter: "all",
    historyPage: 1,
    requestId: "request",
    now,
    course: {
      id: "course",
      service_id: "service",
      service_version: 1,
      service_name: "Kurs",
      price_cents: 40000,
      is_test_price: false,
      sessions_count: 2,
      duration_minutes: 60,
      course_format: "group",
      title: "Wspólna praca",
      public_location: "Park",
      capacity: 4,
      status: "open",
      version: 1,
      created_at: at,
      updated_at: at,
    },
    sessions: [1, 2].map((ordinal) => ({
      id: `course-session-${ordinal}`,
      course_id: "course",
      ordinal,
      starts_at: at,
      duration_minutes: 60,
      public_location: "Park",
      status: "scheduled" as const,
      version: 1,
      course_session_private_details: null,
    })),
    enrollments: [],
    roster: [],
    attendance: [],
    history: [],
    dogs: [],
    hasDogs: false,
    more: false,
    historyMore: false,
    balances: [],
    payments: [],
    refunds: [],
    focus: undefined,
  });
}

function fitness(role: Role) {
  return FitnessDetailView({
    historyPage: 1,
    now,
    plansPage: 1,
    care: { plans: [], more: false, hasDraft: false, canPrepare: false },
    data: {
      role,
      payments: [],
      refunds: [],
      history: [],
      historyMore: false,
      booking: undefined,
      pack: {
        id: "fitness",
        dog_id: "dog",
        guardian_id: "guardian",
        service_id: "service",
        service_version: 1,
        service_name: "Fitness",
        sessions_count: 2,
        duration_minutes: 45,
        agreed_price_cents: 40000,
        is_test_price: false,
        topic: "Ruch",
        availability: "",
        status: "active",
        charge_cents: 40000,
        accepted_at: at,
        settled_at: null,
        version: 1,
        created_at: at,
        updated_at: at,
        dogs: { name: "Figa" },
      },
      sessions: [1, 2].map((ordinal) => ({
        id: `fitness-session-${ordinal}`,
        package_id: "fitness",
        ordinal,
        status: "scheduled" as const,
        starts_at: at,
        duration_minutes: 45,
        attendance: null,
        version: 1,
        fitness_session_private_details: null,
      })),
      balance: {
        id: "fitness",
        dog_id: "dog",
        guardian_id: "guardian",
        service_name: "Fitness",
        status: "active",
        version: 1,
        created_at: at,
        agreed_price_cents: 40000,
        charge_cents: 40000,
        is_test_price: false,
        sessions_count: 2,
        duration_minutes: 45,
        settled_at: null,
        paid_cents: 0,
        refunded_cents: 0,
        completed_sessions: 0,
        next_starts_at: at,
        due_cents: 40000,
        refund_due_cents: 0,
        needs_settlement: false,
        needs_review: false,
        can_pay: true,
      },
    },
  });
}

describe.each([
  ["spacer", walk, 1],
  ["konsultacja", consultation, 1],
  ["kurs", course, 2],
  ["fitness", fitness, 2],
] as const)("staff visibility: %s", (_, view, expected) => {
  it("offers a voice placeholder only to staff, once per concrete meeting", async () => {
    const staff = await view("admin");
    const guardian = await view("client");
    expect(voices(staff)).toHaveLength(expected);
    expect(voices(guardian)).toHaveLength(0);
  });
});

it("keeps both course and fitness meeting anchors alongside the placeholder", () => {
  for (const [view, kind] of [
    [course, "course"],
    [fitness, "fitness"],
  ] as const) {
    const tree = view("admin");
    for (const ordinal of [1, 2]) {
      const id = `spotkanie-${kind}-session-${ordinal}`;
      expect(elements(tree).some((element) => element.props.id === id)).toBe(
        true,
      );
      expect(
        elements(tree).some(
          (element) => element.props.id === `spotkanie-${ordinal}`,
        ),
      ).toBe(true);
    }
  }
});
