"use client";
import { useActionState, useEffect, useId, useRef, useState } from "react";
import { usePersistentForm } from "@/components/use-persistent-form";
import { useHydrated } from "@/components/use-hydrated";
import { agreeConsultationPrice } from "./actions";
import styles from "./consultations.module.css";

export function ConsultationPriceEditor({
  id,
  version,
  requestId,
}: {
  id: string;
  version: number;
  requestId: string;
}) {
  const hydrated = useHydrated();
  const form = usePersistentForm();
  const prefix = useId();
  const error = useRef<HTMLDivElement>(null);
  // Retain the version and idempotency key of this draft after a background
  // refresh or failed save, so another tab cannot silently replace its terms.
  const [original] = useState({ id, version, requestId });
  const [state, action, pending] = useActionState(agreeConsultationPrice, {});
  const [priceKind, setPriceKind] = useState("false");
  useEffect(() => {
    if (state.error) error.current?.focus();
  }, [state]);
  return (
    <article className="card pad">
      <h3>Uzgodniona kwota</h3>
      <p className="muted">
        Wpisz kwotę ustaloną z opiekunem dla tego starszego spotkania. Po
        zapisie zachowamy ją wraz z uzasadnieniem w historii konsultacji.
      </p>
      <form
        ref={form}
        action={action}
        className="form-stack"
        aria-busy={!hydrated || pending}
      >
        <input type="hidden" name="id" value={original.id} />
        <input type="hidden" name="expected_version" value={original.version} />
        <input type="hidden" name="request_id" value={original.requestId} />
        <fieldset className={styles.fields} disabled={!hydrated || pending}>
          <legend className="sr-only">
            Uzgodnienie kwoty starszej konsultacji
          </legend>
          <div className="field">
            <label htmlFor={`${prefix}-amount`}>Uzgodniona kwota (zł)</label>
            <input
              id={`${prefix}-amount`}
              name="amount"
              inputMode="decimal"
              maxLength={8}
              required
              aria-invalid={Boolean(state.fields?.amount?.length)}
              aria-describedby={`${prefix}-hint`}
            />
            <small id={`${prefix}-hint`}>
              Kwota za całe spotkanie. Nie zapisuje wpłaty.
            </small>
          </div>
          <div className="field">
            <label htmlFor={`${prefix}-kind`}>Rodzaj uzgodnionej ceny</label>
            <select
              id={`${prefix}-kind`}
              name="is_test_price"
              value={priceKind}
              onChange={(e) => setPriceKind(e.target.value)}
            >
              <option value="false">Uzgodniona z opiekunem</option>
              <option value="true">Robocza — do testów</option>
            </select>
          </div>
          <div className="field">
            <label htmlFor={`${prefix}-note`}>Uzasadnienie dla opiekuna</label>
            <textarea
              id={`${prefix}-note`}
              name="note"
              rows={3}
              minLength={3}
              maxLength={3000}
              required
              aria-invalid={Boolean(state.fields?.note?.length)}
              aria-describedby={`${prefix}-note-hint`}
            />
            <small id={`${prefix}-note-hint`}>
              Opiekun zobaczy tę wiadomość i kwotę w historii.
            </small>
          </div>
        </fieldset>
        <p className="muted">
          Umówione i zakończone spotkanie pojawi się w finansach. Zgłoszenie
          zacznie wymagać wpłaty dopiero po potwierdzeniu terminu.
        </p>
        {state.error && (
          <div ref={error} role="alert" className="alert red" tabIndex={-1}>
            {state.error}
          </div>
        )}
        <button className="primary-button" disabled={!hydrated || pending}>
          {!hydrated
            ? "Przygotowuję formularz…"
            : pending
              ? "Zapisuję…"
              : "Zapisz uzgodnioną kwotę"}
        </button>
      </form>
    </article>
  );
}
