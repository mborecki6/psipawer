"use client";
import { useActionState, useEffect, useId, useRef, useState } from "react";
import { useHydrated } from "@/components/use-hydrated";
import { usePersistentForm } from "@/components/use-persistent-form";
import { saveCalendarResource, type BlockState } from "./actions";
import type { CalendarResource } from "./types";
import styles from "./calendar.module.css";

function ResourceEditor({
  id,
  initial,
  onNew,
}: {
  id: string;
  initial?: CalendarResource;
  onNew?: () => void;
}) {
  const hydrated = useHydrated();
  const form = usePersistentForm();
  const [original] = useState({ id, version: initial?.version || 0 });
  const [values, setValues] = useState({
    name: initial?.name || "",
    exclusive: initial?.exclusive ?? true,
    active: initial?.active ?? true,
  });
  const [state, action, pending] = useActionState(
    async (previous: BlockState, form: FormData) => {
      const result = await saveCalendarResource(previous, form);
      return { ...result, version: result.version ?? previous.version };
    },
    { version: original.version },
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
      <input type="hidden" name="id" value={original.id} />
      <input type="hidden" name="expected_version" value={state.version} />
      <input type="hidden" name="exclusive" value={String(values.exclusive)} />
      <input type="hidden" name="active" value={String(values.active)} />
      <fieldset className={styles.fields} disabled={!hydrated || pending}>
        <legend className="sr-only">Miejsce prowadzenia zajęć</legend>
        <div className="field">
          <label htmlFor={`${prefix}-name`}>Nazwa miejsca</label>
          <input
            id={`${prefix}-name`}
            name="name"
            value={values.name}
            onChange={(event) =>
              setValues((v) => ({ ...v, name: event.target.value }))
            }
            required
            minLength={3}
            maxLength={160}
            placeholder="Np. sala fitness · lokalizacja centrum"
          />
        </div>
        <label className={styles.dayToggle}>
          <input
            type="checkbox"
            checked={values.exclusive}
            onChange={(event) =>
              setValues((v) => ({ ...v, exclusive: event.target.checked }))
            }
          />
          Jedne zajęcia naraz (np. wspólna sala)
        </label>
        <label className={styles.dayToggle}>
          <input
            type="checkbox"
            checked={values.active}
            onChange={(event) =>
              setValues((v) => ({ ...v, active: event.target.checked }))
            }
          />
          Dostępne do nowych rezerwacji
        </label>
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
      <div className={styles.controls}>
        <button className="primary-button" disabled={!hydrated || pending}>
          {pending
            ? "Zapisuję…"
            : state.version
              ? "Zapisz miejsce"
              : "Dodaj miejsce"}
        </button>
        {Boolean(state.version) && onNew && (
          <button
            type="button"
            className="ghost-button"
            disabled={!hydrated || pending}
            onClick={onNew}
          >
            Dodaj kolejne miejsce
          </button>
        )}
      </div>
    </form>
  );
}

export function CalendarResourcesEditor({
  resources,
  newResourceId,
}: {
  resources: CalendarResource[];
  newResourceId: string;
}) {
  const [id, setId] = useState(newResourceId);
  return (
    <div className="stack">
      {resources.map((resource) => (
        <details key={resource.id} className="card pad">
          <summary className={styles.resourceSummary}>
            {resource.name}
            {!resource.active
              ? " · nieaktywne"
              : resource.exclusive
                ? " · jedne zajęcia naraz"
                : " · zajęcia równoległe"}
          </summary>
          <ResourceEditor id={resource.id} initial={resource} />
        </details>
      ))}
      <details className="card pad">
        <summary className={styles.resourceSummary}>Dodaj miejsce</summary>
        <ResourceEditor
          key={id}
          id={id}
          onNew={() => setId(crypto.randomUUID())}
        />
      </details>
    </div>
  );
}
