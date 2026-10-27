import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { Service } from "../src/modules/services/types";
vi.mock("@/lib/domain", async () => import("../src/lib/domain"));
vi.mock(
  "@/components/progressive-details",
  async () => import("../src/components/progressive-details"),
);
vi.mock("@/components/use-hydrated", () => ({ useHydrated: () => true }));
vi.mock("@/components/use-persistent-form", () => ({
  usePersistentForm: () => ({ current: null }),
}));
vi.mock("../src/modules/services/actions", () => ({ updateService: vi.fn() }));
import { ServiceEditor } from "../src/modules/services/editor";
import { ConsultationServicePicker } from "../src/modules/services/selection";
import { ServiceDetailView } from "../src/modules/services/views";
const service: Service = {
  id: "service",
  name: "Konsultacja",
  description: "Opis potrzeb",
  kind: "individual",
  course_format: null,
  booking_flow: "consultation",
  meeting_mode: "in_person",
  price_cents: 12345,
  price_unit: "za spotkanie",
  duration_minutes: 60,
  sessions_count: 1,
  active: true,
  is_test_price: true,
  source_url: "https://psipawer.pl",
  source_note: "",
  version: 7,
  updated_at: "2030-01-01T10:00:00Z",
};
describe("simple service editor", () => {
  it("keeps price, visibility and test-price type primary while preserving the entire versioned payload", () => {
    const html = renderToStaticMarkup(
      createElement(ServiceEditor, { service }),
    );
    const detailsPosition = html.indexOf('id="szczegoly-oferty-service"');
    for (const name of ["price", "active", "is_test_price"])
      expect(html.indexOf(`name="${name}"`)).toBeLessThan(detailsPosition);
    for (const name of [
      "id",
      "expected_version",
      "name",
      "description",
      "price",
      "price_unit",
      "duration_minutes",
      "sessions_count",
      "active",
      "is_test_price",
    ])
      expect(html.match(new RegExp(`name="${name}"`, "g"))).toHaveLength(1);
    expect(html).toContain('name="expected_version" value="7"');
    expect(html).toContain('type="hidden" name="sessions_count" value="1"');
    expect(html).toContain("Liczba spotkań: 1");
    expect(html.match(/<details[^>]+>/)?.[0]).not.toContain('open=""');
    expect(html).toContain("Robocza — do testów");
    expect(html).toContain("za spotkanie");
  });
  it.each([null, 2])(
    "does not normalize a legacy consultation count of %s",
    (count) => {
      const html = renderToStaticMarkup(
        createElement(ServiceEditor, {
          service: { ...service, sessions_count: count },
        }),
      );
      expect(html).not.toContain('type="hidden" name="sessions_count"');
      expect(html).toMatch(
        new RegExp(`name="sessions_count"[^>]*value="${count ?? ""}"`),
      );
      expect(html).toContain("Liczba spotkań</label>");
    },
  );
  it.each(["course", "fitness"] as const)(
    "keeps the %s workflow link outside collapsed history and explanations",
    (kind) => {
      const input: Service = {
        ...service,
        kind: kind === "course" ? "course" : "package",
        booking_flow: kind === "fitness" ? "fitness" : "catalogue",
      };
      const html = renderToStaticMarkup(
        createElement(ServiceDetailView, {
          service: input,
          history: [],
          page: 1,
          more: false,
        }),
      );
      expect(html).toContain(
        kind === "course"
          ? 'href="/admin/courses/new?service=service"'
          : 'href="/admin/fitness"',
      );
      expect(
        html.match(/<details[^>]*id="historia-cennika"[^>]*>/)?.[0],
      ).not.toContain('open=""');
      const actionPosition = html.indexOf(
        kind === "course"
          ? 'href="/admin/courses/new?'
          : 'href="/admin/fitness"',
      );
      expect(actionPosition).toBeLessThan(
        html.indexOf("Co stanie się po zmianie ceny?"),
      );
    },
  );
});
describe("chosen consultation service", () => {
  it("summarizes only a valid explicit service and keeps its selected ID, version, price and test flag", () => {
    const html = renderToStaticMarkup(
      createElement(ConsultationServicePicker, {
        services: [service],
        serviceId: service.id,
      }),
    );
    expect(html.match(/<details[^>]*>/)?.[0]).not.toContain('open=""');
    expect(html).toContain("Zmień usługę");
    expect(html).toContain('name="service_version" value="7"');
    expect(html).toContain('<option value="service" selected=""');
    expect(html).toContain("123,45");
    expect(html).toContain("Cena robocza do testów.");
  });
  it.each([undefined, "invalid"])(
    "leaves the existing choice and fallback visible for serviceId=%s",
    (serviceId) => {
      const html = renderToStaticMarkup(
        createElement(ConsultationServicePicker, {
          services: [service],
          serviceId,
        }),
      );
      expect(html.match(/<details[^>]*>/)?.[0]).toContain('open=""');
      expect(html).toContain('<option value="service" selected=""');
      expect(html).not.toContain("Zmień usługę");
    },
  );
});
