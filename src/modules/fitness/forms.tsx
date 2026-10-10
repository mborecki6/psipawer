"use client";
import { useActionState, useEffect, useRef, useState } from "react";
import { useHydrated } from "@/components/use-hydrated";
import { usePersistentForm } from "@/components/use-persistent-form";
import { money } from "@/lib/domain";
import { warsawDateTimeInput } from "@/lib/time";
import type { Service } from "@/modules/services/types";
import type { FitnessPackage, FitnessSession } from "./types";
import { fitnessAttendanceLabels } from "./types";
import {
  requestFitness,
  changeFitnessPackage,
  saveFitnessSession,
  changeFitnessSession,
  type FitnessActionState,
} from "./actions";
import styles from "./fitness.module.css";
import { CalendarWarning } from "@/modules/calendar/warning";
import { BookingChoice } from "@/modules/calendar/booking-choice";
import type { BookingChoices } from "@/modules/calendar/booking-queries";

function Feedback({
  state,
  pending = false,
}: {
  state: FitnessActionState;
  pending?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (state.error) ref.current?.focus();
  }, [state]);
  return (
    <>
      <CalendarWarning warning={state.calendarWarning} pending={pending} />
      <div aria-live="polite" aria-atomic="true">
        {state.success && (
          <p role="status" className="alert green">
            {state.success}
          </p>
        )}
      </div>
      {state.error && (
        <div ref={ref} role="alert" tabIndex={-1} className="alert red">
          {state.error}
        </div>
      )}
    </>
  );
}
function CommandInputs({
  id,
  version,
  requestId,
}: {
  id: string;
  version: number;
  requestId: string;
}) {
  return (
    <>
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="expected_version" value={version} />
      <input type="hidden" name="request_id" value={requestId} />
    </>
  );
}
function RefreshLink({ href, success }: { href: string; success?: string }) {
  return (
    <a className="ghost-button" href={href}>
      {success
        ? "Wczytaj aktualny stan i kolejne działanie →"
        : "Wczytaj aktualny stan →"}
    </a>
  );
}
export function FitnessRequestForm({
  services,
  dogs,
  requestId,
  serviceId,
}: {
  services: Service[];
  dogs: { id: string; name: string; unavailable: boolean }[];
  requestId: string;
  serviceId?: string;
}) {
  const [original] = useState({ services, requestId });
  const [service, setService] = useState(
    services.some((s) => s.id === serviceId)
      ? serviceId!
      : services[0]?.id || "",
  );
  const [dog, setDog] = useState(dogs.find((d) => !d.unavailable)?.id || "");
  const [topic, setTopic] = useState(""),
    [availability, setAvailability] = useState("");
  const [state, submit, pending] = useActionState(requestFitness, {});
  const ref = usePersistentForm(),
    hydrated = useHydrated();
  const selected = original.services.find((s) => s.id === service);
  return (
    <form ref={ref} action={submit} className="stack">
      <Feedback state={state} />
      <fieldset className={styles.fields} disabled={!hydrated || pending}>
        <input type="hidden" name="id" value={original.requestId} />
        <input
          type="hidden"
          name="service_version"
          value={selected?.version || ""}
        />
        <label className="field">
          <span>Pakiet</span>
          <select
            name="service_id"
            value={service}
            onChange={(e) => setService(e.target.value)}
            required
          >
            {original.services.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        {selected && (
          <div className={styles.quote}>
            <strong>{money(selected.price_cents)} za cały pakiet</strong>
            <span>
              {selected.sessions_count} spotkania · każde{" "}
              {selected.duration_minutes} min · miejsce ustalane z prowadzącą
            </span>
            {selected.is_test_price && <span>Cena robocza do testów.</span>}
            <span>
              Zgłoszenie nie tworzy należności. Przyjęcie i terminy potwierdzi
              prowadząca.
            </span>
          </div>
        )}
        <label className="field">
          <span>Pies</span>
          <select
            name="dog_id"
            value={dog}
            onChange={(e) => setDog(e.target.value)}
            required
          >
            <option value="">Wybierz psa</option>
            {dogs.map((d) => (
              <option key={d.id} value={d.id} disabled={d.unavailable}>
                {d.name}
                {d.unavailable ? " — ma otwarty pakiet" : ""}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Cel spotkań</span>
          <textarea
            name="topic"
            rows={4}
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            minLength={3}
            maxLength={3000}
            required
          />
          <small className="field-hint">
            Opisz potrzeby psa. Zalecenia i ćwiczenia dobierze prowadząca.
          </small>
        </label>
        <label className="field">
          <span>Dostępność (opcjonalnie)</span>
          <textarea
            name="availability"
            rows={3}
            value={availability}
            onChange={(e) => setAvailability(e.target.value)}
            maxLength={1000}
          />
          <small className="field-hint">Np. wtorki i czwartki po 17:00.</small>
        </label>
        <label className={styles.confirmation}>
          <input type="checkbox" required />
          <span>Zapoznałem/am się z ceną i zakresem całego pakietu.</span>
        </label>
        <button className="primary-button" disabled={!selected || !dog}>
          {pending ? "Wysyłam…" : "Wyślij zgłoszenie fitness"}
        </button>
      </fieldset>
    </form>
  );
}
type Option = { value: string; label: string; disabled?: boolean };
export function FitnessCommandForm({
  pack,
  session,
  admin,
  requestId,
  refreshHref,
  now,
  allSessionsCompleted = false,
}: {
  pack: FitnessPackage;
  session?: FitnessSession;
  admin: boolean;
  requestId: string;
  refreshHref: string;
  now: string;
  allSessionsCompleted?: boolean;
}) {
  // Freeze the command and available choices. Revalidation must not silently
  // attach a new version to an already prepared or uncertain submission.
  const [original] = useState({
    id: session?.id || pack.id,
    version: session?.version || pack.version,
    requestId,
    pack,
    session,
  });
  const [options] = useState<Option[]>(() => {
    if (session) {
      if (pack.status === "active" && session.status === "scheduled")
        return [
          ...(session.starts_at &&
          Date.parse(session.starts_at) + session.duration_minutes * 60000 <=
            Date.parse(now)
            ? [{ value: "complete", label: "Zakończ i zapisz obecność" }]
            : []),
          { value: "cancel", label: "Odwołaj termin i umów ponownie" },
        ];
      if (
        session.status === "completed" &&
        ["active", "completed"].includes(pack.status)
      )
        return [
          { value: "correct", label: "Skoryguj obecność" },
          ...(pack.status === "active"
            ? [{ value: "reopen", label: "Przywróć spotkanie do umówienia" }]
            : []),
        ];
      return [];
    }
    if (!admin)
      return ["requested", "active"].includes(pack.status)
        ? [{ value: "cancel", label: "Zgłoś rezygnację z pakietu" }]
        : [];
    if (pack.status === "requested")
      return [
        { value: "accept", label: "Przyjmij pakiet" },
        { value: "reject", label: "Nie przyjmuj zgłoszenia" },
        { value: "cancel", label: "Zapisz rezygnację" },
      ];
    if (pack.status === "active")
      return [
        {
          value: "complete",
          label: "Zakończ cały pakiet",
          disabled: !allSessionsCompleted,
        },
        { value: "cancel", label: "Zapisz rezygnację lub odwołanie" },
      ];
    if (pack.status === "completed")
      return [{ value: "resume", label: "Wznów pakiet" }];
    return [
      {
        value: pack.accepted_at ? "restore" : "reconsider",
        label: pack.accepted_at
          ? "Przywróć przyjęty pakiet"
          : "Rozpatrz zgłoszenie ponownie",
      },
    ];
  });
  const [intent, setIntent] = useState(""),
    [note, setNote] = useState("");
  const [attendance, setAttendance] = useState<string>(
    session?.attendance || "present",
  );
  const [state, submit, pending] = useActionState(
    session ? changeFitnessSession : changeFitnessPackage,
    {},
  );
  const ref = usePersistentForm(),
    hydrated = useHydrated();
  const attendanceRequired =
    !!session && ["complete", "correct"].includes(intent);
  return (
    <form ref={ref} action={submit} className="stack">
      <Feedback state={state} />
      {options.length ? (
        <fieldset
          className={styles.fields}
          disabled={!hydrated || pending || !!state.success}
        >
          <CommandInputs
            id={original.id}
            version={original.version}
            requestId={original.requestId}
          />
          <label className="field">
            <span>
              {session ? "Działanie dla spotkania" : "Działanie dla pakietu"}
            </span>
            <select
              name="intent"
              value={intent}
              onChange={(e) => setIntent(e.target.value)}
              required
            >
              <option value="">Wybierz działanie</option>
              {options.map((o) => (
                <option key={o.value} value={o.value} disabled={o.disabled}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
          {!session &&
            original.pack.status === "active" &&
            !allSessionsCompleted && (
              <p className="muted">
                Pakiet zakończysz po obsłużeniu wszystkich spotkań. Ich
                obecności zapiszesz przy poszczególnych terminach.
              </p>
            )}
          {attendanceRequired && (
            <label className="field">
              <span>Obecność psa</span>
              <select
                name="attendance"
                value={attendance}
                onChange={(e) => setAttendance(e.target.value)}
              >
                {Object.entries(fitnessAttendanceLabels).map(
                  ([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ),
                )}
              </select>
            </label>
          )}
          {intent === "complete" && session && (
            <p className={styles.quote}>
              Zakończenie liczy to spotkanie jako obsłużone także przy
              nieobecności lub usprawiedliwieniu. Nie zmienia opłaty. Jeśli
              ustalasz spotkanie zastępcze, później jawnie przywróć to spotkanie
              do umówienia.
            </p>
          )}
          {intent === "complete" && !session && (
            <p className="muted">
              Najpierw zakończ wszystkie spotkania. Nieopłacona należność
              pozostanie w rozliczeniach.
            </p>
          )}
          {intent === "cancel" && (
            <p className="muted">
              {session
                ? "Termin zostanie zwolniony. Spotkanie wróci do umówienia, a opłata za pakiet pozostanie bez zmian."
                : "Pozostałe terminy zostaną odwołane. Wpłaty i zakończone spotkania pozostaną; końcową należność prowadząca uzgodni osobno."}
            </p>
          )}
          {intent === "restore" && (
            <p className="muted">
              Przywrócenie obejmuje pełną pierwotną cenę{" "}
              {money(original.pack.agreed_price_cents)}. Zakończone spotkania,
              wpłaty i zwroty pozostają. Pozostałe terminy ustalisz ponownie.
            </p>
          )}
          <label className="field">
            <span>
              Powód lub notatka
              {["accept", "complete"].includes(intent) ? " (opcjonalnie)" : ""}
            </span>
            <textarea
              name="note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={3}
              minLength={
                ["accept", "complete"].includes(intent) ? undefined : 3
              }
              maxLength={3000}
              required={!["accept", "complete"].includes(intent)}
            />
            <small className="field-hint">
              Opis będzie widoczny także dla opiekuna.
            </small>
          </label>
          <label className={styles.confirmation}>
            <input type="checkbox" required />
            <span>Potwierdzam wybrane działanie i jego skutki.</span>
          </label>
          <button className="primary-button">
            {pending ? "Zapisuję…" : "Zapisz działanie"}
          </button>
        </fieldset>
      ) : (
        <p className="muted">
          {session
            ? "Brak dostępnej zmiany spotkania w tym stanie pakietu."
            : "To zgłoszenie nie wymaga działania z Twojej strony."}
        </p>
      )}
      <RefreshLink href={refreshHref} success={state.success} />
    </form>
  );
}
export function FitnessScheduleForm({
  session,
  enabled,
  requestId,
  refreshHref,
  booking,
}: {
  session: FitnessSession;
  enabled: boolean;
  requestId: string;
  refreshHref: string;
  booking?: BookingChoices;
}) {
  const [original] = useState({
    id: session.id,
    version: session.version,
    requestId,
    status: session.status,
  });
  const [date, setDate] = useState(
    session.starts_at ? warsawDateTimeInput(session.starts_at) : "",
  );
  const [location, setLocation] = useState(
      session.fitness_session_private_details?.exact_location || "",
    ),
    [note, setNote] = useState("");
  const [state, submit, pending] = useActionState(saveFitnessSession, {});
  const ref = usePersistentForm(),
    hydrated = useHydrated();
  return (
    <form ref={ref} action={submit} className="stack">
      <Feedback state={state} pending={!hydrated || pending} />
      {booking && (
        <BookingChoice
          data={booking}
          appointmentId={original.id}
          pending={!hydrated || pending || !enabled}
          saved={!!state.success}
        />
      )}
      <fieldset
        className={styles.fields}
        disabled={!hydrated || pending || !enabled || !!state.success}
      >
        <CommandInputs
          id={original.id}
          version={original.version}
          requestId={original.requestId}
        />
        <label className="field">
          <span>Termin spotkania (czas polski)</span>
          <input
            name="starts_at"
            type="datetime-local"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            required
          />
        </label>
        <p className="muted">
          Czas: {session.duration_minutes} min. Termin nie może nakładać się na
          inne zajęcia lub blokadę.
        </p>
        <label className="field">
          <span>Dokładne miejsce spotkania</span>
          <textarea
            name="location"
            rows={3}
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            minLength={3}
            maxLength={2000}
            required
          />
          <small className="field-hint">
            Widoczne tylko dla prowadzącej i uprawnionego opiekuna pakietu.
          </small>
        </label>
        <label className="field">
          <span>
            {original.status === "scheduled"
              ? "Powód zmiany terminu"
              : "Notatka (opcjonalnie)"}
          </span>
          <textarea
            name="note"
            rows={3}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            minLength={original.status === "scheduled" ? 3 : undefined}
            maxLength={3000}
            required={original.status === "scheduled"}
          />
          <small className="field-hint">
            Notatka będzie widoczna także dla opiekuna. Dokładne miejsce wpisz w
            osobnym polu powyżej.
          </small>
        </label>
        <button className="primary-button">
          {pending ? "Zapisuję…" : "Zapisz termin fitness"}
        </button>
      </fieldset>
      <RefreshLink href={refreshHref} success={state.success} />
    </form>
  );
}
