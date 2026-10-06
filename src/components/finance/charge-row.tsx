import Link from "next/link";
import { ArrowUpRight, CalendarDays, Package, Wallet } from "lucide-react";
import { ActionForm, Field } from "@/components/action-form";
import { dateLabel, money } from "@/lib/domain";
import type { FinanceCharge } from "@/lib/finance";
import { recordPayment, usePackage } from "@/lib/data/finance-actions";
import { Details, NoteField } from "./ui";
import { shortDate } from "./format";
import styles from "../finance.module.css";

function PaymentForm({ charge }: { charge: FinanceCharge }) {
  if (charge.kind === "fitness")
    return (
      <Link className="primary-button" href={charge.href}>
        Odnotuj wpłatę w fitnessie →
      </Link>
    );
  if (charge.kind === "course")
    return (
      <Link className="primary-button" href={charge.href}>
        Odnotuj wpłatę w kursie →
      </Link>
    );
  return (
    <ActionForm
      action={recordPayment}
      label="Zapisz wpłatę"
      pendingLabel="Zapisuję wpłatę…"
    >
      <input type="hidden" name="target_kind" value={charge.kind} />
      <input type="hidden" name="target_id" value={charge.id} />
      <input type="hidden" name="request_id" value={crypto.randomUUID()} />
      <div className="form-grid">
        <Field
          name="amount"
          label="Otrzymana kwota (zł)"
          value={(charge.dueCents / 100).toFixed(2).replace(".", ",")}
          inputMode="decimal"
          maxLength={9}
          required
        />
        <label className="field">
          <span>Metoda płatności</span>
          <select name="method" defaultValue="transfer" required>
            <option value="transfer">Przelew</option>
            <option value="cash">Gotówka</option>
            <option value="card">Karta</option>
            <option value="other">Inna (np. BLIK)</option>
          </select>
        </label>
      </div>
      <NoteField />
    </ActionForm>
  );
}

export function ChargeRow({
  charge,
  admin,
}: {
  charge: FinanceCharge;
  admin: boolean;
}) {
  return (
    <article className={styles.row} id={`charge-${charge.kind}-${charge.id}`}>
      <div className={styles.rowMain}>
        <div>
          <h3 className={styles.rowTitle}>
            <Link href={charge.href}>{charge.dogName}</Link>
            {admin && (
              <span className={styles.muted}>· {charge.guardianName}</span>
            )}
          </h3>
          <div className={styles.rowMeta}>
            <Link className={styles.textLink} href={charge.href}>
              {charge.kind === "package" && <Package aria-hidden="true" />}
              {charge.title} <ArrowUpRight aria-hidden="true" />
            </Link>
          </div>
          <div className={styles.rowMeta}>
            <span>
              <CalendarDays aria-hidden="true" />
              {charge.kind === "package"
                ? `Zakup ${shortDate(charge.date)}`
                : dateLabel(charge.date)}
            </span>
          </div>
        </div>
        <div className={styles.amount}>
          <strong>
            {charge.reviewReason === "settlement"
              ? "Do uzgodnienia"
              : money(
                  charge.reviewReason === "refund"
                    ? charge.refundDueCents || 0
                    : charge.dueCents,
                )}
          </strong>
          <span className="badge amber">
            {charge.reviewReason === "settlement"
              ? "Po rezygnacji"
              : charge.reviewReason === "refund"
                ? "Do zwrotu"
                : "Do zapłaty"}
          </span>
          {charge.isTestPrice && (
            <span className="badge neutral">Cena robocza</span>
          )}
        </div>
      </div>
      {charge.reviewReason && (
        <p className={styles.reviewNote}>
          {charge.reviewReason === "settlement"
            ? "Końcowa kwota po rezygnacji wymaga uzgodnienia z prowadzącą."
            : "Pozostał zwrot według uzgodnionej należności."}{" "}
          <Link className={styles.textLink} href={charge.href}>
            {charge.kind === "fitness"
              ? "Otwórz rozliczenie fitness →"
              : "Otwórz rozliczenie kursu →"}
          </Link>
        </p>
      )}
      {charge.paidCents > 0 && !charge.reviewReason && (
        <p className={styles.rowNote}>
          Wpłacono {money(charge.paidCents)} z {money(charge.amountCents)}.
          Pozostało {money(charge.dueCents)}.
        </p>
      )}
      {admin && charge.canPay && (
        <Details title="Rozlicz należność" icon={<Wallet aria-hidden="true" />}>
          <div
            className={
              charge.availablePackages.length ? styles.actionColumns : undefined
            }
          >
            <div>
              <h4 className={styles.actionHeading}>Otrzymana wpłata</h4>
              <p className={styles.formHint}>
                Wpisz kwotę, którą opiekun już zapłacił. Możesz odnotować także
                część należności.
              </p>
              <PaymentForm charge={charge} />
            </div>
            {charge.availablePackages.length > 0 && (
              <div>
                <h4 className={styles.actionHeading}>Wejście z pakietu</h4>
                <p className={styles.formHint}>
                  Zarezerwuj jedno dostępne wejście tego psa na ten spacer.
                </p>
                <ActionForm
                  action={usePackage}
                  label="Użyj wejścia z pakietu"
                  pendingLabel="Rezerwuję wejście…"
                >
                  <input
                    type="hidden"
                    name="registration_id"
                    value={charge.id}
                  />
                  <label className="field">
                    <span>Pakiet psa {charge.dogName}</span>
                    <select
                      name="package_id"
                      required
                      defaultValue={charge.availablePackages[0].id}
                    >
                      {charge.availablePackages.map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.name} · dostępne wejścia: {item.available}
                        </option>
                      ))}
                    </select>
                  </label>
                  <NoteField privateNote />
                </ActionForm>
              </div>
            )}
          </div>
        </Details>
      )}
    </article>
  );
}
