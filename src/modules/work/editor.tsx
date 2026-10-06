"use client";
import { useActionState, useEffect, useId, useRef, useState } from "react";
import { changeFollowUp, type FollowUpState } from "./actions";
import { followUpStates, type FollowUp } from "./types";
import styles from "./work.module.css";
import { useHydrated } from "@/components/use-hydrated";
import { usePersistentForm } from "@/components/use-persistent-form";
export function FollowUpEditor({
  item,
  today,
}: {
  item: FollowUp;
  today: string;
}) {
  const hydrated = useHydrated();
  const form = usePersistentForm();
  const [original] = useState(item);
  const [intent, setIntent] = useState(
    item.status === "open" ? "completed" : "reopened",
  );
  const [due, setDue] = useState(item.due_on),
    [note, setNote] = useState("");
  const [state, action, pending] = useActionState(
    async (previous: FollowUpState, form: FormData) => {
      const result = await changeFollowUp(previous, form);
      if (result.success) {
        setIntent(result.status === "open" ? "completed" : "reopened");
        setNote("");
      }
      return {
        ...result,
        version: result.version ?? previous.version,
        status: result.status ?? previous.status,
      };
    },
    { version: original.version, status: original.status },
  );
  const prefix = useId(),
    error = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (state.error) error.current?.focus();
  }, [state]);
  const open = state.status === "open";
  const dated = intent === "rescheduled" || intent === "reopened";
  return (
    <form
      action={action}
      className="form-stack"
      aria-busy={!hydrated || pending}
      ref={form}
    >
      <input name="id" type="hidden" value={original.id} />
      <input name="expected_version" type="hidden" value={state.version} />
      <p className="muted">
        Status: {followUpStates[state.status || original.status]}
      </p>
      <fieldset className={styles.fields} disabled={!hydrated || pending}>
        <legend className="sr-only">Obsługa kontaktu kontrolnego</legend>
        <div className="field">
          <label htmlFor={`${prefix}-intent`}>Co chcesz zrobić?</label>
          <select
            id={`${prefix}-intent`}
            name="intent"
            value={intent}
            onChange={(e) => setIntent(e.target.value)}
          >
            {open ? (
              <>
                <option value="completed">Kontakt zakończony</option>
                <option value="rescheduled">Przełóż kontakt</option>
                <option value="cancelled">Odwołaj kontakt</option>
              </>
            ) : (
              <option value="reopened">Zaplanuj kontakt ponownie</option>
            )}
          </select>
        </div>
        {dated && (
          <div className="field">
            <label htmlFor={`${prefix}-due`}>Nowa data kontaktu</label>
            <input
              id={`${prefix}-due`}
              name="due_on"
              type="date"
              value={due}
              onChange={(e) => setDue(e.target.value)}
              min={today}
              max="2099-12-31"
              required
            />
          </div>
        )}
        <div className="field">
          <label htmlFor={`${prefix}-note`}>
            {intent === "completed"
              ? "Co ustalono? (notatka prywatna)"
              : "Powód zmiany (notatka prywatna)"}
          </label>
          <textarea
            id={`${prefix}-note`}
            name="note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            minLength={3}
            maxLength={2000}
            rows={4}
            required
          />
          <small>
            Opiekun widzi datę i status kontaktu. Treść tej notatki pozostaje
            tylko dla zespołu.
          </small>
        </div>
      </fieldset>
      {state.error && (
        <div className="alert red" role="alert" ref={error} tabIndex={-1}>
          {state.error}
        </div>
      )}
      {state.success && (
        <div className="alert green" role="status">
          {state.success}
        </div>
      )}
      <button className="primary-button" disabled={!hydrated || pending}>
        {!hydrated
          ? "Przygotowuję formularz…"
          : pending
            ? "Zapisuję…"
            : "Zapisz obsługę kontaktu"}
      </button>
    </form>
  );
}
