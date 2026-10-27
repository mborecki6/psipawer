import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";
import type { FinanceCharge, FinanceData } from "../src/lib/finance";
import type { OnlinePaymentAttempt } from "../src/modules/payments/types";

const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  context: vi.fn(),
  charge: vi.fn(),
  attempt: vi.fn(),
  start: vi.fn(),
  check: vi.fn(),
  continue: vi.fn(),
  simulate: vi.fn(),
  recover: vi.fn(),
}));
vi.mock("@/lib/auth/session", () => ({ requireSession: mocks.session }));
vi.mock("@/modules/payments/server", () => ({
  getOnlinePaymentContext: mocks.context,
  getOnlinePaymentCharge: mocks.charge,
  getOnlinePaymentAttempt: mocks.attempt,
}));
vi.mock("@/modules/payments/actions", () => ({
  startOnlinePayment: mocks.start,
  checkOnlinePayment: mocks.check,
  continueOnlinePayment: mocks.continue,
  simulateOnlinePayment: mocks.simulate,
  recoverOnlinePayment: mocks.recover,
}));
vi.mock(
  "@/modules/payments/views",
  async () => import("../src/modules/payments/views"),
);
vi.mock("@/lib/domain", async () => import("../src/lib/domain"));
vi.mock(
  "@/lib/finance-pagination",
  async () => import("../src/lib/finance-pagination"),
);
vi.mock("@/components/ui", async () => import("../src/components/ui"));
vi.mock("@/components/use-hydrated", () => ({ useHydrated: () => true }));
vi.mock("@/components/use-persistent-form", () => ({
  usePersistentForm: () => ({ current: null }),
}));
vi.mock("@/lib/data/finance-actions", () => ({
  recordPayment: vi.fn(),
  voidPayment: vi.fn(),
  purchasePackage: vi.fn(),
  usePackage: vi.fn(),
  releasePackage: vi.fn(),
  cancelPackage: vi.fn(),
}));
vi.mock("@/components/action-form", () => ({
  ActionForm: ({ children, label }: { children: ReactNode; label: string }) =>
    createElement(
      "form",
      { method: "post" },
      children,
      createElement("button", { type: "submit" }, label),
    ),
  Field: () => null,
}));

import { FinanceView } from "../src/components/finance";
import { PaymentRow } from "../src/components/finance/payment-row";
import {
  NewOnlinePaymentView,
  OnlinePaymentPreviewView,
  OnlinePaymentAttemptView,
  OnlinePaymentAttempts,
} from "../src/modules/payments/views";
import NewPage from "../src/app/app/payments/new/page";
import ClientPage from "../src/app/app/payments/[id]/page";
import AdminPage from "../src/app/admin/payments/[id]/page";

const charge: FinanceCharge = {
  id: "00000000-0000-4000-8000-000000000001",
  kind: "course",
  dogId: "dog",
  dogName: "Figa",
  guardianName: "Opiekun",
  title: "Przedszkole — grupa pierwsza",
  date: "2030-10-01T10:00:00Z",
  href: "/app/courses/course",
  amountCents: 10000,
  paidCents: 4000,
  dueCents: 6000,
  canPay: true,
  onlinePaymentEligible: true,
  availablePackages: [],
};
const attempt: OnlinePaymentAttempt = {
  id: "00000000-0000-4000-8000-000000000002",
  request_id: "request",
  target_kind: "course",
  target_id: charge.id,
  guardian_id: "guardian",
  dog_id: "dog",
  amount_cents: 6000,
  currency: "PLN",
  environment: "simulator",
  status: "pending",
  transaction_id: "transaction",
  transaction_title: "PRIVATE TECHNICAL TITLE",
  merchant_id: "merchant",
  checkout_url: "https://secure.sandbox.tpay.com/test",
  payment_id: null,
  confirmed_amount_cents: null,
  confirmed_at: null,
  review_reason: null,
  error_code: null,
  created_at: "2030-10-01T10:00:00Z",
  updated_at: "2030-10-01T10:00:00Z",
};
const context = {
  enabled: true,
  canProcess: true,
  environment: "simulator" as const,
  walkGate: "accepted",
  notice: "",
  attempts: [],
};
const data = (charges: FinanceCharge[] = [charge]): FinanceData => ({
  dogs: [],
  charges,
  packages: [],
  payments: [],
  totals: {
    dueCents: charges.reduce((sum, item) => sum + item.dueCents, 0),
    paidCents: 0,
    availableEntries: 0,
    reservedEntries: 0,
  },
});
const detail = (
  changes: Partial<OnlinePaymentAttempt> = {},
  admin = false,
  controlsEnabled = true,
) =>
  renderToStaticMarkup(
    createElement(OnlinePaymentAttemptView, {
      attempt: { ...attempt, ...changes },
      admin,
      controlsEnabled,
      checkAction: mocks.check,
      continueAction: mocks.continue,
      simulateAction: mocks.simulate,
    }),
  );

it.each([
  ["tpay_simulator", "BLIK · symulacja lokalna"],
  ["tpay_sandbox", "BLIK · Tpay sandbox"],
  ["tpay_live", "BLIK · Tpay"],
])(
  "labels test BLIK method %s in the payment history for both roles",
  (method, label) => {
    for (const admin of [false, true]) {
      const html = renderToStaticMarkup(
        createElement(PaymentRow, {
          admin,
          payment: {
            id: "receipt",
            method,
            amountCents: 6000,
            status: "paid",
            paidAt: "2030-10-01T10:00:00Z",
            dogName: "Figa",
            guardianName: "Opiekun",
            title: "Kurs",
            note: null,
            needsReview: false,
            refundedAt: null,
            refundNote: null,
          },
        }),
      );
      expect(html).toContain(label);
      expect(html).toContain("Wpłata zapisana");
      expect(html).not.toContain(method);
    }
  },
);

beforeEach(() => {
  vi.clearAllMocks();
  mocks.session.mockResolvedValue({ role: "client" });
  mocks.context.mockResolvedValue(context);
  mocks.charge.mockResolvedValue(charge);
  mocks.attempt.mockResolvedValue(attempt);
});

it("keeps checkout off and labels the preview when online payment is disabled", () => {
  for (const onlinePayments of [undefined, { ...context, enabled: false }]) {
    const html = renderToStaticMarkup(
      createElement(FinanceView, {
        data: data(),
        admin: false,
        onlinePayments,
      }),
    );
    expect(html).not.toContain("Zapłać BLIKIEM");
    expect(html).not.toContain("Próby płatności BLIK");
    expect(html).not.toContain("Symulacja lokalna");
    expect(html).toContain("Sposób płatności lub zwrotu ustal z prowadzącą");
    expect(html.includes("Podgląd płatności online")).toBe(
      onlinePayments !== undefined,
    );
  }
});

it("offers a clearly named preview of eligible services only to the guardian", () => {
  const charges = (
    ["registration", "consultation", "course", "fitness", "package"] as const
  ).map((kind) => ({ ...charge, kind, id: kind }));
  for (const admin of [false, true]) {
    const html = renderToStaticMarkup(
      createElement(FinanceView, {
        data: data(charges),
        admin,
        onlinePayments: { ...context, enabled: false, environment: null },
      }),
    );
    expect(html.match(/Podgląd płatności online/g) || []).toHaveLength(
      admin ? 0 : 4,
    );
    expect(html).not.toContain("kind=package");
    expect(html).not.toContain("Zapłać BLIKIEM");
  }
});

it("does not preview unaccepted, settled or reviewed charges", () => {
  for (const changes of [
    { onlinePaymentEligible: false },
    { onlinePaymentEligible: undefined },
    { canPay: false },
    { dueCents: 0 },
    { reviewReason: "settlement" as const },
    { reviewReason: "refund" as const },
  ]) {
    const html = renderToStaticMarkup(
      createElement(FinanceView, {
        data: data([{ ...charge, ...changes }]),
        admin: false,
        onlinePayments: { ...context, enabled: false },
      }),
    );
    expect(html).not.toContain("Podgląd płatności online");
  }
});

it.each(["creating", "pending", "uncertain", "requires_review"] as const)(
  "keeps the %s attempt ahead of a preview for its charge",
  (status) => {
    const html = renderToStaticMarkup(
      createElement(FinanceView, {
        data: data([charge, { ...charge, id: "another-charge" }]),
        admin: false,
        onlinePayments: {
          ...context,
          enabled: false,
          environment: null,
          attempts: [{ ...attempt, status }],
        },
      }),
    );
    expect(html).toContain("Przed kolejną wpłatą sprawdź");
    expect(html).toContain(`/app/payments/${attempt.id}`);
    expect(html).not.toContain(`target=${charge.id}`);
    expect(html).toContain("target=another-charge");
  },
);

it("shows the actual balance in a provider-neutral preview without a payment form", () => {
  const html = renderToStaticMarkup(
    createElement(OnlinePaymentPreviewView, { charge }),
  );
  expect(html).toContain("Podgląd płatności online");
  expect(html).toContain("Płatności online jeszcze niedostępne");
  expect(html).toContain("Figa");
  expect(html).toContain(charge.title);
  expect(html).toContain("100,00");
  expect(html).toContain("40,00");
  expect(html).toContain("60,00");
  expect(html).toContain('href="/app/finance"');
  expect(html).toContain(`href="${charge.href}"`);
  expect(html).not.toMatch(/<form|<input|<button|BLIK|Tpay|PayU|Opłacona/);
});

it.each([false, true])(
  "keeps unresolved history visible with checkout off for admin=%s",
  (admin) => {
    const html = renderToStaticMarkup(
      createElement(FinanceView, {
        data: data([]),
        admin,
        onlinePayments: {
          ...context,
          enabled: false,
          environment: null,
          attempts: [{ ...attempt, status: "uncertain" }],
        },
      }),
    );
    expect(html).toContain("Nowe płatności BLIK są obecnie wyłączone");
    expect(html).toContain("Płatności do sprawdzenia: 1");
    expect(html).toContain(attempt.id);
    expect(html).not.toContain("Wszystko rozliczone");
    expect(html).not.toContain("Zapłać BLIKIEM");
  },
);

it("labels a live checkout without a test notice while staff cannot initiate a client charge", () => {
  for (const admin of [false, true]) {
    const html = renderToStaticMarkup(
      createElement(FinanceView, {
        data: data(),
        admin,
        onlinePayments: { ...context, environment: "live" },
      }),
    );
    expect(html.includes("Zapłać BLIKIEM")).toBe(!admin);
    expect(html).not.toContain("BLIKIEM testowo");
    expect(html).not.toContain("Symulacja lokalna");
    expect(html).not.toContain("Tpay sandbox");
  }
});

it("offers a test payment for each allowed service only to the client", () => {
  const charges = (
    ["registration", "consultation", "course", "fitness", "package"] as const
  ).map((kind) => ({ ...charge, id: kind, kind }));
  const html = renderToStaticMarkup(
    createElement(FinanceView, {
      data: data(charges),
      admin: false,
      onlinePayments: context,
    }),
  );
  for (const kind of ["registration", "consultation", "course", "fitness"])
    expect(html).toContain(`/app/payments/new?kind=${kind}&amp;target=${kind}`);
  expect(html).not.toContain("kind=package");
  const staff = renderToStaticMarkup(
    createElement(FinanceView, {
      data: data(charges),
      admin: true,
      onlinePayments: context,
    }),
  );
  expect(staff).not.toContain("Zapłać BLIKIEM");
});

it("hides payment for review, unavailable, zero balance and disabled walk gate", () => {
  for (const changes of [
    { reviewReason: "settlement" as const },
    { canPay: false },
    { dueCents: 0 },
  ]) {
    const html = renderToStaticMarkup(
      createElement(FinanceView, {
        data: data([{ ...charge, ...changes }]),
        admin: false,
        onlinePayments: context,
      }),
    );
    expect(html).not.toContain("Zapłać BLIKIEM");
  }
  const html = renderToStaticMarkup(
    createElement(FinanceView, {
      data: data([{ ...charge, kind: "registration" }]),
      admin: false,
      onlinePayments: { ...context, walkGate: "disabled" },
    }),
  );
  expect(html).not.toContain("Zapłać BLIKIEM");
});

it("confirms dog, service and the remaining amount without submitting a client price or payer", () => {
  const html = renderToStaticMarkup(
    createElement(NewOnlinePaymentView, {
      charge,
      environment: "simulator",
      requestId: "request",
      action: mocks.start,
    }),
  );
  expect(html).toContain("Figa");
  expect(html).toContain(charge.title);
  expect(html).toContain("60,00");
  expect(html).toContain('name="target_id"');
  expect(html).toContain('name="request_id"');
  expect(html).not.toMatch(/name="(?:amount|amount_cents|guardian_id|payer)"/);
  expect(html).toContain("Symulacja lokalna — bez połączenia z Tpay");
  expect(mocks.start).not.toHaveBeenCalled();
});

it.each([
  ["creating", "Rozpoczęta"],
  ["pending", "Oczekuje na potwierdzenie"],
  ["uncertain", "Wynik do sprawdzenia"],
  ["failed", "Nieudana"],
  ["paid", "Opłacona"],
  ["requires_review", "Wpływ do sprawdzenia"],
] as const)(
  "gives %s a text status and the appropriate next step",
  (status, label) => {
    const html = detail({ status });
    expect(html).toContain(label);
    expect(html).toContain('role="status"');
    if (["creating", "pending", "uncertain"].includes(status))
      expect(html).toContain("Sprawdź status płatności");
    else expect(html).not.toContain("Sprawdź status płatności");
    if (status === "failed")
      expect(html).toContain("Sprawdź należność i spróbuj ponownie");
    if (["paid", "requires_review"].includes(status))
      expect(html).not.toContain("/payments/new");
  },
);

it("retains the complete received amount and reason in both roles without promising allocation or refund", () => {
  for (const admin of [false, true]) {
    const html = detail(
      {
        status: "requires_review",
        confirmed_amount_cents: 6500,
        review_reason: "balance_changed",
      },
      admin,
    );
    expect(html).toContain("65,00");
    expect(html).toContain("Pozostała kwota zmieniła się");
    expect(html).toContain("Nie został automatycznie przypisany");
    expect(html).toContain("nie przywraca zajęć");
    expect(html).toContain("nie uruchamia automatycznego zwrotu");
  }
});

it("distinguishes an amount mismatch from a refund of an already allocated receipt", () => {
  expect(
    detail({ status: "requires_review", review_reason: "amount_mismatch" }),
  ).toContain("Potwierdzona wpłata różni się od oczekiwanej kwoty.");
  const refunded = {
    ...attempt,
    status: "requires_review" as const,
    review_reason: "chargeback",
    payment_id: "original-receipt",
    confirmed_amount_cents: 6000,
  };
  for (const admin of [false, true]) {
    const html = detail(refunded, admin);
    expect(html).toContain("Operator zgłosił zwrot płatności.");
    expect(html).toContain(
      "Wcześniejsza wpłata wymaga uzgodnienia po zwrocie.",
    );
    expect(html).not.toContain("Nie został automatycznie przypisany");
    const history = renderToStaticMarkup(
      createElement(OnlinePaymentAttempts, { attempts: [refunded], admin }),
    );
    expect(history).toContain(
      "Wcześniejsza wpłata wymaga uzgodnienia po zwrocie.",
    );
    expect(history).not.toContain("bez automatycznego rozliczenia");
  }
});

it("describes a later amount increase without inventing a refund or losing the earlier receipt", () => {
  const increased = {
    ...attempt,
    status: "requires_review" as const,
    review_reason: "amount_mismatch",
    payment_id: "original-receipt",
    confirmed_amount_cents: 7250,
  };
  for (const admin of [false, true]) {
    const views = [
      detail(increased, admin),
      renderToStaticMarkup(
        createElement(OnlinePaymentAttempts, { attempts: [increased], admin }),
      ),
    ];
    for (const html of views) {
      expect(html).toContain("72,50");
      expect(html).toContain("Wcześniejsza wpłata pozostaje w rozliczeniach.");
      expect(html).toContain(
        "Zmiana potwierdzenia operatora wymaga uzgodnienia; nie płać ponownie.",
      );
      expect(html).not.toContain("po zwrocie");
      expect(html).not.toContain("Nie został automatycznie przypisany");
    }
  }
});

it.each(["paid", "requires_review", "failed"] as const)(
  "lets both roles check a terminal %s sandbox transaction",
  (status) => {
    for (const admin of [false, true]) {
      const html = detail({ environment: "sandbox", status }, admin);
      expect(html).toContain("Sprawdź status płatności");
      expect(html).not.toContain("Wróć do testowej bramki BLIK");
      if (status !== "failed") expect(html).not.toContain("/payments/new");
      expect(
        detail({ environment: "sandbox", status, transaction_id: null }, admin),
      ).not.toContain("Sprawdź status płatności");
      expect(
        detail({ environment: "sandbox", status }, admin, false),
      ).not.toContain("Sprawdź status płatności");
    }
  },
);

it("uses a POST continuation only for pending sandbox attempts and exposes no checkout URL", () => {
  const html = detail({ environment: "sandbox" });
  expect(html).toContain("Wróć do testowej bramki BLIK");
  expect(html).toContain('method="post"');
  expect(html).not.toContain(attempt.checkout_url);
  expect(html).not.toContain("Wynik lokalnego testu");
  expect(detail({ environment: "sandbox", status: "uncertain" })).not.toContain(
    "Wróć do testowej bramki BLIK",
  );
  expect(detail({ environment: "sandbox" }, true)).not.toContain(
    "Wróć do testowej bramki BLIK",
  );
});

it("shows explicit local outcomes only to the owning client in simulator mode", () => {
  const html = detail();
  expect(html).toContain('name="outcome"');
  expect(html).toContain('value="success"');
  expect(html).toContain('value="failure"');
  expect(detail({}, true)).not.toContain('name="outcome"');
  expect(detail({}, false, false)).not.toContain('name="outcome"');
  expect(detail({ status: "paid" })).not.toContain('name="outcome"');
});

it("shows old review attempts alongside recent history without joining a new owner or exposing provider titles", () => {
  const attempts = Array.from({ length: 22 }, (_, i) => ({
    ...attempt,
    id: `${i}-attempt`,
    status: i === 21 ? ("requires_review" as const) : ("paid" as const),
    review_reason: i === 21 ? "owner_changed" : null,
  }));
  const html = renderToStaticMarkup(
    createElement(OnlinePaymentAttempts, { attempts, admin: false }),
  );
  expect(html).toContain("/app/payments/21-attempt");
  expect(html).toContain("zmienił się opiekun");
  expect(html).not.toContain("PRIVATE TECHNICAL TITLE");
  expect(html).not.toContain("guardian");
});

it("requires the client before a read-only confirmation GET", async () => {
  const page = await NewPage({
    searchParams: Promise.resolve({ kind: "course", target: charge.id }),
  });
  expect(mocks.session).toHaveBeenCalledWith("client");
  expect(mocks.session.mock.invocationCallOrder[0]).toBeLessThan(
    mocks.context.mock.invocationCallOrder[0],
  );
  expect(mocks.charge).toHaveBeenCalledWith("course", charge.id);
  expect(renderToStaticMarkup(page)).toContain("Podsumowanie płatności");
  expect(mocks.start).not.toHaveBeenCalled();
});

it("previews a disabled checkout but distinguishes unavailable and failed charge reads", async () => {
  mocks.context.mockResolvedValueOnce({
    ...context,
    enabled: false,
    environment: null,
    notice: "Brak lokalnej konfiguracji testowej.",
  });
  const off = renderToStaticMarkup(
    await NewPage({
      searchParams: Promise.resolve({ kind: "course", target: charge.id }),
    }),
  );
  expect(off).toContain("Płatności online jeszcze niedostępne");
  expect(off).toContain("Podsumowanie płatności");
  expect(off).not.toContain("Brak lokalnej konfiguracji testowej.");
  expect(off).not.toContain("<form");
  expect(mocks.charge).toHaveBeenCalledWith("course", charge.id);
  mocks.charge.mockResolvedValueOnce(null);
  expect(
    renderToStaticMarkup(
      await NewPage({
        searchParams: Promise.resolve({ kind: "course", target: charge.id }),
      }),
    ),
  ).toContain("Ta należność nie jest dostępna");
  mocks.charge.mockRejectedValueOnce(new Error("PRIVATE DB error"));
  const failed = renderToStaticMarkup(
    await NewPage({
      searchParams: Promise.resolve({ kind: "course", target: charge.id }),
    }),
  );
  expect(failed).toContain("Nie udało się odczytać należności");
  expect(failed).not.toContain("PRIVATE DB error");
  expect(mocks.start).not.toHaveBeenCalled();
});

it("keeps repeated preview reads free of all payment actions", async () => {
  mocks.context.mockResolvedValue({
    ...context,
    enabled: false,
    environment: null,
    attempts: [{ ...attempt, status: "uncertain" }],
  });
  for (let visit = 0; visit < 3; visit++) {
    const html = renderToStaticMarkup(
      await NewPage({
        searchParams: Promise.resolve({ kind: "course", target: charge.id }),
      }),
    );
    expect(html).toContain("Płatności online jeszcze niedostępne");
    expect(html).toContain("wcześniejszą próbę płatności");
    expect(html).toContain(`/app/payments/${attempt.id}`);
    expect(html).not.toMatch(/<form|<input|<button/);
  }
  for (const action of [
    mocks.start,
    mocks.continue,
    mocks.check,
    mocks.simulate,
    mocks.recover,
  ])
    expect(action).not.toHaveBeenCalled();
});

it("requires the guardian role before reading a preview", async () => {
  mocks.session.mockRejectedValueOnce(new Error("FORBIDDEN"));
  await expect(
    NewPage({
      searchParams: Promise.resolve({ kind: "course", target: charge.id }),
    }),
  ).rejects.toThrow("FORBIDDEN");
  expect(mocks.context).not.toHaveBeenCalled();
  expect(mocks.charge).not.toHaveBeenCalled();
});

it("does not reveal a missing or foreign charge and rejects ineligible preview targets", async () => {
  mocks.context.mockResolvedValue({
    ...context,
    enabled: false,
    environment: null,
  });
  for (const inaccessible of [
    null,
    { ...charge, onlinePaymentEligible: false },
    { ...charge, canPay: false },
    { ...charge, dueCents: 0 },
    { ...charge, kind: "package" },
    { ...charge, reviewReason: "settlement" },
    { ...charge, reviewReason: "refund" },
  ]) {
    mocks.charge.mockResolvedValueOnce(inaccessible);
    const html = renderToStaticMarkup(
      await NewPage({
        searchParams: Promise.resolve({ kind: "course", target: charge.id }),
      }),
    );
    expect(html).toContain("Ta należność nie jest dostępna w podglądzie");
    expect(html).not.toContain(charge.dogName);
    expect(html).not.toContain(charge.title);
    expect(html).not.toContain("<form");
  }
});

it("requires the appropriate role for either attempt page and never checks or mutates on GET", async () => {
  for (const [page, role] of [
    [ClientPage, "client"],
    [AdminPage, "admin"],
  ] as const) {
    vi.clearAllMocks();
    const html = renderToStaticMarkup(
      await page({ params: Promise.resolve({ id: attempt.id }) }),
    );
    expect(mocks.session).toHaveBeenCalledWith(role);
    expect(mocks.session.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.attempt.mock.invocationCallOrder[0],
    );
    expect(html).toContain("Status płatności");
    expect(mocks.check).not.toHaveBeenCalled();
    expect(mocks.simulate).not.toHaveBeenCalled();
    expect(mocks.continue).not.toHaveBeenCalled();
  }
});

it("keeps missing attempts distinct from a failed read without leaking an error", async () => {
  mocks.attempt.mockResolvedValueOnce(null);
  expect(
    renderToStaticMarkup(
      await ClientPage({ params: Promise.resolve({ id: attempt.id }) }),
    ),
  ).toContain("Ta próba płatności jest niedostępna");
  mocks.attempt.mockRejectedValueOnce(new Error("PRIVATE"));
  const html = renderToStaticMarkup(
    await ClientPage({ params: Promise.resolve({ id: attempt.id }) }),
  );
  expect(html).toContain("Nie udało się odczytać płatności");
  expect(html).not.toContain("PRIVATE");
});

it("carries only an expected summary amount for the DB comparison", () => {
  const html = renderToStaticMarkup(
    createElement(NewOnlinePaymentView, {
      charge,
      environment: "simulator",
      requestId: "request",
      action: mocks.start,
    }),
  );
  expect(html).toContain('name="expected_due_cents" value="6000"');
});
it("reads the original attempt when new payments and all provider credentials are unavailable", async () => {
  mocks.context.mockResolvedValue({
    ...context,
    enabled: false,
    canProcess: false,
    environment: null,
  });
  const html = renderToStaticMarkup(
    await ClientPage({ params: Promise.resolve({ id: attempt.id }) }),
  );
  expect(html).toContain("Status płatności");
  expect(html).toContain(attempt.id);
  expect(html).not.toContain('name="outcome"');
  expect(html).not.toContain("/payments/new");
});
it("shows immutable financial identity and an admin-only recovery form", () => {
  const a = {
    ...attempt,
    environment: "sandbox" as const,
    transaction_id: null,
    dog_name: "Figa",
    guardian_name: "Opiekun historyczny",
    service_name: "Kurs początkowy",
  };
  const props = {
    attempt: a,
    checkAction: mocks.check,
    continueAction: mocks.continue,
    simulateAction: mocks.simulate,
    recoverAction: mocks.recover,
  };
  const admin = renderToStaticMarkup(
    createElement(OnlinePaymentAttemptView, { ...props, admin: true }),
  );
  expect(admin).toContain("Opiekun historyczny");
  expect(admin).toContain('name="transaction_id"');
  const client = renderToStaticMarkup(
    createElement(OnlinePaymentAttemptView, { ...props, admin: false }),
  );
  expect(client).not.toContain('name="transaction_id"');
  expect(client).toContain("Kurs początkowy");
});
