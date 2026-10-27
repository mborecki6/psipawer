import {
  Children,
  createElement,
  isValidElement,
  type ReactElement,
  type ReactNode,
} from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";
import type { ActionState, FormAction } from "../src/components/action-form";

const mocks = vi.hoisted(() => ({
  values: [] as unknown[],
  refs: [] as { current: unknown }[],
  cursor: 0,
  refCursor: 0,
  record: vi.fn<FormAction>(),
  retry: undefined as FormAction | undefined,
}));
vi.mock("react", async () => ({
  ...(await vi.importActual<typeof import("react")>("react")),
  useState: (initial: unknown) => {
    const index = mocks.cursor++;
    if (!(index in mocks.values)) mocks.values[index] = initial;
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
}));
vi.mock("@/components/action-form", () => ({
  ActionForm: ({
    action,
    children,
    label,
    disabled,
  }: {
    action: FormAction;
    children: ReactNode;
    label: string;
    disabled: boolean;
  }) => {
    mocks.retry = action;
    return createElement(
      "form",
      null,
      children,
      createElement("button", { disabled }, label),
    );
  },
}));
vi.mock("@/lib/data/finance-actions", () => ({ recordPayment: mocks.record }));
vi.mock("@/lib/domain", async () => import("../src/lib/domain"));
import {
  PaymentRecoveryProvider,
  type PaymentCommand,
} from "../src/components/finance/payment-recovery";
import { unconfirmedFormMessage } from "../src/components/form-action-recovery";

const command: PaymentCommand = {
  fields: {
    request_id: "71000000-0000-4000-8000-000000000001",
    target_kind: "course",
    target_id: "course-enrollment",
    amount: "400",
    method: "cash",
    note: "Otrzymana wpłata",
  },
  dogName: "Figa",
  guardianName: "Opiekun Figi",
  title: "Kurs nauki",
};
function render(visibleTargets: string[], children: ReactNode = null) {
  mocks.cursor = 0;
  mocks.refCursor = 0;
  return PaymentRecoveryProvider({ visibleTargets, children });
}
function nodes(node: ReactNode): ReactElement<Record<string, unknown>>[] {
  return Children.toArray(node).flatMap((child) =>
    isValidElement<Record<string, unknown>>(child)
      ? [child, ...nodes(child.props.children as ReactNode)]
      : [],
  );
}
beforeEach(() => {
  vi.resetAllMocks();
  mocks.values = [];
  mocks.refs = [];
  mocks.retry = undefined;
});

it("retains a sent command after the entire row unmounts, locks pending retries and confirms the exact immutable payload", async () => {
  const originalRow = (
    <article id="original-charge">
      <form>
        <input name="amount" defaultValue="400" />
      </form>
    </article>
  );
  const initial = render(["course:course-enrollment"], originalRow);
  expect(renderToStaticMarkup(initial)).not.toContain("Potwierdzenia wpłat");
  let reply!: (state: ActionState) => void;
  mocks.record.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        reply = resolve;
      }),
  );
  const submitted = { ...command, fields: { ...command.fields } };
  const pending = initial.props.value.record(submitted, {});
  const whileVisible = renderToStaticMarkup(
    render(["course:course-enrollment"], originalRow),
  );
  expect(whileVisible).not.toContain("Potwierdzenia wpłat");
  submitted.fields.amount = "1";
  const removed = render([], null);
  const waiting = renderToStaticMarkup(removed);
  expect(waiting).not.toContain("original-charge");
  expect(waiting).toContain('aria-label="Potwierdzenia wpłat"');
  expect(waiting).toContain("400,00");
  expect(waiting).toContain("disabled");
  await removed.props.value.record(command, {});
  expect(mocks.record).toHaveBeenCalledTimes(1);
  reply({ error: unconfirmedFormMessage });
  await pending;
  const uncertain = renderToStaticMarkup(render([]));
  expect(uncertain).toContain("Figa · Kurs nauki");
  expect(uncertain).toContain("Opiekun Figi");
  expect(uncertain).toContain("Gotówka");
  expect(uncertain).toContain(unconfirmedFormMessage);
  expect(uncertain).toContain(
    'name="request_id" value="71000000-0000-4000-8000-000000000001"',
  );
  expect(uncertain).not.toContain("disabled");
  expect(uncertain).not.toContain("Zamknij potwierdzenie wpłaty");
  expect(uncertain).not.toContain("Saldo należności");
  expect(uncertain).not.toContain("Pozostało");
  mocks.record.mockResolvedValueOnce({ success: "Wpłata zapisana." });
  await mocks.retry!({}, new FormData());
  expect(mocks.record).toHaveBeenCalledTimes(2);
  for (const call of mocks.record.mock.calls)
    expect(Object.fromEntries(call[1])).toEqual(command.fields);
  const completed = render([]);
  const success = renderToStaticMarkup(completed);
  expect(success).toContain('role="status"');
  expect(success).toContain("Wpłata zapisana.");
  expect(success).not.toContain("Ponów potwierdzenie tej wpłaty");
  const notice = nodes(completed).find(
    (node) => typeof node.props.dismiss === "function",
  );
  expect(notice).toBeTruthy();
  (notice!.props.dismiss as () => void)();
  expect(renderToStaticMarkup(render([]))).not.toContain("Potwierdzenia wpłat");
});

it("keeps feedback for a submitted row when pagination replaces it, and preserves its key after retry errors", async () => {
  mocks.record.mockRejectedValueOnce(new TypeError("Failed to fetch"));
  const first = render(
    ["course:course-enrollment"],
    <article id="first-page" />,
  );
  expect(await first.props.value.record(command, {})).toEqual({
    error: unconfirmedFormMessage,
  });
  const pageTwo = renderToStaticMarkup(
    render(["fitness:other-target"], <article id="second-page" />),
  );
  expect(pageTwo).toContain('id="second-page"');
  expect(pageTwo).not.toContain('id="first-page"');
  expect(pageTwo).toContain("Potwierdzenia wpłat");
  const returned = render(
    ["course:course-enrollment"],
    <article id="returned-row" />,
  );
  expect(
    returned.props.value.unconfirmed("course", "course-enrollment")?.command
      .fields,
  ).toEqual(command.fields);
  const returnedHtml = renderToStaticMarkup(returned);
  expect(returnedHtml).toContain('id="returned-row"');
  expect(returnedHtml).not.toContain("Potwierdzenia wpłat");
  renderToStaticMarkup(render(["fitness:other-target"]));
  mocks.record.mockResolvedValueOnce({ error: "Sprawdź stan wpłaty." });
  await mocks.retry!({}, new FormData());
  const again = renderToStaticMarkup(
    render(["fitness:other-target"], <article id="second-page" />),
  );
  expect(again).toContain("Sprawdź stan wpłaty.");
  expect(again).toContain(
    'name="request_id" value="71000000-0000-4000-8000-000000000001"',
  );
  expect(again).not.toContain("Zamknij potwierdzenie wpłaty");
  expect(Object.fromEntries(mocks.record.mock.calls[1][1])).toEqual(
    command.fields,
  );
});

it("does not duplicate an inline success, but keeps a full receipt confirmation after the row disappears", async () => {
  mocks.record.mockResolvedValueOnce({ success: "Wpłata zapisana." });
  const first = render(
    ["course:course-enrollment"],
    <article id="charge-row" />,
  );
  await first.props.value.record(command, {});
  expect(
    renderToStaticMarkup(
      render(["course:course-enrollment"], <article id="charge-row" />),
    ),
  ).not.toContain("Potwierdzenia wpłat");
  const confirmed = renderToStaticMarkup(render([], null));
  expect(confirmed).not.toContain("charge-row");
  expect(confirmed).toContain('role="status"');
  expect(confirmed).toContain("400,00");
  expect(confirmed).toContain("Zamknij potwierdzenie wpłaty");
});

it("keeps only the latest acknowledged command for one charge after successive partial and final receipts", async () => {
  mocks.record.mockResolvedValue({ success: "Wpłata zapisana." });
  const first = render(["course:course-enrollment"]);
  await first.props.value.record(
    { ...command, fields: { ...command.fields, amount: "100" } },
    {},
  );
  await render(["course:course-enrollment"]).props.value.record(
    {
      ...command,
      fields: {
        ...command.fields,
        request_id: "second-request",
        amount: "300",
      },
    },
    {},
  );
  const confirmed = renderToStaticMarkup(render([]));
  expect(confirmed).toContain('data-payment-request="second-request"');
  expect(confirmed).not.toContain(
    `data-payment-request="${command.fields.request_id}"`,
  );
  expect(confirmed).toContain("300,00");
  expect(confirmed).not.toContain("100,00");
});
