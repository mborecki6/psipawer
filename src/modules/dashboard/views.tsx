import Link from "next/link";
import { ProgressiveDetails } from "@/components/progressive-details";
import { dateLabel } from "@/lib/domain";
import type { DashboardItem } from "./model";
import type { CareSummary } from "@/modules/care/types";
import type { OfferItem } from "@/modules/calendar-offer/types";
import { offerBookingNote, offerHref } from "@/modules/calendar-offer/model";
import styles from "./dashboard.module.css";

function DashboardRow({ item }: { item: DashboardItem }) {
  return (
    <Link className={`list-row ${styles.row}`} href={item.href}>
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
      </div>
      <span className={styles.action}>{item.action} →</span>
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
  const preview = current.slice(0, 4);
  const remaining = current.slice(4);
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
              ? "Nie masz teraz otwartych zgłoszeń."
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
          </nav>
        </ProgressiveDetails>
      </div>
    </article>
  );
}

export function DashboardCare({ plans }: { plans: CareSummary[] }) {
  return (
    <article className={`card ${styles.valueCard}`}>
      <div className="card-head">
        <h2>Zalecenia od Asi</h2>
        <Link className="ghost-button" href="/app/care">
          Wszystkie →
        </Link>
      </div>
      <div className="card-body">
        {plans.slice(0, 2).map((plan) => (
          <Link
            key={plan.id}
            className={`list-row ${styles.row}`}
            href={`/app/dogs/${plan.dog_id}/care?plan=${plan.id}`}
          >
            <div className={`list-main ${styles.main}`}>
              <span>{plan.dog_name}</span>
              <strong>{plan.title}</strong>
            </div>
            <span className={styles.action}>Wróć do planu →</span>
          </Link>
        ))}
        {!plans.length && (
          <p className="muted">
            Po spotkaniu pojawią się tu wskazówki od Asi — żeby łatwiej było
            wrócić do nich w domu.
          </p>
        )}
      </div>
    </article>
  );
}

export function DashboardSuggestions({ items }: { items: OfferItem[] }) {
  return (
    <article className={`card ${styles.valueCard}`}>
      <div className="card-head">
        <h2>Pomysł na kolejne spotkanie</h2>
      </div>
      <div className="card-body">
        {items.map((item) => (
          <div
            className={styles.suggestion}
            key={`${item.kind}:${item.source_id}`}
          >
            <span className={styles.eyebrow}>
              {item.category === "group"
                ? "Wspólnie w grupie"
                : "Indywidualnie"}
            </span>
            <h3>{item.title}</h3>
            <p>
              {dateLabel(item.starts_at)}
              {item.public_location ? ` · ${item.public_location}` : ""}
            </p>
            <p className={styles.offerNote}>{offerBookingNote(item)}</p>
            <Link className="text-button" href={offerHref(item)}>
              Sprawdź zajęcia →
            </Link>
          </div>
        ))}
        {!items.length && (
          <p className="muted">
            Masz ochotę spróbować czegoś nowego? Poznaj zajęcia i znajdź coś dla
            Was.
          </p>
        )}
        <Link
          className="secondary-button"
          href={items.length ? "/app/calendar/offer" : "/app/services"}
        >
          {items.length ? "Zobacz wszystkie zajęcia →" : "Poznaj ofertę →"}
        </Link>
      </div>
    </article>
  );
}
