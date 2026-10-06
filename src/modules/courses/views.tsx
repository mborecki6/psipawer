import Link from "next/link";
import { CourseCarePanel } from "./care-panel";
import type { CourseCarePage } from "@/modules/care/types";
import { GraduationCap, Clock3, MapPin, ArrowRight } from "lucide-react";
import { dateLabel, money } from "@/lib/domain";
import type { Service } from "@/modules/services/types";
import type { getCourse } from "./queries";
import {
  courseLabels,
  enrollmentLabels,
  sessionLabels,
  attendanceLabels,
  type CourseSummary,
} from "./types";
import {
  AttendanceForm,
  CommandForm,
  CourseCreateForm,
  EnrollmentForm,
  ReopeningPanel,
  SessionEditor,
  CourseSettingsForm,
} from "./forms";
import { changeCourse, decideEnrollment, changeSession } from "./actions";
import styles from "./courses.module.css";
import { CourseBilling } from "./billing";
const courseOptions = [
  { value: "publish", label: "Otwórz zapisy" },
  { value: "close", label: "Zamknij zapisy" },
  { value: "reopen", label: "Otwórz zapisy ponownie" },
  { value: "complete", label: "Zakończ cykl" },
  { value: "cancel", label: "Odwołaj cykl" },
];
const decisionOptions = [
  { value: "accept", label: "Przyjmij na kurs" },
  { value: "waitlist", label: "Przenieś na rezerwę" },
  { value: "reject", label: "Nie przyjmuj" },
  { value: "cancel", label: "Zapisz rezygnację" },
];
const sessionOptions = [
  { value: "complete", label: "Zakończ spotkanie" },
  { value: "cancel", label: "Odwołaj spotkanie" },
];
const historyLabels: Record<string, string> = {
  created: "Przygotowany szkic cyklu",
  publish: "Otwarte zapisy",
  close: "Zamknięte zapisy",
  reopen: "Ponownie otwarte zapisy",
  requested: "Nowe zgłoszenie",
  accept: "Zgłoszenie przyjęte",
  waitlist: "Zgłoszenie na rezerwie",
  reject: "Zgłoszenie nieprzyjęte",
  reconsider: "Zgłoszenie ponownie do decyzji",
  restore: "Przywrócony udział na kursie",
  course_cancelled: "Zgłoszenie zamknięte po odwołaniu cyklu",
  rescheduled: "Zmieniony termin lub zbiórka",
  attendance: "Zapisana obecność",
  settings: "Zmienione ustawienia cyklu",
  settled: "Uzgodniona kwota po rezygnacji",
  payment_recorded: "Odnotowana wpłata za kurs",
  payment_refunded: "Odnotowany zwrot wpłaty",
};
export function CourseListView({
  courses,
  role,
  filter,
  page,
  more,
  serviceId,
}: {
  courses: CourseSummary[];
  role: "admin" | "client";
  filter: string;
  page: number;
  more: boolean;
  serviceId?: string;
}) {
  const admin = role === "admin",
    base = admin ? "/admin" : "/app";
  const filters = admin
    ? [
        ["active", "W przygotowaniu i trwające"],
        ["draft", "Szkice"],
        ["open", "Otwarte zapisy"],
        ["closed", "Zamknięte zapisy"],
        ["history", "Historia"],
      ]
    : [
        ["open", "Dostępne kursy"],
        ["mine", "Moje zgłoszenia"],
        ["history", "Historia"],
      ];
  const href = (f: string, p = 1) =>
    `?${new URLSearchParams({ filter: f, page: String(p), ...(serviceId ? { service: serviceId } : {}) })}`;
  return (
    <div className="stack">
      <header className={styles.header}>
        <span className={styles.eyebrow}>
          <GraduationCap size={18} /> Wspólna nauka
        </span>
        <h2>
          {admin ? "Jeden cykl. Wspólny kierunek." : "Kolejny krok dla Was."}
        </h2>
        <p className="muted">
          {admin
            ? "Zaplanuj spotkania, zdecyduj o składzie i obserwuj pracę grupy."
            : "Wybierz kurs i zgłoś swojego psa. Prowadząca potwierdzi przyjęcie na cały cykl."}
        </p>
      </header>
      <div className={styles.toolbar}>
        <nav aria-label="Kursy" className={styles.badges}>
          {filters.map(([value, label]) => (
            <Link
              key={value}
              className={value === filter ? "small-button" : "ghost-button"}
              aria-current={value === filter ? "page" : undefined}
              href={href(value)}
            >
              {label}
            </Link>
          ))}
        </nav>
        {admin && (
          <Link
            className="primary-button"
            href={`/admin/courses/new${serviceId ? `?service=${serviceId}` : ""}`}
          >
            Nowy cykl kursu →
          </Link>
        )}
      </div>
      {serviceId && (
        <Link className="ghost-button" href={`${base}/courses`}>
          Pokaż wszystkie rodzaje kursów →
        </Link>
      )}
      <div className={styles.grid}>
        {courses.map((c) => {
          const starts = c.course_sessions
            .filter((s) => s.status !== "cancelled")
            .map((s) => s.starts_at)
            .sort();
          return (
            <article key={c.id} className={`card pad ${styles.course}`}>
              <div className={styles.badges}>
                <span className="badge">{courseLabels[c.status]}</span>
                {c.is_test_price && <span className="badge">Cena robocza</span>}
              </div>
              <h3>{c.title}</h3>
              <p className="muted">{c.service_name}</p>
              <p>
                <Clock3 size={14} /> {c.sessions_count} × {c.duration_minutes}{" "}
                min ·{" "}
                {c.course_format === "individual"
                  ? "Indywidualnie"
                  : "W grupie"}
              </p>
              <p>
                <MapPin size={14} /> {c.public_location}
              </p>
              {starts[0] && <p>Początek: {dateLabel(starts[0])}</p>}
              <div className={styles.price}>
                <strong>{money(c.price_cents)}</strong>
                <small>
                  za cały cykl · limit {c.capacity}{" "}
                  {c.capacity === 1 ? "para" : "par"} pies–opiekun
                </small>
              </div>
              <Link className="ghost-button" href={`${base}/courses/${c.id}`}>
                Spotkania i zgłoszenia <ArrowRight size={16} />
              </Link>
            </article>
          );
        })}
      </div>
      {!courses.length && (
        <article className="card pad">
          <h3>
            {filter === "mine"
              ? "Jeszcze bez zgłoszeń"
              : "Tu pojawią się kursy"}
          </h3>
          <p className="muted">
            {admin
              ? "Przygotuj cykl i otwórz zapisy, kiedy terminy będą gotowe."
              : "Sprawdź dostępne cykle lub wróć tutaj później."}
          </p>
        </article>
      )}
      <nav aria-label="Strony kursów" className={styles.badges}>
        {page > 1 && (
          <Link className="ghost-button" href={href(filter, page - 1)}>
            ← Poprzednia
          </Link>
        )}
        {more && (
          <Link className="ghost-button" href={href(filter, page + 1)}>
            Następna →
          </Link>
        )}
      </nav>
    </div>
  );
}
export function CourseCreateView({
  id,
  services,
  serviceId,
}: {
  id: string;
  services: Service[];
  serviceId?: string;
}) {
  return (
    <div className={`stack ${styles.create}`}>
      <Link className="ghost-button" href="/admin/courses">
        ← Kursy
      </Link>
      <header className={styles.header}>
        <span className={styles.eyebrow}>
          <GraduationCap size={18} /> Nowy cykl
        </span>
        <h2>Najpierw dobry plan.</h2>
        <p className="muted">
          Zapisz wszystkie terminy jako szkic. Sprawdzenie kalendarza i
          rezerwacja czasu nastąpią podczas otwarcia zapisów.
        </p>
      </header>
      <article className="card pad">
        <CourseCreateForm id={id} services={services} serviceId={serviceId} />
      </article>
      <article className={`card pad ${styles.note}`}>
        <h3>Cena za cały kurs</h3>
        <p>
          Cykl zachowa cenę z chwili utworzenia. Edycja katalogu zmieni ceny
          kolejnych cykli. Zgłoszenie czeka na decyzję; przyjęcie zajmuje
          miejsce i zapisuje należność za całość.
        </p>
        <Link className="ghost-button" href="/admin/services">
          Usługi i ceny →
        </Link>
      </article>
    </div>
  );
}
export function CourseDetailView({
  course: c,
  sessions,
  enrollments,
  roster,
  attendance,
  history,
  dogs,
  hasDogs,
  role,
  page,
  filter,
  historyPage,
  more,
  historyMore,
  requestId,
  now,
  balances,
  payments,
  refunds,
  focus,
  care = {},
  plansPage = 1,
}: Awaited<ReturnType<typeof getCourse>> & {
  page: number;
  filter: string;
  historyPage: number;
  requestId: string;
  now: string;
  care?: Record<string, CourseCarePage>;
  plansPage?: number;
}) {
  const admin = role === "admin",
    base = admin ? "/admin" : "/app";
  const active = ["open", "closed"].includes(c.status),
    future = sessions.every((s) => s.starts_at > now);
  const unfinished = !["completed", "cancelled"].includes(c.status);
  const courseAllowed =
    c.status === "draft"
      ? ["publish", "cancel"]
      : active
        ? [
            ...(c.status === "open" ? ["close"] : future ? ["reopen"] : []),
            ...(!sessions.some((s) => s.status === "scheduled") &&
            sessions.some((s) => s.status === "completed")
              ? ["complete"]
              : []),
            "cancel",
          ]
        : [];
  const href = (f = filter, p = page, h = historyPage) =>
    `?${new URLSearchParams({ filter: f, page: String(p), history: String(h), plans: String(plansPage), ...(focus ? { enrollment: focus } : {}) })}`;
  return (
    <div className="stack">
      <div className={styles.toolbar}>
        <Link className="ghost-button" href={`${base}/courses`}>
          ← Kursy
        </Link>
        <a className="ghost-button" href={`${base}/courses/${c.id}${href()}`}>
          Odśwież dane →
        </a>
      </div>
      <header className={styles.header}>
        <div className={styles.badges}>
          <span className="badge">
            {c.status === "open" && !future
              ? "Kurs w trakcie"
              : courseLabels[c.status]}
          </span>
          {c.is_test_price && (
            <span className="badge">Cena robocza do testów</span>
          )}
        </div>
        <h2>{c.title}</h2>
        <p className="muted">
          {c.service_name} · {c.sessions_count} spotkań po {c.duration_minutes}{" "}
          min
        </p>
        <div className={styles.badges}>
          {!admin && dogs.length > 0 && c.status === "open" && future && (
            <a className="primary-button" href="#zgloszenie">
              Zgłoś psa ↓
            </a>
          )}
          <a className="ghost-button" href="#zgloszenia">
            {admin ? "Skład i zgłoszenia ↓" : "Twoje zgłoszenia ↓"}
          </a>
        </div>
      </header>
      <div className={styles.detail}>
        <div className="stack">
          <section className="stack" aria-label="Spotkania kursu">
            <div className={styles.sectionHead}>
              <h3>Plan spotkań</h3>
              <Link className="ghost-button" href={`${base}/calendar`}>
                Kalendarz →
              </Link>
            </div>
            {sessions.map((s) => {
              const started = s.starts_at <= now,
                ended =
                  Date.parse(s.starts_at) + s.duration_minutes * 60000 <=
                  Date.parse(now);
              const accepted = roster.filter((e) => e.status === "accepted");
              const meetingAttendance = attendance.filter(
                (a) => a.session_id === s.id,
              );
              const attendanceParticipants =
                s.status === "completed"
                  ? meetingAttendance.map((a) => ({
                      id: a.enrollment_id,
                      dogs: a.course_enrollments.dogs,
                    }))
                  : accepted;
              const canComplete =
                active &&
                s.status === "scheduled" &&
                ended &&
                accepted.every((e) =>
                  meetingAttendance.some((a) => a.enrollment_id === e.id),
                );
              return (
                <article
                  className={`card pad ${styles.session}`}
                  key={s.id}
                  id={`spotkanie-${s.ordinal}`}
                >
                  <span
                    id={`spotkanie-${s.id}`}
                    className={styles.anchor}
                    aria-hidden="true"
                  />
                  <div className={styles.sectionHead}>
                    <h3>
                      Spotkanie {s.ordinal} z {c.sessions_count}
                    </h3>
                    <span className="badge">{sessionLabels[s.status]}</span>
                  </div>
                  <p>
                    <strong>{dateLabel(s.starts_at)}</strong> ·{" "}
                    {s.duration_minutes} min
                  </p>
                  <p className="muted">Okolica: {s.public_location}</p>
                  {s.course_session_private_details ? (
                    <p className={styles.location}>
                      <strong>Dokładna zbiórka</strong>
                      <br />
                      {s.course_session_private_details.exact_location}
                    </p>
                  ) : (
                    <p className="muted">
                      Dokładna zbiórka będzie dostępna po przyjęciu na kurs.
                    </p>
                  )}
                  {meetingAttendance.map((a) => (
                    <p key={a.enrollment_id}>
                      {a.course_enrollments.dogs?.name || "Pies zgłoszenia"} ·
                      obecność:{" "}
                      <strong>{attendanceLabels[a.attendance]}</strong>
                    </p>
                  ))}
                  {admin && (
                    <>
                      <details>
                        <summary>Zmień termin lub zbiórkę</summary>
                        <SessionEditor
                          session={s}
                          enabled={
                            unfinished && s.status === "scheduled" && !started
                          }
                        />
                      </details>
                      <details>
                        <summary>Obecności uczestników</summary>
                        <p className="muted">
                          {s.status === "completed"
                            ? "Korekta zapisanej obecności wymaga powodu. Historia i należność za kurs pozostają zachowane."
                            : "Zapisz po rozpoczęciu spotkania. Zakończenie wymaga obecności wszystkich przyjętych psów."}
                        </p>
                        <div className={styles.attendance}>
                          {attendanceParticipants.map((e) => (
                            <div key={e.id}>
                              <AttendanceForm
                                sessionId={s.id}
                                enrollmentId={e.id}
                                dogName={e.dogs?.name || "Pies zgłoszenia"}
                                attendance={meetingAttendance.find(
                                  (a) => a.enrollment_id === e.id,
                                )}
                                enabled={
                                  s.status === "completed" ||
                                  (active &&
                                    s.status === "scheduled" &&
                                    started)
                                }
                                correction={s.status === "completed"}
                              />
                            </div>
                          ))}
                        </div>
                        {!attendanceParticipants.length && (
                          <p className="muted">
                            {s.status === "completed"
                              ? "Brak zapisanych obecności do korekty."
                              : "Brak przyjętych uczestników."}
                          </p>
                        )}
                      </details>
                      <details>
                        <summary>Zakończ lub odwołaj spotkanie</summary>
                        <CommandForm
                          id={s.id}
                          version={s.version}
                          action={changeSession}
                          options={sessionOptions}
                          allowed={
                            active && s.status === "scheduled"
                              ? [...(canComplete ? ["complete"] : []), "cancel"]
                              : []
                          }
                          label={`Zmiana spotkania ${s.ordinal}`}
                        />
                      </details>
                    </>
                  )}
                </article>
              );
            })}
          </section>
          <section
            className="card pad"
            id="zgloszenia"
            aria-label="Zgłoszenia kursu"
          >
            <h3>{admin ? "Skład i zgłoszenia" : "Twoje zgłoszenia"}</h3>
            {focus && (
              <p className="alert">
                Otwierasz wybrane zgłoszenie.{" "}
                <Link href={`${href("all", 1)}#zgloszenia`}>
                  Pokaż wszystkie zgłoszenia →
                </Link>
              </p>
            )}
            {admin && (
              <p className="muted">
                Przyjętych: {roster.length} / {c.capacity}. Rezerwa nie zajmuje
                miejsca i wymaga osobnej decyzji o przyjęciu.
              </p>
            )}
            <nav aria-label="Filtry zgłoszeń" className={styles.badges}>
              {[
                ["all", "Wszystkie"],
                ["requested", "Do decyzji"],
                ["accepted", "Przyjęte"],
                ["waitlisted", "Rezerwa"],
                ["history", "Zamknięte"],
              ].map(([value, label]) => (
                <Link
                  key={value}
                  className={filter === value ? "small-button" : "ghost-button"}
                  aria-current={filter === value ? "page" : undefined}
                  href={`${href(value, 1)}#zgloszenia`}
                >
                  {label}
                </Link>
              ))}
            </nav>
            {enrollments.map((e) => {
              const available =
                active && !["rejected", "cancelled"].includes(e.status);
              const choices = available
                ? [
                    ...(admin &&
                    future &&
                    ["requested", "waitlisted"].includes(e.status)
                      ? ["accept", "waitlist", "reject"]
                      : []),
                    "cancel",
                  ]
                : [];
              return (
                <article
                  className={styles.enrollment}
                  key={e.id}
                  aria-label={`Zgłoszenie: ${e.dogs?.name || "Pies"}`}
                >
                  <h4>
                    {admin ? (
                      <Link href={`/admin/dogs/${e.dog_id}`}>
                        {e.dogs?.name || "Pies zgłoszenia"}
                      </Link>
                    ) : (
                      e.dogs?.name || "Pies zgłoszenia"
                    )}
                  </h4>
                  <span className="badge">{enrollmentLabels[e.status]}</span>
                  <p>
                    Uzgodniona cena:{" "}
                    <strong>{money(e.agreed_price_cents)}</strong> za cały cykl.
                  </p>
                  <p className="muted">
                    {e.status === "requested"
                      ? "Zgłoszenie nie zajmuje miejsca. Czekamy na decyzję prowadzącej."
                      : e.status === "waitlisted"
                        ? "Jesteście na rezerwie. Wolne miejsce nie oznacza automatycznego przyjęcia."
                        : e.status === "accepted"
                          ? "Miejsce potwierdzone. Dokładne zbiórki znajdziesz przy spotkaniach."
                          : "Zgłoszenie jest zamknięte. Dalszy udział uzgodnij z prowadzącą."}
                  </p>
                  {balances.find((b) => b.id === e.id) && (
                    <CourseBilling
                      balance={balances.find((b) => b.id === e.id)!}
                      payments={payments.filter(
                        (p) => p.course_enrollment_id === e.id,
                      )}
                      refunds={refunds.filter((r) => r.enrollment_id === e.id)}
                      admin={admin}
                    />
                  )}
                  {care[e.id] && (
                    <CourseCarePanel
                      care={care[e.id]}
                      enrollment={e}
                      sessions={sessions}
                      admin={admin}
                      available={
                        e.status === "accepted" &&
                        ["open", "closed", "completed"].includes(c.status)
                      }
                      page={plansPage}
                      href={(n) =>
                        `${base}/courses/${c.id}?${new URLSearchParams({ filter, page: String(page), history: String(historyPage), plans: String(n), ...(focus ? { enrollment: focus } : {}) })}#zalecenia-${e.id}`
                      }
                    />
                  )}
                  <details>
                    <summary>
                      {admin ? "Decyzja o zgłoszeniu" : "Rezygnacja z kursu"}
                    </summary>
                    <CommandForm
                      id={e.id}
                      version={e.version}
                      action={decideEnrollment}
                      options={admin ? decisionOptions : [decisionOptions[3]]}
                      allowed={choices}
                      label={`Decyzja: ${e.dogs?.name || "Pies"}`}
                    />
                  </details>
                  {admin && (
                    <ReopeningPanel
                      enrollment={e}
                      enabled={
                        active &&
                        future &&
                        sessions.some((s) => s.status === "scheduled")
                      }
                    />
                  )}
                </article>
              );
            })}
            {!enrollments.length && (
              <p className="muted">Brak zgłoszeń w tym widoku.</p>
            )}
            <nav className={styles.badges} aria-label="Strony zgłoszeń">
              {page > 1 && (
                <Link
                  className="ghost-button"
                  href={`${href(filter, page - 1)}#zgloszenia`}
                >
                  ← Poprzednia
                </Link>
              )}
              {more && (
                <Link
                  className="ghost-button"
                  href={`${href(filter, page + 1)}#zgloszenia`}
                >
                  Następna →
                </Link>
              )}
            </nav>
          </section>
        </div>
        <aside className="stack">
          <article className="card pad">
            <h3>Warunki cyklu</h3>
            <div className={styles.price}>
              <strong>{money(c.price_cents)}</strong>
              <small>
                za cały cykl ·{" "}
                {c.is_test_price ? "cena robocza" : "cena docelowa"}
              </small>
            </div>
            <dl className={styles.facts}>
              <div>
                <dt>Forma</dt>
                <dd>
                  {c.course_format === "individual"
                    ? "Indywidualna"
                    : "Grupowa"}
                </dd>
              </div>
              <div>
                <dt>Miejsca dla par pies–opiekun</dt>
                <dd>{c.capacity}</dd>
              </div>
              <div>
                <dt>Okolica</dt>
                <dd>{c.public_location}</dd>
              </div>
            </dl>
            <p className="muted">
              Przyjęcie obejmuje cały cykl. Zmiana ceny w katalogu nie zmienia
              tego kursu.
            </p>
          </article>
          {admin ? (
            <article className="card pad">
              <h3>Zarządzaj cyklem</h3>
              <details>
                <summary>Edytuj nazwę i liczbę miejsc</summary>
                <CourseSettingsForm
                  course={c}
                  enabled={unfinished}
                  requestId={requestId}
                />
              </details>
              <p className="muted">
                Szkic nie zajmuje kalendarza. Otwarcie zapisów sprawdza i
                rezerwuje wszystkie terminy. Zamknięcie zapisów zachowuje
                potwierdzone miejsca.
              </p>
              <CommandForm
                id={c.id}
                version={c.version}
                action={changeCourse}
                options={courseOptions}
                allowed={courseAllowed}
                label="Zmiana kursu"
              />
              <p className="muted">
                Odwołanie zamknie aktywne zgłoszenia i zaplanowane spotkania.
                Rozliczenia wymagają osobnego uzgodnienia.
              </p>
            </article>
          ) : (
            <article className="card pad" id="zgloszenie">
              <h3>Zgłoś swojego psa</h3>
              {!dogs.length && (
                <p className="muted">
                  {hasDogs
                    ? "Każdy Twój pies ma już zgłoszenie na ten cykl. Jego status sprawdzisz w swoich zgłoszeniach."
                    : "Najpierw dodaj profil swojego psa."}
                </p>
              )}
              <EnrollmentForm
                course={c}
                dogs={dogs}
                id={requestId}
                enabled={c.status === "open" && future}
              />
              <div className={styles.badges}>
                {!hasDogs && (
                  <Link className="ghost-button" href="/app/dogs/new">
                    Dodaj psa →
                  </Link>
                )}
                {dogs.length > 0 && (
                  <a className="ghost-button" href={`${base}/courses/${c.id}`}>
                    Przygotuj kolejne zgłoszenie →
                  </a>
                )}
                {hasDogs && !dogs.length && (
                  <a className="ghost-button" href="#zgloszenia">
                    Sprawdź zgłoszenia ↑
                  </a>
                )}
              </div>
              {(c.status !== "open" || !future) && (
                <p className="muted">Zapisy na ten cykl są zamknięte.</p>
              )}
            </article>
          )}
          <article className="card pad" id="historia">
            <h3>Historia kursu</h3>
            <ol className={styles.history}>
              {history.map((h) => {
                const title =
                  h.action === "cancel"
                    ? h.enrollment_id
                      ? "Rezygnacja ze zgłoszenia"
                      : h.session_id
                        ? "Odwołane spotkanie"
                        : "Odwołany cykl"
                    : h.action === "complete"
                      ? h.session_id
                        ? "Zakończone spotkanie"
                        : "Zakończony cykl"
                      : h.action === "attendance" &&
                          h.details.corrected === true
                        ? "Skorygowana obecność"
                        : historyLabels[h.action] || "Zmiana kursu";
                const session = sessions.find((s) => s.id === h.session_id);
                return (
                  <li key={h.id}>
                    <strong>{title}</strong>
                    <small>
                      {dateLabel(h.created_at)}
                      {session ? ` · spotkanie ${session.ordinal}` : ""}
                    </small>
                    {h.note && <p>{h.note}</p>}
                    {h.action === "settings" && (
                      <p>
                        {String(h.details.previous_title)} →{" "}
                        {String(h.details.title)} · miejsca:{" "}
                        {String(h.details.previous_capacity)} →{" "}
                        {String(h.details.capacity)}
                      </p>
                    )}
                    {h.details.corrected === true &&
                      typeof h.details.previous_attendance === "string" &&
                      h.details.previous_attendance in attendanceLabels && (
                        <p>
                          Poprzednio:{" "}
                          {
                            attendanceLabels[
                              h.details
                                .previous_attendance as keyof typeof attendanceLabels
                            ]
                          }
                        </p>
                      )}
                    {typeof h.details.amount_cents === "number" && (
                      <p>Kwota: {money(h.details.amount_cents)}</p>
                    )}
                    {h.action === "settled" &&
                      typeof h.details.charge_cents === "number" && (
                        <p>
                          Należność po uzgodnieniu:{" "}
                          {money(h.details.charge_cents)}
                        </p>
                      )}
                    {h.action === "restore" &&
                      typeof h.details.previous_charge_cents === "number" &&
                      typeof h.details.charge_cents === "number" && (
                        <p>
                          Należność przed powrotem:{" "}
                          {money(h.details.previous_charge_cents)}. Po
                          przywróceniu udziału: {money(h.details.charge_cents)}{" "}
                          za cały cykl. Wpłaty i zwroty pozostają w ewidencji.
                        </p>
                      )}
                    {h.action === "attendance" &&
                      typeof h.details.attendance === "string" &&
                      h.details.attendance in attendanceLabels && (
                        <p>
                          {
                            attendanceLabels[
                              h.details
                                .attendance as keyof typeof attendanceLabels
                            ]
                          }
                        </p>
                      )}
                  </li>
                );
              })}
            </ol>
            <nav className={styles.badges} aria-label="Strony historii kursu">
              {historyPage > 1 && (
                <Link
                  className="ghost-button"
                  href={`${href(filter, page, historyPage - 1)}#historia`}
                >
                  ← Nowsze
                </Link>
              )}
              {historyMore && (
                <Link
                  className="ghost-button"
                  href={`${href(filter, page, historyPage + 1)}#historia`}
                >
                  Starsze →
                </Link>
              )}
            </nav>
          </article>
        </aside>
      </div>
    </div>
  );
}
