import { expect, it } from "vitest";
import {
  financePages,
  financePageLink,
  financePackageHref,
  financeChargeHref,
} from "../src/lib/finance-pagination";
import type { FinanceData } from "../src/lib/finance";

const data = {
  charges: Array.from({ length: 45 }, (_, i) => ({
    id: String(i).padStart(2, "0"),
    kind: "package",
    date: "2026-10-01",
  })),
  packages: Array.from({ length: 45 }, (_, i) => ({
    id: String(i).padStart(2, "0"),
    purchasedAt: "2026-10-01",
  })),
  payments: Array.from({ length: 45 }, (_, i) => ({
    id: String(i).padStart(2, "0"),
    paidAt: "2026-10-01",
  })),
  dogs: [],
  totals: {
    dueCents: 450000,
    paidCents: 450000,
    availableEntries: 180,
    reservedEntries: 0,
  },
} as unknown as FinanceData;
it("reaches every record exactly once across pages while keeping complete totals and input order", () => {
  const before = JSON.stringify(data);
  const ids = [1, 2, 3].flatMap((page) =>
    financePages(data, { charges_page: String(page) }).charges.items.map(
      (item) => item.id,
    ),
  );
  expect(ids).toEqual(data.charges.map((item) => item.id));
  expect(financePages(data, { charges_page: "3" }).charges).toMatchObject({
    from: 41,
    to: 45,
    total: 45,
    page: 3,
    last: 3,
  });
  expect(JSON.stringify(data)).toBe(before);
  expect(data.totals.dueCents).toBe(450000);
});
it("breaks equal timestamps by ID even if the API returns ties in a different order", () => {
  const reversed = {
    ...data,
    charges: [...data.charges].reverse(),
    packages: [...data.packages].reverse(),
    payments: [...data.payments].reverse(),
  };
  expect(financePages(reversed)).toEqual(financePages(data));
});
it("opens an outstanding consultation on its actual page and handles a settled or unavailable target honestly", () => {
  const withConsultations = {
    ...data,
    charges: data.charges.map((item) => ({
      ...item,
      kind: "consultation" as const,
    })),
  };
  const focused = financePages(withConsultations, {
    charge: "consultation-44",
    charges_page: "1",
  });
  expect(focused.charges.page).toBe(3);
  expect(focused.charges.items.map((item) => item.id)).toContain("44");
  expect(focused.chargeUnavailable).toBe(false);
  expect(
    financePages(withConsultations, { charge: "consultation-settled" })
      .chargeUnavailable,
  ).toBe(true);
  expect(financeChargeHref("/admin", "consultation", "44")).toBe(
    "/admin/finance?filter=due&charge=consultation-44#charge-consultation-44",
  );
});
it("clamps stale pages and handles duplicate, negative, huge or malformed query values", () => {
  for (const raw of ["0", "-2", "1e3", "9999999999999", ["2", "3"], "<script>"])
    expect(financePages(data, { payments_page: raw }).payments.page).toBe(1);
  expect(financePages(data, { payments_page: "9" }).payments.page).toBe(3);
  expect(
    financePages({ ...data, payments: [] }, { payments_page: "3" }).payments,
  ).toMatchObject({ items: [], from: 0, to: 0, page: 1, last: 1 });
});
it("opens a directly linked package on its actual page and never substitutes a foreign package", () => {
  const pages = financePages(data, { package: "44", packages_page: "1" });
  expect(pages.packages.page).toBe(3);
  expect(pages.packages.items.map((item) => item.id)).toContain("44");
  expect(pages.packageUnavailable).toBe(false);
  expect(financePages(data, { package: "foreign" }).packageUnavailable).toBe(
    true,
  );
  expect(financePackageHref("/app", "44")).toBe(
    "/app/finance?package=44#package-44",
  );
});
it("preserves the filter and other section pages, without preserving a focus that would override package navigation", () => {
  const pages = financePages(data, {
    charges_page: "2",
    payments_page: "3",
    package: "44",
  });
  const href = financePageLink("/admin", pages, "packages", 2, true);
  expect(href).toBe(
    "/admin/finance?filter=due&charges_page=2&packages_page=2&payments_page=3#packages",
  );
  expect(href).not.toContain("package=");
});
