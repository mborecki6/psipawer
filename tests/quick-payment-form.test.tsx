import {
  Children,
  isValidElement,
  type ReactElement,
  type ReactNode,
} from "react";
import { beforeEach, expect, it, vi } from "vitest";
import type { ActionState, FormAction } from "../src/components/action-form";
import type { usePaymentRecovery } from "../src/components/finance/payment-recovery";

const mocks = vi.hoisted(() => ({
  values: [] as unknown[],
  cursor: 0,
  record: vi.fn<FormAction>(),
  recovery: null as ReturnType<typeof usePaymentRecovery>,
}));
vi.mock("react", async () => ({
  ...(await vi.importActual<typeof import("react")>("react")),
  useId: () => "amount-fixture",
  useEffect: () => {},
  useRef: () => ({ current: null }),
  useState: (initial: unknown) => {
    const index = mocks.cursor++;
    if (!(index in mocks.values)) mocks.values[index] = initial;
    return [
      mocks.values[index],
      (next: unknown) => (mocks.values[index] = next),
    ];
  },
}));
vi.mock("@/components/action-form", () => ({ ActionForm: () => null }));
vi.mock("@/components/use-hydrated", () => ({ useHydrated: () => true }));
vi.mock("@/components/use-persistent-form", () => ({
  usePersistentForm: () => ({ current: null }),
}));
vi.mock("@/lib/data/finance-actions", () => ({ recordPayment: mocks.record }));
vi.mock("../src/components/finance/payment-recovery", () => ({
  usePaymentRecovery: () => mocks.recovery,
}));
import { PaymentEntryForm } from "../src/components/finance/payment-entry-form";
import {
  unconfirmedFormMessage,
  withFormActionRecovery,
} from "../src/components/form-action-recovery";

type Props = Parameters<typeof PaymentEntryForm>[0];
function render(props: Props) {
  mocks.cursor = 0;
  return PaymentEntryForm(props);
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
function data(tree: ReactNode) {
  const result = new FormData();
  for (const field of fields(tree)) {
    if (typeof field.props.name !== "string") continue;
    result.set(field.props.name, String(field.props.value ?? ""));
  }
  return result;
}
function edit(tree: ReactNode, name: string, value: string) {
  const field = fields(tree).find((item) => item.props.name === name);
  if (!field || typeof field.props.onChange !== "function")
    throw new Error(`Editable field not found: ${name}`);
  field.props.onChange({ target: { value } });
}
const requestId = "71000000-0000-4000-8000-000000000001";
beforeEach(() => {
  vi.resetAllMocks();
  mocks.values = [];
  mocks.cursor = 0;
  mocks.recovery = null;
});

it.each(["course", "fitness"] as const)(
  "keeps an uncertain compact %s receipt through refreshed props, then prepares a fresh intentional receipt only after acknowledgement",
  async (kind) => {
    let props: Props = {
      charge: { kind, id: "original-target", dueCents: 40000 },
      requestId,
      compact: true,
    };
    const edits = { amount: "100", method: "cash", note: "Część należności" };
    for (const [name, value] of Object.entries(edits))
      edit(render(props), name, value);
    let tree = render(props);
    expect(tree.props.label).toBe("Odnotuj otrzymaną wpłatę");
    const before = data(tree);
    mocks.record
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValueOnce({ error: "Sprawdź aktualną należność." })
      .mockResolvedValueOnce({ success: "Wpłata zapisana." });

    const failed = await withFormActionRecovery(tree.props.action)({}, before);
    expect(failed).toEqual({ error: unconfirmedFormMessage });
    props = {
      ...props,
      charge: { kind: "registration", id: "refreshed-target", dueCents: 30000 },
      requestId: "unrelated-refresh-key",
    };
    tree = render(props);
    expect(Object.fromEntries(data(tree))).toEqual(Object.fromEntries(before));
    const rejected = await tree.props.action(failed, data(tree));
    expect(rejected.error).toBeTruthy();
    expect(Object.fromEntries(data(render(props)))).toEqual(
      Object.fromEntries(before),
    );

    const confirmed: ActionState = await tree.props.action(
      rejected,
      data(tree),
    );
    expect(confirmed.success).toBeTruthy();
    tree = render(props);
    const next = data(tree);
    expect(next.get("request_id")).not.toBe(requestId);
    expect(next.get("request_id")).not.toBe(props.requestId);
    expect(next.get("target_kind")).toBe(kind);
    expect(next.get("target_id")).toBe("original-target");
    expect(next.get("amount")).toBe("");
    expect(next.get("method")).toBe("transfer");
    expect(next.get("note")).toBe("");
    for (const call of mocks.record.mock.calls)
      expect(Object.fromEntries(call[1])).toEqual(Object.fromEntries(before));

    edit(tree, "amount", "300");
    const final = data(render(props));
    expect(final.get("amount")).toBe("300");
    expect(final.get("request_id")).toBe(next.get("request_id"));
  },
);

it.each(["course", "fitness"] as const)(
  "restores the same uncertain %s command when its whole form is remounted, then exact retry acknowledges one receipt",
  async (kind) => {
    let receipt: ReturnType<
      NonNullable<ReturnType<typeof usePaymentRecovery>>["unconfirmed"]
    >;
    const saved = new Set<string>();
    mocks.record.mockImplementation(async (_, form) => {
      const key = String(form.get("request_id"));
      if (!saved.has(key)) {
        saved.add(key);
        throw new TypeError("Failed to fetch after commit");
      }
      return { success: "Wpłata zapisana." };
    });
    mocks.recovery = {
      unconfirmed: (targetKind, targetId) =>
        receipt &&
        !receipt.result.success &&
        receipt.command.fields.target_kind === targetKind &&
        receipt.command.fields.target_id === targetId
          ? receipt
          : undefined,
      record: async (command, previous) => {
        receipt = { command, pending: true, result: {} };
        const form = new FormData();
        for (const [name, value] of Object.entries(command.fields))
          form.set(name, value);
        const result = await withFormActionRecovery(mocks.record)(
          previous,
          form,
        );
        receipt = { command, pending: false, result };
        return result;
      },
    };
    const props: Props = {
      charge: { kind, id: "original-target", dueCents: 40000 },
      requestId,
      compact: true,
    };
    for (const [name, value] of Object.entries({
      amount: "100",
      method: "cash",
      note: "Wysłana wpłata",
    }))
      edit(render(props), name, value);
    const original = data(render(props));
    expect((await render(props).props.action({}, original)).error).toBe(
      unconfirmedFormMessage,
    );
    // A different list page destroys all local hooks of PaymentEntryForm; the
    // provider's submitted receipt survives independently above that list.
    mocks.values = [];
    const remountedProps = {
      ...props,
      requestId: "fresh-server-key",
      charge: { ...props.charge, dueCents: 30000 },
    };
    const restored = render(remountedProps);
    expect(Object.fromEntries(data(restored))).toEqual(
      Object.fromEntries(original),
    );
    const feedback = Children.toArray(restored.props.children).find(
      (child) =>
        isValidElement<Record<string, unknown>>(child) &&
        child.props.role === "alert",
    );
    expect(feedback).toBeTruthy();
    await restored.props.action({}, data(restored));
    expect(saved.size).toBe(1);
    expect(mocks.record).toHaveBeenCalledTimes(2);
    expect(Object.fromEntries(mocks.record.mock.calls[1][1])).toEqual(
      Object.fromEntries(original),
    );
    expect(data(render(remountedProps)).get("request_id")).not.toBe(requestId);
    expect(data(render(remountedProps)).get("amount")).toBe("");
  },
);

it("allows correcting a restored validation error while preserving its request key", async () => {
  mocks.recovery = {
    unconfirmed: () => ({
      command: {
        fields: {
          target_kind: "course",
          target_id: "original-target",
          request_id: requestId,
          amount: "0",
          method: "cash",
          note: "",
        },
        dogName: "Figa",
        guardianName: "Opiekun",
        title: "Kurs",
      },
      pending: false,
      result: { error: "Podaj poprawną kwotę." },
    }),
    record: async (command, previous) => {
      const form = new FormData();
      for (const [name, value] of Object.entries(command.fields))
        form.set(name, value);
      return mocks.record(previous, form);
    },
  };
  mocks.record.mockResolvedValue({ success: "Wpłata zapisana." });
  const props: Props = {
    charge: { kind: "course", id: "original-target", dueCents: 40000 },
    requestId: "unused-key",
    compact: true,
  };
  edit(render(props), "amount", "100");
  const tree = render(props);
  await tree.props.action({}, data(tree));
  expect(mocks.record.mock.calls[0][1].get("request_id")).toBe(requestId);
  expect(mocks.record.mock.calls[0][1].get("amount")).toBe("100");
});
