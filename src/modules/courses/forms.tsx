"use client";
import {
  createContext,
  useContext,
  useActionState,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { RosterActionButtons } from "../../components/roster-action-buttons";
import { useHydrated } from "@/components/use-hydrated";
import { usePersistentForm } from "@/components/use-persistent-form";
import {
  withFormActionRecovery,
  unconfirmedFormMessage,
} from "@/components/form-action-recovery";
import { money } from "@/lib/domain";
import { warsawDateTimeInput } from "@/lib/time";
import type { Service } from "@/modules/services/types";
import type {
  Course,
  CourseAttendance,
  CourseEnrollment,
  EnrollmentStatus,
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
  decideEnrollment,
  reopenEnrollment,
  type CourseActionState,
} from "./actions";
import styles from "./courses.module.css";
import { CalendarWarning } from "@/modules/calendar/warning";
import { BookingChoice } from "@/modules/calendar/booking-choice";
import type { BookingChoices } from "@/modules/calendar/booking-queries";
import { revealCourseFormFeedback } from "./course-disclosure";
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
      // Bind every result to the submitted version, including a version just
      // confirmed by a sibling form. Refreshed server props never supply it.
      const submitted = form.has("expected_version")
        ? Number(form.get("expected_version"))
        : undefined;
      const sourceVersion =
        submitted !== undefined &&
        Number.isInteger(submitted) &&
        submitted >= 0 &&
        submitted <= 2147483646
          ? submitted
          : previous.version;
      const result = await withFormActionRecovery(action)(
        { ...previous, version: sourceVersion },
        form,
      );
      return { ...result, version: result.version ?? sourceVersion };
    },
    { version },
  );
  useLayoutEffect(() => {
    // Reveal before Feedback/CalendarWarning effects focus the new result.
    // Depending on action state (not server props) respects a later collapse.
    if (state.error || state.success || state.calendarWarning)
      revealCourseFormFeedback(ref.current);
  }, [state, ref]);
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

type DecisionIntent =
  "accept" | "waitlist" | "reject" | "cancel" | "reconsider" | "restore";
type DecisionCommand = {
  id: string;
  dogName: string;
  version: number;
  intent: DecisionIntent;
  note: string;
};
type DecisionRecord = {
  version?: number;
  status?: EnrollmentStatus;
  message?: string;
  command?: DecisionCommand & { pending: boolean; error?: string };
};
type DecisionRegistry = {
  records: Record<string, DecisionRecord>;
  begin: (command: DecisionCommand) => void;
  finish: (command: DecisionCommand, result: CourseActionState) => void;
};
const DecisionConfirmation = createContext<DecisionRegistry | undefined>(
  undefined,
);
const decisionText: Record<DecisionIntent, string> = {
  accept: "Przyjmij",
  waitlist: "Przenieś na rezerwę",
  reject: "Nie przyjmuj",
  cancel: "Zapisz rezygnację",
  reconsider: "Wróć do decyzji o zgłoszeniu",
  restore: "Przywróć udział na kursie",
};
const decisionResult: Record<
  DecisionIntent,
  { status: EnrollmentStatus; message: string }
> = {
  accept: { status: "accepted", message: "Przyjęto na kurs." },
  waitlist: { status: "waitlisted", message: "Przeniesiono na rezerwę." },
  reject: { status: "rejected", message: "Nie przyjęto na kurs." },
  cancel: { status: "cancelled", message: "Zapisano rezygnację." },
  reconsider: {
    status: "requested",
    message: "Zgłoszenie wróciło do decyzji.",
  },
  restore: { status: "accepted", message: "Przywrócono udział na kursie." },
};
async function runEnrollmentDecision(
  registry: DecisionRegistry | undefined,
  dogName: string,
  previous: CourseActionState,
  data: FormData,
  action: Action,
) {
  const command: DecisionCommand = {
    id: String(data.get("id")),
    dogName,
    version: Number(data.get("expected_version")),
    intent: String(data.get("intent")) as DecisionIntent,
    note: String(data.get("note") || ""),
  };
  const unconfirmed = registry?.records[command.id]?.command;
  if (
    unconfirmed?.error === unconfirmedFormMessage &&
    (unconfirmed.version !== command.version ||
      unconfirmed.intent !== command.intent ||
      unconfirmed.note !== command.note)
  ) {
    return {
      version: unconfirmed.version,
      error:
        "Najpierw potwierdź wcześniejszą decyzję, ponawiając jej zachowaną treść. Sprawdź aktualny status zgłoszenia.",
    };
  }
  registry?.begin(command);
  // Recovery must reach the provider even if the row has already unmounted.
  const result = await withFormActionRecovery(action)(previous, data);
  registry?.finish(command, result);
  return result;
}

// Store only command receipts and submitted drafts, never fetched row/finance
// data. These survive a filtered row disappearing before its response arrives.
export function CourseDecisionFeedback({
  children,
  visibleEnrollmentIds = [],
}: {
  children: React.ReactNode;
  visibleEnrollmentIds?: string[];
}) {
  const [records, setRecords] = useState<Record<string, DecisionRecord>>({});
  const registry: DecisionRegistry = {
    records,
    begin: (command) =>
      setRecords((previous) => ({
        ...previous,
        [command.id]: {
          ...previous[command.id],
          message: undefined,
          command: { ...command, pending: true },
        },
      })),
    finish: (command, result) =>
      setRecords((previous) => {
        if (result.success) {
          const outcome = decisionResult[command.intent];
          // Repeated decisions replace one receipt and move it to the newest
          // position, so the five visible confirmations include this result.
          const remaining = { ...previous };
          delete remaining[command.id];
          return {
            ...remaining,
            [command.id]: {
              version: result.version,
              status: outcome.status,
              message: `${command.dogName}: ${outcome.message}`,
            },
          };
        }
        return {
          ...previous,
          [command.id]: {
            ...previous[command.id],
            command: {
              ...command,
              pending: false,
              error: result.error || unconfirmedFormMessage,
            },
          },
        };
      }),
  };
  return (
    <DecisionConfirmation.Provider value={registry}>
      <div aria-live="polite" aria-atomic="true">
        {Object.entries(records)
          .filter(([, record]) => record.message)
          .slice(-5)
          .map(([id, record]) => (
            <p key={id} role="status" className="alert green">
              {record.message}
            </p>
          ))}
      </div>
      {Object.entries(records).map(
        ([id, record]) =>
          record.command &&
          !visibleEnrollmentIds.includes(id) && (
            <CourseDecisionRecovery key={id} command={record.command} />
          ),
      )}
      {children}
    </DecisionConfirmation.Provider>
  );
}

function CourseDecisionRecovery({
  command,
}: {
  command: NonNullable<DecisionRecord["command"]>;
}) {
  const registry = useContext(DecisionConfirmation);
  const { ref, error, state, submit, busy } = useCourseForm(
    (previous, data) =>
      runEnrollmentDecision(
        registry,
        command.dogName,
        previous,
        data,
        ["restore", "reconsider"].includes(command.intent)
          ? reopenEnrollment
          : decideEnrollment,
      ),
    command.version,
  );
  useEffect(() => {
    if (command.error) error.current?.focus();
  }, [command.error, error]);
  return (
    <form
      ref={ref}
      action={submit}
      className={styles.decisionRecovery}
      aria-label={`Ponowienie decyzji: ${command.dogName}`}
      aria-busy={busy || command.pending}
    >
      <strong>
        {command.dogName} · {decisionText[command.intent]}
      </strong>
      <input type="hidden" name="id" value={command.id} />
      <input type="hidden" name="expected_version" value={command.version} />
      <input type="hidden" name="intent" value={command.intent} />
      <input type="hidden" name="note" value={command.note} />
      {command.note && (
        <p className="preserve-lines">
          Zachowany powód lub wiadomość: {command.note}
        </p>
      )}
      <p className="muted">
        Sprawdź aktualny status zgłoszenia przed ponowieniem. Ponowienie
        zachowuje wysłaną decyzję i jej powód.
      </p>
      <Feedback
        state={{ ...state, error: state.error || command.error }}
        error={error}
        pending={busy || command.pending}
      />
      <button className="secondary-button" disabled={busy || command.pending}>
        Ponów tę samą decyzję: {command.dogName}
      </button>
    </form>
  );
}

export function CourseEnrollmentControls({
  enrollment,
  dogName,
  allowed,
  children,
  admin = true,
}: {
  enrollment: CourseEnrollment;
  dogName: string;
  allowed: string[];
  children: React.ReactNode;
  admin?: boolean;
}) {
  const registry = useContext(DecisionConfirmation);
  const retained = registry?.records[enrollment.id];
  const [original] = useState({
    id: enrollment.id,
    version: retained?.command?.version ?? enrollment.version,
  });
  const [rejecting, setRejecting] = useState(
    retained?.command?.intent === "reject",
  );
  const [note, setNote] = useState(retained?.command?.note || "");
  const [operation, setOperation] = useState<DecisionIntent | null>(
    retained?.command?.intent || null,
  );
  const [confirmed, setConfirmed] = useState<{
    version: number;
    status: EnrollmentStatus;
  } | null>(null);
  const reasonRef = useRef<HTMLTextAreaElement>(null);
  const { ref, error, state, submit, busy } = useCourseForm(
    async (previous, data) => {
      const saved = registry?.records[original.id]?.command;
      if (saved?.error === unconfirmedFormMessage) {
        data.set("expected_version", String(saved.version));
        data.set("intent", saved.intent);
        data.set("note", saved.note);
      }
      const intent = String(data.get("intent")) as DecisionIntent;
      setOperation(intent);
      const result = await runEnrollmentDecision(
        registry,
        dogName,
        previous,
        data,
        ["restore", "reconsider"].includes(intent)
          ? reopenEnrollment
          : decideEnrollment,
      );
      if (result.success) {
        setConfirmed({
          version: result.version!,
          status: decisionResult[intent].status,
        });
        setRejecting(false);
        setNote("");
      }
      return result;
    },
    original.version,
  );
  useEffect(() => {
    if (rejecting) reasonRef.current?.focus();
  }, [rejecting]);
  useEffect(() => {
    if (!state.error && retained?.command?.error) error.current?.focus();
  }, [state.error, retained?.command?.error, error]);
  const ownResult =
    retained?.version && (!confirmed || retained.version > confirmed.version)
      ? { version: retained.version, status: retained.status! }
      : confirmed;
  const status =
    ownResult && ownResult.version > enrollment.version
      ? ownResult.status
      : enrollment.status;
  const accepted = status === "accepted";
  const decided = ["rejected", "cancelled"].includes(status);
  const canDecide = !accepted && !decided && allowed.includes("accept");
  const rowBusy = busy || retained?.command?.pending;
  const unconfirmed = retained?.command?.error === unconfirmedFormMessage;
  const noteValue = unconfirmed ? retained.command!.note : note;
  const selectedOperation = unconfirmed ? retained.command!.intent : operation;
  const newerOwnResult = (retained?.version || 0) > state.version;
  const decisionError =
    retained?.command?.error || (newerOwnResult ? undefined : state.error);
  if (!admin) return <>{children}</>;
  return (
    <fieldset disabled={rowBusy} className={styles.enrollmentControls}>
      <legend className="sr-only">Działania zgłoszenia: {dogName}</legend>
      {accepted && <p className={styles.inRoster}>✓ W składzie kursu</p>}
      {(canDecide || decisionError || state.success) && (
        <form
          ref={ref}
          action={submit}
          className={styles.rosterForm}
          aria-label={`Decyzja: ${dogName}`}
          aria-busy={busy}
        >
          <input type="hidden" name="id" value={original.id} />
          <input
            type="hidden"
            name="expected_version"
            value={
              unconfirmed
                ? retained.command!.version
                : Math.max(state.version, retained?.version || 0)
            }
          />
          {(canDecide || decisionError) && (
            <>
              <RosterActionButtons
                name="intent"
                participantName={dogName}
                label="Decyzja o zgłoszeniu"
                choices={[
                  {
                    value: "accept",
                    label: "Przyjmij",
                    tone: "positive",
                    disabled: rejecting,
                  },
                  {
                    value: "reject",
                    label: "Nie przyjmuj",
                    tone: "negative",
                    type: "button",
                  },
                ]}
                disabled={busy || !canDecide || unconfirmed}
                busy={busy}
                onChoose={() => {
                  setRejecting(true);
                  setOperation("reject");
                }}
              />
              {rejecting ? (
                <div className={styles.rejectionReason}>
                  <label className="field">
                    <span>Powód odmowy dla opiekuna</span>
                    <textarea
                      ref={reasonRef}
                      name="note"
                      value={noteValue}
                      readOnly={unconfirmed}
                      onChange={(event) => setNote(event.target.value)}
                      minLength={3}
                      maxLength={3000}
                      rows={2}
                      required
                    />
                  </label>
                  <div className={styles.rosterSecondaryActions}>
                    <button
                      className="secondary-button"
                      name="intent"
                      value="reject"
                      disabled={!canDecide || unconfirmed}
                    >
                      Potwierdź odmowę: {dogName}
                    </button>
                    <button
                      className="ghost-button"
                      type="button"
                      disabled={unconfirmed}
                      onClick={() => setRejecting(false)}
                    >
                      Anuluj odmowę
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <details className={styles.optionalDecisionNote}>
                    <summary>Wiadomość do decyzji (opcjonalnie)</summary>
                    <label className="field">
                      <span>Wiadomość dla opiekuna (opcjonalnie)</span>
                      <textarea
                        name="note"
                        value={noteValue}
                        readOnly={unconfirmed}
                        onChange={(event) => setNote(event.target.value)}
                        maxLength={3000}
                        rows={2}
                      />
                    </label>
                  </details>
                  {allowed.includes("waitlist") &&
                    status !== "waitlisted" &&
                    enrollment.status !== "waitlisted" && (
                      <button
                        className={`ghost-button ${styles.rosterSecondary}`}
                        name="intent"
                        value="waitlist"
                        disabled={!canDecide || unconfirmed}
                      >
                        Przenieś na rezerwę: {dogName}
                      </button>
                    )}
                </>
              )}
            </>
          )}
          {unconfirmed && retained?.command && (
            <>
              {retained.command.note && (
                <p className="preserve-lines">
                  Zachowany powód lub wiadomość: {retained.command.note}
                </p>
              )}
              <button
                className="secondary-button"
                name="intent"
                value={retained.command.intent}
              >
                Ponów tę samą decyzję: {dogName}
              </button>
            </>
          )}
          {decisionError && selectedOperation && (
            <p className="muted">
              Wybrana decyzja: {decisionText[selectedOperation]}.
            </p>
          )}
          <Feedback
            state={{
              ...state,
              error: decisionError,
              success:
                busy || rejecting || note || newerOwnResult
                  ? undefined
                  : state.success,
            }}
            error={error}
          />
        </form>
      )}
      {children}
    </fieldset>
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
          {booking.resources.some((resource) => resource.active)
            ? "Prowadząca i opcjonalna rezerwacja sali dotyczą całego cyklu. Miejsce zbiórki wpisz poniżej."
            : "Prowadząca zostanie przypisana do całego cyklu. Miejsce zbiórki wpisz poniżej."}
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
        <section
          className={styles.locationFields}
          aria-labelledby={`${prefix}-place-heading`}
        >
          <h3 id={`${prefix}-place-heading`}>Miejsce spotkań</h3>
          <p className="muted">
            Wpisz miejsce dla wszystkich spotkań. Po zapisaniu cyklu możesz
            zmienić je przy wybranym spotkaniu.
          </p>
          <div className="field">
            <label htmlFor={`${prefix}-public`}>
              Miejsce — okolica przed przyjęciem
            </label>
            <textarea
              id={`${prefix}-public`}
              name="public_location"
              value={publicPlace}
              onChange={(e) => setPublicPlace(e.target.value)}
              placeholder="Np. Park Miejski w Warszawie"
              aria-describedby={`${prefix}-public-hint`}
              minLength={3}
              maxLength={300}
              rows={2}
              required
            />
            <small id={`${prefix}-public-hint`}>
              Tę okolicę opiekun zobaczy przed przyjęciem na kurs.
            </small>
          </div>
          <div className="field">
            <label htmlFor={`${prefix}-private`}>
              Dokładne miejsce zbiórki po przyjęciu
            </label>
            <textarea
              id={`${prefix}-private`}
              name="exact_location"
              value={privatePlace}
              onChange={(e) => setPrivatePlace(e.target.value)}
              placeholder="Np. wejście od ul. Parkowej, przy tablicy z mapą"
              aria-describedby={`${prefix}-private-hint`}
              minLength={3}
              maxLength={2000}
              rows={3}
              required
            />
            <small id={`${prefix}-private-hint`}>
              Adres i wskazówki dotarcia zobaczą tylko przyjęci opiekunowie.
            </small>
          </div>
        </section>
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
  enrollmentDecision,
}: {
  id: string;
  version: number;
  action: Action;
  options: { value: string; label: string }[];
  allowed: string[];
  label: string;
  enabled?: boolean;
  enrollmentDecision?: { dogName: string };
}) {
  const registry = useContext(DecisionConfirmation);
  const retained = enrollmentDecision ? registry?.records[id] : undefined;
  const [original] = useState({ id, version });
  const [intent, setIntent] = useState(allowed[0] || options[0].value),
    [note, setNote] = useState("");
  const { ref, error, state, submit, busy } = useCourseForm(
      (previous, data) =>
        enrollmentDecision
          ? runEnrollmentDecision(
              registry,
              enrollmentDecision.dogName,
              previous,
              data,
              action,
            )
          : action(previous, data),
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
      <input
        type="hidden"
        name="expected_version"
        value={Math.max(state.version, retained?.version || 0)}
      />
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
  dogName = "Pies zgłoszenia",
}: {
  enrollment: CourseEnrollment;
  enabled: boolean;
  dogName?: string;
}) {
  const registry = useContext(DecisionConfirmation);
  const confirmed = registry?.records[enrollment.id];
  const terminal = ["rejected", "cancelled"].includes(enrollment.status);
  const [original, setOriginal] = useState<CourseEnrollment | null>(
    terminal ? enrollment : null,
  );
  // Mount a fresh editor only when there was no reopening editor before.
  // Once open, it keeps its original version even after another action refreshes
  // the page. Its own successful confirmation stays visible after restoration.
  if (
    terminal &&
    (!original ||
      (confirmed?.version === enrollment.version &&
        !confirmed.command &&
        original.version < enrollment.version))
  )
    setOriginal(enrollment);
  if (!original) return null;
  return (
    <details>
      <summary>Ponowna decyzja lub przywrócenie udziału</summary>
      <ReopeningForm
        key={original.version}
        enrollment={original}
        enabled={enabled && enrollment.status === original.status}
        dogName={dogName}
      />
    </details>
  );
}
function ReopeningForm({
  enrollment,
  enabled,
  dogName,
}: {
  enrollment: CourseEnrollment;
  enabled: boolean;
  dogName: string;
}) {
  const registry = useContext(DecisionConfirmation);
  const [original] = useState(enrollment);
  const intent = original.status === "rejected" ? "reconsider" : "restore";
  const [note, setNote] = useState("");
  const { ref, error, state, submit, busy } = useCourseForm(
    (previous, data) =>
      runEnrollmentDecision(
        registry,
        dogName,
        previous,
        data,
        reopenEnrollment,
      ),
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
        <section
          className={styles.locationFields}
          aria-labelledby={`${prefix}-place-heading`}
        >
          <h3 id={`${prefix}-place-heading`}>Miejsce tego spotkania</h3>
          <div className="field">
            <label htmlFor={`${prefix}-public`}>
              Miejsce — okolica przed przyjęciem
            </label>
            <textarea
              id={`${prefix}-public`}
              name="public_location"
              value={publicPlace}
              onChange={(e) => setPublicPlace(e.target.value)}
              placeholder="Np. Park Miejski w Warszawie"
              aria-describedby={`${prefix}-public-hint`}
              minLength={3}
              maxLength={300}
              rows={2}
              required
            />
            <small id={`${prefix}-public-hint`}>
              Tę okolicę opiekun zobaczy przed przyjęciem na kurs.
            </small>
          </div>
          <div className="field">
            <label htmlFor={`${prefix}-private`}>
              Dokładne miejsce zbiórki po przyjęciu
            </label>
            <textarea
              id={`${prefix}-private`}
              name="exact_location"
              value={privatePlace}
              onChange={(e) => setPrivatePlace(e.target.value)}
              placeholder="Np. wejście od ul. Parkowej, przy tablicy z mapą"
              aria-describedby={`${prefix}-private-hint`}
              minLength={3}
              maxLength={2000}
              rows={2}
              required
            />
            <small id={`${prefix}-private-hint`}>
              Adres i wskazówki dotarcia zobaczą tylko przyjęci opiekunowie.
            </small>
          </div>
        </section>
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
  const [confirmed, setConfirmed] = useState(attendance?.attendance || null);
  const [operation, setOperation] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [dirty, setDirty] = useState(false);
  const { ref, error, state, submit, busy } = useCourseForm(
    async (previous, data) => {
      const value = String(data.get("attendance"));
      setOperation(value);
      const result = await (correction ? correctAttendance : recordAttendance)(
        previous,
        data,
      );
      if (result.success) {
        setConfirmed(value as CourseAttendance["attendance"]);
        setDirty(false);
      }
      return result;
    },
    original.version,
  );
  return (
    <form
      ref={ref}
      action={submit}
      className={styles.rosterForm}
      aria-label={`${correction ? "Korekta obecności" : "Obecność"}: ${dogName}`}
      aria-busy={busy}
    >
      <input type="hidden" name="session_id" value={original.sessionId} />
      <input type="hidden" name="enrollment_id" value={original.enrollmentId} />
      <input type="hidden" name="expected_version" value={state.version} />
      <div className={styles.rosterIdentity}>
        <strong>{dogName}</strong>
        <span
          className={`badge ${confirmed === "present" ? "green" : confirmed === "absent" ? "red" : "neutral"}`}
        >
          {confirmed ? attendanceLabels[confirmed] : "Nieoznaczono"}
        </span>
      </div>
      <fieldset disabled={busy || !enabled} className={styles.fields}>
        <legend className="sr-only">Obecność</legend>
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
        <RosterActionButtons
          name="attendance"
          participantName={dogName}
          label={correction ? "Korekta obecności" : "Obecność"}
          selectedValue={confirmed}
          disabled={busy || !enabled}
          busy={busy}
          choices={[
            {
              value: "present",
              label: "Był",
              tone: "positive",
              disabled: confirmed === "present",
            },
            {
              value: "absent",
              label: "Nie był",
              tone: "negative",
              disabled: confirmed === "absent",
            },
          ]}
        />
        <button
          className={`ghost-button ${styles.rosterSecondary}`}
          name="attendance"
          value="excused"
          aria-label={`Usprawiedliwiony: ${dogName}`}
          disabled={confirmed === "excused"}
        >
          Usprawiedliwiony
        </button>
      </fieldset>
      {state.error && operation && (
        <p className="muted">
          Wybrana obecność:{" "}
          {attendanceLabels[operation as CourseAttendance["attendance"]]}.
        </p>
      )}
      <Feedback
        state={{ ...state, success: dirty || busy ? undefined : state.success }}
        error={error}
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
