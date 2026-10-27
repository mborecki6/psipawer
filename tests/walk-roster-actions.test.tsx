import {
  Children,
  isValidElement,
  type ReactElement,
  type ReactNode,
} from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ActionState, FormAction } from "../src/components/action-form";

const mocks = vi.hoisted(() => ({
  values: [] as unknown[],
  refs: [] as { current: unknown }[],
  cursor: 0,
  refCursor: 0,
  state: {} as ActionState,
  pending: false,
  hydrated: true,
  reducer: undefined as FormAction | undefined,
  attendance: vi.fn<FormAction>(),
  decision: vi.fn<FormAction>(),
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
  useRef: (initial: unknown) => {
    const index = mocks.refCursor++;
    return (mocks.refs[index] ??= { current: initial });
  },
  useEffect: () => {},
  useId: () => "roster-fixture",
  useActionState: (reducer: FormAction) => {
    mocks.reducer = reducer;
    return [mocks.state, () => {}, mocks.pending];
  },
}));
vi.mock("../src/components/use-hydrated", () => ({
  useHydrated: () => mocks.hydrated,
}));
vi.mock("@/lib/domain", async () => import("../src/lib/domain"));
vi.mock("@/lib/data/actions", () => ({
  markAttendance: mocks.attendance,
  decideRegistration: mocks.decision,
}));
import { WalkRosterActions } from "../src/components/walk-roster-actions";
import { unconfirmedFormMessage } from "../src/components/form-action-recovery";

type Props = Parameters<typeof WalkRosterActions>[0];
const initial: Props = {
  id: "registration-a",
  dogName: "Figa",
  status: "accepted",
  attendance: "pending",
  walkStatus: "open",
  hasStarted: true,
  hasPackage: false,
  price: "60,00 zł",
  heading: <h3>Figa</h3>,
  children: <button type="button">Pozostałe działanie wiersza</button>,
};
function render(props: Partial<Props> = {}) {
  mocks.cursor = 0;
  mocks.refCursor = 0;
  return WalkRosterActions({ ...initial, ...props });
}
function nodes(node: ReactNode): ReactElement<Record<string, unknown>>[] {
  return Children.toArray(node).flatMap((child) =>
    isValidElement<Record<string, unknown>>(child)
      ? [child, ...nodes(child.props.children as ReactNode)]
      : [],
  );
}
function choose(tree: ReactNode, label: string) {
  const button = nodes(tree).find((node) => node.props["aria-label"] === label);
  if (!button || typeof button.props.onClick !== "function")
    throw new Error(`Missing button ${label}`);
  button.props.onClick();
}
function form(tree: ReactNode, label: string) {
  const target = nodes(tree).find(
    (node) => node.type === "form" && node.props["aria-label"] === label,
  );
  if (!target) throw new Error(`Missing form ${label}`);
  return target;
}
function data(tree: ReactNode) {
  const payload = new FormData();
  for (const field of nodes(tree))
    if (
      ["input", "textarea"].includes(String(field.type)) &&
      typeof field.props.name === "string"
    )
      payload.set(
        field.props.name,
        String(field.props.value ?? field.props.defaultValue ?? ""),
      );
  return payload;
}
async function submit(payload: FormData) {
  if (!mocks.reducer) throw new Error("Missing action");
  mocks.state = await mocks.reducer(mocks.state, payload);
  return mocks.state;
}
function pickAttendance(value: string) {
  const payload = data(form(render(), "Obecność: Figa"));
  payload.set("attendance", value);
  return payload;
}
beforeEach(() => {
  vi.resetAllMocks();
  mocks.values = [];
  mocks.refs = [];
  mocks.cursor = 0;
  mocks.refCursor = 0;
  mocks.state = {};
  mocks.pending = false;
  mocks.hydrated = true;
  mocks.reducer = undefined;
});

describe("walk roster actions", () => {
  it("starts unmarked and sends each ordinary attendance in one action with its unchanged domain meaning", async () => {
    const html = renderToStaticMarkup(render());
    expect(html).toContain("Nieoznaczono");
    expect(html).toContain('aria-label="Był: Figa" aria-pressed="false"');
    expect(html).toContain(
      'aria-label="Nie był · płatne: Figa" aria-pressed="false"',
    );
    expect(html).not.toContain("<select");
    mocks.attendance.mockResolvedValue({ success: "Obecność zapisana." });
    for (const value of ["present", "no_show"]) {
      await submit(pickAttendance(value));
      expect(Object.fromEntries(mocks.attendance.mock.lastCall![1])).toEqual({
        id: initial.id,
        attendance: value,
      });
    }
    expect(mocks.decision).not.toHaveBeenCalled();
  });

  it("keeps before-start and cancelled states read-only", () => {
    const before = renderToStaticMarkup(render({ hasStarted: false }));
    expect(before).toContain("Obecność oznaczysz po rozpoczęciu spaceru.");
    expect(before).not.toContain('aria-label="Był: Figa"');
    const cancelled = renderToStaticMarkup(render({ walkStatus: "cancelled" }));
    expect(cancelled).not.toContain('aria-label="Obecność: Figa"');
    expect(cancelled).not.toContain('aria-label="Przyjęcie: Figa"');
  });

  it("makes excuse and resetting explicit and describes package and cash consequences before submission", async () => {
    choose(render({ hasPackage: true }), "Usprawiedliw: Figa");
    let tree = render({ hasPackage: true });
    let html = renderToStaticMarkup(tree);
    expect(html).toContain("Usprawiedliwienie oddaje wejście do pakietu.");
    expect(html).toContain("Nie zwraca automatycznie wcześniejszej wpłaty.");
    expect(html).toContain('aria-label="Potwierdź usprawiedliwienie: Figa"');
    mocks.attendance.mockResolvedValue({ success: "Obecność zapisana." });
    await submit(data(form(tree, "Korekta obecności: Figa")));
    expect(Object.fromEntries(mocks.attendance.mock.lastCall![1])).toEqual({
      id: initial.id,
      attendance: "absent",
    });
    tree = render({ attendance: "absent" });
    choose(tree, "Wyczyść oznaczenie: Figa");
    tree = render({ attendance: "absent" });
    html = renderToStaticMarkup(tree);
    expect(html).toContain("Opłata za przyjęte miejsce pozostaje należna");
    await submit(data(form(tree, "Korekta obecności: Figa")));
    expect(Object.fromEntries(mocks.attendance.mock.lastCall![1])).toEqual({
      id: initial.id,
      attendance: "pending",
    });
  });

  it("keeps refusal and its reason after rejection and streamed regrouping, while retrying the identical operation", async () => {
    const props = { status: "pending", hasStarted: false } as const;
    let tree = render(props);
    const group = nodes(tree).find(
      (node) =>
        node.props.name === "status" &&
        typeof node.props.onChoose === "function",
    )!;
    (group.props.onChoose as (value: string) => void)("rejected");
    tree = render(props);
    let panel = form(tree, "Zmiana zgłoszenia: Figa");
    let reason = nodes(panel).find((node) => node.type === "textarea")!;
    expect(reason.props.required).not.toBe(true);
    mocks.decision.mockRejectedValueOnce(new TypeError("Lost response"));
    (reason.props.onChange as (event: unknown) => void)({
      target: { value: "Potrzebny spokojniejszy skład." },
    });
    tree = render(props);
    panel = form(tree, "Zmiana zgłoszenia: Figa");
    const sent = data(panel);
    expect(await submit(sent)).toEqual({ error: unconfirmedFormMessage });
    tree = render({ ...props, status: "rejected", attendance: "present" });
    const html = renderToStaticMarkup(tree);
    expect(html).toContain("Niepotwierdzona operacja: Nie przyjmuj.");
    expect(html).toContain("Potrzebny spokojniejszy skład.");
    expect(html).not.toContain("Decyzja zapisana.");
    reason = nodes(form(tree, "Zmiana zgłoszenia: Figa")).find(
      (node) => node.type === "textarea",
    )!;
    expect(reason.props.value).toBe("Potrzebny spokojniejszy skład.");
    mocks.decision.mockResolvedValueOnce({ success: "Decyzja zapisana." });
    await submit(data(form(tree, "Ponowienie zapisu: Figa")));
    for (const call of mocks.decision.mock.calls)
      expect(Object.fromEntries(call[1])).toEqual({
        id: initial.id,
        status: "rejected",
        note: "Potrzebny spokojniejszy skład.",
      });
    expect(
      renderToStaticMarkup(render({ ...props, status: "rejected" })),
    ).toContain("Figa: Decyzja zapisana.");
  });

  it("allows refusal without a message according to the existing walk rule", async () => {
    const props = { status: "pending", hasStarted: false } as const;
    let tree = render(props);
    const group = nodes(tree).find(
      (node) =>
        node.props.name === "status" &&
        typeof node.props.onChoose === "function",
    )!;
    (group.props.onChoose as (value: string) => void)("rejected");
    tree = render(props);
    const target = form(tree, "Zmiana zgłoszenia: Figa");
    expect(renderToStaticMarkup(target)).toContain(
      "Wiadomość dla opiekuna (opcjonalna)",
    );
    expect(
      nodes(target).find((node) => node.type === "textarea")!.props.required,
    ).not.toBe(true);
    mocks.decision.mockResolvedValueOnce({ success: "Decyzja zapisana." });
    expect(await submit(data(target))).toEqual({
      success: "Decyzja zapisana.",
    });
    expect(Object.fromEntries(mocks.decision.mock.lastCall![1])).toEqual({
      id: initial.id,
      status: "rejected",
      note: "",
    });
  });

  it("retains acceptance feedback after the registration moves to the current roster", async () => {
    let tree = render({ status: "pending", hasStarted: false });
    const payload = data(form(tree, "Przyjęcie: Figa"));
    payload.set("status", "accepted");
    mocks.decision.mockResolvedValueOnce({ success: "Decyzja zapisana." });
    await submit(payload);
    tree = render({ status: "accepted", hasStarted: false });
    const html = renderToStaticMarkup(tree);
    expect(html).toContain("W składzie");
    expect(html).toContain("Figa: Decyzja zapisana.");
    expect(html).not.toContain('aria-label="Nie przyjmuj: Figa"');
    expect(html).toContain("Cofnij przyjęcie i odmów");
    expect(Object.fromEntries(mocks.decision.mock.lastCall![1])).toEqual({
      id: initial.id,
      status: "accepted",
      note: "",
    });
  });

  it("locks the complete row and retry while a response is pending, and blocks duplicate submits before React renders pending", async () => {
    const tree = render();
    const target = form(tree, "Obecność: Figa");
    const firstEvent = { preventDefault: vi.fn() };
    const repeatedEvent = { preventDefault: vi.fn() };
    (target.props.onSubmit as (event: unknown) => void)(firstEvent);
    (target.props.onSubmit as (event: unknown) => void)(repeatedEvent);
    expect(firstEvent.preventDefault).not.toHaveBeenCalled();
    expect(repeatedEvent.preventDefault).toHaveBeenCalledOnce();
    let finish!: (state: ActionState) => void;
    mocks.attendance.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const saving = submit(pickAttendance("present"));
    mocks.pending = true;
    const waiting = render();
    expect(
      nodes(waiting).find((node) => node.type === "fieldset")!.props.disabled,
    ).toBe(true);
    expect(renderToStaticMarkup(waiting)).not.toContain("Obecność zapisana.");
    finish({ error: "Sprawdź aktualny stan spaceru." });
    await saving;
    mocks.pending = false;
    const failed = render();
    expect(renderToStaticMarkup(failed)).toContain(
      "Niepotwierdzona operacja: Był.",
    );
    mocks.pending = true;
    const retrying = render();
    const retry = form(retrying, "Ponowienie zapisu: Figa");
    expect(
      nodes(retry).find((node) => node.type === "button")!.props.disabled,
    ).toBe(true);
  });

  it("waits for hydration before permitting edits or submissions", () => {
    mocks.hydrated = false;
    const tree = render();
    expect(
      nodes(tree).find((node) => node.type === "fieldset")!.props.disabled,
    ).toBe(true);
    const event = { preventDefault: vi.fn() };
    (form(tree, "Obecność: Figa").props.onSubmit as (event: unknown) => void)(
      event,
    );
    expect(event.preventDefault).toHaveBeenCalledOnce();
  });
});
