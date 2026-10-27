"use client";

import {
  useActionState,
  useEffect,
  useId,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import { Check, CircleAlert, CircleCheck, LoaderCircle } from "lucide-react";
import type { ActionState } from "./action-form";
import { withFormActionRecovery } from "./form-action-recovery";
import { useHydrated } from "./use-hydrated";
import { RosterActionButtons } from "./roster-action-buttons";
import { ProgressiveDetails, revealFormFeedback } from "./progressive-details";
import { decideRegistration, markAttendance } from "@/lib/data/actions";
import { transitions, type RegistrationStatus } from "@/lib/domain";
import styles from "./walks.module.css";

type Command = {
  kind: "decision" | "attendance";
  value: string;
  note: string;
};

const attendanceLabels: Record<string, string> = {
  pending: "Nieoznaczono",
  present: "Był",
  no_show: "Nie był · płatne",
  absent: "Usprawiedliwiono",
};
const decisionLabels: Record<string, string> = {
  accepted: "Przyjmij",
  rejected: "Nie przyjmuj",
  waitlisted: "Przenieś do rezerwy",
  pending: "Wróć do decyzji",
  cancelled_on_time: "Rezygnacja bez opłaty",
  cancelled_late: "Rezygnacja płatna",
};

/** A stable row owns both actions and acknowledgement, even after regrouping. */
export function WalkRosterActions({
  id,
  dogName,
  status,
  attendance,
  walkStatus,
  hasStarted,
  hasPackage,
  price,
  heading,
  children,
}: {
  id: string;
  dogName: string;
  status: RegistrationStatus;
  attendance: string;
  walkStatus: string;
  hasStarted: boolean;
  hasPackage: boolean;
  price: string;
  heading: ReactNode;
  children: ReactNode;
}) {
  const hydrated = useHydrated();
  const [panel, setPanel] = useState<Omit<Command, "note"> | null>(null);
  const [note, setNote] = useState("");
  const [command, setCommand] = useState<Command | null>(null);
  const submitting = useRef(false);
  const feedback = useRef<HTMLDivElement>(null);
  const noteId = useId();
  const [state, formAction, pending] = useActionState(
    async (previous: ActionState, data: FormData) => {
      const sent: Command = {
        kind: data.get("kind") === "attendance" ? "attendance" : "decision",
        value: String(data.get("attendance") ?? data.get("status") ?? ""),
        note: String(data.get("note") ?? ""),
      };
      setCommand(sent);
      try {
        const payload = new FormData();
        payload.set("id", id);
        payload.set(
          sent.kind === "attendance" ? "attendance" : "status",
          sent.value,
        );
        if (sent.kind === "decision") payload.set("note", sent.note);
        const result = await withFormActionRecovery(
          sent.kind === "attendance" ? markAttendance : decideRegistration,
        )(previous, payload);
        if (
          result.success &&
          !result.error &&
          !Object.values(result.fields || {}).some(
            (messages) => messages.length,
          )
        ) {
          setPanel(null);
          setNote("");
        }
        return result;
      } finally {
        submitting.current = false;
      }
    },
    {},
  );
  const errors = Object.values(state.fields || {}).flat();
  const busy = !hydrated || pending;
  const hasError = Boolean(state.error || errors.length);
  const canDecide =
    !hasStarted && !["cancelled", "completed"].includes(walkStatus);
  const decisionOptions = transitions[status].filter(
    (value) => value !== "withdrawn",
  );
  const admission = canDecide && ["pending", "waitlisted"].includes(status);

  useEffect(() => {
    const invalidFields = Object.values(state.fields || {}).some(
      (messages) => messages.length,
    );
    if (state.error || state.success || invalidFields) {
      revealFormFeedback(feedback.current);
      if (state.error || invalidFields) feedback.current?.focus();
    }
  }, [state]);

  function choose(kind: Command["kind"], value: string) {
    if (!busy && !submitting.current) setPanel({ kind, value });
  }
  function guardSubmit(event: FormEvent<HTMLFormElement>) {
    if (busy || submitting.current) event.preventDefault();
    else submitting.current = true;
  }
  function decisionEffect(value: string) {
    if (value === "cancelled_late")
      return hasPackage
        ? "Płatna rezygnacja zwalnia miejsce i zużywa wejście z pakietu. Historia zgłoszenia zostaje zachowana."
        : `Płatna rezygnacja zwalnia miejsce, a opłata ${price} pozostaje należna. Historia zgłoszenia zostaje zachowana.`;
    if (value === "accepted")
      return hasPackage
        ? "Przyjęcie potwierdza miejsce i rezerwuje wejście z pakietu."
        : `Przyjęcie potwierdza miejsce. Opłata za spacer: ${price}.`;
    return `${status === "accepted" ? "Pies przestanie należeć do bieżącego składu. " : ""}${hasPackage ? "Zarezerwowane wejście wróci do pakietu." : "Zgłoszenie nie będzie wymagało opłaty za spacer."} Wcześniejszą wpłatę rozlicz osobno w finansach — bez automatycznego zwrotu.${value === "waitlisted" ? " Rezerwa wymaga osobnego przyjęcia; zwolnienie miejsca nie przyjmuje jej automatycznie." : ""}`;
  }
  function attendanceEffect(value: string) {
    if (value === "absent")
      return hasPackage
        ? "Usprawiedliwienie oddaje wejście do pakietu. Nie zwraca automatycznie wcześniejszej wpłaty."
        : "Usprawiedliwienie zwalnia z opłaty za spacer. Wcześniejszą wpłatę rozlicz osobno w finansach — bez automatycznego zwrotu.";
    if (value === "pending")
      return hasPackage
        ? "Wyczyszczenie oznaczenia ponownie rezerwuje wejście z pakietu. Obecność wróci do stanu „Nieoznaczono”; historia zmiany pozostanie."
        : "Wyczyszczenie oznaczenia przywraca stan „Nieoznaczono”. Opłata za przyjęte miejsce pozostaje należna; historia zmiany pozostanie.";
    return hasPackage
      ? "Obecność i nieobecność płatna zużywają wejście z pakietu. Po usprawiedliwieniu korekta wymaga dostępnego wejścia. Historia zmiany pozostaje."
      : `Obecność i nieobecność płatna oznaczają opłatę ${price}. Otrzymana wpłata pozostaje w rozliczeniu. Historia zmiany pozostaje.`;
  }

  return (
    <div className={styles.rosterRow} aria-busy={pending}>
      <fieldset className={styles.rowControls} disabled={busy}>
        <legend className="sr-only">Skład i obecność: {dogName}</legend>
        {heading}
        {status === "accepted" && (
          <p className={styles.inRoster}>
            <Check size={18} aria-hidden="true" /> W składzie
          </p>
        )}
        {admission && (
          <form
            action={formAction}
            onSubmit={guardSubmit}
            aria-label={`Przyjęcie: ${dogName}`}
            className="form-stack"
          >
            <input type="hidden" name="id" value={id} />
            <input type="hidden" name="kind" value="decision" />
            <p className={styles.rosterHint}>{decisionEffect("accepted")}</p>
            <RosterActionButtons
              name="status"
              participantName={dogName}
              label="Przyjęcie"
              busy={busy}
              choices={[
                { value: "accepted", label: "Przyjmij", tone: "positive" },
                {
                  value: "rejected",
                  label: "Nie przyjmuj",
                  tone: "negative",
                  type: "button",
                },
              ]}
              onChoose={(value) => choose("decision", value)}
            />
            {!panel ? (
              <ProgressiveDetails
                label="Dodaj wiadomość dla opiekuna"
                className={styles.rowDetails}
              >
                <label className="field" htmlFor={`${noteId}-message`}>
                  <span>Wiadomość dla opiekuna (opcjonalna)</span>
                  <textarea
                    id={`${noteId}-message`}
                    name="note"
                    value={note}
                    onChange={(event) => setNote(event.target.value)}
                    maxLength={2000}
                    rows={2}
                  />
                </label>
              </ProgressiveDetails>
            ) : (
              <input type="hidden" name="note" value={note} />
            )}
          </form>
        )}
        {canDecide &&
          decisionOptions.length > 0 &&
          (status === "accepted" ? (
            <ProgressiveDetails
              label="Zmiana składu lub rezygnacja"
              className={styles.rowDetails}
            >
              <p className="muted">
                Wybierz nazwaną zmianę. Przed zapisem zobaczysz jej skutek dla
                miejsca i rozliczenia.
              </p>
              <div className={styles.secondaryChoices}>
                {decisionOptions.map((value) => (
                  <button
                    key={value}
                    type="button"
                    className="secondary-button"
                    aria-label={`${value === "rejected" ? "Cofnij przyjęcie i odmów" : decisionLabels[value]}: ${dogName}`}
                    onClick={() => choose("decision", value)}
                  >
                    {value === "rejected"
                      ? "Cofnij przyjęcie i odmów"
                      : decisionLabels[value]}
                  </button>
                ))}
              </div>
            </ProgressiveDetails>
          ) : (
            <div className={styles.secondaryChoices}>
              {decisionOptions
                .filter((value) => !["accepted", "rejected"].includes(value))
                .map((value) => (
                  <button
                    key={value}
                    type="button"
                    className="secondary-button"
                    aria-label={`${decisionLabels[value]}: ${dogName}`}
                    onClick={() => choose("decision", value)}
                  >
                    {decisionLabels[value]}
                  </button>
                ))}
            </div>
          ))}
        {status === "accepted" && walkStatus !== "cancelled" && (
          <div className={styles.attendanceActions}>
            <p className={styles.attendanceStatus}>
              Obecność:{" "}
              <strong>{attendanceLabels[attendance] ?? "Nieoznaczono"}</strong>
            </p>
            {!hasStarted ? (
              <p className="muted">
                Obecność oznaczysz po rozpoczęciu spaceru.
              </p>
            ) : (
              <>
                <form
                  action={formAction}
                  onSubmit={guardSubmit}
                  aria-label={`Obecność: ${dogName}`}
                >
                  <input type="hidden" name="id" value={id} />
                  <input type="hidden" name="kind" value="attendance" />
                  <RosterActionButtons
                    name="attendance"
                    participantName={dogName}
                    label="Obecność"
                    selectedValue={attendance}
                    busy={busy}
                    choices={[
                      {
                        value: "present",
                        label: "Był",
                        tone: "positive",
                        disabled: attendance === "present",
                        type: attendance === "pending" ? "submit" : "button",
                      },
                      {
                        value: "no_show",
                        label: "Nie był · płatne",
                        tone: "negative",
                        disabled: attendance === "no_show",
                        type: attendance === "pending" ? "submit" : "button",
                      },
                    ]}
                    onChoose={(value) => choose("attendance", value)}
                  />
                </form>
                <p className={styles.rosterHint}>
                  {hasPackage
                    ? "Był i Nie był · płatne zużywają wejście z pakietu."
                    : `Był i Nie był · płatne zachowują opłatę ${price}.`}
                </p>
                <button
                  type="button"
                  className="secondary-button"
                  disabled={attendance === "absent"}
                  aria-label={`Usprawiedliw: ${dogName}`}
                  onClick={() => choose("attendance", "absent")}
                >
                  Usprawiedliw
                </button>
                {attendance !== "pending" && (
                  <ProgressiveDetails
                    label="Korekta obecności"
                    className={styles.rowDetails}
                  >
                    <button
                      type="button"
                      className="secondary-button"
                      aria-label={`Wyczyść oznaczenie: ${dogName}`}
                      onClick={() => choose("attendance", "pending")}
                    >
                      Wyczyść oznaczenie
                    </button>
                  </ProgressiveDetails>
                )}
              </>
            )}
          </div>
        )}
        {panel && (
          <form
            action={formAction}
            onSubmit={guardSubmit}
            aria-label={`${panel.kind === "attendance" ? "Korekta obecności" : "Zmiana zgłoszenia"}: ${dogName}`}
            className={`form-stack ${styles.changePanel}`}
          >
            <input type="hidden" name="id" value={id} />
            <input type="hidden" name="kind" value={panel.kind} />
            <input
              type="hidden"
              name={panel.kind === "attendance" ? "attendance" : "status"}
              value={panel.value}
            />
            <strong>
              {panel.kind === "attendance"
                ? attendanceLabels[panel.value]
                : panel.value === "rejected" && status === "accepted"
                  ? "Cofnij przyjęcie i odmów"
                  : decisionLabels[panel.value]}
            </strong>
            <p className={styles.rosterHint}>
              {panel.kind === "attendance"
                ? attendanceEffect(panel.value)
                : decisionEffect(panel.value)}
            </p>
            {panel.kind === "decision" && (
              <label className="field" htmlFor={`${noteId}-reason`}>
                <span>Wiadomość dla opiekuna (opcjonalna)</span>
                <textarea
                  id={`${noteId}-reason`}
                  name="note"
                  value={note}
                  onChange={(event) => setNote(event.target.value)}
                  maxLength={2000}
                  rows={3}
                />
              </label>
            )}
            <div className={styles.secondaryChoices}>
              <button
                type="submit"
                className="primary-button"
                aria-label={`${panel.kind === "attendance" ? (panel.value === "absent" ? "Potwierdź usprawiedliwienie" : "Zapisz korektę") : "Zapisz zmianę"}: ${dogName}`}
              >
                {panel.kind === "attendance"
                  ? panel.value === "absent"
                    ? "Potwierdź usprawiedliwienie"
                    : "Zapisz korektę"
                  : "Zapisz zmianę"}
              </button>
              <button
                type="button"
                className="ghost-button"
                onClick={() => setPanel(null)}
              >
                Anuluj zmianę
              </button>
            </div>
          </form>
        )}
        {children}
      </fieldset>
      <div
        ref={feedback}
        tabIndex={hasError ? -1 : undefined}
        role={hasError ? "alert" : undefined}
        className={styles.rowFeedback}
        aria-label={`Wynik zapisu: ${dogName}`}
      >
        {!pending && hasError && (
          <div className="alert red">
            <CircleAlert aria-hidden="true" />
            <div>
              {state.error || "Sprawdź dane."}
              {errors.length > 0 && (
                <ul>
                  {errors.map((error, index) => (
                    <li key={index}>{error}</li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}
        <div aria-live="polite" aria-atomic="true">
          {pending ? (
            <p role="status">
              <LoaderCircle className="button-spinner" aria-hidden="true" />{" "}
              Zapisuję: {dogName}…
            </p>
          ) : state.success && !hasError ? (
            <p role="status" className="alert green">
              <CircleCheck aria-hidden="true" />
              {dogName}: {state.success}
            </p>
          ) : null}
        </div>
      </div>
      {hasError && command && (
        <form
          action={formAction}
          onSubmit={guardSubmit}
          aria-label={`Ponowienie zapisu: ${dogName}`}
          className="form-stack"
        >
          <input type="hidden" name="id" value={id} />
          <input type="hidden" name="kind" value={command.kind} />
          <input
            type="hidden"
            name={command.kind === "attendance" ? "attendance" : "status"}
            value={command.value}
          />
          <input type="hidden" name="note" value={command.note} />
          <p className={styles.rosterHint}>
            Niepotwierdzona operacja:{" "}
            {command.kind === "attendance"
              ? attendanceLabels[command.value]
              : decisionLabels[command.value]}
            .
            {command.note && (
              <>
                {" "}
                Powód / wiadomość:{" "}
                <span className="preserve-lines">{command.note}</span>.
              </>
            )}{" "}
            Sprawdź aktualny stan przed ponowieniem.
          </p>
          <button type="submit" className="secondary-button" disabled={busy}>
            Ponów ten sam zapis: {dogName}
          </button>
        </form>
      )}
    </div>
  );
}
