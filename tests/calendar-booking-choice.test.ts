import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { BookingChoice } from "../src/modules/calendar/booking-choice";
import type {
  BookingChoices,
  BookingAssignment,
} from "../src/modules/calendar/booking-queries";

const asia = "10000000-0000-4000-8000-000000000001";
const administrator = "10000000-0000-4000-8000-000000000002";
const appointment = "10000000-0000-4000-8000-000000000010";
const data: BookingChoices = {
  defaultStaffId: asia,
  staff: [
    { user_id: asia, full_name: "Asia" },
    { user_id: administrator, full_name: "Administrator" },
  ],
  resources: [],
  assignments: [],
};
function render(
  assignment?: BookingAssignment,
  defaultStaffId = data.defaultStaffId,
) {
  return renderToStaticMarkup(
    createElement(BookingChoice, {
      data: {
        ...data,
        defaultStaffId,
        assignments: assignment ? [assignment] : [],
      },
      appointmentId: appointment,
    }),
  );
}
function saved(staff: string | null): BookingAssignment {
  return {
    appointment_id: appointment,
    assigned_staff_id: staff,
    resource_id: null,
    version: 7,
  };
}

it("offers only the active practitioner for a new appointment", () => {
  const html = render();
  expect(html).toContain(`value="${asia}" selected=""`);
  expect(html).not.toContain(administrator);
  expect(html).toContain('required=""');
});

it("preserves an administrator's historical assignment and its version", () => {
  const html = render(saved(administrator));
  expect(html).toContain(`value="${administrator}" selected=""`);
  expect(html).toContain("Administrator · dotychczasowe przypisanie");
  expect(html).toContain(`value="${asia}"`);
  expect(html).toContain('name="calendar_assignment_version" value="7"');
});

it("preserves a former member's UUID even when it is absent from the directory", () => {
  const former = "10000000-0000-4000-8000-000000000099";
  const html = render(saved(former));
  expect(html).toContain(`value="${former}" selected=""`);
  expect(html).toContain(
    "Dotychczasowy prowadzący · dotychczasowe przypisanie",
  );
});

it("retains a saved shared reservation without assigning the primary automatically", () => {
  const html = render(saved(null));
  expect(html).toContain('<option value="" selected="">Do przypisania');
  expect(html).not.toContain(`value="${asia}" selected=""`);
  expect(html).not.toContain('required=""');
});

it("selects primary for the first booking of a request made before configuration", () => {
  const html = render({
    ...saved(null),
    version: 1,
    legacy_unassigned: false,
    booked_interval: null,
  });
  expect(html).toContain(`value="${asia}" selected=""`);
});

it("makes unavailable configuration explicit and keeps existing history editable", () => {
  const fresh = render(undefined, null);
  expect(fresh).toContain("Nie można jeszcze zaplanować nowego spotkania");
  expect(fresh).not.toContain(administrator);
  expect(fresh).not.toContain(asia);
  const historical = render(saved(administrator), null);
  expect(historical).toContain(`value="${administrator}" selected=""`);
  expect(historical).toContain("Dotychczasowe przypisanie pozostaje zachowane");
});
