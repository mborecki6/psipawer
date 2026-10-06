import Link from "next/link";
import { ActionForm } from "@/components/action-form";
import { dateLabel } from "@/lib/domain";
import { RefreshInbox } from "../notifications/refresh";
import { processReminders, retryReminder } from "./actions";
import {
  reminderHref,
  reminderKinds,
  reminderStatuses,
  retryQueuedMessage,
  type Reminder,
  type ReminderAttempt,
  type ReminderCount,
  type ReminderStatus,
  type WorkerState,
} from "./types";
import styles from "./reminders.module.css";

function Retry({ job }: { job: Reminder }) {
  return job.status === "failed" ? (
    <ActionForm
      action={retryReminder}
      label="Ponów przypomnienie"
      pendingLabel="Dodaję do kolejki…"
    >
      <input type="hidden" name="id" value={job.id} />
      <input type="hidden" name="attempts" value={job.attempts} />
    </ActionForm>
  ) : null;
}
function JobSummary({ job: j }: { job: Reminder }) {
  return (
    <>
      <div className={styles.row}>
        <span className={`badge ${j.status === "failed" ? "red" : ""}`}>
          {reminderStatuses[j.status]}
        </span>
        <span className="muted">Próby: {j.attempts}</span>
      </div>
      <h3>
        {reminderKinds[j.kind]} · {j.dogs?.name || "Pies"}
      </h3>
      <dl className={styles.facts}>
        <div>
          <dt>{j.kind === "follow_up" ? "Dzień kontaktu" : "Spotkanie"}</dt>
          <dd>
            {j.kind === "follow_up"
              ? new Intl.DateTimeFormat("pl-PL", {
                  dateStyle: "long",
                  timeZone: "Europe/Warsaw",
                }).format(new Date(j.target_at))
              : dateLabel(j.target_at)}
          </dd>
        </div>
        <div>
          <dt>Przypomnienie od</dt>
          <dd>{dateLabel(j.due_at)}</dd>
        </div>
        {j.status === "retry" && (
          <div>
            <dt>Kolejna próba od</dt>
            <dd>{dateLabel(j.next_attempt_at)}</dd>
          </div>
        )}
      </dl>
      {j.status === "retry" && j.cycle_attempts === 0 && (
        <p role="status" className="alert green">
          {retryQueuedMessage}
        </p>
      )}
      {j.status === "failed" && (
        <p className="alert red">
          Dostarczenie nie powiodło się po pięciu próbach. Możesz uruchomić
          kolejny cykl prób.
        </p>
      )}
      {j.status === "cancelled" && (
        <p className="muted">
          Termin, status lub źródłowa sprawa zmieniły się. To przypomnienie nie
          zostanie dostarczone.
        </p>
      )}
      {j.status === "sent" && (
        <p className="muted">
          Zapisano w skrzynce aplikacji. Ten status nie potwierdza przeczytania
          ani wysłania e-maila.
        </p>
      )}
    </>
  );
}
export function ReminderQueueView({
  items,
  counts,
  worker,
  filter,
  page,
  more,
}: {
  items: Reminder[];
  counts: ReminderCount[];
  worker: WorkerState;
  filter: ReminderStatus | "all";
  page: number;
  more: boolean;
}) {
  const due = counts.reduce((n, c) => n + Number(c.due), 0);
  const failed = counts.find((c) => c.status === "failed")?.total || 0;
  return (
    <div className="stack">
      <Link className="ghost-button" href="/admin/notifications">
        ← Powiadomienia
      </Link>
      <header className={styles.header}>
        <div>
          <span className="eyebrow">Kontakt na czas</span>
          <h2>Przypomnienia</h2>
          <p className="muted">
            Przed spotkaniem — 24 godziny wcześniej. Kontakt kontrolny — w
            wybranym dniu o 9:00, według czasu w Polsce.
          </p>
        </div>
        <RefreshInbox />
      </header>
      <article className="card pad">
        <h3>Do sprawdzenia teraz: {due}</h3>
        <p>Wymagają uwagi: {failed}.</p>
        <p className="muted">
          {worker
            ? `Ostatnie sprawdzenie: ${dateLabel(worker.last_run_at)}.`
            : "Kolejka nie została jeszcze uruchomiona."}{" "}
          Czas ostatniego sprawdzenia nie oznacza, że proces nadal działa.
        </p>
        <p className="muted">
          Przypomnienia trafiają do skrzynki w aplikacji. O spotkaniach
          przypominamy opiekunom, a o kontakcie kontrolnym — zespołowi
          prowadzącemu.
        </p>
        <ActionForm
          action={processReminders}
          label="Sprawdź do 50 oczekujących"
          pendingLabel="Sprawdzam kolejkę…"
        >
          <span className="sr-only">
            Dostarcz tylko przypomnienia, których czas już nadszedł.
          </span>
        </ActionForm>
      </article>
      <nav className={styles.filters} aria-label="Stan przypomnień">
        {(["all", ...Object.keys(reminderStatuses)] as const).map((s) => (
          <Link
            className="ghost-button"
            key={s}
            href={`/admin/reminders?filter=${s}`}
            aria-current={filter === s ? "page" : undefined}
          >
            {s === "all"
              ? "Wszystkie"
              : `${reminderStatuses[s as ReminderStatus]} (${counts.find((c) => c.status === s)?.total || 0})`}
          </Link>
        ))}
      </nav>
      {items.length ? (
        <ol className={styles.list}>
          {items.map((j) => (
            <li key={j.id} className="card pad">
              <JobSummary job={j} />
              <div className={styles.row}>
                <Link
                  className="ghost-button"
                  href={`/admin/reminders/${j.id}`}
                >
                  Szczegóły i próby
                </Link>
                <Retry job={j} />
              </div>
            </li>
          ))}
        </ol>
      ) : (
        <article className="card pad">
          <h3>Brak przypomnień w tym widoku</h3>
          <p className="muted">
            Powstają po umówieniu konsultacji lub spotkania fitness, przyjęciu
            udziału w spacerze lub kursie oraz zaplanowaniu kontaktu przy
            zaleceniach.
          </p>
        </article>
      )}
      <nav className={styles.row} aria-label="Strony przypomnień">
        {page > 1 && (
          <Link
            className="ghost-button"
            href={`?filter=${filter}&page=${page - 1}`}
          >
            ← Nowsze
          </Link>
        )}
        {more && (
          <Link
            className="ghost-button"
            href={`?filter=${filter}&page=${page + 1}`}
          >
            Starsze →
          </Link>
        )}
      </nav>
    </div>
  );
}
export function ReminderDetailView({
  job,
  history,
  page,
  more,
}: {
  job: Reminder;
  history: ReminderAttempt[];
  page: number;
  more: boolean;
}) {
  return (
    <div className="stack">
      <Link className="ghost-button" href="/admin/reminders">
        ← Przypomnienia
      </Link>
      <article className="card pad">
        <JobSummary job={job} />
        <div className={styles.row}>
          <Link className="ghost-button" href={reminderHref(job)}>
            Otwórz aktualną sprawę
          </Link>
          <Retry job={job} />
        </div>
      </article>
      <article className="card pad">
        <h3>Historia prób</h3>
        {history.length ? (
          <ol className={styles.list}>
            {history.map((h) => (
              <li key={h.attempt}>
                <strong>
                  Próba {h.attempt} ·{" "}
                  {h.outcome === "sent"
                    ? "Zapisano w skrzynce"
                    : h.outcome === "failed"
                      ? "Nie udało się dostarczyć"
                      : "Sprawa jest już nieaktualna"}
                </strong>
                <p className="muted">{dateLabel(h.created_at)}</p>
              </li>
            ))}
          </ol>
        ) : (
          <p className="muted">
            Nie wykonano jeszcze próby dostarczenia. Zmiana terminu może wycofać
            zadanie przed pierwszą próbą.
          </p>
        )}
        <nav className={styles.row} aria-label="Strony historii prób">
          {page > 1 && (
            <Link className="ghost-button" href={`?page=${page - 1}`}>
              ← Nowsze
            </Link>
          )}
          {more && (
            <Link className="ghost-button" href={`?page=${page + 1}`}>
              Starsze →
            </Link>
          )}
        </nav>
      </article>
    </div>
  );
}
