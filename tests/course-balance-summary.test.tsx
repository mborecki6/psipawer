import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import type { CourseBalance } from "../src/lib/finance";
vi.mock("@/lib/domain", async () => import("../src/lib/domain"));
vi.mock("../src/modules/courses/money-form", () => ({
  CourseMoneyForm: () => null,
}));
import { CourseBalanceSummary } from "../src/modules/courses/billing";
const base: CourseBalance = {
  id: "enrollment",
  course_id: "course",
  dog_id: "dog",
  guardian_id: "owner",
  course_title: "Kurs",
  service_name: "Usługa",
  course_status: "open",
  status: "accepted",
  version: 2,
  agreed_price_cents: 10000,
  charge_cents: 10000,
  is_test_price: false,
  created_at: "2030-01-01T12:00:00Z",
  starts_at: null,
  settled_at: null,
  paid_cents: 4000,
  refunded_cents: 0,
  due_cents: 6000,
  refund_due_cents: 0,
  needs_review: false,
  needs_settlement: false,
  can_pay: true,
};
const summary = (overrides: Partial<CourseBalance> = {}) =>
  renderToStaticMarkup(
    createElement(CourseBalanceSummary, { balance: { ...base, ...overrides } }),
  );
it("shows the existing outstanding amount instead of recalculating it from price or receipts", () => {
  expect(summary({ due_cents: 2300 })).toContain("Do zapłaty: 23,00");
  expect(summary({ due_cents: 2300 })).not.toContain("60,00");
});
it("keeps a cancelled participant's settlement exception visible before any obsolete amount", () => {
  const html = summary({
    status: "cancelled",
    needs_settlement: true,
    needs_review: true,
  });
  expect(html).toContain("Kwota po rezygnacji do uzgodnienia");
  expect(html).toContain("Rozliczenie do sprawdzenia");
  expect(html).not.toContain("Do zapłaty:");
});
it("keeps the existing refund amount visible for a closed enrollment", () => {
  const html = summary({
    status: "cancelled",
    due_cents: 0,
    refund_due_cents: 2700,
  });
  expect(html).toContain("Do zwrotu: 27,00");
  expect(html).not.toContain("Opłacone");
});
it("keeps the review signal even with no amount outstanding", () => {
  const html = summary({ due_cents: 0, needs_review: true });
  expect(html).toContain("Rozliczenie do sprawdzenia");
});
it.each([
  [{ due_cents: 0 }, "Opłacone"],
  [{ due_cents: 0, status: "requested", charge_cents: 0 }, "Brak należności"],
  [{ due_cents: 0, status: "cancelled" }, "Rozliczone"],
] as const)(
  "preserves settled or nonchargeable labels for %o",
  (overrides, label) => {
    expect(summary(overrides)).toContain(label);
  },
);
