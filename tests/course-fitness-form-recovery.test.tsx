import {
  Children,
  isValidElement,
  type ReactElement,
  type ReactNode,
} from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ActionState } from "../src/components/action-form";
import type { Service } from "../src/modules/services/types";
import type { Course } from "../src/modules/courses/types";

type State = ActionState & { version?: number };
type Action = (previous: State, data: FormData) => Promise<State>;
const mocks = vi.hoisted(() => ({
  values: [] as unknown[],
  cursor: 0,
  state: undefined as State | undefined,
  reducer: undefined as Action | undefined,
  create: vi.fn<Action>(),
  enrollment: vi.fn<Action>(),
  fitness: vi.fn<Action>(),
}));
vi.mock("react", async () => ({
  ...(await vi.importActual<typeof import("react")>("react")),
  useState: (initial: unknown) => {
    const index = mocks.cursor++;
    if (!(index in mocks.values))
      mocks.values[index] = typeof initial === "function" ? initial() : initial;
    return [
      mocks.values[index],
      (next: unknown) => {
        mocks.values[index] =
          typeof next === "function" ? next(mocks.values[index]) : next;
      },
    ];
  },
  useId: () => "fixture",
  useRef: () => ({ current: null }),
  useEffect: () => {},
  useLayoutEffect: () => {},
  useActionState: (reducer: Action, initial: State) => {
    mocks.reducer = reducer;
    mocks.state ??= initial;
    return [mocks.state, () => {}, false];
  },
}));
vi.mock("@/components/use-hydrated", () => ({ useHydrated: () => true }));
vi.mock(
  "@/components/progressive-details",
  async () => import("../src/components/progressive-details"),
);
vi.mock("@/components/use-persistent-form", () => ({
  usePersistentForm: () => ({ current: null }),
}));
vi.mock(
  "@/components/form-action-recovery",
  async () => import("../src/components/form-action-recovery"),
);
vi.mock("@/lib/domain", async () => import("../src/lib/domain"));
vi.mock("@/lib/time", async () => import("../src/lib/time"));
vi.mock("@/modules/calendar/warning", () => ({ CalendarWarning: () => null }));
vi.mock("@/modules/calendar/booking-choice", () => ({
  BookingChoice: () => null,
}));
vi.mock("../src/modules/courses/actions", () => ({
  createCourse: mocks.create,
  requestEnrollment: mocks.enrollment,
  rescheduleSession: vi.fn(),
  recordAttendance: vi.fn(),
  editCourse: vi.fn(),
  correctAttendance: vi.fn(),
  reopenEnrollment: vi.fn(),
}));
vi.mock("../src/modules/fitness/actions", () => ({
  requestFitness: mocks.fitness,
  changeFitnessPackage: vi.fn(),
  saveFitnessSession: vi.fn(),
  changeFitnessSession: vi.fn(),
}));
import { CourseCreateForm, EnrollmentForm } from "../src/modules/courses/forms";
import { FitnessRequestForm } from "../src/modules/fitness/forms";
import { unconfirmedFormMessage } from "../src/components/form-action-recovery";

const requestId = "75561dd9-010e-4ed7-8a9b-bc1fcf1c2341";
const service: Service = {
  id: "service",
  name: "Kurs",
  description: "",
  kind: "course",
  course_format: "group",
  booking_flow: "catalogue",
  meeting_mode: "in_person",
  price_cents: 10000,
  price_unit: "cykl",
  duration_minutes: 60,
  sessions_count: 1,
  active: true,
  is_test_price: true,
  source_url: "",
  source_note: "",
  version: 3,
  updated_at: "2030-01-01T12:00:00Z",
};
function render(component: () => ReactElement) {
  mocks.cursor = 0;
  return component();
}
function fields(node: ReactNode): ReactElement<Record<string, unknown>>[] {
  return Children.toArray(node).flatMap((child) => {
    if (!isValidElement<Record<string, unknown>>(child)) return [];
    const nested = fields(child.props.children as ReactNode);
    return ["input", "select", "textarea"].includes(String(child.type))
      ? [child, ...nested]
      : nested;
  });
}
function edit(tree: ReactNode, name: string, value: string) {
  const field = fields(tree).find((item) => item.props.name === name);
  if (!field || typeof field.props.onChange !== "function")
    throw new Error(`Editable field not found: ${name}`);
  field.props.onChange({ target: { value } });
}
function data(tree: ReactNode) {
  const result = new FormData();
  for (const field of fields(tree)) {
    if (typeof field.props.name !== "string") continue;
    result.append(
      field.props.name,
      String(field.props.value ?? field.props.defaultValue ?? ""),
    );
  }
  return result;
}
async function submit(form: FormData) {
  if (!mocks.reducer || !mocks.state) throw new Error("Missing form action");
  mocks.state = await mocks.reducer(mocks.state, form);
}
beforeEach(() => {
  vi.resetAllMocks();
  mocks.values = [];
  mocks.cursor = 0;
  mocks.state = undefined;
  mocks.reducer = undefined;
});

describe("course and fitness component reducers after rejection", () => {
  it("keeps all six course draft fields and the UUID after a rejected action and streamed props", async () => {
    mocks.create.mockRejectedValue(new TypeError("Failed to fetch"));
    let id = requestId;
    const component = () => CourseCreateForm({ services: [service], id });
    let tree = render(component);
    const edits = {
      service_id: "service",
      title: "Przygotowany cykl",
      capacity: "6",
      public_location: "Park przy lesie",
      exact_location: "Brama od północy",
      starts: "2030-05-20T15:00",
    };
    for (const [name, value] of Object.entries(edits)) {
      edit(tree, name, value);
      tree = render(component);
    }
    const before = data(tree);
    await submit(before);
    expect(mocks.state).toEqual({ version: 1, error: unconfirmedFormMessage });
    expect(mocks.create).toHaveBeenCalledTimes(1);
    id = "replacement-from-stream";
    const after = data(render(component));
    expect(Object.fromEntries(after)).toEqual(Object.fromEntries(before));
    expect(Object.fromEntries(after)).toMatchObject({
      ...edits,
      id: requestId,
      service_version: "3",
    });
  });

  it("keeps the fitness selections, both texts, service version and UUID after a rejected action", async () => {
    mocks.fitness.mockRejectedValue(new TypeError("Failed to fetch"));
    let id = requestId;
    const component = () =>
      FitnessRequestForm({
        services: [service],
        requestId: id,
        dogs: [
          { id: "dog-a", name: "Figa", unavailable: false },
          { id: "dog-b", name: "Luna", unavailable: false },
        ],
      });
    let tree = render(component);
    const edits = {
      service_id: "service",
      dog_id: "dog-b",
      topic: "Poprawa koordynacji",
      availability: "Czwartki po 18",
    };
    for (const [name, value] of Object.entries(edits)) {
      edit(tree, name, value);
      tree = render(component);
    }
    const before = data(tree);
    await submit(before);
    expect(mocks.state).toEqual({ error: unconfirmedFormMessage });
    expect(mocks.fitness).toHaveBeenCalledTimes(1);
    id = "replacement-from-stream";
    const after = data(render(component));
    expect(Object.fromEntries(after)).toEqual(Object.fromEntries(before));
    expect(Object.fromEntries(after)).toEqual({
      ...edits,
      id: requestId,
      service_version: "3",
    });
  });

  it("retains the course version for both typed conflicts and ordinary rejection", async () => {
    const conflict = { error: "Kurs zmienił się. Odśwież widok." };
    mocks.enrollment
      .mockResolvedValueOnce(conflict)
      .mockRejectedValueOnce(new TypeError("Failed to fetch"));
    const component = () =>
      EnrollmentForm({
        course: {
          id: "course",
          version: 7,
          price_cents: 10000,
          sessions_count: 4,
        } as Course,
        dogs: [{ id: "dog-a", name: "Figa" }],
        id: requestId,
        enabled: true,
      });
    const before = data(render(component));
    await submit(before);
    expect(mocks.state).toEqual({ ...conflict, version: 7 });
    await submit(data(render(component)));
    expect(mocks.state).toEqual({ error: unconfirmedFormMessage, version: 7 });
    expect(data(render(component)).get("course_version")).toBe("7");
    expect(data(render(component)).get("id")).toBe(requestId);
  });
});
