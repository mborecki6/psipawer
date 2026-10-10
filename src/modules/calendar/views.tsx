import Link from "next/link";
import { CalendarDays, Clock3, LockKeyhole, ArrowRight } from "lucide-react";
import type {
  Appointment,
  CalendarSettings,
  CalendarTeamMember,
  CalendarResource,
} from "./types";
import {
  localDate,
  onDay,
  dayLabel,
  clockTime,
  weekRange,
  validCalendarDate,
  appointmentAnchor,
  isAllDayBlock,
} from "./dates";
import { BlockEditor, CreateBlockEditor, AssignmentEditor } from "./editor";
import styles from "./calendar.module.css";
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
  view = "week",
  selectedStaff = "all",
  selectedEvent,
  focusDate,
  members = [],
  resources = [],
  currentUserId,
}: {
  appointments: Appointment[];
  range: ReturnType<typeof weekRange>;
  admin: boolean;
  newBlockId: string;
  now: string;
  settings?: CalendarSettings | null;
  view?: "week" | "month";
  selectedStaff?: string;
  selectedEvent?: string;
  focusDate?: string;
  members?: CalendarTeamMember[];
  resources?: CalendarResource[];
  currentUserId?: string | null;
}) {
  const today = localDate(now);
  const focus = validCalendarDate(focusDate, new Date(now));
  const base = admin ? "/admin" : "/app";
  const filtered =
    admin && selectedStaff !== "all"
      ? appointments.filter((item) =>
          selectedStaff === "unassigned"
            ? !item.assigned_staff_id
            : item.assigned_staff_id === selectedStaff,
        )
      : appointments;
  const href = (date: string, mode = view) =>
    `${base}/calendar?date=${date}&view=${mode}${admin && selectedStaff !== "all" ? `&staff=${encodeURIComponent(selectedStaff)}` : ""}`;
  const monthTitle = new Intl.DateTimeFormat("pl-PL", {
    timeZone: "Europe/Warsaw",
    month: "long",
    year: "numeric",
  }).format(new Date(`${focus}T12:00:00Z`));
  return (
    <div className="stack">
      <header className={styles.header}>
        <span className={styles.eyebrow}>
          <CalendarDays size={17} /> Wasz czas
        </span>
        <h2>
          {admin
            ? "Spokojnie zaplanowane spotkania."
            : "Wasze spotkania w jednym miejscu."}
        </h2>
        <p className="muted">
          {admin
            ? "Spacery, konsultacje, kursy, fitness i dostępność zespołu. Prowadzący i sala mają osobne rezerwacje."
            : "Potwierdzone spacery, kursy i umówione spotkania Twoich psów. Zgłoszenia oczekujące znajdziesz w odpowiednich zakładkach."}
        </p>
      </header>
      <div className={styles.toolbar}>
        <nav aria-label="Widok kalendarza" className={styles.controls}>
          <Link
            className={view === "week" ? "small-button" : "ghost-button"}
            href={href(focus, "week")}
            aria-current={view === "week" ? "page" : undefined}
          >
            Tydzień
          </Link>
          <Link
            className={view === "month" ? "small-button" : "ghost-button"}
            href={href(focus, "month")}
            aria-current={view === "month" ? "page" : undefined}
          >
            Miesiąc
          </Link>
        </nav>
        <nav
          aria-label={
            view === "month" ? "Miesiące kalendarza" : "Tygodnie kalendarza"
          }
          className={styles.controls}
        >
          <Link className="ghost-button" href={href(range.previous)}>
            ← Poprzedni
          </Link>
          <Link className="ghost-button" href={href(today)}>
            {view === "month" ? "Bieżący miesiąc" : "Bieżący tydzień"}
          </Link>
          <Link className="ghost-button" href={href(range.next)}>
            Następny →
          </Link>
        </nav>
        <form className={styles.dateJump}>
          <input type="hidden" name="view" value={view} />
          {admin && selectedStaff !== "all" && (
            <input type="hidden" name="staff" value={selectedStaff} />
          )}
          <label htmlFor="calendar-date">Przejdź do daty</label>
          <input
            id="calendar-date"
            name="date"
            type="date"
            defaultValue={focus}
            min="2000-01-01"
            max="2099-12-31"
            required
          />
          <button className="small-button">Pokaż</button>
        </form>
      </div>
      {admin && members.length > 0 && (
        <form className={styles.teamFilter}>
          <input type="hidden" name="view" value={view} />
          <input type="hidden" name="date" value={focus} />
          <label htmlFor="calendar-staff-filter">Kalendarz prowadzącego</label>
          <select
            id="calendar-staff-filter"
            name="staff"
            defaultValue={selectedStaff}
          >
            <option value="all">Cały zespół</option>
            {members.map((member) => (
              <option key={member.user_id} value={member.user_id}>
                {member.full_name}
              </option>
            ))}
            <option value="unassigned">Do przypisania</option>
          </select>
          <button className="small-button">Filtruj</button>
          {selectedStaff !== "all" && (
            <Link
              className="ghost-button"
              href={`${base}/calendar?date=${focus}&view=${view}`}
            >
              Cały zespół →
            </Link>
          )}
        </form>
      )}
      <div className={admin ? styles.layout : ""}>
        {view === "month" ? (
          <section
            className={`card pad ${styles.month}`}
            aria-label={`Kalendarz: ${monthTitle}`}
          >
            <h3>{monthTitle}</h3>
            <p className="muted">
              Wybierz dzień, żeby zobaczyć godziny i szczegóły w widoku
              tygodnia.
            </p>
            <div className={styles.monthGrid}>
              {["Pon", "Wt", "Śr", "Czw", "Pt", "Sob", "Ndz"].map((day) => (
                <span key={day} className={styles.weekday}>
                  {day}
                </span>
              ))}
              {range.days.map((day) => {
                const items = filtered.filter((item) => onDay(item, day));
                return (
                  <Link
                    key={day}
                    href={href(day, "week")}
                    className={`${styles.monthDay} ${day.slice(0, 7) !== focus.slice(0, 7) ? styles.outsideMonth : ""} ${day === today ? styles.today : ""}`}
                    aria-label={`${dayLabel(day)}: ${items.length ? `${items.length} zaplanowanych` : "bez spotkań"}`}
                    aria-current={day === today ? "date" : undefined}
                  >
                    <strong>{Number(day.slice(-2))}</strong>
                    {items.length > 0 && (
                      <span className={styles.monthCount}>
                        {items.length}
                        <span className={styles.monthCountLabel}>
                          {" "}
                          w planie
                        </span>
                      </span>
                    )}
                    <span className={styles.monthTitles}>
                      {items.slice(0, 2).map((item) => (
                        <span
                          key={`${item.kind}-${item.appointment_id || item.id}-${item.starts_at}`}
                        >
                          {clockTime(item.starts_at)} {item.title}
                        </span>
                      ))}
                      {items.length > 2 && (
                        <span>+{items.length - 2} kolejne</span>
                      )}
                    </span>
                  </Link>
                );
              })}
            </div>
          </section>
        ) : (
          <div className={styles.days}>
            {range.days.map((day) => {
              const items = filtered.filter((item) => onDay(item, day));
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
                    {items.map((item) => {
                      const before = localDate(item.starts_at) < day,
                        later = localDate(item.ends_at) > day;
                      const detailHref = `${base}/${item.kind === "walk" ? "walks" : item.kind === "course" ? "courses" : item.kind === "fitness" ? "fitness" : "consultations"}/${item.id}`;
                      const selected =
                        selectedEvent ===
                        `${item.kind}:${item.id}:${Date.parse(item.starts_at)}`;
                      return (
                        <article
                          key={`${item.kind}-${item.appointment_id || item.id}-${item.starts_at}`}
                          id={appointmentAnchor(item, day)}
                          className={`${styles.event} ${styles[item.kind]} ${selected ? styles.selectedEvent : ""}`}
                          aria-label={
                            selected
                              ? `Wybrane spotkanie: ${item.title}`
                              : undefined
                          }
                        >
                          <div className={styles.eventTime}>
                            <Clock3 size={14} />
                            {item.kind === "block" && isAllDayBlock(item) ? (
                              "Cały dzień"
                            ) : (
                              <span>
                                {before
                                  ? "od poprzedniego dnia"
                                  : clockTime(item.starts_at)}{" "}
                                –{" "}
                                {later
                                  ? "do kolejnego dnia"
                                  : clockTime(item.ends_at)}
                              </span>
                            )}
                          </div>
                          <div className={styles.eventMain}>
                            <span className={styles.kind}>
                              {labels[item.kind]}
                              {item.status === "completed"
                                ? " · zakończone"
                                : ""}
                            </span>
                            <h4>{item.title}</h4>
                            {admin && item.assignment_version !== undefined && (
                              <p className={styles.assignmentSummary}>
                                <strong>
                                  {item.assigned_staff_name || "Do przypisania"}
                                </strong>
                                {item.resource_name
                                  ? ` · ${item.resource_name}`
                                  : ""}
                              </p>
                            )}
                            {item.location && <p>{item.location}</p>}
                            {admin && item.created_by_name && (
                              <p className={styles.author}>
                                Wpis dodał(a): {item.created_by_name}
                              </p>
                            )}
                            {admin && Boolean(item.break_warnings?.length) && (
                              <p className={styles.breakNote}>
                                Krótka przerwa między spotkaniami — sprawdź czas
                                na dojazd i przygotowanie.
                              </p>
                            )}
                            {item.kind === "block" ? (
                              admin && (
                                <details>
                                  <summary>Zmień lub usuń blokadę</summary>
                                  <BlockEditor
                                    id={item.id}
                                    initial={item}
                                    members={members}
                                    resources={resources}
                                  />
                                </details>
                              )
                            ) : (
                              <>
                                <Link
                                  className="ghost-button"
                                  href={detailHref}
                                >
                                  Otwórz szczegóły <ArrowRight size={15} />
                                </Link>
                                {admin &&
                                  item.assignment_version !== undefined && (
                                    <details>
                                      <summary>Prowadzący i miejsce</summary>
                                      <AssignmentEditor
                                        appointment={item}
                                        members={members}
                                        resources={resources}
                                      />
                                    </details>
                                  )}
                              </>
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
        )}
        {admin && (
          <aside className="stack">
            <details className={`card pad ${styles.blockDisclosure}`}>
              <summary>
                <LockKeyhole size={18} aria-hidden="true" /> Zarezerwuj czas
              </summary>
              <div id="calendar-block-editor">
                <p className="muted">
                  Urlop, dojazd lub inna niedostępność wybranego prowadzącego.
                  Możesz też zarezerwować salę. Blokada jest prywatna dla
                  zespołu.
                </p>
                <CreateBlockEditor
                  id={newBlockId}
                  members={members}
                  resources={resources}
                  currentUserId={currentUserId}
                />
              </div>
            </details>
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
                Równoległe spotkania są możliwe dla różnych prowadzących i
                miejsc. Wpis „Do przypisania” rezerwuje czas wspólnie, dopóki
                nie wybierzesz prowadzącego.
              </p>
            </article>
            <Link className="ghost-button" href="/admin/settings/calendar">
              Godziny, przerwy i miejsca →
            </Link>
          </aside>
        )}
      </div>
    </div>
  );
}
