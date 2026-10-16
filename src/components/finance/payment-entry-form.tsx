"use client";

import { useId, useState, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
import { ActionForm, type ActionState } from "@/components/action-form";
import { useHydrated } from "@/components/use-hydrated";
import { usePersistentForm } from "@/components/use-persistent-form";
import { recordPayment } from "@/lib/data/finance-actions";
import type { FinanceCharge } from "@/lib/finance";

function PaymentFields({ children }: { children: ReactNode }) {
  const hydrated = useHydrated();
  const { pending } = useFormStatus();
  return (
    <fieldset
      disabled={!hydrated || pending}
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
}: {
  charge: Pick<FinanceCharge, "kind" | "id" | "dueCents">;
  requestId: string;
}) {
  const hydrated = useHydrated();
  const formRef = usePersistentForm();
  const amountId = useId();
  const [target] = useState({ kind: charge.kind, id: charge.id });
  const [requestId, setRequestId] = useState(initialRequestId);
  const [amount, setAmount] = useState(
    (charge.dueCents / 100).toFixed(2).replace(".", ","),
  );
  const [method, setMethod] = useState("transfer");
  const [note, setNote] = useState("");

  async function submit(previous: ActionState, data: FormData) {
    const result = await recordPayment(previous, data);
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

  return (
    <ActionForm
      action={submit}
      label="Zapisz wpłatę"
      pendingLabel="Zapisuję wpłatę…"
      disabled={!hydrated}
    >
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
      <PaymentFields>
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
        <label className="field">
          <span>Notatka (opcjonalnie)</span>
          <textarea
            name="note"
            value={note}
            onChange={(event) => setNote(event.target.value)}
            rows={2}
            maxLength={2000}
          />
          <small className="field-hint">
            Opis będzie widoczny także dla opiekuna.
          </small>
        </label>
      </PaymentFields>
    </ActionForm>
  );
}
