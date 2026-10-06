import Link from "next/link";
import { CalendarDays, ReceiptText } from "lucide-react";
import { ActionForm } from "@/components/action-form";
import { dateLabel, money } from "@/lib/domain";
import type { FinancePackage, PackageTransaction } from "@/lib/finance";
import { cancelPackage, releasePackage } from "@/lib/data/finance-actions";
import { Details, NoteField } from "./ui";
import styles from "../finance.module.css";

const packageStatuses: Record<string, string> = {
  active: "Aktywny",
  expired: "Wygasł",
  completed: "Wykorzystany",
  cancelled: "Anulowany",
};

function deltaDescription(transaction: PackageTransaction) {
  return [
    transaction.available_delta
      ? `Dostępne: ${transaction.available_delta > 0 ? "+" : ""}${transaction.available_delta}`
      : "",
    transaction.reserved_delta
      ? `Zarezerwowane: ${transaction.reserved_delta > 0 ? "+" : ""}${transaction.reserved_delta}`
      : "",
    transaction.used_delta
      ? `Wykorzystane: ${transaction.used_delta > 0 ? "+" : ""}${transaction.used_delta}`
      : "",
  ]
    .filter(Boolean)
    .join(" · ");
}

export function PackageCard({
  item,
  admin,
}: {
  item: FinancePackage;
  admin: boolean;
}) {
  const total = item.available + item.reserved + item.used;
  const base = admin ? "/admin" : "/app";
  return (
    <article className={styles.packageCard} id={`package-${item.id}`}>
      <div className={styles.packageHeader}>
        <div>
          <h3>{item.name}</h3>
          <p>
            <Link
              className={styles.textLink}
              href={`${base}/dogs/${item.dogId}`}
            >
              {item.dogName}
            </Link>
            {admin && ` · ${item.guardianName}`}
          </p>
        </div>
        <span
          className={`badge ${item.status === "active" ? "green" : item.status === "expired" ? "amber" : "neutral"}`}
        >
          {packageStatuses[item.status] || item.status}
        </span>
      </div>
      <div className={styles.packageBalance}>
        <strong>{item.available}</strong>
        <span>
          {item.status === "active"
            ? "dostępnych wejść"
            : "niewykorzystanych wejść"}
        </span>
      </div>
      <div className={styles.packageTrack} aria-hidden="true">
        {total > 0 && (
          <>
            <span
              className={styles.trackAvailable}
              style={{ width: `${(item.available / total) * 100}%` }}
            />
            <span
              className={styles.trackReserved}
              style={{ width: `${(item.reserved / total) * 100}%` }}
            />
            <span
              className={styles.trackUsed}
              style={{ width: `${(item.used / total) * 100}%` }}
            />
          </>
        )}
      </div>
      <dl className={styles.packageStats}>
        <div>
          <dt>Dostępne</dt>
          <dd>{item.available}</dd>
        </div>
        <div>
          <dt>Zarezerwowane</dt>
          <dd>{item.reserved}</dd>
        </div>
        <div>
          <dt>Wykorzystane</dt>
          <dd>{item.used}</dd>
        </div>
      </dl>
      <p className={styles.packageExpiry}>
        {item.expiresAt
          ? `Ważny do ${dateLabel(item.expiresAt)}`
          : "Bez terminu ważności"}
        <br />
        Cena: {money(item.priceCents)} ·{" "}
        {item.dueCents > 0
          ? `do zapłaty ${money(item.dueCents)}`
          : item.paidCents >= item.priceCents
            ? "opłacony"
            : "bez należności"}
      </p>
      {item.status === "expired" && (
        <p className={styles.rowNote}>
          Pakiet wygasł. Pozostałych wejść nie można przypisać do kolejnych
          spacerów.
        </p>
      )}
      {item.reservations.length > 0 && (
        <Details
          title="Przypisane spacery"
          icon={<CalendarDays aria-hidden="true" />}
        >
          <ol className={styles.ledger}>
            {item.reservations.map((reservation) => (
              <li key={reservation.id}>
                <strong>{reservation.title}</strong>
                <time dateTime={reservation.startsAt}>
                  {dateLabel(reservation.startsAt)}
                </time>
                {admin && reservation.canRelease && (
                  <Details title="Odłącz wejście od tego spaceru">
                    <p>
                      Pies pozostanie zapisany na spacer. Wróci należność za
                      pojedynczy udział, a wejście będzie znów dostępne w
                      pakiecie.
                    </p>
                    <ActionForm
                      action={releasePackage}
                      label="Odłącz wejście"
                      confirm="Odłączyć wejście? Pies pozostanie zapisany na spacer, a jego udział będzie znów płatny osobno."
                    >
                      <input
                        type="hidden"
                        name="registration_id"
                        value={reservation.id}
                      />
                      <NoteField required label="Powód odłączenia wejścia" />
                    </ActionForm>
                  </Details>
                )}
              </li>
            ))}
          </ol>
        </Details>
      )}
      <Details title="Historia wejść" icon={<ReceiptText aria-hidden="true" />}>
        {item.transactions.length ? (
          <ol className={styles.ledger}>
            {[...item.transactions]
              .sort((a, b) => b.created_at.localeCompare(a.created_at))
              .map((transaction) => (
                <li key={transaction.id}>
                  <strong>{transaction.reason}</strong>
                  <p>{deltaDescription(transaction)}</p>
                  <time dateTime={transaction.created_at}>
                    {dateLabel(transaction.created_at)}
                  </time>
                </li>
              ))}
          </ol>
        ) : (
          <p>Historia zmian salda pojawi się po pierwszej operacji.</p>
        )}
      </Details>
      {admin && item.canCancel && (
        <Details title="Anuluj niewykorzystany pakiet">
          <p>
            Pakiet przestanie być dostępny, a jego należność zostanie zamknięta.
            Otrzymaną wcześniej wpłatę rozlicz osobno w historii wpłat.
          </p>
          <ActionForm
            action={cancelPackage}
            label="Anuluj pakiet"
            confirm={`Anulować pakiet „${item.name}” psa ${item.dogName}? Ta zmiana nie wykona zwrotu pieniędzy.`}
          >
            <input type="hidden" name="package_id" value={item.id} />
            <NoteField required label="Powód anulowania pakietu" />
          </ActionForm>
        </Details>
      )}
    </article>
  );
}
