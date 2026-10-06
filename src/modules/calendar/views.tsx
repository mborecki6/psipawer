import Link from "next/link";
import { CalendarDays, Clock3, LockKeyhole, ArrowRight } from "lucide-react";
import type { Appointment, CalendarSettings } from "./types";
import { localDate, onDay, dayLabel, clockTime, weekRange } from "./dates";
import { BlockEditor, CreateBlockEditor } from "./editor";
import styles from "./calendar.module.css";
import { CalendarSettingsEditor } from "./settings-editor";
const labels = {
  walk: "Spacer",
  consultation: "Spotkanie indywidualne",
  block: "Czas prywatny",
  course: "Spotkanie kursu",
  fitness: "PSI FITNESS",
};
export function CalendarView({
  appointments,
  range,
  admin,
  newBlockId,
  now,
  settings,
}: {
  appointments: Appointment[];
  range: ReturnType<typeof weekRange>;
  admin: boolean;
  newBlockId: string;
  now: string;
  settings?: CalendarSettings | null;
}) {
  const today = localDate(now);
  const base = admin ? "/admin" : "/app";
  return (
    <div className="stack">
      <header className={styles.header}>
        <span className={styles.eyebrow}>
          <CalendarDays size={17} /> Wasz czas
        </span>
        <h2>
          {admin
            ? "Spokojnie zaplanowany tydzień."
            : "Wasze spotkania w jednym miejscu."}
        </h2>
        <p className="muted">
          {admin
            ? "Spacery, konsultacje, kursy, fitness i czas dla siebie. Nakładające się terminy są blokowane przy zapisie."
            : "Potwierdzone spacery, kursy i umówione spotkania Twoich psów. Zgłoszenia oczekujące znajdziesz w odpowiednich zakładkach."}
        </p>
      </header>
      <div className={styles.toolbar}>
        {admin && (
          <a className="ghost-button" href="#calendar-block-editor">
            Zablokuj czas ↓
          </a>
        )}
        <nav aria-label="Tygodnie kalendarza" className={styles.controls}>
          <Link className="ghost-button" href={`?date=${range.previous}`}>
            ← Poprzedni
          </Link>
          <Link className="ghost-button" href={base + "/calendar"}>
            Bieżący tydzień
          </Link>
          <Link className="ghost-button" href={`?date=${range.next}`}>
            Następny →
          </Link>
        </nav>
        <form className={styles.dateJump}>
          <label htmlFor="calendar-date">Przejdź do daty</label>
          <input
            id="calendar-date"
            name="date"
            type="date"
            defaultValue={range.start}
            min="2000-01-01"
            max="2099-12-31"
            required
          />
          <button className="small-button">Pokaż</button>
        </form>
      </div>
      <div className={admin ? styles.layout : ""}>
        <div className={styles.days}>
          {range.days.map((day) => {
            const items = appointments.filter((a) => onDay(a, day));
            return (
              <section
                key={day}
                className={`card ${styles.day}`}
                aria-label={dayLabel(day)}
              >
                <header className={styles.dayHead}>
                  <h3>{dayLabel(day)}</h3>
                  {day === today && <span className="badge">Dzisiaj</span>}
                  <small>
                    {items.length
                      ? `${items.length} w planie`
                      : admin
                        ? "Bez zaplanowanych zajęć"
                        : "Bez spotkań"}
                  </small>
                </header>
                <div className={styles.events}>
                  {items.map((a) => {
                    const before = localDate(a.starts_at) < day;
                    const later = localDate(a.ends_at) > day;
                    const href = `${base}/${a.kind === "walk" ? "walks" : a.kind === "course" ? "courses" : a.kind === "fitness" ? "fitness" : "consultations"}/${a.id}`;
                    return (
                      <article
                        key={`${a.kind}-${a.id}-${a.starts_at}`}
                        className={`${styles.event} ${styles[a.kind]}`}
                      >
                        <div className={styles.eventTime}>
                          <Clock3 size={14} />
                          {before
                            ? "od poprzedniego dnia"
                            : clockTime(a.starts_at)}{" "}
                          – {later ? "do kolejnego dnia" : clockTime(a.ends_at)}
                        </div>
                        <div className={styles.eventMain}>
                          <span className={styles.kind}>
                            {labels[a.kind]}
                            {a.status === "completed" ? " · zakończone" : ""}
                          </span>
                          <h4>{a.title}</h4>
                          {a.location && <p>{a.location}</p>}
                          {a.kind === "block" ? (
                            admin && (
                              <details>
                                <summary>Zmień lub usuń blokadę</summary>
                                <BlockEditor id={a.id} initial={a} />
                              </details>
                            )
                          ) : (
                            <Link className="ghost-button" href={href}>
                              Otwórz szczegóły <ArrowRight size={15} />
                            </Link>
                          )}
                        </div>
                      </article>
                    );
                  })}
                  {!items.length && (
                    <p className="muted">
                      {admin
                        ? "Możesz zaplanować spotkanie lub zarezerwować czas dla siebie."
                        : "Nie masz tutaj potwierdzonych terminów."}
                    </p>
                  )}
                </div>
              </section>
            );
          })}
        </div>
        {admin && (
          <aside className="stack">
            {settings && (
              <article className="card pad" id="calendar-settings">
                <h3>
                  <Clock3 size={18} /> Rytm pracy
                </h3>
                <p className="muted">
                  {settings.hours_enabled
                    ? "Harmonogram tygodnia jest włączony."
                    : "Harmonogram tygodnia jest wyłączony."}{" "}
                  Przerwy: {settings.before_minutes} min przed i{" "}
                  {settings.after_minutes} min po spotkaniu.
                </p>
                <details>
                  <summary>Ustaw godziny i przerwy</summary>
                  <CalendarSettingsEditor initial={settings} />
                </details>
              </article>
            )}
            <article className="card pad" id="calendar-block-editor">
              <h3>
                <LockKeyhole size={18} /> Zarezerwuj czas
              </h3>
              <p className="muted">
                Blokada jest widoczna tylko dla zespołu. Może obejmować przerwę,
                dojazd lub kilka dni urlopu.
              </p>
              <CreateBlockEditor id={newBlockId} />
            </article>
            <article className={`card pad ${styles.note}`}>
              <h3>Zaplanuj spotkanie</h3>
              <p>
                Termin konsultacji ustalisz z jej zgłoszenia. Spacer dodasz
                bezpośrednio.
              </p>
              <div className={styles.quickLinks}>
                <Link
                  className="ghost-button"
                  href="/admin/consultations?filter=requested"
                >
                  Zgłoszenia do ustalenia →
                </Link>
                <Link className="ghost-button" href="/admin/walks/new">
                  Dodaj spacer →
                </Link>
              </div>
              <p className="muted">
                Blokada nie odwołuje istniejących zajęć. Jeśli czas jest już
                zajęty, najpierw uzgodnij zmianę spotkania.
              </p>
            </article>
          </aside>
        )}
      </div>
    </div>
  );
}
