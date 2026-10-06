import { randomUUID } from "node:crypto";
import { dateLabel, money } from "@/lib/domain";
import type {
  CourseBalance,
  CourseRefundRecord,
  PaymentRecord,
} from "@/lib/finance";
import { CourseMoneyForm } from "./money-form";
import styles from "./courses.module.css";
const methods: Record<string, string> = {
  cash: "Gotówka",
  transfer: "Przelew",
  card: "Karta",
  other: "Inna metoda",
  gift_card: "Karta podarunkowa",
};

export function CourseBilling({
  balance: b,
  payments,
  refunds,
  admin,
}: {
  balance: CourseBalance;
  payments: PaymentRecord[];
  refunds: CourseRefundRecord[];
  admin: boolean;
}) {
  const base = admin ? "/admin" : "/app",
    refreshHref = `${base}/courses/${b.course_id}?enrollment=${b.id}#rozliczenie-${b.id}`;
  const label = b.needs_settlement
    ? "Kwota po rezygnacji do uzgodnienia"
    : b.refund_due_cents > 0
      ? "Pozostał zwrot"
      : b.due_cents > 0
        ? "Do zapłaty"
        : b.status === "accepted"
          ? "Opłacone"
          : b.charge_cents > 0
            ? "Rozliczone"
            : "Brak należności";
  return (
    <div className={styles.billing} id={`rozliczenie-${b.id}`}>
      <h5>Rozliczenie kursu</h5>
      <span
        className={`badge ${b.needs_review || b.due_cents > 0 ? "amber" : b.status === "accepted" ? "green" : "neutral"}`}
      >
        {label}
      </span>
      <dl className={styles.billingFacts}>
        <div>
          <dt>Cena za cały cykl</dt>
          <dd>{money(b.agreed_price_cents)} za cykl</dd>
        </div>
        <div>
          <dt>
            {b.needs_settlement
              ? "Kwota przed uzgodnieniem"
              : "Należność za kurs"}
          </dt>
          <dd>{money(b.charge_cents)}</dd>
        </div>
        <div>
          <dt>Wpłaty po zwrotach</dt>
          <dd>{money(b.paid_cents)}</dd>
        </div>
        <div>
          <dt>Odnotowane zwroty</dt>
          <dd>{money(b.refunded_cents)}</dd>
        </div>
        {!b.needs_settlement && (
          <div>
            <dt>
              {b.refund_due_cents > 0
                ? "Pozostało do zwrotu"
                : "Pozostało do zapłaty"}
            </dt>
            <dd>
              {money(b.refund_due_cents > 0 ? b.refund_due_cents : b.due_cents)}
            </dd>
          </div>
        )}
      </dl>
      {b.needs_settlement ? (
        <p className="muted">
          {admin
            ? "Uzgodnij z opiekunem końcową należność za kurs. Dotychczasowe wpłaty pozostają w historii. Samo odwołanie nie zwraca pieniędzy."
            : "Prowadząca uzgodni z Tobą końcową kwotę po rezygnacji. Dotychczasowe wpłaty zachowały swoją historię."}
        </p>
      ) : b.refund_due_cents > 0 ? (
        <p className="muted">
          {admin
            ? "Zwróć uzgodnioną kwotę i odnotuj każdy zwrot przy właściwej wpłacie poniżej."
            : "Pozostała kwota zwrotu wymaga rozliczenia z prowadzącą."}
        </p>
      ) : ["requested", "waitlisted", "rejected"].includes(b.status) ? (
        <p className="muted">
          Samo zgłoszenie i miejsce na rezerwie nie wymagają wpłaty. Należność
          powstaje po przyjęciu.
        </p>
      ) : (
        <p className="muted">
          {b.due_cents > 0
            ? "Sposób płatności ustal z prowadzącą. Wpłatę odnotuje po jej otrzymaniu."
            : "Historia wpłat i zwrotów pozostaje dostępna poniżej."}
        </p>
      )}
      {b.is_test_price && (
        <small className="muted">Cena robocza do testów.</small>
      )}
      {admin && b.status === "cancelled" && (
        <details>
          <summary>
            {b.settled_at
              ? "Zmień uzgodnioną kwotę"
              : "Uzgodnij kwotę po rezygnacji"}
          </summary>
          <CourseMoneyForm
            kind="settlement"
            targetId={b.id}
            requestId={randomUUID()}
            version={b.version}
            amountCents={b.charge_cents}
            enabled
            refreshHref={refreshHref}
          />
        </details>
      )}
      {admin &&
        (b.status === "accepted" ||
          (b.status === "cancelled" && b.settled_at !== null)) && (
          <details>
            <summary>Odnotuj otrzymaną wpłatę</summary>
            <CourseMoneyForm
              kind="payment"
              targetId={b.id}
              requestId={randomUUID()}
              amountCents={b.due_cents}
              enabled={b.can_pay}
              refreshHref={refreshHref}
            />
            {!b.can_pay && (
              <p className="muted">
                Brak kwoty do przyjęcia według aktualnego salda.
              </p>
            )}
          </details>
        )}
      {payments.length > 0 && (
        <details className={styles.receipts}>
          <summary>Historia wpłat i zwrotów ({payments.length})</summary>
          <ol className={styles.history}>
            {payments.map((p) => {
              const rows = refunds.filter((r) => r.payment_id === p.id),
                refunded = rows.reduce((sum, r) => sum + r.amount_cents, 0),
                remaining =
                  p.status === "paid"
                    ? Math.max(0, p.amount_cents - refunded)
                    : 0;
              return (
                <li key={p.id} id={`wplata-${p.id}`}>
                  <strong>
                    Wpłata {money(p.amount_cents)} ·{" "}
                    {methods[p.method] || "Inna metoda"}
                  </strong>
                  <small>{dateLabel(p.paid_at || p.created_at)}</small>
                  {p.note && <p>{p.note}</p>}
                  <p>
                    Pozostało z wpłaty: <strong>{money(remaining)}</strong>.{" "}
                    {p.status === "refunded" &&
                      "Wpłata w całości zwrócona lub skorygowana."}
                  </p>
                  {rows.map((r) => (
                    <div key={r.id} className={styles.refund}>
                      <strong>Zwrot {money(r.amount_cents)}</strong>
                      <small>{dateLabel(r.created_at)}</small>
                      <p>{r.note}</p>
                    </div>
                  ))}
                  {admin && (
                    <details>
                      <summary>Odnotuj zwrot tej wpłaty</summary>
                      <p className="muted">
                        {p.method === "gift_card"
                          ? "Wpisz kwotę przywracaną na pierwotną kartę. Możesz oddać część salda. Termin ważności karty pozostaje zachowany."
                          : "Wpisz faktycznie zwróconą kwotę. Możesz zwrócić część wpłaty. Aplikacja nie wykonuje przelewu."}
                      </p>
                      <CourseMoneyForm
                        kind="refund"
                        cardCredit={p.method === "gift_card"}
                        targetId={p.id}
                        requestId={randomUUID()}
                        amountCents={remaining}
                        enabled={remaining > 0}
                        refreshHref={refreshHref}
                      />
                    </details>
                  )}
                </li>
              );
            })}
          </ol>
        </details>
      )}
    </div>
  );
}
