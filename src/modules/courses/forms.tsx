"use client";
import { useActionState, useEffect, useId, useRef, useState } from "react";
import { useHydrated } from "@/components/use-hydrated";
import { usePersistentForm } from "@/components/use-persistent-form";
import { money } from "@/lib/domain";
import { warsawDateTimeInput } from "@/lib/time";
import type { Service } from "@/modules/services/types";
import type {
  Course,
  CourseAttendance,
  CourseEnrollment,
  SessionDetail,
} from "./types";
import { attendanceLabels } from "./types";
import {
  createCourse,
  requestEnrollment,
  rescheduleSession,
  recordAttendance,
  editCourse,
  correctAttendance,
  reopenEnrollment,
  type CourseActionState,
} from "./actions";
import styles from "./courses.module.css";
import { CalendarWarning } from "@/modules/calendar/warning";
import { BookingChoice } from "@/modules/calendar/booking-choice";
import type { BookingChoices } from "@/modules/calendar/booking-queries";
type Action = (
  state: CourseActionState,
  form: FormData,
) => Promise<CourseActionState>;
function useCourseForm(action: Action, version: number) {
  const hydrated = useHydrated();
  const ref = usePersistentForm();
  const error = useRef<HTMLDivElement>(null);
  const [state, submit, pending] = useActionState(
    async (
      previous: CourseActionState & { version: number },
      form: FormData,
    ) => {
      const result = await action(previous, form);
      return { ...result, version: result.version ?? previous.version };
    },
    { version },
  );
  useEffect(() => {
    if (state.error) error.current?.focus();
  }, [state]);
  return {
    hydrated,
    ref,
    error,
    state,
    submit,
    pending,
    busy: !hydrated || pending,
  };
}
function Feedback({
  state,
  error,
  pending = false,
}: {
  state: CourseActionState;
  error: React.RefObject<HTMLDivElement | null>;
  pending?: boolean;
}) {
  return (
    <>
      <CalendarWarning warning={state.calendarWarning} pending={pending} />
      {state.error && (
        <div ref={error} role="alert" tabIndex={-1} className="alert red">
          {state.error}
        </div>
      )}
      <div aria-live="polite" aria-atomic="true">
        {state.success && (
          <div role="status" className="alert green">
            {state.success}
          </div>
        )}
      </div>
    </>
  );
}
function Submit({
  busy,
  label,
  disabled = false,
}: {
  busy: boolean;
  label: string;
  disabled?: boolean;
}) {
  return (
    <button className="primary-button" disabled={busy || disabled}>
      {busy ? "Proszę czekać…" : label}
    </button>
  );
}
export function CourseCreateForm({
  services,
  id,
  serviceId,
  booking,
}: {
  services: Service[];
  id: string;
  serviceId?: string;
  booking?: BookingChoices;
}) {
  const [original] = useState({ services, id });
  const first =
    original.services.find((s) => s.id === serviceId) || original.services[0];
  const [selected, setSelected] = useState(first?.id || "");
  const service = original.services.find((s) => s.id === selected);
  const [title, setTitle] = useState(first?.name || "");
  const [capacity, setCapacity] = useState(
    first?.course_format === "individual" ? "1" : "4",
  );
  const [publicPlace, setPublicPlace] = useState("");
  const [privatePlace, setPrivatePlace] = useState("");
  const [starts, setStarts] = useState<string[]>(
    Array(first?.sessions_count || 0).fill(""),
  );
  const { ref, error, state, submit, busy } = useCourseForm(createCourse, 1),
    prefix = useId();
  if (!service)
    return <p>Brak aktywnej oferty kursu. Uzupełnij katalog usług.</p>;
  return (
    <form
      ref={ref}
      action={submit}
      className="form-stack"
      aria-label="Nowy cykl kursu"
      aria-busy={busy}
    >
      <input type="hidden" name="id" value={original.id} />
      <input type="hidden" name="service_version" value={service.version} />
      {booking && <BookingChoice data={booking} pending={busy} />}
      {booking && (
        <p className="muted">
          Wybór prowadzącego i sali dotyczy całego cyklu. Poszczególne spotkania
          możesz później przypisać osobno w kalendarzu.
        </p>
      )}
      <fieldset disabled={busy} className={styles.fields}>
        <legend className="sr-only">Dane cyklu</legend>
        <div className="field">
          <label htmlFor={`${prefix}-service`}>Usługa</label>
          <select
            id={`${prefix}-service`}
            name="service_id"
            value={selected}
            onChange={(e) => {
              const next = original.services.find(
                (s) => s.id === e.target.value,
              )!;
              setSelected(next.id);
              if (title === service.name) setTitle(next.name);
              setCapacity(next.course_format === "individual" ? "1" : "4");
              setStarts((current) =>
                Array.from(
                  { length: next.sessions_count! },
                  (_, i) => current[i] || "",
                ),
              );
            }}
          >
            {original.services.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </div>
        <div className={styles.quote}>
          <strong>{money(service.price_cents)} za cały cykl</strong>
          <span>
            {service.sessions_count} spotkań po {service.duration_minutes} min ·{" "}
            {service.is_test_price ? "Cena robocza" : "Cena docelowa"}
          </span>
        </div>
        <div className="field">
          <label htmlFor={`${prefix}-title`}>Nazwa cyklu</label>
          <input
            id={`${prefix}-title`}
            name="title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            minLength={3}
            maxLength={160}
            required
          />
        </div>
        <div className="field">
          <label htmlFor={`${prefix}-capacity`}>Liczba psów z opiekunami</label>
          <input
            id={`${prefix}-capacity`}
            name="capacity"
            type="number"
            min={1}
            max={service.course_format === "individual" ? 1 : 50}
            readOnly={service.course_format === "individual"}
            value={capacity}
            onChange={(e) => setCapacity(e.target.value)}
            required
          />
          <small>
            {service.course_format === "individual"
              ? "Kurs indywidualny: jedna para pies–opiekun."
              : "Domyślnie 4 pary. Zgłoszenia zatwierdzasz osobiście."}
          </small>
        </div>
        <div className="field">
          <label htmlFor={`${prefix}-public`}>
            Okolica widoczna przed przyjęciem
          </label>
          <textarea
            id={`${prefix}-public`}
            name="public_location"
            value={publicPlace}
            onChange={(e) => setPublicPlace(e.target.value)}
            minLength={3}
            maxLength={300}
            rows={2}
            required
          />
        </div>
        <div className="field">
          <label htmlFor={`${prefix}-private`}>
            Dokładna zbiórka po przyjęciu
          </label>
          <textarea
            id={`${prefix}-private`}
            name="exact_location"
            value={privatePlace}
            onChange={(e) => setPrivatePlace(e.target.value)}
            minLength={3}
            maxLength={2000}
            rows={3}
            required
          />
          <small>
            Początkowo dla wszystkich spotkań. Potem możesz zmienić miejsce
            każdego z nich osobno.
          </small>
        </div>
        <div className={styles.sectionHead}>
          <h3>Terminy w czasie polskim</h3>
          <button
            className="ghost-button"
            type="button"
            disabled={!starts[0]}
            onClick={() => {
              const firstDate = new Date(`${starts[0]}:00Z`);
              if (Number.isFinite(firstDate.getTime()))
                setStarts(
                  starts.map((_, i) =>
                    new Date(firstDate.getTime() + i * 7 * 86400000)
                      .toISOString()
                      .slice(0, 16),
                  ),
                );
            }}
          >
            Uzupełnij co tydzień
          </button>
        </div>
        <div className={styles.dateGrid}>
          {starts.map((date, i) => (
            <div className="field" key={i}>
              <label htmlFor={`${prefix}-date-${i}`}>Spotkanie {i + 1}</label>
              <input
                id={`${prefix}-date-${i}`}
                type="datetime-local"
                name="starts"
                value={date}
                onChange={(e) =>
                  setStarts((all) =>
                    all.map((v, n) => (n === i ? e.target.value : v)),
                  )
                }
                required
              />
            </div>
          ))}
        </div>
      </fieldset>
      <Feedback state={state} error={error} pending={busy} />
      <Submit busy={busy} label="Zapisz szkic cyklu" />
    </form>
  );
}
export function EnrollmentForm({
  course,
  dogs,
  id,
  enabled,
}: {
  course: Course;
  dogs: { id: string; name: string }[];
  id: string;
  enabled: boolean;
}) {
  const [original] = useState({ course, id });
  const [dog, setDog] = useState(dogs[0]?.id || "");
  const { ref, error, state, submit, busy } = useCourseForm(
      requestEnrollment,
      original.course.version,
    ),
    prefix = useId();
  const done = Boolean(state.success);
  return (
    <form
      ref={ref}
      action={submit}
      className="form-stack"
      aria-label="Zgłoszenie na kurs"
      aria-busy={busy}
    >
      <input type="hidden" name="id" value={original.id} />
      <input type="hidden" name="course_id" value={original.course.id} />
      <input type="hidden" name="course_version" value={state.version} />
      {dogs.length > 0 && !done && (
        <fieldset disabled={busy || !enabled} className={styles.fields}>
          <legend className="sr-only">Zgłoszenie psa</legend>
          <div className="field">
            <label htmlFor={`${prefix}-dog`}>Pies</label>
            <select
              id={`${prefix}-dog`}
              name="dog_id"
              value={dog}
              onChange={(e) => setDog(e.target.value)}
              required
            >
              {dogs.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </div>
          <p className="muted">
            {money(original.course.price_cents)} za cały cykl (
            {original.course.sessions_count} spotkań).{" "}
            {original.course.is_test_price ? "Cena robocza do testów." : ""}{" "}
            Miejsce zajmujesz po decyzji prowadzącej.
          </p>
        </fieldset>
      )}
      <Feedback state={state} error={error} pending={busy} />
      {dogs.length > 0 && !done && (
        <Submit
          busy={busy}
          disabled={!enabled || done || !dogs.length}
          label="Zgłoś psa na kurs"
        />
      )}
    </form>
  );
}
export function CommandForm({
  id,
  version,
  action,
  options,
  allowed,
  label,
  enabled = true,
}: {
  id: string;
  version: number;
  action: Action;
  options: { value: string; label: string }[];
  allowed: string[];
  label: string;
  enabled?: boolean;
}) {
  const [original] = useState({ id, version });
  const [intent, setIntent] = useState(allowed[0] || options[0].value),
    [note, setNote] = useState("");
  const { ref, error, state, submit, busy } = useCourseForm(
      action,
      original.version,
    ),
    prefix = useId();
  const reason = ["cancel", "reject"].includes(intent);
  return (
    <form
      ref={ref}
      action={submit}
      className="form-stack"
      aria-label={label}
      aria-busy={busy}
    >
      <input type="hidden" name="id" value={original.id} />
      <input type="hidden" name="expected_version" value={state.version} />
      <fieldset
        disabled={busy || !enabled || !allowed.length}
        className={styles.fields}
      >
        <legend className="sr-only">{label}</legend>
        <div className="field">
          <label htmlFor={`${prefix}-intent`}>{label}</label>
          <select
            id={`${prefix}-intent`}
            name="intent"
            value={intent}
            onChange={(e) => setIntent(e.target.value)}
          >
            {options.map((o) => (
              <option
                key={o.value}
                value={o.value}
                disabled={!allowed.includes(o.value)}
              >
                {o.label}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor={`${prefix}-note`}>
            {reason
              ? "Powód dla opiekuna"
              : "Wiadomość dla opiekuna (opcjonalnie)"}
          </label>
          <textarea
            id={`${prefix}-note`}
            name="note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            minLength={reason ? 3 : undefined}
            required={reason}
            maxLength={3000}
            rows={2}
          />
        </div>
      </fieldset>
      <Feedback state={state} error={error} pending={busy} />
      <Submit
        busy={busy}
        disabled={!enabled || !allowed.includes(intent)}
        label="Zapisz zmianę"
      />
    </form>
  );
}
export function ReopeningPanel({
  enrollment,
  enabled,
}: {
  enrollment: CourseEnrollment;
  enabled: boolean;
}) {
  const terminal = ["rejected", "cancelled"].includes(enrollment.status);
  const [original, setOriginal] = useState<CourseEnrollment | null>(
    terminal ? enrollment : null,
  );
  // Mount a fresh editor only when there was no reopening editor before.
  // Once open, it keeps its original version even after another action refreshes
  // the page. Its own successful confirmation stays visible after restoration.
  if (!original && terminal) setOriginal(enrollment);
  if (!original) return null;
  return (
    <details>
      <summary>Ponowna decyzja lub przywrócenie udziału</summary>
      <ReopeningForm
        enrollment={original}
        enabled={enabled && enrollment.status === original.status}
      />
    </details>
  );
}
function ReopeningForm({
  enrollment,
  enabled,
}: {
  enrollment: CourseEnrollment;
  enabled: boolean;
}) {
  const [original] = useState(enrollment);
  const intent = original.status === "rejected" ? "reconsider" : "restore";
  const [note, setNote] = useState("");
  const { ref, error, state, submit, busy } = useCourseForm(
    reopenEnrollment,
    original.version,
  );
  const prefix = useId(),
    done = Boolean(state.success);
  return (
    <form
      ref={ref}
      action={submit}
      className="form-stack"
      aria-label="Powrót do zgłoszenia"
      aria-busy={busy}
    >
      <input type="hidden" name="id" value={original.id} />
      <input type="hidden" name="expected_version" value={original.version} />
      <input type="hidden" name="intent" value={intent} />
      <p className="muted">
        {intent === "restore" ? (
          <>
            Przywrócenie potwierdza miejsce i należność{" "}
            <strong>{money(original.agreed_price_cents)}</strong> za cały cykl.
            Dotychczasowe wpłaty i zwroty pozostają w ewidencji.
          </>
        ) : (
          <>
            Zgłoszenie wróci do oczekujących z wcześniejszą ceną{" "}
            <strong>{money(original.agreed_price_cents)}</strong>. Miejsce
            wymaga osobnej decyzji prowadzącej.
          </>
        )}
      </p>
      <fieldset disabled={busy || !enabled || done} className={styles.fields}>
        <legend className="sr-only">Powrót do zgłoszenia</legend>
        <div className="field">
          <label htmlFor={`${prefix}-reason`}>
            Powód powrotu do zgłoszenia
          </label>
          <textarea
            id={`${prefix}-reason`}
            name="note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            minLength={3}
            maxLength={3000}
            required
            rows={3}
          />
          <span className="field-hint">
            Powód trafi do historii widocznej dla opiekuna.
          </span>
        </div>
      </fieldset>
      <Feedback state={state} error={error} pending={busy} />
      {!enabled && !done && (
        <p className="muted">
          Powrót wymaga aktywnego kursu przed pierwszym spotkaniem. Po innej
          zmianie zgłoszenia odśwież dane.
        </p>
      )}
      <Submit
        busy={busy}
        disabled={!enabled || done}
        label={
          intent === "restore"
            ? "Przywróć udział na kursie"
            : "Wróć do decyzji o zgłoszeniu"
        }
      />
    </form>
  );
}
export function SessionEditor({
  session,
  enabled,
  booking,
}: {
  session: SessionDetail;
  enabled: boolean;
  booking?: BookingChoices;
}) {
  const [original] = useState(session);
  const [date, setDate] = useState(warsawDateTimeInput(session.starts_at));
  const [publicPlace, setPublicPlace] = useState(session.public_location);
  const [privatePlace, setPrivatePlace] = useState(
    session.course_session_private_details?.exact_location || "",
  );
  const [note, setNote] = useState("");
  const { ref, error, state, submit, busy } = useCourseForm(
      rescheduleSession,
      original.version,
    ),
    prefix = useId();
  return (
    <form
      ref={ref}
      action={submit}
      className="form-stack"
      aria-label={`Termin spotkania ${original.ordinal}`}
      aria-busy={busy}
    >
      <input type="hidden" name="id" value={original.id} />
      <input type="hidden" name="expected_version" value={state.version} />
      {booking && (
        <BookingChoice
          data={booking}
          appointmentId={original.id}
          pending={busy || !enabled}
          saved={state.version > original.version}
        />
      )}
      <fieldset disabled={busy || !enabled} className={styles.fields}>
        <legend className="sr-only">Termin i zbiórka</legend>
        <div className="field">
          <label htmlFor={`${prefix}-date`}>Termin (czas polski)</label>
          <input
            id={`${prefix}-date`}
            type="datetime-local"
            name="starts_at"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            required
          />
        </div>
        <div className="field">
          <label htmlFor={`${prefix}-public`}>
            Okolica widoczna przed przyjęciem
          </label>
          <textarea
            id={`${prefix}-public`}
            name="public_location"
            value={publicPlace}
            onChange={(e) => setPublicPlace(e.target.value)}
            minLength={3}
            maxLength={300}
            rows={2}
            required
          />
        </div>
        <div className="field">
          <label htmlFor={`${prefix}-private`}>
            Dokładna zbiórka po przyjęciu
          </label>
          <textarea
            id={`${prefix}-private`}
            name="exact_location"
            value={privatePlace}
            onChange={(e) => setPrivatePlace(e.target.value)}
            minLength={3}
            maxLength={2000}
            rows={2}
            required
          />
        </div>
        <div className="field">
          <label htmlFor={`${prefix}-note`}>Powód zmiany dla opiekuna</label>
          <textarea
            id={`${prefix}-note`}
            name="note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            minLength={3}
            maxLength={3000}
            rows={2}
            required
          />
        </div>
      </fieldset>
      <Feedback state={state} error={error} pending={busy} />
      <Submit busy={busy} disabled={!enabled} label="Zapisz termin i zbiórkę" />
    </form>
  );
}
export function AttendanceForm({
  sessionId,
  enrollmentId,
  attendance,
  enabled,
  dogName,
  correction = false,
}: {
  sessionId: string;
  enrollmentId: string;
  attendance?: CourseAttendance;
  enabled: boolean;
  dogName: string;
  correction?: boolean;
}) {
  const [original] = useState({
    sessionId,
    enrollmentId,
    version: attendance?.version || 0,
  });
  const [value, setValue] = useState(attendance?.attendance || "present");
  const [note, setNote] = useState("");
  const [dirty, setDirty] = useState(false);
  const { ref, error, state, submit, busy } = useCourseForm(
      async (previous, data) => {
        const result = await (
          correction ? correctAttendance : recordAttendance
        )(previous, data);
        if (result.success) setDirty(false);
        return result;
      },
      original.version,
    ),
    prefix = useId();
  return (
    <form
      ref={ref}
      action={submit}
      className="form-stack"
      aria-label={`${correction ? "Korekta obecności" : "Obecność"}: ${dogName}`}
      aria-busy={busy}
    >
      <input type="hidden" name="session_id" value={original.sessionId} />
      <input type="hidden" name="enrollment_id" value={original.enrollmentId} />
      <input type="hidden" name="expected_version" value={state.version} />
      <fieldset disabled={busy || !enabled} className={styles.fields}>
        <legend className="sr-only">Obecność</legend>
        <div className="field">
          <label htmlFor={prefix}>{dogName}</label>
          <select
            id={prefix}
            name="attendance"
            value={value}
            onChange={(e) => {
              setValue(e.target.value as typeof value);
              setDirty(true);
            }}
          >
            {Object.entries(attendanceLabels).map(([v, text]) => (
              <option key={v} value={v}>
                {text}
              </option>
            ))}
          </select>
        </div>
        {correction && (
          <label className="field">
            <span>Powód korekty obecności</span>
            <textarea
              name="note"
              value={note}
              onChange={(e) => {
                setNote(e.target.value);
                setDirty(true);
              }}
              minLength={3}
              maxLength={3000}
              rows={2}
              required
            />
          </label>
        )}
      </fieldset>
      <Feedback
        state={{ ...state, success: dirty || busy ? undefined : state.success }}
        error={error}
      />
      <Submit
        busy={busy}
        disabled={!enabled}
        label={correction ? "Zapisz korektę obecności" : "Zapisz obecność"}
      />
    </form>
  );
}

export function CourseSettingsForm({
  course,
  enabled,
  requestId: initialRequestId,
}: {
  course: Course;
  enabled: boolean;
  requestId: string;
}) {
  const [original] = useState(course);
  const [requestId, setRequestId] = useState(initialRequestId);
  const [title, setTitle] = useState(original.title);
  const [capacity, setCapacity] = useState(String(original.capacity));
  const [note, setNote] = useState("");
  const [dirty, setDirty] = useState(false);
  const { ref, error, state, submit, busy } = useCourseForm(
    async (previous, data) => {
      const result = await editCourse(previous, data);
      if (result.success) {
        setDirty(false);
        setRequestId(crypto.randomUUID());
      }
      return result;
    },
    original.version,
  );
  return (
    <form
      ref={ref}
      action={submit}
      className="form-stack"
      aria-label="Ustawienia cyklu"
      aria-busy={busy}
    >
      <input type="hidden" name="id" value={original.id} />
      <input type="hidden" name="expected_version" value={state.version} />
      <input type="hidden" name="request_id" value={requestId} />
      <fieldset disabled={busy || !enabled} className={styles.fields}>
        <legend className="sr-only">Nazwa i liczba miejsc</legend>
        <label className="field">
          <span>Nazwa cyklu</span>
          <input
            name="title"
            value={title}
            onChange={(e) => {
              setTitle(e.target.value);
              setDirty(true);
            }}
            minLength={3}
            maxLength={160}
            required
          />
        </label>
        <label className="field">
          <span>Liczba psów z opiekunami</span>
          <input
            name="capacity"
            type="number"
            value={capacity}
            onChange={(e) => {
              setCapacity(e.target.value);
              setDirty(true);
            }}
            min={1}
            max={original.course_format === "individual" ? 1 : 50}
            readOnly={original.course_format === "individual"}
            required
          />
        </label>
        <label className="field">
          <span>Powód zmiany ustawień</span>
          <textarea
            name="note"
            value={note}
            onChange={(e) => {
              setNote(e.target.value);
              setDirty(true);
            }}
            minLength={3}
            maxLength={3000}
            rows={2}
            required
          />
          <small>Powód pojawi się w historii widocznej dla opiekunów.</small>
        </label>
        <p className="muted">
          Cena całego cyklu i zgłoszeń pozostaje bez zmian. Limit nie może być
          mniejszy niż liczba przyjętych psów. Rezerwa nie jest przyjmowana
          automatycznie.
        </p>
      </fieldset>
      <Feedback
        state={{ ...state, success: dirty || busy ? undefined : state.success }}
        error={error}
      />
      <Submit
        busy={busy}
        disabled={!enabled || !dirty}
        label="Zapisz ustawienia cyklu"
      />
    </form>
  );
}
