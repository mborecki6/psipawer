import Link from "next/link";
import { ProgressiveDetails } from "@/components/progressive-details";
import { dateLabel, money } from "@/lib/domain";
import { hasFinancialIssue, type DashboardItem } from "./model";
import styles from "./dashboard.module.css";

function DashboardRow({ item }: { item: DashboardItem }) {
  const financial = hasFinancialIssue(item);
  const href =
    item.charges[0]?.href || item.reviewPayments[0]?.href || item.href;
  return (
    <Link className={`list-row ${styles.row}`} href={href}>
      <div className={`list-main ${styles.main}`}>
        <strong>{item.dogName}</strong>
        <span>{item.service}</span>
        <span>
          {item.startsAt
            ? dateLabel(item.startsAt)
            : item.open
              ? "Termin do ustalenia"
              : "Bez zaplanowanego terminu"}
        </span>
        <span>{item.status}</span>
        {item.charges.map((charge) => (
          <span className={styles.finance} key={`${charge.kind}:${charge.id}`}>
            {charge.reviewReason === "settlement"
              ? "Rozliczenie po rezygnacji do uzgodnienia"
              : charge.refundDueCents && charge.refundDueCents > 0
                ? `Do zwrotu: ${money(charge.refundDueCents)}`
                : charge.dueCents > 0
                  ? `Do zapłaty: ${money(charge.dueCents)}`
                  : "Rozliczenie wymaga sprawdzenia"}
          </span>
        ))}
        {item.reviewPayments.length > 0 && (
          <span className={styles.finance}>
            {item.reviewPayments.length === 1
              ? `Wpłata ${money(item.reviewPayments[0].amountCents)} wymaga sprawdzenia`
              : `Wpłaty wymagają sprawdzenia: ${item.reviewPayments.length}`}
          </span>
        )}
      </div>
      <span className={styles.action}>
        {financial ? "Sprawdź rozliczenie" : item.action} →
      </span>
    </Link>
  );
}

export function DashboardRegistrations({
  current,
  history,
}: {
  current: DashboardItem[];
  history: DashboardItem[];
}) {
  // Financial exceptions always remain visible. Only ordinary open cases use
  // a compact preview, with every remaining case mounted in the disclosure.
  const financial = current.filter(hasFinancialIssue);
  const ordinary = current.filter((item) => !hasFinancialIssue(item));
  const preview = [...financial, ...ordinary.slice(0, 4)];
  const remaining = ordinary.slice(4);
  return (
    <article className="card">
      <div className="card-head">
        <h2>Bieżące zgłoszenia</h2>
      </div>
      <div className="card-body">
        <div className="list">
          {preview.map((item) => (
            <DashboardRow key={item.key} item={item} />
          ))}
        </div>
        {!current.length && (
          <p>
            {history.length
              ? "Nie masz teraz otwartych zgłoszeń ani spraw rozliczeniowych."
              : "Nie masz jeszcze zgłoszeń."}
          </p>
        )}
        {remaining.length > 0 && (
          <ProgressiveDetails
            label={`Pozostałe bieżące zgłoszenia (${remaining.length})`}
            className={styles.details}
          >
            {remaining.map((item) => (
              <DashboardRow key={item.key} item={item} />
            ))}
          </ProgressiveDetails>
        )}
        <ProgressiveDetails
          label={`Historia zgłoszeń${history.length ? ` (${history.length})` : " i listy usług"}`}
          className={styles.details}
        >
          {history.map((item) => (
            <DashboardRow key={item.key} item={item} />
          ))}
          <nav className={styles.links} aria-label="Listy usług i historia">
            <Link href="/app/walks?filter=completed">Zakończone spacery</Link>
            <Link href="/app/walks?filter=cancelled">Odwołane spacery</Link>
            <Link href="/app/consultations?filter=history">Konsultacje</Link>
            <Link href="/app/courses?filter=history">Kursy</Link>
            <Link href="/app/fitness?filter=history">Fitness</Link>
            <Link href="/app/service-requests?filter=history">
              Prośby o termin
            </Link>
            <Link href="/app/finance">Rozliczenia i wpłaty</Link>
          </nav>
        </ProgressiveDetails>
      </div>
    </article>
  );
}
