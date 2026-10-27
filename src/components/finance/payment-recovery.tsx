"use client";

import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { ActionForm, type ActionState } from "@/components/action-form";
import { recordPayment } from "@/lib/data/finance-actions";
import { money } from "@/lib/domain";
import { parseMoney } from "../../lib/finance";
import { withFormActionRecovery } from "../form-action-recovery";
import styles from "../finance.module.css";

export type PaymentCommand = {
  fields: Record<
    "target_kind" | "target_id" | "request_id" | "amount" | "method" | "note",
    string
  >;
  dogName: string;
  guardianName: string;
  title: string;
};
type Receipt = {
  command: PaymentCommand;
  pending: boolean;
  result: ActionState;
};
type Recovery = {
  unconfirmed: (kind: string, targetId: string) => Receipt | undefined;
  record: (
    command: PaymentCommand,
    previous: ActionState,
  ) => Promise<ActionState>;
};
const PaymentRecoveryContext = createContext<Recovery | null>(null);
export function usePaymentRecovery() {
  return useContext(PaymentRecoveryContext);
}

function RecoveryNotice({
  receipt,
  record,
  dismiss,
}: {
  receipt: Receipt;
  record: Recovery["record"];
  dismiss: () => void;
}) {
  const { command, pending, result } = receipt;
  const feedback = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (!pending) feedback.current?.focus();
  }, [pending, result]);
  const amount = parseMoney(command.fields.amount);
  const methods: Record<string, string> = {
    cash: "Gotówka",
    transfer: "Przelew",
    card: "Karta",
    other: "Inna (np. BLIK)",
  };
  return (
    <article
      className={styles.recoveryNotice}
      data-payment-request={command.fields.request_id}
    >
      <h3>
        {command.dogName} · {command.title}
      </h3>
      <p>Opiekun: {command.guardianName}</p>
      <p>
        Wysłana wpłata:{" "}
        <strong>
          {amount === null ? `${command.fields.amount} zł` : money(amount)}
        </strong>
        {" · "}
        {methods[command.fields.method] || command.fields.method}
      </p>
      {command.fields.note && (
        <p className="preserve-lines">{command.fields.note}</p>
      )}
      <p
        ref={feedback}
        tabIndex={-1}
        role={result.error ? "alert" : "status"}
        className={`alert ${result.success ? "green" : result.error ? "red" : ""}`}
      >
        {pending
          ? "Potwierdzam wysłaną wpłatę…"
          : result.success
            ? "Wpłata zapisana. Potwierdzenie dotyczy powyższej kwoty."
            : result.error}
      </p>
      {result.success ? (
        <button type="button" className="ghost-button" onClick={dismiss}>
          Zamknij potwierdzenie wpłaty
        </button>
      ) : (
        <>
          <p>
            Ponowienie dotyczy dokładnie tej wysłanej wpłaty. Jej kwota, metoda
            i odbiorca pozostają zachowane.
          </p>
          <ActionForm
            action={async () => {
              await record(command, {});
              // Feedback belongs to this stable notice, including when the
              // original row was removed by a streamed refresh or pagination.
              return {};
            }}
            label="Ponów potwierdzenie tej wpłaty"
            pendingLabel="Potwierdzam wpłatę…"
            disabled={pending}
          >
            {Object.entries(command.fields).map(([name, value]) => (
              <input key={name} type="hidden" name={name} value={value} />
            ))}
          </ActionForm>
        </>
      )}
    </article>
  );
}

export function PaymentRecoveryProvider({
  visibleTargets,
  children,
}: {
  visibleTargets: string[];
  children: ReactNode;
}) {
  // This is only the submitted command, never a cached row or an old balance.
  // It lives above the server-rendered list, for this mounted finance page.
  const [receipts, setReceipts] = useState<Receipt[]>([]);
  const inFlight = useRef(new Set<string>());
  async function record(command: PaymentCommand, previous: ActionState) {
    const submitted = { ...command, fields: { ...command.fields } };
    const id = submitted.fields.request_id;
    if (inFlight.current.has(id))
      return { error: "Trwa potwierdzanie tej wpłaty." };
    inFlight.current.add(id);
    setReceipts((current) => [
      ...current.filter(
        (item) =>
          item.command.fields.request_id !== id &&
          !(
            item.result.success &&
            item.command.fields.target_kind === submitted.fields.target_kind &&
            item.command.fields.target_id === submitted.fields.target_id
          ),
      ),
      { command: submitted, pending: true, result: {} },
    ]);
    try {
      const form = new FormData();
      for (const [name, value] of Object.entries(submitted.fields))
        form.set(name, value);
      const result = await withFormActionRecovery(recordPayment)(
        previous,
        form,
      );
      setReceipts((current) =>
        current.map((item) =>
          item.command.fields.request_id === id
            ? { command: submitted, pending: false, result }
            : item,
        ),
      );
      return result;
    } finally {
      inFlight.current.delete(id);
    }
  }
  const missing = receipts.filter(
    ({ command }) =>
      !visibleTargets.includes(
        `${command.fields.target_kind}:${command.fields.target_id}`,
      ),
  );
  return (
    <PaymentRecoveryContext.Provider
      value={{
        record,
        unconfirmed: (kind, targetId) =>
          [...receipts]
            .reverse()
            .find(
              (receipt) =>
                !receipt.result.success &&
                receipt.command.fields.target_kind === kind &&
                receipt.command.fields.target_id === targetId,
            ),
      }}
    >
      {missing.length > 0 && (
        <section
          className={styles.paymentRecovery}
          aria-label="Potwierdzenia wpłat"
        >
          {missing.map((receipt) => (
            <RecoveryNotice
              key={receipt.command.fields.request_id}
              receipt={receipt}
              record={record}
              dismiss={() =>
                setReceipts((current) =>
                  current.filter(
                    (item) =>
                      item.command.fields.request_id !==
                      receipt.command.fields.request_id,
                  ),
                )
              }
            />
          ))}
        </section>
      )}
      {children}
    </PaymentRecoveryContext.Provider>
  );
}
