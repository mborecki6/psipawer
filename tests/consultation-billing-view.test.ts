import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
vi.mock(
  "@/lib/finance-pagination",
  async () => import("../src/lib/finance-pagination"),
);
vi.mock("@/lib/domain", async () => import("../src/lib/domain"));
vi.mock("@/components/ui", async () => import("../src/components/ui"));
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
    createElement("form", null, children, createElement("button", null, label)),
  Field: ({ name, value }: { name: string; value: string }) =>
    createElement("input", { name, defaultValue: value }),
}));
import { ConsultationBilling } from "../src/modules/consultations/billing";
import { FinanceView } from "../src/components/finance";
import { buildFinanceData, type ConsultationBalance } from "../src/lib/finance";
import type { Dog } from "../src/lib/data/types";
const balance: ConsultationBalance = {
  id: "test",
  dog_id: "dog",
  status: "scheduled",
  starts_at: "2030-10-10T10:00:00Z",
  created_at: "2030-10-01T10:00:00Z",
  service_name: "Konsultacja online",
  agreed_price_cents: 10000,
  is_test_price: true,
  paid_cents: 4000,
  due_cents: 6000,
  needs_review: false,
};
function render(overrides: Partial<ConsultationBalance> = {}, admin = false) {
  return renderToStaticMarkup(
    createElement(ConsultationBilling, {
      balance: { ...balance, ...overrides },
      admin,
    }),
  );
}
it("shows the remaining price and links staff straight to the correct payment form", () => {
  const html = render({}, true);
  expect(html).toContain("Do zapłaty");
  expect(html).toContain("60,00");
  expect(html).toContain("40,00");
  expect(html).toContain("100,00");
  expect(html).toContain("Cena robocza");
  expect(html).toContain(
    "/admin/finance?filter=due&amp;charge=consultation-test#charge-consultation-test",
  );
  expect(html).toContain("Zapisz wpłatę w finansach");
  const client = render();
  expect(client).toContain(
    "/app/finance?filter=due&amp;charge=consultation-test#charge-consultation-test",
  );
  expect(client).not.toContain("/admin/");
  expect(client).not.toContain("Zapisz wpłatę");
});
it("distinguishes requested, unpriced, settled, cancelled and refund-review states", () => {
  expect(
    render({ status: "requested", due_cents: 0, paid_cents: 0 }),
  ).toContain("Samo zgłoszenie nie wymaga wpłaty");
  expect(
    render({ agreed_price_cents: null, due_cents: 0, paid_cents: 0 }),
  ).toContain("Starsze zgłoszenie bez ustalonej ceny");
  expect(render({ due_cents: 0, paid_cents: 10000 })).toContain("Opłacone");
  expect(
    render({ status: "cancelled", due_cents: 0, paid_cents: 0 }),
  ).toContain("brak należności");
  const cancelled = render({
    status: "cancelled",
    due_cents: 0,
    needs_review: true,
  });
  expect(cancelled).toContain("Wpłata do rozliczenia po odwołaniu");
  expect(cancelled).not.toContain("Opłacone");
  expect(cancelled).toContain("/app/finance#payments");
});
it("renders the consultation target and preserved amount in staff finance but no payment action for the guardian", () => {
  const data = buildFinanceData({
    dogs: [{ id: "dog", name: "Figa", guardian_id: "owner" } as Dog],
    walks: [],
    registrations: [],
    packages: [],
    transactions: [],
    payments: [],
    profiles: [],
    consultations: [balance],
    admin: true,
  });
  const staff = renderToStaticMarkup(
    createElement(FinanceView, { data, admin: true }),
  );
  expect(staff).toContain('id="charge-consultation-test"');
  expect(staff).toContain('name="target_kind" value="consultation"');
  expect(staff).toContain('name="target_id" value="test"');
  expect(staff).toContain('name="amount" value="60,00"');
  expect(staff).toContain("Cena robocza");
  const client = renderToStaticMarkup(
    createElement(FinanceView, { data, admin: false }),
  );
  expect(client).not.toContain('name="target_kind"');
  expect(client).not.toContain("Zapisz wpłatę");
});
