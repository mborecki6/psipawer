"use client";
import { useId, useState } from "react";
import type { BookingChoices } from "./booking-queries";

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
  const initialStaff = assignment
    ? assignment.assigned_staff_id
    : original.defaultStaffId;
  const [staff, setStaff] = useState(
    original.staff.some((member) => member.user_id === initialStaff)
      ? initialStaff!
      : "",
  );
  const [resource, setResource] = useState(assignment?.resource_id || "");
  const prefix = useId();
  const resources = original.resources.filter(
    (r) => r.active || r.id === assignment?.resource_id,
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
        <div className="field">
          <label htmlFor={`${prefix}-staff`}>Prowadzący</label>
          <select
            id={`${prefix}-staff`}
            name="calendar_staff_id"
            value={staff}
            onChange={(e) => setStaff(e.target.value)}
            required
          >
            <option value="">Wybierz prowadzącego</option>
            {original.staff.map((s) => (
              <option key={s.user_id} value={s.user_id}>
                {s.full_name || "Członek zespołu"}
              </option>
            ))}
          </select>
        </div>
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
