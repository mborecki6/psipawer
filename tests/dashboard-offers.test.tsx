import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";
import type { OfferItem } from "../src/modules/calendar-offer/types";
import type { CareSummary } from "../src/modules/care/types";

const mocks = vi.hoisted(() => ({ session: vi.fn(), rpc: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/session", () => ({ requireSession: mocks.session }));
vi.mock("@/lib/data/queries", async () => import("../src/lib/data/queries"));
vi.mock("@/lib/domain", async () => import("../src/lib/domain"));
vi.mock(
  "@/components/progressive-details",
  async () => import("../src/components/progressive-details"),
);
vi.mock(
  "@/modules/calendar-offer/model",
  async () => import("../src/modules/calendar-offer/model"),
);
import { getDashboardOfferItems } from "../src/modules/dashboard/queries";
import {
  DashboardCare,
  DashboardSuggestions,
} from "../src/modules/dashboard/views";

const now = "2030-01-30T12:00:00.000Z";
beforeEach(() => {
  vi.resetAllMocks();
  mocks.session.mockResolvedValue({ db: { rpc: mocks.rpc }, role: "client" });
});

it("reads the real available offer across the month boundary using the verified client and every page", async () => {
  const ranges: number[][] = [],
    filters: unknown[] = [];
  const rows = Array.from({ length: 501 }, (_, i) => ({ id: String(i) }));
  const builder = {
    eq: (key: string, value: string) => {
      filters.push([key, value]);
      return builder;
    },
    in: (key: string, value: string[]) => {
      filters.push([key, value]);
      return builder;
    },
    order: () => builder,
    range: async (from: number, to: number) => {
      ranges.push([from, to]);
      return { data: rows.slice(from, to + 1), error: null };
    },
  };
  mocks.rpc.mockReturnValue(builder);
  expect(await getDashboardOfferItems(now)).toHaveLength(501);
  expect(mocks.session).toHaveBeenCalledWith("client");
  expect(mocks.rpc).toHaveBeenCalledWith(
    "calendar_offer",
    {
      p_from: now,
      p_to: "2030-03-02T12:00:00.000Z",
    },
    { get: true },
  );
  expect(ranges).toEqual([
    [0, 499],
    [500, 999],
  ]);
  expect(filters).toContainEqual(["availability", "available"]);
  expect(filters).toContainEqual([
    "eligibility",
    ["eligible", "needs_dog", "qualification_required"],
  ]);
});

it("does not turn a failed offer read into an empty marketing card or read without a client session", async () => {
  const builder = {
    eq: () => builder,
    in: () => builder,
    order: () => builder,
    range: async () => ({ data: null, error: { message: "backend details" } }),
  };
  mocks.rpc.mockReturnValue(builder);
  await expect(getDashboardOfferItems(now)).rejects.toThrow(
    "Nie udało się pobrać danych",
  );
  mocks.rpc.mockClear();
  mocks.session.mockRejectedValue(new Error("client required"));
  await expect(getDashboardOfferItems(now)).rejects.toThrow("client required");
  expect(mocks.rpc).not.toHaveBeenCalled();
});

it("links published guidance to the correct dog's plan, with a truthful empty state", () => {
  const plan = {
    id: "plan",
    dog_id: "dog",
    dog_name: "Kluska",
    title: "Wasz spokojny krok",
  } as CareSummary;
  const html = renderToStaticMarkup(<DashboardCare plans={[plan]} />);
  expect(html).toContain("Kluska");
  expect(html).toContain("Wasz spokojny krok");
  expect(html).toContain('href="/app/dogs/dog/care?plan=plan"');
  const empty = renderToStaticMarkup(<DashboardCare plans={[]} />);
  expect(empty).toContain("Po spotkaniu pojawią się tu wskazówki od Asi");
  expect(empty).not.toContain("Wróć do planu");
});

it.each(["qualification_required", "needs_dog"] as const)(
  "keeps the %s requirement visible instead of promising admission",
  (eligibility) => {
    const item = {
      id: "walk",
      source_id: "walk",
      kind: "walk",
      category: "group",
      title: "Spacer razem",
      starts_at: now,
      public_location: "Park",
      availability: "available",
      eligibility,
    } as OfferItem;
    const html = renderToStaticMarkup(<DashboardSuggestions items={[item]} />);
    expect(html).toContain("Spacer razem");
    expect(html).toContain('href="/app/walks/walk"');
    expect(html).toContain(
      eligibility === "needs_dog"
        ? "dodaj profil swojego psa"
        : "kwalifikacja psa przez prowadzącą",
    );
    expect(html).not.toMatch(/Do zapłaty|zł|Dopasowaliśmy|Zarezerwowano/);
  },
);

it("offers exploration without inventing available dates when there are no suggestions", () => {
  const html = renderToStaticMarkup(<DashboardSuggestions items={[]} />);
  expect(html).toContain("Poznaj ofertę");
  expect(html).toContain('href="/app/services"');
  expect(html).not.toContain("Sprawdź zajęcia");
});
