import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import type { GiftCard } from "../src/modules/gifts/types";
vi.mock("@/lib/domain", async () => import("../src/lib/domain"));
vi.mock("../src/modules/gifts/forms", () =>
  Object.fromEntries(
    [
      "GiftClaimForm",
      "GiftChangeForm",
      "GiftCashRefundForm",
      "GiftRedeemForm",
      "GiftPrintButton",
    ].map((name) => [
      name,
      () => createElement("div", { "data-gift-form": name }),
    ]),
  ),
);
import { GiftListView, GiftDetailView } from "../src/modules/gifts/views";
const card: GiftCard = {
  id: "local-card",
  beneficiary_id: "owner",
  service_id: null,
  service_version: null,
  service_name: null,
  is_test_price: true,
  value_cents: 10000,
  purchased_on: "2026-10-03",
  expires_on: "2027-04-03",
  sender_label: "Darczyńca",
  recipient_label: "Obdarowany",
  message: "Dobrego wspólnego czasu",
  status: "active",
  version: 1,
  created_at: "2026-10-03T10:00:00Z",
  balance_cents: 10000,
  redeemed_cents: 0,
  returned_cents: 0,
  cash_refunded_cents: 0,
  usable: true,
};
const detail = (admin: boolean, overrides: Partial<GiftCard> = {}) =>
  renderToStaticMarkup(
    createElement(GiftDetailView, {
      data: {
        card: { ...card, ...overrides },
        role: admin ? "admin" : "client",
        code: "A1B2C3D4".repeat(5),
        ledger: [],
        history: [],
        more: false,
        sale: undefined,
      },
      staff: null,
      page: 1,
      today: "2026-10-03",
    }),
  );
it("offers staff issuance and client claiming in their respective list views", () => {
  const view = (admin: boolean) =>
    renderToStaticMarkup(
      createElement(GiftListView, {
        cards: [card],
        admin,
        page: 1,
        more: false,
        today: "2026-10-03",
      }),
    );
  expect(view(true)).toContain("/admin/gifts/new");
  expect(view(true)).not.toContain('data-gift-form="GiftClaimForm"');
  expect(view(false)).toContain('data-gift-form="GiftClaimForm"');
  expect(view(false)).not.toContain("/admin/gifts/new");
});
it("never renders a private activation code or staff print control in a client view, even if a malformed caller supplies them", () => {
  expect(detail(false)).not.toContain("A1B2C3D4-A1B2C3D4");
  expect(detail(false)).not.toContain('data-gift-form="GiftPrintButton"');
  expect(detail(true)).toContain("A1B2C3D4-A1B2C3D4");
});
it("clearly preserves expiry and distinguishes restoring card value from returning money", () => {
  const html = detail(false);
  expect(html).toContain("3 kwietnia 2027");
  expect(html).toContain("wraca na jej saldo");
  expect(html).toContain("Nie odnawia terminu ważności");
});
it("shows an explicit withdrawal mark on the printable card and does not call its value available", () => {
  const html = detail(true, { status: "cancelled", usable: false });
  expect(html).toContain("Ta karta została wycofana");
  expect(html).toContain("Wycofana");
  expect(html).not.toContain("Gotowa do wykorzystania");
});
it("separates the original face value from the remaining balance and names the intended service", () => {
  const html = detail(false, {
    balance_cents: 4000,
    service_id: "service",
    service_name: "Konsultacja behawioralna",
  });
  expect(html).toContain("40,00");
  expect(html).toContain("100,00");
  expect(html).toContain("Konsultacja behawioralna");
});
