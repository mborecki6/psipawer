import Link from "next/link";
import { randomUUID } from "node:crypto";
import { Activity } from "lucide-react";
import { dateLabel, money } from "@/lib/domain";
import type { getFitnessPackage } from "./queries";
import type { FitnessPackage, FitnessHistory } from "./types";
import {
  fitnessLabels,
  fitnessSessionLabels,
  fitnessAttendanceLabels,
} from "./types";
import { FitnessCommandForm, FitnessScheduleForm } from "./forms";
import { FitnessBilling } from "./billing";
import { FitnessCarePanel } from "./care-panel";
import type { FitnessCarePage } from "@/modules/care/types";
import styles from "./fitness.module.css";
export function FitnessListView({
  packages,
  role,
  filter,
  page,
  more,
}: {
  packages: FitnessPackage[];
  role: "admin" | "client";
  filter: string;
  page: number;
  more: boolean;
}) {
  const admin = role === "admin",
    base = admin ? "/admin" : "/app";
  const href = (f: string, p = 1) =>
    `?${new URLSearchParams({ filter: f, page: String(p) })}`;
  return (
    <div className="stack">
      <header className={styles.header}>
        <span className={styles.eyebrow}>
          <Activity size={18} /> Ruch i współpraca
        </span>
        <h2>PSI FITNESS</h2>
        <p className="muted">
          {admin
            ? "Zgłoszenia, indywidualne terminy i rozliczenie całego pakietu w jednym miejscu."
            : "Twoje pakiety i spotkania. Każdy termin ustalisz z prowadzącą."}
        </p>
      </header>
      <div className={styles.toolbar}>
        {!admin && (
          <Link className="primary-button" href="/app/fitness/new">
            Zgłoś psa na fitness →
          </Link>
        )}
        <Link className="ghost-button" href={`${base}/calendar`}>
          Wspólny kalendarz →
        </Link>
        {!admin && (
          <Link className="ghost-button" href="/app/services">
            Oferta i ceny →
          </Link>
        )}
      </div>
      <nav className={styles.toolbar} aria-label="Filtry pakietów fitness">
        {[
          ["open", "Otwarte"],
          ["requested", "Do decyzji"],
          ["active", "W trakcie"],
          ["history", "Historia"],
          ["all", "Wszystkie"],
        ].map(([f, label]) => (
          <Link
            key={f}
            className={f === filter ? "primary-button" : "ghost-button"}
            aria-current={f === filter ? "page" : undefined}
            href={href(f)}
          >
            {label}
          </Link>
        ))}
      </nav>
      {packages.length ? (
        <div className={styles.grid}>
          {packages.map((p) => (
            <article key={p.id} className={`card pad ${styles.package}`}>
              <span
                className={`badge ${p.status === "active" ? "green" : p.status === "requested" ? "amber" : "neutral"}`}
              >
                {fitnessLabels[p.status]}
              </span>
              <h3>{p.dogs?.name || "Pies z wcześniejszego zgłoszenia"}</h3>
              <p>{p.service_name}</p>
              <p className="muted">
                {p.sessions_count} spotkania po {p.duration_minutes} min
              </p>
              <strong>{money(p.agreed_price_cents)} za cały pakiet</strong>
              <small className="muted">
                Zgłoszenie: {dateLabel(p.created_at)}
                {p.is_test_price && " · cena robocza"}
              </small>
              <Link className="ghost-button" href={`${base}/fitness/${p.id}`}>
                Otwórz pakiet →
              </Link>
            </article>
          ))}
        </div>
      ) : (
        <div className="card pad">
          <h3>Brak pakietów w tym widoku</h3>
          <p className="muted">
            {admin
              ? "Nowe zgłoszenia opiekunów pojawią się tutaj."
              : "Zgłoś własnego psa lub wybierz inny filtr, aby zobaczyć wcześniejsze zgłoszenia."}
          </p>
        </div>
      )}
      <nav className={styles.toolbar} aria-label="Strony pakietów fitness">
        {page > 1 && (
          <Link className="ghost-button" href={href(filter, page - 1)}>
            ← Poprzednia
          </Link>
        )}
        <span className="muted">Strona {page}</span>
        {more && (
          <Link className="ghost-button" href={href(filter, page + 1)}>
            Następna →
          </Link>
        )}
      </nav>
    </div>
  );
}
const historyLabels: Record<string, string> = {
  requested: "Zgłoszony pakiet",
  accept: "Przyjęty pakiet",
  reject: "Nieprzyjęte zgłoszenie",
  cancel: "Rezygnacja lub odwołanie",
  complete: "Zakończenie",
  resume: "Wznowiony pakiet",
  restore: "Przywrócony przyjęty pakiet",
  reconsider: "Zgłoszenie ponownie do decyzji",
  scheduled: "Ustalony termin",
  rescheduled: "Przełożony termin",
  reopen: "Spotkanie ponownie do umówienia",
  correct: "Korekta obecności",
  settled: "Uzgodniona kwota po rezygnacji",
  payment_recorded: "Odnotowana wpłata",
  payment_refunded: "Odnotowany zwrot",
};
function HistoryDetails({ row }: { row: FitnessHistory }) {
  const prev = row.details.previous_attendance,
    next = row.details.attendance;
  const attendance = (v: unknown) =>
    typeof v === "string" && v in fitnessAttendanceLabels
      ? fitnessAttendanceLabels[v as keyof typeof fitnessAttendanceLabels]
      : "Brak zapisu";
  const date = (v: unknown) =>
    typeof v === "string" && Number.isFinite(Date.parse(v))
      ? dateLabel(v)
      : null;
  return (
    <>
      {row.session_id &&
        (typeof prev === "string" || typeof next === "string") && (
          <p>
            Obecność: {attendance(prev)} → {attendance(next)}
          </p>
        )}
      {date(row.details.previous_starts_at) && (
        <p>Poprzedni termin: {date(row.details.previous_starts_at)}</p>
      )}
      {date(row.details.starts_at) && (
        <p>Termin: {date(row.details.starts_at)}</p>
      )}
      {typeof row.details.amount_cents === "number" && (
        <p>Kwota: {money(row.details.amount_cents)}</p>
      )}
      {typeof row.details.charge_cents === "number" && (
        <p>Należność: {money(row.details.charge_cents)}</p>
      )}
    </>
  );
}
export function FitnessDetailView({
  data,
  historyPage,
  now,
  care,
  plansPage,
}: {
  data: Awaited<ReturnType<typeof getFitnessPackage>>;
  historyPage: number;
  now: string;
  care: FitnessCarePage;
  plansPage: number;
}) {
  const {
    pack: p,
    sessions,
    balance,
    payments,
    refunds,
    history,
    historyMore,
    role,
  } = data;
  const admin = role === "admin",
    base = admin ? "/admin" : "/app",
    refreshHref = `${base}/fitness/${p.id}`;
  const progress = sessions.filter((s) => s.status === "completed").length;
  return (
    <div className="stack">
      <header className={styles.header}>
        <Link className="text-button" href={`${base}/fitness`}>
          ← Pakiety fitness
        </Link>
        <h2>{p.service_name}</h2>
        <div className={styles.badges}>
          <span
            className={`badge ${p.status === "active" ? "green" : p.status === "requested" ? "amber" : "neutral"}`}
          >
            {fitnessLabels[p.status]}
          </span>
          <span className="badge neutral">
            {p.dogs?.name || "Pies z wcześniejszego zgłoszenia"}
          </span>
          {p.is_test_price && (
            <span className="badge neutral">Cena robocza</span>
          )}
        </div>
      </header>
      <div className={styles.detail}>
        <div className="stack">
          <section className="card pad">
            <h3>Warunki pakietu</h3>
            <dl className={styles.facts}>
              <div>
                <dt>Cena z chwili zgłoszenia</dt>
                <dd>{money(p.agreed_price_cents)} za cały pakiet</dd>
              </div>
              <div>
                <dt>Spotkania indywidualne</dt>
                <dd>
                  {p.sessions_count} × {p.duration_minutes} min · miejsce
                  ustalane osobno
                </dd>
              </div>
              <div>
                <dt>Cel spotkań</dt>
                <dd className={styles.location}>{p.topic}</dd>
              </div>
              {p.availability && (
                <div>
                  <dt>Dostępność opiekuna</dt>
                  <dd className={styles.location}>{p.availability}</dd>
                </div>
              )}
              <div>
                <dt>Zgłoszenie</dt>
                <dd>{dateLabel(p.created_at)}</dd>
              </div>
            </dl>
            <p className="muted">
              Zmiana cennika nie przepisuje tych warunków. Zalecenia dobiera
              prowadząca po pracy z psem.
            </p>
          </section>
          <section className="stack" aria-labelledby="fitness-meetings">
            <div>
              <h3 id="fitness-meetings">Spotkania pakietu</h3>
              <p className="muted">
                Zakończone: {progress} z {p.sessions_count}. Nieobecność nie
                zmienia automatycznie opłaty.
              </p>
            </div>
            {!sessions.length && (
              <div className="card pad">
                <p className="muted">
                  Spotkania pojawią się po przyjęciu zgłoszenia przez
                  prowadzącą.
                </p>
              </div>
            )}
            {sessions.map((s) => (
              <article
                key={s.id}
                id={`spotkanie-${s.id}`}
                className={`card pad ${styles.session}`}
              >
                <div className={styles.toolbar}>
                  <h3>
                    Spotkanie {s.ordinal} z {p.sessions_count}
                  </h3>
                  <span
                    className={`badge ${s.status === "completed" ? "green" : "neutral"}`}
                  >
                    {fitnessSessionLabels[s.status]}
                  </span>
                </div>
                <p>
                  {s.starts_at ? dateLabel(s.starts_at) : "Termin do ustalenia"}{" "}
                  · {s.duration_minutes} min
                </p>
                {s.attendance && (
                  <p>
                    Obecność:{" "}
                    <strong>{fitnessAttendanceLabels[s.attendance]}</strong>
                  </p>
                )}
                {s.fitness_session_private_details?.exact_location && (
                  <p className={styles.location}>
                    {s.fitness_session_private_details.exact_location}
                  </p>
                )}
                {s.status === "scheduled" &&
                  !s.fitness_session_private_details && (
                    <p className="muted">
                      Dokładne miejsce nie jest dostępne dla tego konta.
                    </p>
                  )}
                {admin && (
                  <>
                    <details>
                      <summary>Ustal lub zmień termin spotkania</summary>
                      <FitnessScheduleForm
                        session={s}
                        enabled={
                          p.status === "active" &&
                          ["pending", "scheduled"].includes(s.status)
                        }
                        requestId={randomUUID()}
                        refreshHref={refreshHref}
                      />
                    </details>
                    <details>
                      <summary>Obecność, odwołanie lub korekta</summary>
                      <FitnessCommandForm
                        pack={p}
                        session={s}
                        admin
                        requestId={randomUUID()}
                        refreshHref={refreshHref}
                        now={now}
                      />
                    </details>
                  </>
                )}
              </article>
            ))}
          </section>
          <FitnessCarePanel
            care={care}
            pack={p}
            sessions={sessions}
            admin={admin}
            page={plansPage}
            href={(n) =>
              `${base}/fitness/${p.id}?${new URLSearchParams({ historyPage: String(historyPage), plans: String(n) })}#zalecenia`
            }
          />
          <section className="card pad">
            <h3>Historia pakietu</h3>
            {history.length ? (
              <ol className={styles.history}>
                {history.map((h) => (
                  <li key={h.id}>
                    <strong>
                      {historyLabels[h.action] || "Zapisana zmiana"}
                      {h.session_id
                        ? ` · spotkanie ${sessions.find((s) => s.id === h.session_id)?.ordinal || "pakietu"}`
                        : ""}
                    </strong>
                    <small>{dateLabel(h.created_at)}</small>
                    {h.note && <p>{h.note}</p>}
                    <HistoryDetails row={h} />
                  </li>
                ))}
              </ol>
            ) : (
              <p className="muted">Brak wpisów w historii.</p>
            )}
            <nav
              className={styles.toolbar}
              aria-label="Strony historii fitness"
            >
              {historyPage > 1 && (
                <Link
                  className="ghost-button"
                  href={`?historyPage=${historyPage - 1}`}
                >
                  ← Nowsze wpisy
                </Link>
              )}
              <span className="muted">Strona {historyPage}</span>
              {historyMore && (
                <Link
                  className="ghost-button"
                  href={`?historyPage=${historyPage + 1}`}
                >
                  Starsze wpisy →
                </Link>
              )}
            </nav>
          </section>
        </div>
        <aside className="stack">
          <section className="card pad">
            <h3>{admin ? "Obsługa pakietu" : "Twoje zgłoszenie"}</h3>
            <FitnessCommandForm
              pack={p}
              admin={admin}
              requestId={randomUUID()}
              refreshHref={refreshHref}
              now={now}
              allSessionsCompleted={progress === p.sessions_count}
            />
          </section>
          <FitnessBilling
            balance={balance}
            payments={payments}
            refunds={refunds}
            admin={admin}
          />
          <Link className="ghost-button" href={`${base}/calendar`}>
            Otwórz wspólny kalendarz →
          </Link>
        </aside>
      </div>
    </div>
  );
}
