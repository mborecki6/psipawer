"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
import { ActionForm, type ActionState } from "@/components/action-form";
import { useHydrated } from "@/components/use-hydrated";
import { usePersistentForm } from "@/components/use-persistent-form";
import { recordPayment } from "@/lib/data/finance-actions";
import type { FinanceCharge } from "@/lib/finance";
import styles from "../finance.module.css";
import { usePaymentRecovery, type PaymentCommand } from "./payment-recovery";
import { revealFormFeedback } from "../progressive-details";

function PaymentFields({
  children,
  disabled = false,
}: {
  children: ReactNode;
  disabled?: boolean;
}) {
  const hydrated = useHydrated();
  const { pending } = useFormStatus();
  return (
    <fieldset
      disabled={!hydrated || pending || disabled}
      className="form-stack"
      style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}
    >
      {children}
    </fieldset>
  );
}

export function PaymentEntryForm({
  charge,
  requestId: initialRequestId,
  compact = false,
}: {
  charge: Pick<FinanceCharge, "kind" | "id" | "dueCents"> &
    Partial<Pick<FinanceCharge, "dogName" | "guardianName" | "title">>;
  requestId: string;
  compact?: boolean;
}) {
  const hydrated = useHydrated();
  const formRef = usePersistentForm();
  const amountId = useId();
  const noteId = useId();
  const noteHintId = `${noteId}-hint`;
  const recovery = usePaymentRecovery();
  const initialReceipt = recovery?.unconfirmed(charge.kind, charge.id);
  const [target] = useState({ kind: charge.kind, id: charge.id });
  const [requestId, setRequestId] = useState(
    initialReceipt?.command.fields.request_id ?? initialRequestId,
  );
  const [amount, setAmount] = useState(
    initialReceipt?.command.fields.amount ??
      (charge.dueCents / 100).toFixed(2).replace(".", ","),
  );
  const [method, setMethod] = useState(
    initialReceipt?.command.fields.method ?? "transfer",
  );
  const [note, setNote] = useState(initialReceipt?.command.fields.note ?? "");
  const [showRestored, setShowRestored] = useState(Boolean(initialReceipt));
  const restoredFeedback = useRef<HTMLDivElement>(null);
  const activeReceipt = recovery?.unconfirmed(target.kind, target.id);
  const restored =
    showRestored && activeReceipt?.command.fields.request_id === requestId
      ? activeReceipt
      : undefined;
  useEffect(() => {
    if (restored) {
      revealFormFeedback(formRef.current);
      restoredFeedback.current?.focus();
    }
  }, [restored, formRef]);

  async function submit(previous: ActionState, data: FormData) {
    setShowRestored(false);
    const command: PaymentCommand = {
      fields: {
        target_kind: String(data.get("target_kind") || ""),
        target_id: String(data.get("target_id") || ""),
        request_id: String(data.get("request_id") || ""),
        amount: String(data.get("amount") || ""),
        method: String(data.get("method") || ""),
        note: String(data.get("note") || ""),
      },
      dogName: charge.dogName || "Pies",
      guardianName: charge.guardianName || "Opiekun",
      title: charge.title || "Usługa",
    };
    const result = recovery
      ? await recovery.record(command, previous)
      : await recordPayment(previous, data);
    if (result.success) {
      // An unrelated payment can refresh this row after a lost response.
      // Rotate only after our own acknowledgement, never from server props.
      setRequestId(crypto.randomUUID());
      setAmount("");
      setMethod("transfer");
      setNote("");
    }
    return result;
  }

  const noteField = (
    <div className="field">
      <label htmlFor={noteId}>Notatka (opcjonalnie)</label>
      <textarea
        id={noteId}
        aria-describedby={noteHintId}
        name="note"
        value={note}
        onChange={(event) => setNote(event.target.value)}
        rows={2}
        maxLength={2000}
      />
      <small id={noteHintId} className="field-hint">
        Opis będzie widoczny także dla opiekuna.
      </small>
    </div>
  );

  return (
    <ActionForm
      action={submit}
      label={compact ? "Odnotuj otrzymaną wpłatę" : "Zapisz wpłatę"}
      pendingLabel="Zapisuję wpłatę…"
      disabled={!hydrated || Boolean(activeReceipt?.pending)}
    >
      {restored && (
        <div
          ref={restoredFeedback}
          role={restored.pending ? "status" : "alert"}
          tabIndex={-1}
          className="alert"
        >
          Przywrócono wysłaną wpłatę i jej identyfikator.{" "}
          {restored.pending
            ? "Trwa potwierdzanie zapisu."
            : restored.result.error}{" "}
          Sprawdź wynik przed nowym wpisem.
        </div>
      )}
      <input type="hidden" name="target_kind" value={target.kind} />
      <input type="hidden" name="target_id" value={target.id} />
      <input
        type="hidden"
        name="request_id"
        value={requestId}
        ref={(input) => {
          formRef.current = input?.form ?? null;
        }}
      />
      <PaymentFields disabled={Boolean(activeReceipt?.pending)}>
        <div className="form-grid">
          <div className="field">
            <label htmlFor={amountId}>Otrzymana kwota (zł)</label>
            <input
              id={amountId}
              name="amount"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              inputMode="decimal"
              maxLength={9}
              required
            />
          </div>
          <label className="field">
            <span>Metoda płatności</span>
            <select
              name="method"
              value={method}
              onChange={(event) => setMethod(event.target.value)}
              required
            >
              <option value="transfer">Przelew</option>
              <option value="cash">Gotówka</option>
              <option value="card">Karta</option>
              <option value="other">Inna (np. BLIK)</option>
            </select>
          </label>
        </div>
        {compact ? (
          <details className={styles.paymentNote}>
            <summary>Dodaj notatkę (opcjonalnie)</summary>
            {noteField}
          </details>
        ) : (
          noteField
        )}
      </PaymentFields>
    </ActionForm>
  );
}
