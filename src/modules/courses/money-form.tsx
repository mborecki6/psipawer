"use client";
import { useActionState, useEffect, useRef, useState } from "react";
import { usePersistentForm } from "@/components/use-persistent-form";
import { useHydrated } from "@/components/use-hydrated";
import { recordPayment } from "@/lib/data/finance-actions";
import { settleEnrollment, refundCoursePayment } from "./finance-actions";
import type { CourseActionState } from "./actions";
import styles from "./courses.module.css";

export function CourseMoneyForm({
  kind,
  targetId,
  requestId,
  amountCents,
  version,
  enabled,
  refreshHref,
  cardCredit = false,
}: {
  kind: "payment" | "refund" | "settlement";
  targetId: string;
  requestId: string;
  amountCents: number;
  version?: number;
  enabled: boolean;
  refreshHref: string;
  cardCredit?: boolean;
}) {
  // Preserve one command across a streamed refresh and an uncertain response.
  // A new receipt/refund/settlement requires an explicit fresh page.
  const [original] = useState({ targetId, requestId, version });
  const [amount, setAmount] = useState(
    (amountCents / 100).toFixed(2).replace(".", ","),
  );
  const [note, setNote] = useState(""),
    [method, setMethod] = useState("transfer");
  const action =
    kind === "payment"
      ? recordPayment
      : kind === "refund"
        ? refundCoursePayment
        : settleEnrollment;
  const [state, submit, pending] = useActionState<CourseActionState, FormData>(
    action,
    {},
  );
  const ref = usePersistentForm(),
    hydrated = useHydrated(),
    errorRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (state.error) errorRef.current?.focus();
  }, [state]);
  const label =
    kind === "payment"
      ? "Zapisz wpłatę"
      : kind === "refund"
        ? "Odnotuj zwrot"
        : "Zapisz uzgodnioną kwotę";
  return (
    <form ref={ref} action={submit} className="stack">
      {state.error && (
        <div ref={errorRef} role="alert" tabIndex={-1} className="alert red">
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
      <fieldset
        className={styles.fields}
        disabled={!hydrated || pending || !enabled || !!state.success}
      >
        <input type="hidden" name="request_id" value={original.requestId} />
        {kind === "payment" ? (
          <>
            <input type="hidden" name="target_kind" value="course" />
            <input type="hidden" name="target_id" value={original.targetId} />
          </>
        ) : (
          <input
            type="hidden"
            name={kind === "refund" ? "payment_id" : "enrollment_id"}
            value={original.targetId}
          />
        )}
        {kind === "settlement" && (
          <input
            type="hidden"
            name="expected_version"
            value={original.version}
          />
        )}
        <label className="field">
          <span>
            {kind === "payment"
              ? "Otrzymana kwota (zł)"
              : kind === "refund"
                ? cardCredit
                  ? "Kwota przywracana na kartę (zł)"
                  : "Zwrócona kwota (zł)"
                : "Uzgodniona należność za kurs (zł)"}
          </span>
          <input
            name="amount"
            inputMode="decimal"
            maxLength={9}
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            required
          />
          {kind === "settlement" && (
            <small className="field-hint">
              0 zł oznacza zwolnienie z opłaty. Ta zmiana nie zwraca pieniędzy.
            </small>
          )}
        </label>
        {kind === "payment" && (
          <label className="field">
            <span>Metoda płatności</span>
            <select
              name="method"
              value={method}
              onChange={(e) => setMethod(e.target.value)}
              required
            >
              <option value="transfer">Przelew</option>
              <option value="cash">Gotówka</option>
              <option value="card">Karta</option>
              <option value="other">Inna (np. BLIK)</option>
            </select>
          </label>
        )}
        <label className="field">
          <span>
            {kind === "payment"
              ? "Notatka do wpłaty (opcjonalnie)"
              : kind === "refund"
                ? "Powód zwrotu"
                : "Powód uzgodnienia"}
          </span>
          <textarea
            name="note"
            rows={3}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            minLength={kind === "payment" ? undefined : 3}
            maxLength={kind === "settlement" ? 3000 : 2000}
            required={kind !== "payment"}
          />
          <small className="field-hint">
            Opis będzie widoczny także dla opiekuna.
          </small>
        </label>
        <label className={styles.confirmation}>
          <input type="checkbox" required />
          <span>
            {kind === "payment"
              ? "Potwierdzam, że wpłata została otrzymana."
              : kind === "refund"
                ? cardCredit
                  ? "Potwierdzam przywrócenie kwoty na saldo karty podarunkowej."
                  : "Potwierdzam, że pieniądze zostały zwrócone lub koryguję błędny wpis."
                : "Potwierdzam, że kwota została uzgodniona z opiekunem."}
          </span>
        </label>
        <button className="primary-button" disabled={pending || !hydrated}>
          {pending ? "Zapisuję…" : label}
        </button>
      </fieldset>
      <a className="ghost-button" href={refreshHref.split("#")[0]}>
        {state.success
          ? "Odśwież saldo i przygotuj kolejny wpis →"
          : "Wczytaj aktualne saldo →"}
      </a>
    </form>
  );
}
