import {
  Children,
  isValidElement,
  type ReactElement,
  type ReactNode,
} from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CourseActionState } from "../src/modules/courses/actions";
import type {
  CourseAttendance,
  CourseEnrollment,
} from "../src/modules/courses/types";

type Action = (
  previous: CourseActionState,
  data: FormData,
) => Promise<CourseActionState>;
type Instance = {
  values: unknown[];
  state?: CourseActionState;
  reducer?: Action;
  pending?: boolean;
};
const harness = vi.hoisted(() => ({
  current: { values: [] } as Instance,
  cursor: 0,
  confirmation: undefined as unknown,
  record: vi.fn<Action>(),
  correct: vi.fn<Action>(),
  decide: vi.fn<Action>(),
  reopen: vi.fn<Action>(),
}));
vi.mock("react", async () => ({
  ...(await vi.importActual<typeof import("react")>("react")),
  useState: (initial: unknown) => {
    const instance = harness.current;
    const index = harness.cursor++;
    if (!(index in instance.values))
      instance.values[index] =
        typeof initial === "function" ? initial() : initial;
    return [
      instance.values[index],
      (next: unknown) => {
        instance.values[index] =
          typeof next === "function" ? next(instance.values[index]) : next;
      },
    ];
  },
  useContext: () => harness.confirmation,
  useId: () => "course-fixture",
  useRef: () => ({ current: null }),
  useEffect: () => {},
  useLayoutEffect: () => {},
  useActionState: (reducer: Action, initial: CourseActionState) => {
    harness.current.reducer = reducer;
    harness.current.state ??= initial;
    return [harness.current.state, () => {}, Boolean(harness.current.pending)];
  },
}));
vi.mock("@/components/use-hydrated", () => ({ useHydrated: () => true }));
vi.mock("@/components/use-persistent-form", () => ({
  usePersistentForm: () => ({ current: null }),
}));
vi.mock(
  "@/components/form-action-recovery",
  async () => import("../src/components/form-action-recovery"),
);
vi.mock(
  "@/components/roster-action-buttons",
  async () => import("../src/components/roster-action-buttons"),
);
vi.mock("@/lib/domain", async () => import("../src/lib/domain"));
vi.mock("@/lib/time", async () => import("../src/lib/time"));
vi.mock("@/modules/calendar/warning", () => ({ CalendarWarning: () => null }));
vi.mock("@/modules/calendar/booking-choice", () => ({
  BookingChoice: () => null,
}));
vi.mock("next/navigation", () => ({ unstable_rethrow: () => {} }));
vi.mock("../src/modules/courses/actions", () => ({
  createCourse: vi.fn(),
  requestEnrollment: vi.fn(),
  rescheduleSession: vi.fn(),
  recordAttendance: harness.record,
  correctAttendance: harness.correct,
  decideEnrollment: harness.decide,
  editCourse: vi.fn(),
  reopenEnrollment: harness.reopen,
}));
import {
  AttendanceForm,
  CourseDecisionFeedback,
  CourseEnrollmentControls,
  CommandForm,
  ReopeningPanel,
} from "../src/modules/courses/forms";
import { RosterActionButtons } from "../src/components/roster-action-buttons";
import { unconfirmedFormMessage } from "../src/components/form-action-recovery";

function render<T extends ReactElement>(
  instance: Instance,
  component: () => T,
): T {
  harness.current = instance;
  harness.cursor = 0;
  return component();
}
function nodes(tree: ReactNode): ReactElement<Record<string, unknown>>[] {
  return Children.toArray(tree).flatMap((child) => {
    if (!isValidElement<Record<string, unknown>>(child)) return [];
    if (child.type === RosterActionButtons) {
      return nodes(
        RosterActionButtons(
          child.props as Parameters<typeof RosterActionButtons>[0],
        ),
      );
    }
    return [child, ...nodes(child.props.children as ReactNode)];
  });
}
function refreshRegistry(
  provider: Instance,
  visibleEnrollmentIds: string[] = [],
) {
  const tree = render(provider, () =>
    CourseDecisionFeedback({ children: null, visibleEnrollmentIds }),
  );
  harness.confirmation = tree.props.value;
  return tree;
}
function renderChild(
  instance: Instance,
  node: ReactElement<Record<string, unknown>>,
) {
  return render(instance, () =>
    (node.type as (props: Record<string, unknown>) => ReactElement)(node.props),
  );
}
function field(tree: ReactNode, name: string) {
  const result = nodes(tree).find(
    (node) =>
      ["input", "textarea"].includes(String(node.type)) &&
      node.props.name === name,
  );
  if (!result) throw new Error(`Missing field ${name}`);
  return result;
}
function edit(tree: ReactNode, name: string, value: string) {
  const change = field(tree, name).props.onChange as (event: {
    target: { value: string };
  }) => void;
  change({ target: { value } });
}
function payload(tree: ReactNode, name: string, value: string) {
  const data = new FormData();
  for (const node of nodes(tree)) {
    if (
      !["input", "textarea"].includes(String(node.type)) ||
      typeof node.props.name !== "string"
    )
      continue;
    data.set(node.props.name, String(node.props.value ?? ""));
  }
  data.set(name, value);
  return data;
}
async function submit(instance: Instance, data: FormData) {
  if (!instance.reducer || !instance.state) throw new Error("Missing action");
  instance.state = await instance.reducer(instance.state, data);
}
const enrollment = {
  id: "enrollment",
  version: 3,
  status: "requested",
} as CourseEnrollment;
const attendance = {
  session_id: "session",
  enrollment_id: "enrollment",
  version: 3,
  attendance: "present",
} as CourseAttendance;
beforeEach(() => {
  vi.clearAllMocks();
  harness.confirmation = undefined;
});

describe("course roster commands", () => {
  it("does not treat an unrecorded dog as present, then confirms only the successful command", async () => {
    const instance: Instance = { values: [] };
    const component = () =>
      AttendanceForm({
        sessionId: "session",
        enrollmentId: "enrollment",
        dogName: "Figa",
        enabled: true,
      });
    let tree = render(instance, component);
    expect(nodes(tree).some((node) => node.type === "select")).toBe(false);
    expect(
      nodes(tree).filter(
        (node) => node.type === "button" && node.props["aria-pressed"] === true,
      ),
    ).toHaveLength(0);
    expect(
      nodes(tree).some((node) => node.props.children === "Nieoznaczono"),
    ).toBe(true);
    let finish: ((state: CourseActionState) => void) | undefined;
    harness.record.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const saving = submit(instance, payload(tree, "attendance", "absent"));
    tree = render(instance, component);
    expect(
      nodes(tree).filter(
        (node) => node.type === "button" && node.props["aria-pressed"] === true,
      ),
    ).toHaveLength(0);
    finish!({ version: 1, success: "Obecność zapisana." });
    await saving;
    tree = render(instance, component);
    expect(harness.record.mock.calls[0][1].get("attendance")).toBe("absent");
    expect(harness.record.mock.calls[0][1].get("expected_version")).toBe("0");
    expect(field(tree, "expected_version").props.value).toBe(1);
    expect(
      nodes(tree).find(
        (node) => node.type === "button" && node.props.value === "absent",
      )?.props["aria-pressed"],
    ).toBe(true);
  });

  it("keeps a correction's reason, chosen command and source version after a lost response and refreshed props", async () => {
    const instance: Instance = { values: [] };
    let saved = attendance;
    const component = () =>
      AttendanceForm({
        sessionId: "session",
        enrollmentId: "enrollment",
        dogName: "Figa",
        enabled: true,
        correction: true,
        attendance: saved,
      });
    let tree = render(instance, component);
    edit(tree, "note", "Potwierdzenie od opiekuna");
    tree = render(instance, component);
    harness.correct.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    await submit(instance, payload(tree, "attendance", "excused"));
    saved = { ...attendance, attendance: "absent", version: 9 };
    tree = render(instance, component);
    expect(instance.state).toEqual({
      version: 3,
      error: unconfirmedFormMessage,
    });
    expect(field(tree, "note").props.value).toBe("Potwierdzenie od opiekuna");
    expect(field(tree, "note").props.required).toBe(true);
    expect(field(tree, "expected_version").props.value).toBe(3);
    expect(
      nodes(tree).some((node) => node.props.children === "Usprawiedliwiony"),
    ).toBe(true);
    expect(
      nodes(tree).find(
        (node) => node.type === "button" && node.props.value === "present",
      )?.props["aria-pressed"],
    ).toBe(true);
    expect(harness.record).not.toHaveBeenCalled();
  });

  it("blocks the whole attendance fieldset before start and while its request is pending", () => {
    const instance: Instance = { values: [], pending: false };
    const component = (enabled: boolean) =>
      AttendanceForm({
        sessionId: "session",
        enrollmentId: "enrollment",
        dogName: "Figa",
        enabled,
      });
    expect(
      nodes(render(instance, () => component(false))).find(
        (node) => node.type === "fieldset",
      )?.props.disabled,
    ).toBe(true);
    instance.pending = true;
    expect(
      nodes(render(instance, () => component(true))).find(
        (node) => node.type === "fieldset",
      )?.props.disabled,
    ).toBe(true);
  });

  it("opens an explicit required refusal reason without writing, then retains it on a version conflict", async () => {
    const instance: Instance = { values: [] };
    let current = enrollment;
    const component = () =>
      CourseEnrollmentControls({
        enrollment: current,
        dogName: "Figa",
        allowed: ["accept", "waitlist", "reject"],
        children: null,
      });
    let tree = render(instance, component);
    const reject = nodes(tree).find(
      (node) => node.type === "button" && node.props.value === "reject",
    )!;
    expect(reject.props.type).toBe("button");
    (reject.props.onClick as () => void)();
    expect(harness.decide).not.toHaveBeenCalled();
    tree = render(instance, component);
    expect(field(tree, "note").props.required).toBe(true);
    edit(tree, "note", "Uzgodniono inny kurs");
    tree = render(instance, component);
    harness.decide.mockResolvedValueOnce({
      error: "Zgłoszenie zmieniło się. Odśwież widok przed zapisem.",
    });
    await submit(instance, payload(tree, "intent", "reject"));
    current = { ...enrollment, version: 8, status: "accepted" };
    tree = render(instance, component);
    expect(field(tree, "note").props.value).toBe("Uzgodniono inny kurs");
    expect(field(tree, "expected_version").props.value).toBe(3);
    expect(harness.decide.mock.calls[0][1].get("intent")).toBe("reject");
  });

  it("retains acceptance acknowledgement in the list provider after the submitting row is removed", async () => {
    const provider: Instance = { values: [] };
    let providerTree = render(provider, () =>
      CourseDecisionFeedback({ children: null }),
    );
    harness.confirmation = providerTree.props.value;
    const row: Instance = { values: [] };
    const component = () =>
      CourseEnrollmentControls({
        enrollment,
        dogName: "Figa",
        allowed: ["accept", "waitlist", "reject"],
        children: null,
      });
    let tree = render(row, component);
    edit(tree, "note", "Uzgodniono udział z opiekunem");
    tree = render(row, component);
    let finish: ((state: CourseActionState) => void) | undefined;
    harness.decide.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const saving = submit(row, payload(tree, "intent", "accept"));
    providerTree = render(provider, () =>
      CourseDecisionFeedback({ children: null }),
    );
    expect(
      nodes(providerTree).filter((node) => node.props.role === "status"),
    ).toHaveLength(0);
    finish!({ version: 4, success: "Decyzja zapisana." });
    await saving;
    expect(harness.decide.mock.calls[0][1].get("note")).toBe(
      "Uzgodniono udział z opiekunem",
    );
    providerTree = render(provider, () =>
      CourseDecisionFeedback({ children: null }),
    );
    expect(
      nodes(providerTree).find((node) => node.props.role === "status")?.props
        .children,
    ).toBe("Figa: Przyjęto na kurs.");
  });

  it("keeps an unacknowledged refusal outside the filtered list and retries its exact original command", async () => {
    const provider: Instance = { values: [] };
    refreshRegistry(provider, [enrollment.id]);
    const row: Instance = { values: [] };
    const component = () =>
      CourseEnrollmentControls({
        enrollment,
        dogName: "Figa",
        allowed: ["accept", "waitlist", "reject"],
        children: null,
      });
    let tree = render(row, component);
    (
      nodes(tree).find(
        (node) => node.type === "button" && node.props.value === "reject",
      )!.props.onClick as () => void
    )();
    tree = render(row, component);
    edit(tree, "note", "Uzgodniono inne zajęcia z opiekunem");
    tree = render(row, component);
    harness.decide.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    await submit(row, payload(tree, "intent", "reject"));
    // A visible row keeps its own feedback; only removal mounts recovery.
    expect(
      nodes(refreshRegistry(provider, [enrollment.id])).some(
        (node) => "command" in node.props,
      ),
    ).toBe(false);
    // Never render the original row again: recovery cannot use its local state.
    const providerTree = refreshRegistry(provider, []);
    const recoveryNode = nodes(providerTree).find(
      (node) => typeof node.type === "function" && "command" in node.props,
    )!;
    const recovery: Instance = { values: [] };
    const recoveryTree = renderChild(recovery, recoveryNode);
    expect(
      Object.fromEntries(payload(recoveryTree, "intent", "reject")),
    ).toEqual(Object.fromEntries(payload(tree, "intent", "reject")));
    expect(field(recoveryTree, "expected_version").props.value).toBe(3);
    expect(field(recoveryTree, "note").props.value).toBe(
      "Uzgodniono inne zajęcia z opiekunem",
    );
    // Another filter shows the committed rejected row again. This is a new
    // component with no action-state error; it must recover from the registry.
    refreshRegistry(provider, [enrollment.id]);
    const remounted: Instance = { values: [] };
    const returnedTree = render(remounted, () =>
      CourseEnrollmentControls({
        enrollment: { ...enrollment, status: "rejected", version: 4 },
        dogName: "Figa",
        allowed: [],
        children: null,
      }),
    );
    expect(field(returnedTree, "expected_version").props.value).toBe(3);
    expect(field(returnedTree, "note").props.value).toBe(
      "Uzgodniono inne zajęcia z opiekunem",
    );
    expect(field(returnedTree, "note").props.readOnly).toBe(true);
    expect(
      nodes(returnedTree).find(
        (node) =>
          node.type === "button" &&
          node.props.value === "reject" &&
          node.props.type !== "button" &&
          !node.props.disabled,
      )?.props.children,
    ).toEqual(["Ponów tę samą decyzję: ", "Figa"]);
    expect(
      nodes(returnedTree).find(
        (node) => typeof node.type === "function" && "state" in node.props,
      )?.props.state,
    ).toMatchObject({ error: unconfirmedFormMessage });
    refreshRegistry(provider, []);
    harness.decide.mockResolvedValueOnce({
      version: 4,
      success: "Decyzja zapisana.",
    });
    await submit(recovery, payload(recoveryTree, "intent", "reject"));
    expect(Object.fromEntries(harness.decide.mock.calls[1][1])).toEqual(
      Object.fromEntries(harness.decide.mock.calls[0][1]),
    );
    expect(
      nodes(refreshRegistry(provider)).find(
        (node) => node.props.role === "status",
      )?.props.children,
    ).toBe("Figa: Nie przyjęto na kurs.");
  });

  it("shares only its own confirmed acceptance version with an already mounted cancellation form", async () => {
    const provider: Instance = { values: [] };
    refreshRegistry(provider, [enrollment.id]);
    let current = enrollment;
    const row: Instance = { values: [] };
    const cancellation: Instance = { values: [] };
    const component = () =>
      CourseEnrollmentControls({
        enrollment: current,
        dogName: "Figa",
        allowed:
          current.status === "requested"
            ? ["accept", "waitlist", "reject", "cancel"]
            : ["cancel"],
        children: null,
      });
    const cancelComponent = () =>
      CommandForm({
        id: enrollment.id,
        version: current.version,
        action: harness.decide,
        options: [{ value: "cancel", label: "Zapisz rezygnację" }],
        allowed: ["cancel"],
        label: "Rezygnacja: Figa",
        enrollmentDecision: { dogName: "Figa" },
      });
    render(cancellation, cancelComponent);
    current = { ...enrollment, version: 30 };
    expect(
      field(render(cancellation, cancelComponent), "expected_version").props
        .value,
    ).toBe(3);
    current = enrollment;
    harness.decide.mockResolvedValueOnce({
      version: 4,
      success: "Decyzja zapisana.",
    });
    await submit(row, payload(render(row, component), "intent", "accept"));
    refreshRegistry(provider, [enrollment.id]);
    current = { ...enrollment, status: "accepted", version: 4 };
    let cancelTree = render(cancellation, cancelComponent);
    expect(field(cancelTree, "expected_version").props.value).toBe(4);
    edit(cancelTree, "note", "Rezygnacja uzgodniona z opiekunem");
    cancelTree = render(cancellation, cancelComponent);
    harness.decide.mockResolvedValueOnce({
      version: 5,
      success: "Decyzja zapisana.",
    });
    await submit(cancellation, payload(cancelTree, "intent", "cancel"));
    refreshRegistry(provider, [enrollment.id]);
    current = { ...current, status: "cancelled", version: 5 };
    expect(
      nodes(render(row, component)).some(
        (node) => node.props.children === "✓ W składzie kursu",
      ),
    ).toBe(false);
    expect(harness.decide.mock.calls[1][1].get("expected_version")).toBe("4");
    // A secondary restore can fail while the primary form still has its older
    // acceptance result. The newer registry error must remain visible.
    const panel = render({ values: [] }, () =>
      ReopeningPanel({ enrollment: current, enabled: true, dogName: "Figa" })!,
    );
    const reopenNode = nodes(panel).find(
      (node) => typeof node.type === "function",
    )!;
    const reopening: Instance = { values: [] };
    let restoreTree = renderChild(reopening, reopenNode);
    edit(restoreTree, "note", "Powód przywrócenia po rezygnacji");
    restoreTree = renderChild(reopening, reopenNode);
    harness.reopen.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    await submit(reopening, payload(restoreTree, "intent", "restore"));
    refreshRegistry(provider, [enrollment.id]);
    const retryTree = render(row, component);
    expect(field(retryTree, "note").props.value).toBe(
      "Powód przywrócenia po rezygnacji",
    );
    expect(field(retryTree, "expected_version").props.value).toBe(5);
    expect(
      nodes(retryTree).find(
        (node) => typeof node.type === "function" && "state" in node.props,
      )?.props.state,
    ).toMatchObject({ error: unconfirmedFormMessage });
    harness.reopen.mockResolvedValueOnce({
      version: 6,
      success: "Powrót zapisany.",
    });
    await submit(row, payload(retryTree, "intent", "restore"));
    expect(Object.fromEntries(harness.reopen.mock.calls[1][1])).toEqual(
      Object.fromEntries(harness.reopen.mock.calls[0][1]),
    );
  });

  it("restores decisions after refusal and its own confirmed reopening, then accepts without a reload", async () => {
    const provider: Instance = { values: [] };
    refreshRegistry(provider, [enrollment.id]);
    let current = enrollment;
    const row: Instance = { values: [] };
    const component = () =>
      CourseEnrollmentControls({
        enrollment: current,
        dogName: "Figa",
        allowed:
          current.status === "requested"
            ? ["accept", "waitlist", "reject"]
            : [],
        children: null,
      });
    let tree = render(row, component);
    (
      nodes(tree).find(
        (node) => node.type === "button" && node.props.value === "reject",
      )!.props.onClick as () => void
    )();
    tree = render(row, component);
    edit(tree, "note", "Wcześniejsza odmowa");
    harness.decide.mockResolvedValueOnce({
      version: 4,
      success: "Decyzja zapisana.",
    });
    await submit(row, payload(render(row, component), "intent", "reject"));
    refreshRegistry(provider, [enrollment.id]);
    current = { ...enrollment, status: "rejected", version: 4 };
    render(row, component);
    const panel = render({ values: [] }, () =>
      ReopeningPanel({ enrollment: current, enabled: true, dogName: "Figa" })!,
    );
    const reopening: Instance = { values: [] };
    const reopenNode = nodes(panel).find(
      (node) => typeof node.type === "function",
    )!;
    let reopenTree = renderChild(reopening, reopenNode);
    edit(reopenTree, "note", "Uzgodniono ponowne rozpatrzenie");
    reopenTree = renderChild(reopening, reopenNode);
    harness.reopen.mockResolvedValueOnce({
      version: 5,
      success: "Powrót zapisany.",
    });
    await submit(reopening, payload(reopenTree, "intent", "reconsider"));
    refreshRegistry(provider, [enrollment.id]);
    current = { ...current, status: "requested", version: 5 };
    tree = render(row, component);
    expect(
      nodes(tree).find(
        (node) => node.type === "button" && node.props.value === "accept",
      )?.props.disabled,
    ).toBeFalsy();
    expect(field(tree, "expected_version").props.value).toBe(5);
    harness.decide.mockResolvedValueOnce({
      error: "Brak wolnych miejsc na kursie.",
    });
    await submit(row, payload(tree, "intent", "accept"));
    refreshRegistry(provider, [enrollment.id]);
    tree = render(row, component);
    expect(row.state?.version).toBe(5);
    expect(
      nodes(tree).find(
        (node) => typeof node.type === "function" && "state" in node.props,
      )?.props.state,
    ).toMatchObject({ error: "Brak wolnych miejsc na kursie." });
    harness.decide.mockResolvedValueOnce({
      version: 6,
      success: "Decyzja zapisana.",
    });
    await submit(row, payload(tree, "intent", "accept"));
    expect(harness.decide.mock.calls[2][1].get("expected_version")).toBe("5");
  });

  it("retries a lost secondary cancellation with its saved reason rather than the primary form's empty draft", async () => {
    const provider: Instance = { values: [] };
    refreshRegistry(provider, [enrollment.id]);
    let current = {
      ...enrollment,
      status: "accepted" as const,
      version: 4,
    } as CourseEnrollment;
    const row: Instance = { values: [] };
    const component = () =>
      CourseEnrollmentControls({
        enrollment: current,
        dogName: "Figa",
        allowed: ["cancel"],
        children: null,
      });
    render(row, component);
    const cancellation: Instance = { values: [] };
    const cancelComponent = () =>
      CommandForm({
        id: enrollment.id,
        version: 4,
        action: harness.decide,
        options: [{ value: "cancel", label: "Zapisz rezygnację" }],
        allowed: ["cancel"],
        label: "Rezygnacja: Figa",
        enrollmentDecision: { dogName: "Figa" },
      });
    let cancelTree = render(cancellation, cancelComponent);
    edit(cancelTree, "note", "Zachowany powód rezygnacji");
    cancelTree = render(cancellation, cancelComponent);
    harness.decide.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    await submit(cancellation, payload(cancelTree, "intent", "cancel"));
    refreshRegistry(provider, [enrollment.id]);
    current = { ...current, status: "cancelled", version: 5 };
    const tree = render(row, component);
    expect(field(tree, "note").props.value).toBe("Zachowany powód rezygnacji");
    expect(field(tree, "expected_version").props.value).toBe(4);
    const retry = payload(tree, "intent", "cancel");
    retry.set("note", "An obsolete local field must not replace the command");
    harness.decide.mockResolvedValueOnce({
      version: 5,
      success: "Decyzja zapisana.",
    });
    await submit(row, retry);
    expect(Object.fromEntries(harness.decide.mock.calls[1][1])).toEqual(
      Object.fromEntries(harness.decide.mock.calls[0][1]),
    );
  });

  it.each(["reconsider", "restore"] as const)(
    "retries a lost %s through the reopening action with its exact command",
    async (intent) => {
      const provider: Instance = { values: [] };
      refreshRegistry(provider, [enrollment.id]);
      const terminal = {
        ...enrollment,
        status: intent === "reconsider" ? "rejected" : "cancelled",
      } as CourseEnrollment;
      const panel = render({ values: [] }, () =>
        ReopeningPanel({
          enrollment: terminal,
          enabled: true,
          dogName: "Figa",
        })!,
      );
      const reopenNode = nodes(panel).find(
        (node) => typeof node.type === "function",
      )!;
      const reopening: Instance = { values: [] };
      let reopenTree = renderChild(reopening, reopenNode);
      edit(reopenTree, "note", "Zachowany powód powrotu");
      reopenTree = renderChild(reopening, reopenNode);
      harness.reopen.mockRejectedValueOnce(new TypeError("Failed to fetch"));
      await submit(reopening, payload(reopenTree, "intent", intent));
      refreshRegistry(provider, [enrollment.id]);
      const row: Instance = { values: [] };
      const tree = render(row, () =>
        CourseEnrollmentControls({
          enrollment: {
            ...terminal,
            status: intent === "reconsider" ? "requested" : "accepted",
            version: 4,
          },
          dogName: "Figa",
          allowed: [],
          children: null,
        }),
      );
      expect(field(tree, "note").props.value).toBe("Zachowany powód powrotu");
      expect(field(tree, "expected_version").props.value).toBe(3);
      harness.reopen.mockResolvedValueOnce({
        version: 4,
        success: "Powrót zapisany.",
      });
      await submit(row, payload(tree, "intent", intent));
      expect(harness.decide).not.toHaveBeenCalled();
      expect(Object.fromEntries(harness.reopen.mock.calls[1][1])).toEqual(
        Object.fromEntries(harness.reopen.mock.calls[0][1]),
      );
    },
  );

  it("keeps at most five confirmations and makes a repeated participant's latest result visible", () => {
    const provider: Instance = { values: [] };
    let tree = refreshRegistry(provider);
    for (let index = 0; index < 6; index++) {
      const command = {
        id: `enrollment-${index}`,
        dogName: `Pies ${index}`,
        version: 1,
        intent: "waitlist" as const,
        note: "",
      };
      tree.props.value.finish(command, {
        version: 2,
        success: "Decyzja zapisana.",
      });
      tree = refreshRegistry(provider);
    }
    expect(
      nodes(tree).filter((node) => node.props.role === "status"),
    ).toHaveLength(5);
    tree.props.value.finish(
      {
        id: "enrollment-0",
        dogName: "Pies 0",
        version: 2,
        intent: "accept",
        note: "",
      },
      { version: 3, success: "Decyzja zapisana." },
    );
    tree = refreshRegistry(provider);
    const messages = nodes(tree).filter((node) => node.props.role === "status");
    expect(messages).toHaveLength(5);
    expect(messages.at(-1)?.props.children).toBe("Pies 0: Przyjęto na kurs.");
  });

  it("does not expose administrative decisions to a guardian", () => {
    const tree = render({ values: [] }, () =>
      CourseEnrollmentControls({
        enrollment,
        dogName: "Figa",
        allowed: ["cancel"],
        admin: false,
        children: "Szczegóły własnego zgłoszenia",
      }),
    );
    expect(nodes(tree).filter((node) => node.type === "button")).toHaveLength(
      0,
    );
  });
});
