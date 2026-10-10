"use client";
import { useActionState, useEffect, useId, useRef, useState } from "react";
import {
  saveBlock,
  cancelBlock,
  saveCalendarAssignment,
  type BlockState,
} from "./actions";
import { warsawDateTimeInput, warsawLocalToISO } from "@/lib/time";
import { addDays, isAllDayBlock, localDate } from "./dates";
import { CalendarWarning } from "./warning";
import type {
  Appointment,
  CalendarTeamMember,
  CalendarResource,
} from "./types";
import styles from "./calendar.module.css";
import { useHydrated } from "@/components/use-hydrated";
import { usePersistentForm } from "@/components/use-persistent-form";
export function BlockEditor({
  id,
  initial,
  onNew,
  members = [],
  resources = [],
  currentUserId,
}: {
  id: string;
  initial?: Appointment;
  onNew?: () => void;
  members?: CalendarTeamMember[];
  resources?: CalendarResource[];
  currentUserId?: string | null;
}) {
  const hydrated = useHydrated();
  const form = usePersistentForm();
  const [original] = useState({
    id,
    version: initial?.version || 0,
    assignmentVersion: initial?.assignment_version || 0,
  });
  const [values, setValues] = useState({
    title: initial?.title || "",
    starts_at: initial ? warsawDateTimeInput(initial.starts_at) : "",
    ends_at: initial ? warsawDateTimeInput(initial.ends_at) : "",
    assigned_staff_id: initial
      ? initial.assigned_staff_id || ""
      : currentUserId || "",
    resource_id: initial?.resource_id || "",
  });
  const [allDay, setAllDay] = useState(
    Boolean(initial && isAllDayBlock(initial)),
  );
  const [dates, setDates] = useState({
    from: initial ? localDate(initial.starts_at) : "",
    to: initial
      ? addDays(localDate(initial.ends_at), isAllDayBlock(initial) ? -1 : 0)
      : "",
  });
  const autoEnd = useRef(!initial);
  const autoEndDate = useRef(!initial);
  const [state, action, pending] = useActionState(
    async (previous: BlockState, form: FormData) => {
      const result =
        form.get("intent") === "cancel"
          ? await cancelBlock(previous, form)
          : await saveBlock(previous, form);
      return {
        ...result,
        version: result.version ?? previous.version,
        assignmentVersion:
          result.assignmentVersion ?? previous.assignmentVersion,
      };
    },
    {
      version: original.version,
      assignmentVersion: original.assignmentVersion,
    },
  );
  const prefix = useId();
  const error = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (state.error) error.current?.focus();
  }, [state]);
  if (state.cancelled)
    return (
      <div>
        <p className="alert green" role="status">
          {state.success}
        </p>
        {onNew && (
          <button type="button" className="ghost-button" onClick={onNew}>
            Dodaj kolejną blokadę
          </button>
        )}
      </div>
    );
  function field(name: keyof typeof values) {
    return {
      id: `${prefix}-${name}`,
      name,
      value: values[name],
      onChange: (
        e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>,
      ) => {
        const value = e.target.value;
        if (name === "ends_at") autoEnd.current = false;
        setValues((v) => {
          let end = v.ends_at;
          if (name === "starts_at" && value && autoEnd.current) {
            try {
              end = warsawDateTimeInput(
                new Date(
                  Date.parse(warsawLocalToISO(value)) + 3600000,
                ).toISOString(),
              );
            } catch {
              /* Server validation explains an impossible local hour. */
            }
          }
          return { ...v, ends_at: end, [name]: value };
        });
      },
    };
  }
  return (
    <form
      ref={form}
      action={action}
      className="form-stack"
      aria-busy={!hydrated || pending}
    >
      <input type="hidden" name="id" value={original.id} />
      <input type="hidden" name="expected_version" value={state.version} />
      <input
        type="hidden"
        name="expected_assignment_version"
        value={state.assignmentVersion}
      />
      {allDay && (
        <>
          <input
            type="hidden"
            name="starts_at"
            value={dates.from ? `${dates.from}T00:00` : ""}
          />
          <input
            type="hidden"
            name="ends_at"
            value={dates.to ? `${addDays(dates.to, 1)}T00:00` : ""}
          />
        </>
      )}
      <fieldset disabled={!hydrated || pending} className={styles.fields}>
        <legend className="sr-only">Prywatna blokada kalendarza</legend>
        <div className="field">
          <label htmlFor={`${prefix}-title`}>Nazwa blokady</label>
          <input
            {...field("title")}
            placeholder="Np. przerwa, dojazd lub urlop"
            minLength={3}
            maxLength={160}
            required
          />
        </div>
        <label className={styles.dayToggle}>
          <input
            type="checkbox"
            checked={allDay}
            onChange={(event) => {
              setAllDay(event.target.checked);
              if (event.target.checked && !dates.from && values.starts_at)
                setDates({
                  from: values.starts_at.slice(0, 10),
                  to:
                    values.ends_at.slice(0, 10) ||
                    values.starts_at.slice(0, 10),
                });
              if (!event.target.checked && !values.starts_at && dates.from)
                setValues((v) => ({
                  ...v,
                  starts_at: `${dates.from}T09:00`,
                  ends_at: `${dates.to || dates.from}T10:00`,
                }));
            }}
          />{" "}
          Cały dzień
        </label>
        {allDay ? (
          <>
            <div className="field">
              <label htmlFor={`${prefix}-from-date`}>Od dnia</label>
              <input
                id={`${prefix}-from-date`}
                type="date"
                required
                value={dates.from}
                min="2000-01-01"
                max="2099-12-31"
                onChange={(event) => {
                  const value = event.target.value;
                  setDates((v) => ({
                    from: value,
                    to: autoEndDate.current ? value : v.to,
                  }));
                }}
              />
            </div>
            <div className="field">
              <label htmlFor={`${prefix}-to-date`}>Do dnia (włącznie)</label>
              <input
                id={`${prefix}-to-date`}
                type="date"
                required
                value={dates.to}
                min={dates.from || "2000-01-01"}
                max="2099-12-31"
                onChange={(event) => {
                  autoEndDate.current = false;
                  setDates((v) => ({ ...v, to: event.target.value }));
                }}
              />
            </div>
            <small className="muted">
              Blokada obejmie wybrane dni od północy do końca ostatniego dnia, w
              czasie polskim.
            </small>
          </>
        ) : (
          <>
            <div className="field">
              <label htmlFor={`${prefix}-starts_at`}>Od (czas polski)</label>
              <input {...field("starts_at")} type="datetime-local" required />
            </div>
            <div className="field">
              <label htmlFor={`${prefix}-ends_at`}>Do (czas polski)</label>
              <input {...field("ends_at")} type="datetime-local" required />
            </div>
          </>
        )}
        <div className="field">
          <label htmlFor={`${prefix}-assigned_staff_id`}>Prowadzący</label>
          <select {...field("assigned_staff_id")}>
            <option value="">Wspólna blokada zespołu</option>
            {values.assigned_staff_id &&
              !members.some(
                (member) => member.user_id === values.assigned_staff_id,
              ) && (
                <option value={values.assigned_staff_id}>
                  {initial?.assigned_staff_name || "Dotychczasowy prowadzący"}{" "}
                  (poza zespołem)
                </option>
              )}
            {members.map((member) => (
              <option key={member.user_id} value={member.user_id}>
                {member.full_name}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor={`${prefix}-resource_id`}>Miejsce do rezerwacji</label>
          <select {...field("resource_id")}>
            <option value="">Bez rezerwacji miejsca</option>
            {resources
              .filter(
                (resource) =>
                  resource.active || resource.id === values.resource_id,
              )
              .map((resource) => (
                <option key={resource.id} value={resource.id}>
                  {resource.name}
                  {!resource.active
                    ? " (nieaktywne)"
                    : !resource.exclusive
                      ? " (zajęcia równoległe)"
                      : ""}
                </option>
              ))}
          </select>
        </div>
      </fieldset>
      {state.error && (
        <div className="alert red" role="alert" tabIndex={-1} ref={error}>
          {state.error}
        </div>
      )}
      {state.success && (
        <div className="alert green" role="status">
          {state.success}
        </div>
      )}
      <CalendarWarning
        warning={state.calendarWarning}
        pending={!hydrated || pending}
      />
      <div className={styles.controls}>
        {state.version && onNew ? (
          <button
            type="button"
            className="ghost-button"
            onClick={onNew}
            disabled={!hydrated || pending}
          >
            Dodaj kolejną blokadę
          </button>
        ) : null}
        <button className="primary-button" disabled={!hydrated || pending}>
          {!hydrated
            ? "Przygotowuję formularz…"
            : pending
              ? "Zapisuję…"
              : state.version
                ? "Zapisz blokadę"
                : "Zablokuj czas"}
        </button>
        {Boolean(state.version) && (
          <button
            className="ghost-button"
            formAction={(form) => {
              form.set("intent", "cancel");
              action(form);
            }}
            formNoValidate
            disabled={!hydrated || pending}
            onClick={(e) => {
              if (
                !window.confirm(
                  "Usunąć tę blokadę i zwolnić czas w kalendarzu?",
                )
              )
                e.preventDefault();
            }}
          >
            Usuń blokadę
          </button>
        )}
      </div>
    </form>
  );
}

export function CreateBlockEditor({
  id,
  members = [],
  resources = [],
  currentUserId,
}: {
  id: string;
  members?: CalendarTeamMember[];
  resources?: CalendarResource[];
  currentUserId?: string | null;
}) {
  const [currentId, setCurrentId] = useState(id);
  return (
    <BlockEditor
      key={currentId}
      id={currentId}
      members={members}
      resources={resources}
      currentUserId={currentUserId}
      onNew={() => setCurrentId(crypto.randomUUID())}
    />
  );
}

export function AssignmentEditor({
  appointment,
  members,
  resources,
}: {
  appointment: Appointment;
  members: CalendarTeamMember[];
  resources: CalendarResource[];
}) {
  const hydrated = useHydrated();
  const form = usePersistentForm();
  const [original] = useState(appointment);
  const [values, setValues] = useState({
    assigned_staff_id: appointment.assigned_staff_id || "",
    resource_id: appointment.resource_id || "",
  });
  const [state, action, pending] = useActionState(
    async (previous: BlockState, form: FormData) => {
      const result = await saveCalendarAssignment(previous, form);
      return { ...result, version: result.version ?? previous.version };
    },
    { version: appointment.assignment_version },
  );
  const error = useRef<HTMLDivElement>(null);
  const prefix = useId();
  useEffect(() => {
    if (state.error) error.current?.focus();
  }, [state]);
  return (
    <form
      ref={form}
      action={action}
      className="form-stack"
      aria-busy={!hydrated || pending}
    >
      <input type="hidden" name="kind" value={original.kind} />
      <input
        type="hidden"
        name="appointment_id"
        value={original.appointment_id || original.id}
      />
      <input type="hidden" name="expected_version" value={state.version} />
      <fieldset disabled={!hydrated || pending} className={styles.fields}>
        <legend className="sr-only">Prowadzący i miejsce zajęć</legend>
        <div className="field">
          <label htmlFor={`${prefix}-staff`}>Prowadzący</label>
          <select
            id={`${prefix}-staff`}
            name="assigned_staff_id"
            value={values.assigned_staff_id}
            onChange={(event) =>
              setValues((v) => ({
                ...v,
                assigned_staff_id: event.target.value,
              }))
            }
          >
            <option value="">Do przypisania — wspólna rezerwacja</option>
            {values.assigned_staff_id &&
              !members.some(
                (member) => member.user_id === values.assigned_staff_id,
              ) && (
                <option value={values.assigned_staff_id}>
                  {original.assigned_staff_name || "Dotychczasowy prowadzący"}{" "}
                  (poza zespołem)
                </option>
              )}
            {members.map((member) => (
              <option key={member.user_id} value={member.user_id}>
                {member.full_name}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor={`${prefix}-resource`}>Miejsce do rezerwacji</label>
          <select
            id={`${prefix}-resource`}
            name="resource_id"
            value={values.resource_id}
            onChange={(event) =>
              setValues((v) => ({ ...v, resource_id: event.target.value }))
            }
          >
            <option value="">Bez rezerwacji miejsca</option>
            {resources
              .filter(
                (resource) =>
                  resource.active || resource.id === values.resource_id,
              )
              .map((resource) => (
                <option key={resource.id} value={resource.id}>
                  {resource.name}
                  {!resource.active
                    ? " (nieaktywne)"
                    : !resource.exclusive
                      ? " (zajęcia równoległe)"
                      : ""}
                </option>
              ))}
          </select>
        </div>
      </fieldset>
      {state.error && (
        <div className="alert red" role="alert" tabIndex={-1} ref={error}>
          {state.error}
        </div>
      )}
      {state.success && (
        <div className="alert green" role="status">
          {state.success}
        </div>
      )}
      <CalendarWarning
        warning={state.calendarWarning}
        pending={!hydrated || pending}
      />
      <button className="primary-button" disabled={!hydrated || pending}>
        {pending ? "Sprawdzam…" : "Zapisz przypisanie"}
      </button>
    </form>
  );
}
