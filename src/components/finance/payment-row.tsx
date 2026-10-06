import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { ActionForm } from "@/components/action-form";
import { dateLabel, money } from "@/lib/domain";
import type { FinancePayment } from "@/lib/finance";
import { voidPayment } from "@/lib/data/finance-actions";
import { Details, NoteField } from "./ui";
import { shortDate } from "./format";
import styles from "../finance.module.css";

const paymentMethods: Record<string, string> = {
  cash: "Gotówka",
  transfer: "Przelew",
  card: "Karta",
  other: "Inna metoda",
  gift_card: "Karta podarunkowa",
};

export function PaymentRow({
  payment,
  admin,
}: {
  payment: FinancePayment;
  admin: boolean;
}) {
  const refunded = payment.status === "refunded";
  return (
    <article className={styles.row} id={`payment-${payment.id}`}>
      <div className={styles.rowMain}>
        <div>
          <h3 className={styles.rowTitle}>
            {payment.dogName}
            {admin && (
              <span className={styles.muted}>· {payment.guardianName}</span>
            )}
          </h3>
          <div className={styles.rowMeta}>
            {payment.href ? (
              <Link className={styles.textLink} href={payment.href}>
                {payment.title} <ArrowUpRight aria-hidden="true" />
              </Link>
            ) : (
              <span>{payment.title}</span>
            )}
          </div>
          <div className={styles.rowMeta}>
            <span>{shortDate(payment.paidAt)}</span>
            <span>{paymentMethods[payment.method] || payment.method}</span>
          </div>
        </div>
        <div className={styles.amount}>
          <strong>{money(payment.amountCents)}</strong>
          <span
            className={`badge ${payment.status === "paid" ? "green" : refunded ? "neutral" : "amber"}`}
          >
            {refunded
              ? "Zwrot / korekta"
              : payment.status === "paid"
                ? payment.giftCardId && !payment.giftCardSale
                  ? "Rozliczono kartą"
                  : "Wpłata zapisana"
                : "Do rozliczenia"}
          </span>
        </div>
      </div>
      {payment.note && <p className={styles.rowNote}>{payment.note}</p>}
      {(payment.courseEnrollmentId ||
        payment.fitnessPackageId ||
        payment.giftCardSale) &&
        (payment.refundedCents || 0) > 0 && (
          <p className={styles.rowNote}>
            {payment.giftCardId && !payment.giftCardSale
              ? "Przywrócono na kartę"
              : "Zwrócono"}{" "}
            {money(payment.refundedCents || 0)}. Pozostało z wpłaty:{" "}
            {money(payment.remainingCents || 0)}.
          </p>
        )}
      {payment.refunds && payment.refunds.length > 0 && (
        <Details title="Historia częściowych zwrotów">
          <ol className={styles.ledger}>
            {payment.refunds.map((refund) => (
              <li key={refund.id}>
                <strong>Zwrot {money(refund.amount_cents)}</strong>
                <time dateTime={refund.created_at}>
                  {dateLabel(refund.created_at)}
                </time>
                <p>{refund.note}</p>
              </li>
            ))}
          </ol>
        </Details>
      )}
      {payment.needsReview && (
        <p className={styles.reviewNote}>
          <strong>
            {payment.fitnessPackageId
              ? "Rozliczenie fitness wymaga uwagi."
              : payment.courseEnrollmentId
                ? "Rozliczenie kursu wymaga uwagi."
                : "Do sprawdzenia: zwrot wpłaty."}
          </strong>{" "}
          {payment.courseEnrollmentId || payment.fitnessPackageId
            ? "Sprawdź uzgodnioną kwotę i pozostały zwrot w szczegółach zajęć."
            : admin
              ? "Ta wpłata dotyczy odwołanej usługi lub zwolnienia z opłaty. Ustal zwrot z opiekunem i odnotuj go po rozliczeniu."
              : "Ta wpłata dotyczy odwołanej usługi lub zwolnienia z opłaty. Sposób jej rozliczenia ustal z behawiorystą."}
        </p>
      )}
      {refunded && (
        <p className={styles.rowNote}>
          <strong>Zwrot / korekta</strong>
          {payment.refundedAt && (
            <>
              {" "}
              ·{" "}
              <time dateTime={payment.refundedAt}>
                {dateLabel(payment.refundedAt)}
              </time>
            </>
          )}
          {payment.refundNote && (
            <>
              <br />
              {payment.refundNote}
            </>
          )}
        </p>
      )}
      {payment.giftCardId && (
        <Link
          className="text-button"
          href={`${admin ? "/admin" : "/app"}/gifts/${payment.giftCardId}`}
        >
          {payment.giftCardSale
            ? "Karta, saldo i potwierdzone zwroty →"
            : "Saldo i historia karty podarunkowej →"}
        </Link>
      )}
      {admin &&
        payment.status === "paid" &&
        (payment.courseEnrollmentId || payment.fitnessPackageId) &&
        payment.href && (
          <Link className="ghost-button" href={payment.href}>
            {payment.fitnessPackageId
              ? "Odnotuj pełny lub częściowy zwrot w fitnessie →"
              : "Odnotuj pełny lub częściowy zwrot w kursie →"}
          </Link>
        )}
      {admin &&
        payment.status === "paid" &&
        !payment.courseEnrollmentId &&
        !payment.fitnessPackageId &&
        !payment.giftCardSale && (
          <Details title="Zapisz zwrot lub popraw błędną wpłatę">
            <p>
              {payment.giftCardId
                ? "Ten wpis przywróci wykorzystaną kwotę na saldo karty podarunkowej. Zachowa termin ważności i może ponownie otworzyć należność."
                : "Ten wpis zmieni ewidencję rozliczeń. Nie wykona przelewu. Zapisz go dopiero po zwrocie pieniędzy lub gdy pierwotna wpłata została wpisana błędnie."}
            </p>
            <ActionForm
              action={voidPayment}
              label="Zapisz zwrot / korektę"
              confirm={
                payment.giftCardId
                  ? `Przywrócić ${money(payment.amountCents)} na saldo pierwotnej karty? Należność może zostać otwarta ponownie.`
                  : `Potwierdź: kwota ${money(payment.amountCents)} została zwrócona albo wpłata jest błędnym wpisem. Zmiana może ponownie otworzyć należność. Zapisać korektę?`
              }
            >
              <input type="hidden" name="payment_id" value={payment.id} />
              <NoteField required />
            </ActionForm>
          </Details>
        )}
    </article>
  );
}
