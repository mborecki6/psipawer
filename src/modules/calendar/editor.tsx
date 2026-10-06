"use client";
import { useActionState, useEffect, useId, useRef, useState } from "react";
import { saveBlock, cancelBlock, type BlockState } from "./actions";
import { warsawDateTimeInput } from "@/lib/time";
import type { Appointment } from "./types";
import styles from "./calendar.module.css";
import { useHydrated } from "@/components/use-hydrated";
export function BlockEditor({
  id,
  initial,
  onNew,
}: {
  id: string;
  initial?: Appointment;
  onNew?: () => void;
}) {
  const hydrated = useHydrated();
  const [original] = useState({ id, version: initial?.version || 0 });
  const [values, setValues] = useState({
    title: initial?.title || "",
    starts_at: initial ? warsawDateTimeInput(initial.starts_at) : "",
    ends_at: initial ? warsawDateTimeInput(initial.ends_at) : "",
  });
  const [state, action, pending] = useActionState(
    async (previous: BlockState, form: FormData) => {
      const result =
        form.get("intent") === "cancel"
          ? await cancelBlock(previous, form)
          : await saveBlock(previous, form);
      return { ...result, version: result.version ?? previous.version };
    },
    { version: original.version },
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
      onChange: (e: React.ChangeEvent<HTMLInputElement>) =>
        setValues((v) => ({ ...v, [name]: e.target.value })),
    };
  }
  return (
    <form
      action={action}
      className="form-stack"
      aria-busy={!hydrated || pending}
    >
      <input type="hidden" name="id" value={original.id} />
      <input type="hidden" name="expected_version" value={state.version} />
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
        <div className="field">
          <label htmlFor={`${prefix}-starts_at`}>Od (czas polski)</label>
          <input {...field("starts_at")} type="datetime-local" required />
        </div>
        <div className="field">
          <label htmlFor={`${prefix}-ends_at`}>Do (czas polski)</label>
          <input {...field("ends_at")} type="datetime-local" required />
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

export function CreateBlockEditor({ id }: { id: string }) {
  const [currentId, setCurrentId] = useState(id);
  return (
    <BlockEditor
      key={currentId}
      id={currentId}
      onNew={() => setCurrentId(crypto.randomUUID())}
    />
  );
}
