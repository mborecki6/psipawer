import Link from "next/link";
import { ControlInvitationCard, ReportingPanel } from "./access-panels";
import type { ControlInvitation, ReportingAccess } from "./types";
import { BookOpen, ClipboardList, MessageCircle } from "lucide-react";
import { ActionForm } from "@/components/action-form";
import { ProgressiveDetails } from "@/components/progressive-details";
import type { Role } from "@/lib/auth/session";
import { reviewProgress } from "./actions";
import { ProgressForm } from "./progress-form";
import { CareEditorDisclosure, CareEditor, TemplateEditor } from "./editor";
import {
  careDate,
  careContextKey,
  careContextLabel,
  careContextSearch,
  type CareContext,
  type CareContextSummary,
  type CareDraft,
  type CarePlan,
  type CareProgress,
  type CareSummary,
  type CareTemplate,
  type CareConsultation,
  type CareCourse,
  type CareFitness,
} from "./types";
import styles from "./care.module.css";
import { ContactCard } from "@/modules/work/contact-card";
import { followUpStates, type FollowUp } from "@/modules/work/types";
import { dateLabel } from "@/lib/domain";

function PlanDocument({
  plan,
  current = false,
  role,
}: {
  plan: CarePlan;
  current?: boolean;
  role: Role;
}) {
  return (
    <section className={`card pad ${styles.document}`}>
      <div className={styles.meta}>
        <span className={styles.pill}>
          {current ? "Aktualny plan" : "Wcześniejsza wersja"}
        </span>
        <span>
          Wersja {plan.revision} · {careDate(plan.published_at)}
        </span>
      </div>
      <h3>{plan.title}</h3>
      {plan.consultation_id && (
        <p>
          <Link
            className="ghost-button"
            href={`${role === "admin" ? "/admin" : "/app"}/consultations/${plan.consultation_id}`}
          >
            Otwórz konsultację →
          </Link>
        </p>
      )}
      {plan.course_id &&
        plan.course_enrollment_id &&
        plan.course_enrollments && (
          <p>
            <Link
              className="ghost-button"
              href={`${role === "admin" ? "/admin" : "/app"}/courses/${plan.course_id}?enrollment=${plan.course_enrollment_id}${plan.course_session_id ? `#spotkanie-${plan.course_session_id}` : `#zalecenia-${plan.course_enrollment_id}`}`}
            >
              {plan.course_session_id
                ? "Otwórz spotkanie kursu"
                : "Otwórz kurs"}{" "}
              →
            </Link>
          </p>
        )}
      {plan.fitness_package_id && plan.fitness_packages && (
        <p>
          <Link
            className="ghost-button"
            href={`${role === "admin" ? "/admin" : "/app"}/fitness/${plan.fitness_package_id}${plan.fitness_session_id ? `#spotkanie-${plan.fitness_session_id}` : "#zalecenia"}`}
          >
            {plan.fitness_session_id
              ? "Otwórz spotkanie fitness"
              : "Otwórz pakiet fitness"}{" "}
            →
          </Link>
        </p>
      )}
      <div className={styles.body}>{plan.body}</div>
      {plan.follow_up_on && (
        <div className={styles.followUp}>
          Termin kontaktu zapisany przy publikacji:{" "}
          <strong>{careDate(plan.follow_up_on)}</strong>
        </div>
      )}
    </section>
  );
}

export function CarePublicationView({
  role,
  plan,
  current,
}: {
  role: Role;
  plan: CarePlan & { dogs: { name: string } };
  current: boolean;
}) {
  const base = role === "admin" ? "/admin" : "/app";
  return (
    <div className="stack">
      <Link
        className="ghost-button"
        href={`${base}/dogs/${plan.dog_id}/care?${careContextSearch(plan)}`}
      >
        ← Aktualny plan i postępy tej usługi
      </Link>
      <header className={`card pad ${styles.header}`}>
        <div>
          <span className={styles.eyebrow}>Opublikowane zalecenia</span>
          <h2>
            {plan.dogs.name} · wersja {plan.revision}
          </h2>
          {!current && (
            <p className="muted">
              To wcześniejsza wersja. Nowsze wskazówki znajdziesz w aktualnym
              planie tej usługi.
            </p>
          )}
        </div>
      </header>
      <PlanDocument plan={plan} role={role} current={current} />
    </div>
  );
}

export function ProgressCard({
  progress,
  role,
  showDog = false,
}: {
  progress: CareProgress;
  role: Role;
  showDog?: boolean;
}) {
  return (
    <article className={styles.response} id={`progress-${progress.id}`}>
      <div className={styles.meta}>
        <span className={styles.pill}>
          {progress.reviewed_at
            ? "Przeczytana"
            : role === "admin"
              ? "Nowa odpowiedź"
              : "Przekazana prowadzącej"}
        </span>
        <span>{careDate(progress.created_at)}</span>
      </div>
      <h3>
        {showDog && `${progress.dogs?.name || "Pies"} · `}
        {progress.care_plan_versions.title}
      </h3>
      <p className="muted">
        Odpowiedź do wersji {progress.care_plan_versions.revision} planu
      </p>
      <dl>
        <dt>Co udało się zrobić?</dt>
        <dd>{progress.attempted}</dd>
        {progress.went_well && (
          <>
            <dt>Co poszło dobrze?</dt>
            <dd>{progress.went_well}</dd>
          </>
        )}
        {progress.difficult && (
          <>
            <dt>Co było trudne?</dt>
            <dd>{progress.difficult}</dd>
          </>
        )}
      </dl>
      {showDog && (
        <Link
          className="ghost-button"
          href={`/admin/dogs/${progress.dog_id}/care?plan=${progress.plan_id}#postepy`}
        >
          Otwórz plan i historię psa →
        </Link>
      )}
      {role === "admin" && !progress.reviewed_at && (
        <ActionForm action={reviewProgress} label="Oznacz jako przeczytaną">
          <input type="hidden" name="id" value={progress.id} />
        </ActionForm>
      )}
    </article>
  );
}

export function CarePagination({
  page,
  more,
  href,
}: {
  page: number;
  more: boolean;
  href: (page: number) => string;
}) {
  if (page === 1 && !more) return null;
  return (
    <nav className={styles.pagination} aria-label="Strony listy">
      {page > 1 && (
        <Link className="secondary-button" href={href(page - 1)}>
          ← Poprzednia
        </Link>
      )}
      <span className="muted">Strona {page}</span>
      {more && (
        <Link className="secondary-button" href={href(page + 1)}>
          Następna →
        </Link>
      )}
    </nav>
  );
}

export function DogCareView({
  role,
  dog,
  latest,
  draft,
  templates,
  history,
  moreHistory,
  progress,
  moreProgress,
  historyPage,
  progressPage,
  responseId,
  followUp = null,
  consultations = [],
  requestedConsultation = null,
  requestedUnavailable = false,
  courses = [],
  requestedCourse = null,
  requestedSession,
  requestedCourseUnavailable = false,
  fitness = [],
  requestedFitness = null,
  requestedFitnessSession,
  requestedFitnessUnavailable = false,
  contexts = [],
  context,
  controlInvitation,
  reporting,
}: {
  role: Role;
  dog: { id: string; name: string };
  latest: CarePlan | null;
  draft: CareDraft | null;
  templates: CareTemplate[];
  history: CarePlan[];
  moreHistory: boolean;
  progress: CareProgress[];
  moreProgress: boolean;
  historyPage: number;
  progressPage: number;
  responseId: string;
  followUp?: FollowUp | null;
  consultations?: CareConsultation[];
  requestedConsultation?: CareConsultation | null;
  requestedUnavailable?: boolean;
  courses?: CareCourse[];
  requestedCourse?: CareCourse | null;
  requestedSession?: string;
  requestedCourseUnavailable?: boolean;
  fitness?: CareFitness[];
  requestedFitness?: CareFitness | null;
  requestedFitnessSession?: string;
  requestedFitnessUnavailable?: boolean;
  contexts?: CareContextSummary[];
  context?: CareContext;
  controlInvitation?: ControlInvitation | null;
  reporting?: ReportingAccess | null;
}) {
  const base = role === "admin" ? "/admin" : "/app";
  const path = `${base}/dogs/${dog.id}/care`;
  const selectedContext = context ||
    draft ||
    latest || { consultation_id: null };
  const selectedKey = careContextKey(selectedContext);
  const contextSearch = careContextSearch(selectedContext);
  const selectedConsultation = consultations.find(
    (item) => item.id === selectedContext.consultation_id,
  );
  const selectedCourse = courses.find(
    (item) => item.id === selectedContext.course_enrollment_id,
  );
  const selectedCourseSession = selectedCourse?.sessions.find(
    (item) => item.id === selectedContext.course_session_id,
  );
  const selectedFitness = fitness.find(
    (item) => item.id === selectedContext.fitness_package_id,
  );
  const selectedFitnessSession = selectedFitness?.sessions.find(
    (item) => item.id === selectedContext.fitness_session_id,
  );
  const serviceTitle = selectedContext.consultation_id
    ? selectedConsultation?.service_name || "Konsultacja"
    : selectedContext.course_enrollment_id
      ? selectedCourse
        ? `Kurs · ${selectedCourse.title}`
        : "Kurs"
      : selectedContext.fitness_package_id
        ? selectedFitness
          ? `Fitness · ${selectedFitness.title}`
          : "Fitness"
        : "Ogólny plan pracy";
  const serviceScope = selectedContext.consultation_id
    ? selectedConsultation?.starts_at
      ? dateLabel(selectedConsultation.starts_at)
      : "Zalecenia po konsultacji"
    : selectedContext.course_enrollment_id
      ? selectedContext.course_session_id
        ? selectedCourseSession
          ? `Spotkanie ${selectedCourseSession.ordinal} · ${dateLabel(selectedCourseSession.starts_at)}`
          : "Zalecenia po spotkaniu kursu"
        : "Cały kurs"
      : selectedContext.fitness_package_id
        ? selectedContext.fitness_session_id
          ? selectedFitnessSession
            ? `Spotkanie ${selectedFitnessSession.ordinal}${selectedFitnessSession.starts_at ? ` · ${dateLabel(selectedFitnessSession.starts_at)}` : ""}`
            : "Zalecenia po spotkaniu fitness"
          : "Cały pakiet fitness"
        : null;
  const planChoices = (
    <>
      <nav className={styles.contexts} aria-label="Wybierz plan psa">
        {contexts.map((item) => (
          <Link
            key={item.context_key}
            className="ghost-button"
            aria-current={item.context_key === selectedKey ? "page" : undefined}
            href={`${path}?${careContextSearch(item)}`}
          >
            {item.title} · {careContextLabel(item)}
            {role === "admin" && item.has_draft ? " · szkic" : ""}
          </Link>
        ))}
        {!contexts.some((item) => item.context_key === "general") &&
          role === "admin" && (
            <Link
              className="ghost-button"
              aria-current={selectedKey === "general" ? "page" : undefined}
              href={`${path}?context=general`}
            >
              Ogólny plan pracy
            </Link>
          )}
        {!contexts.length && role === "client" && (
          <p className="muted">Opublikowane plany pojawią się tutaj.</p>
        )}
      </nav>
      {role === "admin" && (
        <details className={styles.adminNewPlan}>
          <summary>Przygotuj plan innej usługi</summary>
          <div className={styles.contexts}>
            <Link
              className="ghost-button"
              href={`${path}?context=general#szkic`}
            >
              Ogólny plan pracy
            </Link>
            {consultations
              .filter((item) =>
                ["scheduled", "completed"].includes(item.status),
              )
              .map((item) => (
                <Link
                  key={item.id}
                  className="ghost-button"
                  href={`${path}?consultation=${item.id}#szkic`}
                >
                  {item.service_name || "Konsultacja"}
                  {item.starts_at ? ` · ${careDate(item.starts_at)}` : ""}
                </Link>
              ))}
            {courses.map((item) => (
              <div className="stack" key={item.id}>
                <Link
                  className="ghost-button"
                  href={`${path}?enrollment=${item.id}#szkic`}
                >
                  {item.title} · cały kurs
                </Link>
                {item.sessions
                  .filter((session) => session.status !== "cancelled")
                  .map((session) => (
                    <Link
                      key={session.id}
                      className="ghost-button"
                      href={`${path}?enrollment=${item.id}&session=${session.id}#szkic`}
                    >
                      {item.title} · spotkanie {session.ordinal} ·{" "}
                      {careDate(session.starts_at)}
                    </Link>
                  ))}
              </div>
            ))}
            {fitness.map((item) => (
              <div className="stack" key={item.id}>
                <Link
                  className="ghost-button"
                  href={`${path}?fitness=${item.id}#szkic`}
                >
                  {item.title} · cały pakiet
                </Link>
                {item.sessions
                  .filter((session) =>
                    ["scheduled", "completed"].includes(session.status),
                  )
                  .map((session) => (
                    <Link
                      key={session.id}
                      className="ghost-button"
                      href={`${path}?fitness=${item.id}&fitness_session=${session.id}#szkic`}
                    >
                      {item.title} · spotkanie {session.ordinal}
                      {session.starts_at
                        ? ` · ${careDate(session.starts_at)}`
                        : ""}
                    </Link>
                  ))}
              </div>
            ))}
          </div>
        </details>
      )}
    </>
  );
  return (
    <div className={`stack ${role === "admin" ? styles.adminPage : ""}`}>
      {role === "admin" ? (
        <>
          <header className={styles.adminHeader}>
            <div>
              <span className={styles.eyebrow}>Plany i postępy</span>
              <h2>{dog.name}</h2>
            </div>
            <nav
              className={styles.adminHeaderLinks}
              aria-label="Przydatne strony"
            >
              <Link href={`${base}/dogs/${dog.id}`}>← Karta psa</Link>
              <Link href="/admin/care/library">
                <BookOpen aria-hidden="true" size={16} /> Biblioteka materiałów
              </Link>
            </nav>
          </header>
          <section
            className={`card ${styles.adminContext}`}
            aria-label="Plany według usługi"
          >
            <section
              className={styles.adminSelectedContext}
              aria-label="Powiązanie planu"
            >
              <div>
                <h3>{serviceTitle}</h3>
                {serviceScope && <p>{serviceScope}</p>}
              </div>
              <span className={styles.adminPlanStatus}>
                {latest
                  ? `Opublikowany · wersja ${latest.revision}`
                  : "Nieopublikowany"}
                {draft ? " · zapisany szkic" : ""}
              </span>
            </section>
            <details className={styles.adminPlanPicker}>
              <summary>Zmień plan</summary>
              <div className={styles.adminPlanChoices}>{planChoices}</div>
            </details>
          </section>
        </>
      ) : (
        <>
          <Link className="ghost-button" href={`${base}/dogs/${dog.id}`}>
            ← Karta psa
          </Link>
          <header className={styles.adminHeader}>
            <div>
              <h2>{dog.name} · zalecenia</h2>
            </div>
          </header>
          <section className="card pad stack" aria-label="Plany według usługi">
            <p>
              <strong>{serviceTitle}</strong>
              {serviceScope ? ` · ${serviceScope}` : ""}
            </p>
            {contexts.some((item) => item.context_key !== selectedKey) && (
              <ProgressiveDetails
                label="Zmień plan"
                className={styles.disclosure}
              >
                {planChoices}
              </ProgressiveDetails>
            )}
          </section>
        </>
      )}
      {role === "client" && followUp && (
        <ContactCard item={followUp} admin={false} />
      )}
      {role === "client" && controlInvitation && (
        <ControlInvitationCard invitation={controlInvitation} admin={false} />
      )}
      {latest ? (
        <PlanDocument plan={latest} role={role} current />
      ) : role === "client" ? (
        <article className="card pad">
          <div className={styles.empty}>
            <h3>Wasz plan pojawi się tutaj</h3>
            <p>
              Prowadząca udostępni wskazówki dopasowane do Twojego psa. Wtedy
              możesz też opisać postępy.
            </p>
          </div>
        </article>
      ) : null}
      {role === "admin" && (
        <article className={`card ${styles.adminEditorCard}`} id="szkic">
          {requestedUnavailable && (
            <p className="alert">
              Nie znaleziono dostępnej konsultacji tego psa. Wybierz spotkanie w
              liście usług; zapisany szkic pozostaje bez zmian.
            </p>
          )}
          {requestedCourseUnavailable && (
            <p className="alert">
              Nie znaleziono dostępnego zgłoszenia lub spotkania kursu dla tego
              psa. Wybierz plan na liście usług; zapisany szkic pozostaje bez
              zmian.
            </p>
          )}
          {requestedFitnessUnavailable && (
            <p className="alert">
              Nie znaleziono dostępnego pakietu lub umówionego spotkania fitness
              tego psa. Wybierz plan na liście usług; zapisany szkic pozostaje
              bez zmian.
            </p>
          )}
          <CareEditorDisclosure
            compact
            key={`${dog.id}:${selectedKey}`}
            openForHash="szkic"
            initiallyOpen={
              !latest ||
              Boolean(requestedConsultation) ||
              requestedUnavailable ||
              Boolean(requestedCourse) ||
              requestedCourseUnavailable ||
              Boolean(requestedFitness) ||
              requestedFitnessUnavailable
            }
            openForConsultation={
              requestedConsultation?.id ||
              requestedCourse?.id ||
              requestedFitness?.id ||
              (requestedFitnessUnavailable
                ? "fitness-unavailable"
                : undefined) ||
              (requestedCourseUnavailable ? "course-unavailable" : undefined) ||
              (requestedUnavailable ? "unavailable" : undefined)
            }
            label={
              latest
                ? "Edytuj szkic lub przygotuj kolejną wersję"
                : "Przygotuj zalecenia"
            }
          >
            <CareEditor
              compact
              key={`${dog.id}:${selectedKey}`}
              context={selectedContext}
              dogId={dog.id}
              draft={draft}
              templates={templates}
              consultations={consultations}
              requestedConsultation={requestedConsultation}
              courses={courses}
              requestedCourse={requestedCourse}
              requestedSession={requestedSession}
              fitness={fitness}
              requestedFitness={requestedFitness}
              requestedFitnessSession={requestedFitnessSession}
            />
          </CareEditorDisclosure>
        </article>
      )}
      {role === "admin" && (
        <details className={`card ${styles.adminSettings}`}>
          <summary>
            Kontrola i ustawienia
            <span className={styles.adminSettingsSummary}>
              {followUp && (
                <span>
                  Kontakt prowadzącej: {followUpStates[followUp.status]} ·{" "}
                  {careDate(followUp.due_on)}
                </span>
              )}
              {controlInvitation && (
                <span>
                  Zaproszenie opiekuna: {careDate(controlInvitation.due_on)} ·{" "}
                  {controlInvitation.status === "open"
                    ? "otwarte"
                    : controlInvitation.status === "requested"
                      ? "zgłoszenie przekazane"
                      : controlInvitation.status === "superseded"
                        ? "zastąpione nowym planem"
                        : "wycofane"}
                </span>
              )}
              {reporting && (
                <span>
                  Raportowanie:{" "}
                  {!reporting.included
                    ? "wyłączone"
                    : reporting.allowed
                      ? "aktywne"
                      : "zakończone"}
                  {reporting.expires_at
                    ? ` · koniec: ${dateLabel(reporting.expires_at)}`
                    : " · bez daty końca"}
                </span>
              )}
            </span>
          </summary>
          <div className={styles.adminSettingsContent}>
            {followUp && <ContactCard item={followUp} admin />}
            {controlInvitation && (
              <ControlInvitationCard invitation={controlInvitation} admin />
            )}
            {reporting && <ReportingPanel access={reporting} admin />}
            <Link
              className="ghost-button"
              href={`/admin/work/follow-ups?dog=${dog.id}`}
            >
              Kontakty kontrolne i historia →
            </Link>
          </div>
        </details>
      )}
      {role === "client" && reporting && (
        <ReportingPanel access={reporting} admin={false} />
      )}
      {role === "client" && latest && reporting?.allowed !== false && (
        <article className="card pad" id="odpowiedz">
          <h2>Jak Wam idzie?</h2>
          <p className="muted">
            Kilka zdań wystarczy. Opisz także trudności — to pomoże zaplanować
            dalszą pracę.
          </p>
          <ProgressForm
            key={`${dog.id}:${selectedKey}`}
            plan={latest}
            responseId={responseId}
          />
        </article>
      )}
      <section className="card pad" id="postepy">
        <h2>Odpowiedzi i postępy</h2>
        <p className="muted">
          Każdy wpis zachowuje powiązanie z wersją zaleceń, której dotyczył.
        </p>
        <div className={styles.list}>
          {progress.map((entry) => (
            <ProgressCard key={entry.id} progress={entry} role={role} />
          ))}
        </div>
        {!progress.length && (
          <p className="muted">
            {progressPage > 1
              ? "Nie ma kolejnych odpowiedzi."
              : "Nie ma jeszcze odpowiedzi. Brak wpisu nie oznacza braku pracy z psem."}
          </p>
        )}
        <CarePagination
          page={progressPage}
          more={moreProgress}
          href={(page) =>
            `${path}?${contextSearch}&history=${historyPage}&progress=${page}#postepy`
          }
        />
      </section>
      {(history.length > 0 || historyPage > 1) && (
        <section className="card pad" id="historia">
          <details className={styles.disclosure} open={historyPage > 1}>
            <summary>Wcześniejsze wersje planu</summary>
            <div className={styles.list}>
              {history.map((plan) => (
                <PlanDocument key={plan.id} plan={plan} role={role} />
              ))}
            </div>
            <CarePagination
              page={historyPage}
              more={moreHistory}
              href={(page) =>
                `${path}?${contextSearch}&history=${page}&progress=${progressPage}#historia`
              }
            />
          </details>
        </section>
      )}
    </div>
  );
}

export function CareOverviewView({
  role,
  plans,
  morePlans,
  inbox,
  moreInbox,
  inboxCount,
  page,
  inboxPage,
}: {
  role: Role;
  plans: CareSummary[];
  morePlans: boolean;
  inbox: CareProgress[];
  moreInbox: boolean;
  inboxCount: number;
  page: number;
  inboxPage: number;
}) {
  const base = role === "admin" ? "/admin" : "/app";
  return (
    <div className="stack">
      <header className={`card pad ${styles.header}`}>
        <div>
          <span className={styles.eyebrow}>
            <ClipboardList aria-hidden="true" /> Wspólna praca
          </span>
          <h2>
            {role === "admin"
              ? "Plany, do których warto wracać"
              : "Wasze plany pracy"}
          </h2>
          <p className="muted">
            {role === "admin"
              ? "Zalecenia i odpowiedzi opiekunów w jednym miejscu."
              : "Aktualne wskazówki i miejsce na Wasze postępy."}
          </p>
        </div>
        {role === "admin" && (
          <Link className="secondary-button" href="/admin/care/library">
            Biblioteka materiałów →
          </Link>
        )}
      </header>
      {role === "admin" && (
        <section className="card pad" id="odpowiedzi">
          <div className={styles.header}>
            <div>
              <span className={styles.eyebrow}>
                <MessageCircle aria-hidden="true" /> Kontakt z opiekunami
              </span>
              <h2>Do przeczytania: {inboxCount}</h2>
            </div>
          </div>
          <div className={styles.list}>
            {inbox.map((entry) => (
              <ProgressCard
                key={entry.id}
                progress={entry}
                role={role}
                showDog
              />
            ))}
          </div>
          {!inbox.length && (
            <p className="muted">
              {inboxPage > 1
                ? "Na tej stronie nie ma już nieprzeczytanych odpowiedzi. Wróć do poprzedniej strony."
                : "Nowe odpowiedzi opiekunów pojawią się tutaj. Samo otwarcie listy nie oznacza ich jako przeczytanych."}
            </p>
          )}
          <CarePagination
            page={inboxPage}
            more={moreInbox}
            href={(next) =>
              `${base}/care?page=${page}&inbox=${next}#odpowiedzi`
            }
          />
        </section>
      )}
      <section className="card pad" id="plany">
        <h2>Aktualne plany</h2>
        <div className={styles.list}>
          {plans.map((plan) => (
            <Link
              key={plan.id}
              className={styles.planLink}
              href={`${base}/dogs/${plan.dog_id}/care?plan=${plan.id}`}
            >
              <div className={styles.meta}>
                <span className={styles.pill}>{plan.dog_name}</span>
                <span>
                  Wersja {plan.revision} · {careDate(plan.published_at)}
                </span>
              </div>
              <h3>{plan.title}</h3>
              {plan.follow_up_on && (
                <p className="muted">
                  Kontakt kontrolny: {careDate(plan.follow_up_on)}
                </p>
              )}
              {role === "admin" && plan.unread_count > 0 && (
                <p>Nieprzeczytane odpowiedzi: {plan.unread_count}</p>
              )}
              <span className="ghost-button">Otwórz plan i postępy →</span>
            </Link>
          ))}
        </div>
        {!plans.length && (
          <div className={styles.empty}>
            <p>
              {role === "admin"
                ? "Pierwszy plan przygotujesz z karty wybranego psa."
                : "Gdy prowadząca opublikuje plan dla Twojego psa, znajdziesz go tutaj."}
            </p>
            <Link className="secondary-button" href={`${base}/dogs`}>
              {role === "admin" ? "Wybierz psa" : "Przejdź do moich psów"}
            </Link>
          </div>
        )}
        <CarePagination
          page={page}
          more={morePlans}
          href={(next) => `${base}/care?page=${next}&inbox=${inboxPage}#plany`}
        />
      </section>
    </div>
  );
}

export function CareLibraryView({
  templates,
  newId,
}: {
  templates: CareTemplate[];
  newId: string;
}) {
  return (
    <div className="stack">
      <Link className="ghost-button" href="/admin/care">
        ← Plany i postępy
      </Link>
      <header className="card pad">
        <span className={styles.eyebrow}>
          <BookOpen aria-hidden="true" /> Twoje materiały
        </span>
        <h2>Biblioteka zaleceń</h2>
        <p className="muted">
          Zachowaj sprawdzone treści, a potem dostosuj je do konkretnego psa.
          Zmiana materiału nie zmienia wcześniej opublikowanych planów.
        </p>
      </header>
      <article className="card pad">
        <CareEditorDisclosure
          initiallyOpen={!templates.length}
          label="Dodaj własny materiał"
        >
          <TemplateEditor newId={newId} />
        </CareEditorDisclosure>
      </article>
      {templates.map((template) => (
        <article className="card pad" key={template.id}>
          <details className={styles.disclosure}>
            <summary>{template.title}</summary>
            <p className="muted">
              Ostatnia zmiana: {careDate(template.updated_at)}
            </p>
            <TemplateEditor template={template} />
          </details>
        </article>
      ))}
    </div>
  );
}
