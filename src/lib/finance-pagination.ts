import type { FinanceData } from "./finance";

export type FinanceSearch = {
  filter?: string | string[];
  charges_page?: string | string[];
  packages_page?: string | string[];
  payments_page?: string | string[];
  package?: string | string[];
  charge?: string | string[];
};
export type FinanceSection = "charges" | "packages" | "payments";
const size = 20;

function slice<T>(items: T[], raw?: string | string[], focus?: number) {
  const last = Math.max(1, Math.ceil(items.length / size));
  const requested =
    typeof raw === "string" && /^[1-9]\d{0,8}$/.test(raw) ? Number(raw) : 1;
  const page =
    focus !== undefined && focus >= 0
      ? Math.floor(focus / size) + 1
      : Math.min(last, requested);
  const start = (page - 1) * size;
  return {
    items: items.slice(start, start + size),
    page,
    last,
    total: items.length,
    from: items.length ? start + 1 : 0,
    to: Math.min(items.length, start + size),
  };
}
export function financePages(data: FinanceData, search: FinanceSearch = {}) {
  const charges = [...data.charges].sort(
    (a, b) =>
      a.date.localeCompare(b.date) ||
      a.kind.localeCompare(b.kind) ||
      a.id.localeCompare(b.id),
  );
  const packages = [...data.packages].sort(
    (a, b) =>
      b.purchasedAt.localeCompare(a.purchasedAt) || a.id.localeCompare(b.id),
  );
  const payments = [...data.payments].sort(
    (a, b) => b.paidAt.localeCompare(a.paidAt) || a.id.localeCompare(b.id),
  );
  const focus =
    typeof search.package === "string"
      ? packages.findIndex((item) => item.id === search.package)
      : undefined;
  const chargeFocus =
    typeof search.charge === "string"
      ? charges.findIndex((item) => `${item.kind}-${item.id}` === search.charge)
      : undefined;
  return {
    charges: slice(charges, search.charges_page, chargeFocus),
    packages: slice(packages, search.packages_page, focus),
    payments: slice(payments, search.payments_page),
    packageUnavailable: typeof search.package === "string" && focus === -1,
    chargeUnavailable: typeof search.charge === "string" && chargeFocus === -1,
  };
}
export function financePageLink(
  base: "/app" | "/admin",
  pages: ReturnType<typeof financePages>,
  section: FinanceSection,
  page: number,
  dueOnly: boolean,
) {
  const query = new URLSearchParams();
  if (dueOnly) query.set("filter", "due");
  for (const key of ["charges", "packages", "payments"] as const) {
    const selected = key === section ? page : pages[key].page;
    if (selected > 1) query.set(`${key}_page`, String(selected));
  }
  const anchor = section === "charges" ? "finance-due" : section;
  return `${base}/finance${query.size ? `?${query}` : ""}#${anchor}`;
}
export function financePackageHref(base: "/app" | "/admin", id: string) {
  return `${base}/finance?package=${encodeURIComponent(id)}#package-${encodeURIComponent(id)}`;
}
export function financeChargeHref(
  base: "/app" | "/admin",
  kind: "registration" | "package" | "consultation" | "course" | "fitness",
  id: string,
) {
  const target = encodeURIComponent(`${kind}-${id}`);
  return `${base}/finance?filter=due&charge=${target}#charge-${target}`;
}
