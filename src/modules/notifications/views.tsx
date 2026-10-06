import Link from "next/link";
import { Bell, CheckCheck, ArrowDown } from "lucide-react";
import { ActionForm } from "@/components/action-form";
import { dateLabel } from "@/lib/domain";
import type { Role } from "@/lib/auth/session";
import {
  notificationLabels,
  type Notification,
  type NotificationFilter,
} from "./types";
import { markNotificationsRead, openNotification } from "./actions";
import { RefreshInbox } from "./refresh";
import styles from "./notifications.module.css";

export function NotificationInboxView({
  role,
  items,
  count,
  filter,
  more,
  before,
  resetRequired,
}: {
  role: Role;
  items: Notification[];
  count: number;
  filter: NotificationFilter;
  more: boolean;
  before?: string;
  resetRequired: boolean;
}) {
  const base = role === "admin" ? "/admin" : "/app";
  const href = `${base}/notifications`;
  const unread = items.filter((n) => n.read_at === null);
  return (
    <div className="stack">
      <header className={styles.header}>
        <div>
          <span className={styles.eyebrow}>
            <Bell size={17} aria-hidden="true" />
            Ważne sprawy w jednym miejscu
          </span>
          <h2>Co nowego u Was?</h2>
          <p className="muted">
            {count
              ? `Nieprzeczytane powiadomienia: ${count}.`
              : "Wszystkie powiadomienia są przeczytane."}{" "}
            Odśwież, aby sprawdzić najnowsze zmiany.
          </p>
        </div>
        <div className={styles.actions}>
          {role === "admin" && (
            <Link className="ghost-button" href="/admin/reminders">
              Przypomnienia
            </Link>
          )}
          <RefreshInbox />
        </div>
      </header>
      <nav className={styles.tabs} aria-label="Filtr powiadomień">
        <Link
          href={href}
          aria-current={filter === "unread" ? "page" : undefined}
        >
          Nieprzeczytane
        </Link>
        <Link
          href={`${href}?filter=all`}
          aria-current={filter === "all" ? "page" : undefined}
        >
          Wszystkie
        </Link>
      </nav>
      {unread.length > 0 && (
        <div className={styles.bulk}>
          <ActionForm
            action={markNotificationsRead}
            label="Oznacz tę stronę jako przeczytaną"
            pendingLabel="Oznaczam…"
          >
            {unread.map((n) => (
              <input key={n.id} type="hidden" name="id" value={n.id} />
            ))}
          </ActionForm>
          <p className="muted">
            Dotyczy {unread.length} powiadomień z tej strony. Przeczytanie
            wiadomości nie kończy sprawy.
          </p>
        </div>
      )}
      {resetRequired ? (
        <article className="card pad">
          <h3>Wróć do najnowszych powiadomień</h3>
          <p className="muted">
            Poprzedni fragment listy jest już niedostępny. Otwórz jej początek.
          </p>
          <Link className="primary-button" href={`${href}?filter=${filter}`}>
            Pokaż początek listy
          </Link>
        </article>
      ) : items.length ? (
        <ol className={styles.list}>
          {items.map((n) => (
            <li
              className={`card ${styles.item} ${n.read_at ? "" : styles.unread}`}
              key={n.id}
            >
              <div className={styles.itemHeader}>
                <span
                  className={n.read_at ? styles.readLabel : styles.newLabel}
                >
                  {n.read_at ? (
                    <CheckCheck size={15} aria-hidden="true" />
                  ) : (
                    <span className={styles.dot} aria-hidden="true" />
                  )}
                  {n.read_at ? "Przeczytane" : "Nowe"}
                </span>
                <time dateTime={n.created_at}>{dateLabel(n.created_at)}</time>
              </div>
              <h3>{notificationLabels[n.kind]}</h3>
              <p className={styles.dogName}>{n.dog_name}</p>
              <p className="muted">
                {n.kind === "progress_reviewed"
                  ? "Twoja odpowiedź została oznaczona jako przeczytana. Dalsze zalecenia znajdziesz przy planie psa."
                  : n.kind.startsWith("course_payment_") ||
                      n.kind === "course_settled"
                    ? "Aktualne rozliczenie i historię wpłat znajdziesz przy zgłoszeniu na kurs."
                    : n.kind.startsWith("fitness_payment_") ||
                        n.kind === "fitness_settled"
                      ? "Aktualne rozliczenie i historię wpłat znajdziesz przy pakiecie PSI FITNESS."
                      : n.kind === "course_reminder" ||
                          n.kind === "fitness_reminder"
                        ? "Przypomnienie dotyczy jednego spotkania. Otwórz jego aktualny termin i miejsce."
                        : n.kind.startsWith("payment_")
                          ? "Szczegóły wpłaty i aktualne saldo znajdziesz w finansach."
                          : "Otwórz sprawę, aby zobaczyć aktualny stan i szczegóły."}
              </p>
              <div className={styles.actions}>
                <ActionForm
                  action={openNotification}
                  label="Otwórz sprawę"
                  pendingLabel="Otwieram…"
                >
                  <input type="hidden" name="id" value={n.id} />
                </ActionForm>
                {!n.read_at && (
                  <ActionForm
                    action={markNotificationsRead}
                    label="Przeczytane"
                    pendingLabel="Oznaczam…"
                  >
                    <input type="hidden" name="id" value={n.id} />
                  </ActionForm>
                )}
              </div>
            </li>
          ))}
        </ol>
      ) : (
        <article className={`card pad ${styles.empty}`}>
          <Bell aria-hidden="true" size={28} />
          <h3>
            {filter === "unread"
              ? count
                ? "Sprawdź najnowsze powiadomienia"
                : "Wszystko przeczytane"
              : "Tutaj pojawią się ważne zmiany"}
          </h3>
          <p className="muted">
            {filter === "unread"
              ? "Nie ma więcej nieprzeczytanych powiadomień w tej części listy. Wcześniejsze wiadomości znajdziesz w zakładce Wszystkie."
              : "Powiadomienia o spotkaniach, planach i wpłatach pojawią się po kolejnych zmianach w aplikacji."}
          </p>
        </article>
      )}
      <nav className={styles.paging} aria-label="Strony powiadomień">
        {before && !resetRequired && (
          <Link className="ghost-button" href={`${href}?filter=${filter}`}>
            Wróć do najnowszych
          </Link>
        )}
        {more && items.length > 0 && (
          <Link
            className="ghost-button"
            href={`${href}?filter=${filter}&before=${items[items.length - 1].id}`}
          >
            Starsze powiadomienia <ArrowDown size={16} aria-hidden="true" />
          </Link>
        )}
      </nav>
    </div>
  );
}
