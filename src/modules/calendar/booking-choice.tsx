"use client";
import { useId, useState } from "react";
import type { BookingChoices } from "./booking-queries";
import { ProgressiveDetails } from "../../components/progressive-details";

export function BookingChoice({
  data,
  appointmentId,
  saved = false,
  pending = false,
}: {
  data: BookingChoices;
  appointmentId?: string;
  saved?: boolean;
  pending?: boolean;
}) {
  const [original] = useState(data);
  const assignment = original.assignments.find(
    (a) => a.appointment_id === appointmentId,
  );
  const freshRequest =
    assignment?.assigned_staff_id === null &&
    assignment.legacy_unassigned === false &&
    assignment.version === 1 &&
    !assignment.booked_interval;
  const initialStaff =
    assignment && !freshRequest
      ? assignment.assigned_staff_id
      : original.defaultStaffId;
  const [staff, setStaff] = useState(initialStaff || "");
  const [resource, setResource] = useState(assignment?.resource_id || "");
  const prefix = useId();
  const resources = original.resources.filter(
    (r) => r.active || r.id === assignment?.resource_id,
  );
  const activeStaff = original.staff.filter(
    (member) => member.user_id === original.defaultStaffId,
  );
  const historicalStaff = assignment?.assigned_staff_id
    ? original.staff.find(
        (member) => member.user_id === assignment.assigned_staff_id,
      )
    : undefined;
  const compactStaff =
    activeStaff.length === 1 &&
    initialStaff === original.defaultStaffId &&
    (!assignment ||
      freshRequest ||
      assignment.assigned_staff_id === original.defaultStaffId);
  const staffField = (
    <div className="field">
      <label htmlFor={`${prefix}-staff`}>Prowadzący</label>
      <select
        id={`${prefix}-staff`}
        name="calendar_staff_id"
        value={staff}
        onChange={(e) => setStaff(e.target.value)}
        required={!assignment}
      >
        <option value="">
          {assignment
            ? "Do przypisania — wspólna rezerwacja"
            : "Wybierz prowadzącego"}
        </option>
        {assignment?.assigned_staff_id &&
          assignment.assigned_staff_id !== original.defaultStaffId && (
            <option value={assignment.assigned_staff_id}>
              {historicalStaff?.full_name || "Dotychczasowy prowadzący"}
              {" · dotychczasowe przypisanie"}
            </option>
          )}
        {activeStaff.map((s) => (
          <option key={s.user_id} value={s.user_id}>
            {s.full_name || "Prowadząca"}
          </option>
        ))}
      </select>
      {!original.defaultStaffId && (
        <small className="field-hint" role="status">
          Brak aktywnej prowadzącej w ustawieniach kalendarza.
          {assignment
            ? " Dotychczasowe przypisanie pozostaje zachowane."
            : " Nie można jeszcze zaplanować nowego spotkania."}
        </small>
      )}
    </div>
  );
  return (
    <fieldset
      disabled={pending || saved}
      style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}
    >
      <legend className="sr-only">Prowadzący i sala</legend>
      <input
        type="hidden"
        name="calendar_assignment_version"
        value={assignment?.version || 0}
      />
      <div className="form-grid" style={{ alignItems: "start" }}>
        {compactStaff ? (
          <div className="stack-sm">
            <p className="muted">
              Prowadząca:{" "}
              <strong>
                {activeStaff.find((s) => s.user_id === staff)?.full_name ||
                  "Do przypisania"}
              </strong>
            </p>
            <ProgressiveDetails label="Zmień przypisanie">
              {staffField}
            </ProgressiveDetails>
          </div>
        ) : (
          staffField
        )}
        {resources.length ? (
          <div className="field">
            <label htmlFor={`${prefix}-resource`}>
              Sala do rezerwacji (opcjonalnie)
            </label>
            <select
              id={`${prefix}-resource`}
              name="calendar_resource_id"
              value={resource}
              onChange={(e) => setResource(e.target.value)}
            >
              <option value="">Bez wspólnej sali</option>
              {resources.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                  {!r.active
                    ? " · wyłączona"
                    : r.exclusive
                      ? " · jedna grupa naraz"
                      : ""}
                </option>
              ))}
            </select>
            <small className="field-hint">
              Dokładną zbiórkę wpisz w opisie miejsca spotkania.
            </small>
          </div>
        ) : (
          <input type="hidden" name="calendar_resource_id" value="" />
        )}
      </div>
      {saved && (
        <small className="field-hint">
          Przypisanie zapisane. Aby ponownie zmienić prowadzącego lub salę,
          odśwież formularz.
        </small>
      )}
    </fieldset>
  );
}
