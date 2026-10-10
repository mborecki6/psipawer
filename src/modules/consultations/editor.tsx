"use client";
import { useActionState, useEffect, useId, useRef, useState } from "react";
import { scheduleConsultation } from "./actions";
import { warsawDateTimeInput } from "@/lib/time";
import type { Consultation } from "./types";
import type { ActionState } from "@/components/action-form";
import styles from "./consultations.module.css";
import { useHydrated } from "@/components/use-hydrated";
import { usePersistentForm } from "@/components/use-persistent-form";
import { CalendarWarning } from "@/modules/calendar/warning";
import { BookingChoice } from "@/modules/calendar/booking-choice";
import type { BookingChoices } from "@/modules/calendar/booking-queries";

export function ScheduleEditor({
  consultation,
  confirmedPriceVersion,
  booking,
}: {
  consultation: Consultation;
  confirmedPriceVersion?: number;
  booking?: BookingChoices;
}) {
  const hydrated = useHydrated();
  const form = usePersistentForm();
  // The version always describes the visible draft. A background refresh must
  // not silently relabel an old draft with a newer version from another tab.
  const [original] = useState(consultation);
  const [values, setValues] = useState({
    starts_at: consultation.starts_at
      ? warsawDateTimeInput(consultation.starts_at)
      : "",
    duration_minutes: String(
      consultation.duration_minutes ||
        consultation.service_duration_minutes ||
        60,
    ),
    meeting_mode:
      consultation.service_meeting_mode ||
      consultation.meeting_mode ||
      "in_person",
    location: consultation.location,
    note: "",
  });
  const [state, action, pending] = useActionState(
    async (previous: ActionState & { version: number }, form: FormData) => {
      const result = await scheduleConsultation(previous, form);
      return { ...result, version: result.version ?? previous.version };
    },
    { version: original.version },
  );
  const error = useRef<HTMLDivElement>(null);
  const prefix = useId();
  useEffect(() => {
    if (state.error) error.current?.focus();
  }, [state]);
  const alreadyScheduled =
    original.status === "scheduled" || state.version > original.version;
  // Acknowledge only this tab's explicit price save while retaining the date
  // and location draft. Other refreshed versions still cause a conflict.
  const expectedVersion =
    confirmedPriceVersion === state.version + 1
      ? confirmedPriceVersion
      : state.version;
  function field(name: keyof typeof values) {
    return {
      id: `${prefix}-${name}`,
      name,
      value: values[name],
      onChange: (
        e: React.ChangeEvent<
          HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement
        >,
      ) => setValues((v) => ({ ...v, [name]: e.target.value })),
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
      <input type="hidden" name="expected_version" value={expectedVersion} />
      {booking && (
        <BookingChoice
          data={booking}
          appointmentId={original.id}
          pending={!hydrated || pending}
          saved={state.version > original.version}
        />
      )}
      <fieldset disabled={!hydrated || pending} className={styles.fields}>
        <legend className="sr-only">Szczegóły konsultacji</legend>
        <div className={styles.formGrid}>
          <div className="field">
            <label htmlFor={`${prefix}-starts_at`}>Termin (czas polski)</label>
            <input {...field("starts_at")} type="datetime-local" required />
          </div>
          <div className="field">
            <label htmlFor={`${prefix}-duration_minutes`}>
              Czas trwania (minuty)
            </label>
            <input
              {...field("duration_minutes")}
              type="number"
              min={15}
              max={240}
              required
            />
          </div>
        </div>
        <div className="field">
          <label htmlFor={`${prefix}-meeting_mode`}>Forma spotkania</label>
          {original.service_meeting_mode && (
            <input
              type="hidden"
              name="meeting_mode"
              value={original.service_meeting_mode}
            />
          )}
          <select
            {...field("meeting_mode")}
            disabled={Boolean(original.service_meeting_mode)}
          >
            <option value="in_person">Na miejscu</option>
            <option value="online">Online</option>
          </select>
        </div>
        <div className="field">
          <label htmlFor={`${prefix}-location`}>
            Miejsce lub instrukcja połączenia
          </label>
          <textarea
            {...field("location")}
            rows={3}
            minLength={3}
            maxLength={1000}
            required
          />
        </div>
        <div className="field">
          <label htmlFor={`${prefix}-note`}>
            {alreadyScheduled
              ? "Powód zmiany dla opiekuna"
              : "Wiadomość dla opiekuna (opcjonalnie)"}
          </label>
          <textarea
            {...field("note")}
            rows={3}
            maxLength={3000}
            minLength={alreadyScheduled ? 3 : undefined}
            required={alreadyScheduled}
          />
        </div>
      </fieldset>
      {state.error && (
        <div ref={error} role="alert" tabIndex={-1} className="alert red">
          {state.error}
        </div>
      )}
      {state.success && (
        <div role="status" className="alert green">
          {state.success}
        </div>
      )}
      <CalendarWarning
        warning={state.calendarWarning}
        pending={!hydrated || pending}
      />
      <button className="primary-button" disabled={!hydrated || pending}>
        {!hydrated
          ? "Przygotowuję formularz…"
          : pending
            ? "Zapisuję…"
            : alreadyScheduled
              ? "Zapisz zmianę terminu"
              : "Potwierdź uzgodniony termin"}
      </button>
    </form>
  );
}
