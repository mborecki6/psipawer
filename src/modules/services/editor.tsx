"use client";
import { useState, useActionState, useEffect, useRef, useId } from "react";
import { updateService, type ServiceState } from "./actions";
import type { Service } from "./types";
import styles from "./services.module.css";
import { usePersistentForm } from "@/components/use-persistent-form";
import { useHydrated } from "@/components/use-hydrated";
export function ServiceEditor({ service }: { service: Service }) {
  const hydrated = useHydrated();
  const form = usePersistentForm();
  const [original] = useState(service);
  const [values, setValues] = useState({
    name: service.name,
    description: service.description,
    price: (service.price_cents / 100).toFixed(2).replace(".", ","),
    price_unit: service.price_unit,
    duration_minutes:
      service.duration_minutes === null ? "" : String(service.duration_minutes),
    sessions_count:
      service.sessions_count === null ? "" : String(service.sessions_count),
    active: String(service.active),
    is_test_price: String(service.is_test_price),
  });
  const [state, action, pending] = useActionState(
    async (previous: ServiceState, form: FormData) => {
      const result = await updateService(previous, form);
      return { ...result, version: result.version ?? previous.version };
    },
    { version: original.version },
  );
  const id = useId();
  const error = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (state.error) error.current?.focus();
  }, [state]);
  const field = (name: keyof typeof values) => ({
    id: `${id}-${name}`,
    name,
    value: values[name],
    onChange: (
      e: React.ChangeEvent<
        HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement
      >,
    ) => setValues((v) => ({ ...v, [name]: e.target.value })),
  });
  return (
    <form
      ref={form}
      action={action}
      className="form-stack"
      aria-busy={!hydrated || pending}
    >
      <input type="hidden" name="id" value={original.id} />
      <input type="hidden" name="expected_version" value={state.version} />
      <fieldset className={styles.fields} disabled={!hydrated || pending}>
        <legend className="sr-only">Dane usługi i cena</legend>
        <div className="field">
          <label htmlFor={`${id}-name`}>Nazwa usługi</label>
          <input {...field("name")} required minLength={3} maxLength={160} />
        </div>
        <div className="field">
          <label htmlFor={`${id}-description`}>Krótki opis</label>
          <textarea {...field("description")} rows={3} maxLength={2000} />
        </div>
        <div className={styles.twoColumns}>
          <div className="field">
            <label htmlFor={`${id}-price`}>Cena (zł)</label>
            <input
              {...field("price")}
              inputMode="decimal"
              required
              maxLength={8}
            />
            <small>Kwota za jednostkę podaną obok.</small>
          </div>
          <div className="field">
            <label htmlFor={`${id}-price_unit`}>Za co płaci opiekun?</label>
            <input
              {...field("price_unit")}
              required
              minLength={3}
              maxLength={80}
            />
          </div>
        </div>
        <div className={styles.twoColumns}>
          <div className="field">
            <label htmlFor={`${id}-duration_minutes`}>
              Minuty jednego spotkania
            </label>
            <input
              {...field("duration_minutes")}
              type="number"
              min={15}
              max={original.booking_flow === "consultation" ? 240 : 480}
              required={original.booking_flow === "consultation"}
            />
          </div>
          <div className="field">
            <label htmlFor={`${id}-sessions_count`}>Liczba spotkań</label>
            <input
              {...field("sessions_count")}
              type="number"
              min={1}
              max={original.booking_flow === "consultation" ? 1 : 100}
              required={original.booking_flow === "consultation"}
            />
          </div>
        </div>
        <div className={styles.twoColumns}>
          <div className="field">
            <label htmlFor={`${id}-active`}>Widoczność oferty</label>
            <select {...field("active")}>
              <option value="true">Aktywna</option>
              <option value="false">Ukryta dla nowych zgłoszeń</option>
            </select>
          </div>
          <div className="field">
            <label htmlFor={`${id}-is_test_price`}>Rodzaj ceny</label>
            <select {...field("is_test_price")}>
              <option value="true">Robocza — do testów</option>
              <option value="false">Docelowa</option>
            </select>
          </div>
        </div>
      </fieldset>
      {state.error && (
        <div role="alert" className="alert red" ref={error} tabIndex={-1}>
          {state.error}
        </div>
      )}
      {state.success && (
        <div role="status" className="alert green">
          {state.success}
        </div>
      )}
      <button className="primary-button" disabled={!hydrated || pending}>
        {!hydrated
          ? "Przygotowuję formularz…"
          : pending
            ? "Zapisuję…"
            : "Zapisz usługę i cenę"}
      </button>
    </form>
  );
}
