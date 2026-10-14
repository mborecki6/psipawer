import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
vi.mock("../src/modules/calendar/actions", () => ({
  saveBlock: vi.fn(),
  cancelBlock: vi.fn(),
  saveCalendarAssignment: vi.fn(),
}));
vi.mock("@/lib/time", async () => import("../src/lib/time"));
vi.mock("@/components/use-hydrated", () => ({ useHydrated: () => true }));
vi.mock("@/components/use-persistent-form", () => ({
  usePersistentForm: () => null,
}));
import { BlockEditor, AssignmentEditor } from "../src/modules/calendar/editor";
import type { Appointment } from "../src/modules/calendar/types";

const asia = "10000000-0000-4000-8000-000000000001";
const administrator = "10000000-0000-4000-8000-000000000002";
const members = [{ user_id: asia, full_name: "Asia" }];
const history: Appointment = {
  id: "10000000-0000-4000-8000-000000000010",
  kind: "block",
  title: "Dawna blokada",
  starts_at: "2026-10-14T09:00:00Z",
  ends_at: "2026-10-14T10:00:00Z",
  version: 3,
  assignment_version: 5,
  assigned_staff_id: administrator,
  assigned_staff_name: "Administrator",
  status: "blocked",
  location: "",
};

it("defaults a new block to the active practitioner", () => {
  const html = renderToStaticMarkup(
    createElement(BlockEditor, {
      id: history.id,
      members,
      defaultStaffId: asia,
    }),
  );
  expect(html).toContain(`value="${asia}" selected=""`);
  expect(html).not.toContain(administrator);
  expect(html).toContain('required=""');
  expect(html).toContain("Wybierz prowadzącą");
  expect(html).not.toContain("Wspólna blokada kalendarza");
});

it("makes missing practitioner configuration a visible obstacle for new blocks", () => {
  const html = renderToStaticMarkup(
    createElement(BlockEditor, {
      id: history.id,
      members,
      defaultStaffId: null,
    }),
  );
  expect(html).toContain("Uzupełnij konfigurację przed dodaniem blokady");
  expect(html).toMatch(
    /<button class="primary-button" disabled="">Zablokuj czas/,
  );
});

it("preserves the administrator UUID in an existing block and appointment editor", () => {
  for (const element of [
    createElement(BlockEditor, {
      id: history.id,
      initial: history,
      members,
      defaultStaffId: asia,
    }),
    createElement(AssignmentEditor, {
      appointment: history,
      members,
      resources: [],
    }),
  ]) {
    const html = renderToStaticMarkup(element);
    expect(html).toContain(`value="${administrator}" selected=""`);
    expect(html).toContain("Administrator (dotychczasowe przypisanie)");
    expect(html).not.toContain(`value="${asia}" selected=""`);
  }
});
