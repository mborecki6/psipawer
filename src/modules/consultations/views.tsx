import Link from "next/link";
import { CalendarDays, Clock3, ArrowRight, MessageCircle } from "lucide-react";
import type { Role } from "@/lib/auth/session";
import type { ConsultationBalance } from "@/lib/finance";
import { ConsultationBilling } from "./billing";
import { ActionForm } from "@/components/action-form";
import { dateLabel, money } from "@/lib/domain";
import { ConsultationServicePicker } from "@/modules/services/selection";
import type { Service } from "@/modules/services/types";
import { ScheduleEditor } from "./editor";
import { ConsultationPriceEditor } from "./price-editor";
import { requestConsultation, closeConsultation } from "./actions";
import {
  consultationLabels,
  historyLabels,
  type Consultation,
  type ConsultationHistory,
  consultationFilter,
} from "./types";
import styles from "./consultations.module.css";
import type { CarePlan } from "@/modules/care/types";

function Status({ value }: { value: Consultation["status"] }) {
  return (
    <span className={`${styles.status} ${styles[value]}`}>
      {consultationLabels[value]}
    </span>
  );
}
function Paging({
  page,
  more,
  href,
}: {
  page: number;
  more: boolean;
  href: (n: number) => string;
}) {
  return (
    (page > 1 || more) && (
      <nav aria-label="Strony wyników" className={styles.actions}>
        {page > 1 && (
          <Link className="ghost-button" href={href(page - 1)}>
            ← Poprzednia strona
          </Link>
        )}
        <span className="muted">Strona {page}</span>
        {more && (
          <Link className="ghost-button" href={href(page + 1)}>
            Następna strona →
          </Link>
        )}
      </nav>
    )
  );
}
export function ConsultationListView({
  role,
  consultations,
  filter,
  page,
  more,
  dogId,
}: {
  role: Role;
  consultations: Consultation[];
  filter: ReturnType<typeof consultationFilter>;
  page: number;
  more: boolean;
  dogId?: string;
}) {
  const base = role === "admin" ? "/admin" : "/app";
  const url = (f: string, p = 1) =>
    `${base}/consultations?${new URLSearchParams({ filter: f, page: String(p), ...(dogId ? { dog: dogId } : {}) })}`;
  return (
    <div className="stack">
      <header className={styles.header}>
        <div>
          <span className={styles.eyebrow}>
            <CalendarDays size={17} /> Czas na rozmowę
          </span>
          <h2>Mały krok do lepszego zrozumienia.</h2>
          <p className="muted">
            {role === "admin"
              ? "Potrzeby opiekunów, ustalone spotkania i historia wspólnej pracy."
              : "Opisz, czego potrzebujecie. Termin ustalicie wspólnie z prowadzącą."}
          </p>
        </div>
        {role === "client" && (
          <Link
            className="primary-button"
            href={`/app/consultations/new${dogId ? `?dog=${dogId}` : ""}`}
          >
            Poproś o konsultację <ArrowRight size={17} />
          </Link>
        )}
      </header>
      <nav className={styles.tabs} aria-label="Filtry konsultacji">
        {(
          [
            ["active", "Otwarte"],
            ["requested", "Do ustalenia"],
            ["scheduled", "Umówione"],
            ["history", "Historia"],
          ] as const
        ).map(([key, label]) => (
          <Link
            key={key}
            href={url(key)}
            className={filter === key ? styles.activeTab : ""}
            aria-current={filter === key ? "page" : undefined}
          >
            {label}
          </Link>
        ))}
      </nav>
      {dogId && (
        <Link className="ghost-button" href={`${base}/consultations`}>
          Pokaż konsultacje wszystkich psów →
        </Link>
      )}
      {consultations.length ? (
        <div className={styles.list}>
          {consultations.map((c) => (
            <Link
              className={`card ${styles.appointment}`}
              href={`${base}/consultations/${c.id}`}
              key={c.id}
            >
              <div className={styles.dateTile}>
                {c.starts_at ? (
                  <>
                    <strong>
                      {new Intl.DateTimeFormat("pl-PL", {
                        day: "numeric",
                        timeZone: "Europe/Warsaw",
                      }).format(new Date(c.starts_at))}
                    </strong>
                    <span>
                      {new Intl.DateTimeFormat("pl-PL", {
                        month: "short",
                        timeZone: "Europe/Warsaw",
                      }).format(new Date(c.starts_at))}
                    </span>
                  </>
                ) : (
                  <MessageCircle aria-hidden="true" />
                )}
              </div>
              <div className={styles.rowBody}>
                <div className={styles.rowTitle}>
                  <h3>{c.dogs.name}</h3>
                  <Status value={c.status} />
                </div>
                <p className={styles.topicPreview}>{c.topic}</p>
                <span className="muted">
                  {c.starts_at
                    ? `${dateLabel(c.starts_at)} · ${c.duration_minutes} min · ${c.meeting_mode === "online" ? "Online" : "Na miejscu"}`
                    : "Termin ustalimy po omówieniu zgłoszenia"}
                </span>
              </div>
              <ArrowRight className={styles.rowArrow} aria-hidden="true" />
            </Link>
          ))}
        </div>
      ) : (
        <article className="card pad">
          <h3>
            {filter === "requested"
              ? "Brak zgłoszeń do ustalenia"
              : filter === "history"
                ? "Tutaj pojawi się historia spotkań"
                : "Na razie spokojnie w kalendarzu"}
          </h3>
          <p className="muted">
            {role === "client"
              ? "Jeśli potrzebujesz wsparcia, możesz opisać potrzebę konsultacji. Zgłoszenie nie rezerwuje jeszcze terminu."
              : "Zgłoszenia opiekunów pojawią się tutaj. Każde otwiera kartę psa i pozwala ustalić spotkanie."}
          </p>
        </article>
      )}
      <Paging page={page} more={more} href={(n) => url(filter, n)} />
    </div>
  );
}
export function ConsultationRequestView({
  dogs,
  id,
  dogId,
  services,
  serviceId,
}: {
  dogs: { id: string; name: string }[];
  services: Service[];
  serviceId?: string;
  id: string;
  dogId?: string;
}) {
  return (
    <div className="stack">
      <Link className="ghost-button" href="/app/consultations">
        ← Konsultacje
      </Link>
      <header className={styles.header}>
        <div>
          <span className={styles.eyebrow}>
            <MessageCircle size={17} /> Zacznijmy od Was
          </span>
          <h2>W czym możemy pomóc?</h2>
          <p className="muted">
            Krótki opis wystarczy. Szczegóły omówicie z prowadzącą.
          </p>
        </div>
      </header>
      <div className={styles.detailGrid}>
        <article className="card pad">
          {dogs.length && services.length ? (
            <ActionForm action={requestConsultation} label="Przekaż zgłoszenie">
              <input type="hidden" name="id" value={id} />
              <ConsultationServicePicker
                services={services}
                serviceId={serviceId}
              />
              <label className="field">
                Twój pies
                <select
                  name="dog_id"
                  defaultValue={
                    dogs.some((d) => d.id === dogId) ? dogId : dogs[0].id
                  }
                  required
                >
                  {dogs.map((d) => (
                    <option value={d.id} key={d.id}>
                      {d.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                Co chcesz omówić?
                <textarea
                  name="topic"
                  minLength={3}
                  maxLength={3000}
                  rows={6}
                  required
                  placeholder="Napisz, z czym przychodzicie i czego potrzebujesz."
                />
              </label>
              <label className="field">
                Kiedy masz czas? (opcjonalnie)
                <textarea
                  name="availability"
                  maxLength={1000}
                  rows={3}
                  placeholder="Np. popołudnia w tygodniu, spotkanie online lub na miejscu."
                />
              </label>
            </ActionForm>
          ) : dogs.length ? (
            <>
              <h3>Oferta spotkań jest w przygotowaniu</h3>
              <p>
                Skontaktuj się z prowadzącą, aby ustalić dostępne możliwości.
              </p>
            </>
          ) : (
            <>
              <h3>Najpierw poznajmy Twojego psa</h3>
              <p className="muted">
                Dodaj krótki profil. Nie trzeba od razu uzupełniać wszystkich
                informacji.
              </p>
              <Link className="primary-button" href="/app/dogs/new">
                Dodaj psa
              </Link>
            </>
          )}
        </article>
        <aside className={`card pad ${styles.aside}`}>
          <h3>Co wydarzy się dalej?</h3>
          <ol className={styles.steps}>
            <li>Prowadząca przeczyta zgłoszenie.</li>
            <li>Uzgodnicie termin i warunki spotkania.</li>
            <li>Potwierdzone szczegóły zobaczysz tutaj.</li>
          </ol>
          <p className="muted">
            Zgłoszenie nie jest płatnością ani potwierdzeniem rezerwacji.
          </p>
        </aside>
      </div>
    </div>
  );
}
export function ConsultationView({
  role,
  consultation: c,
  history,
  page,
  more,
  now,
  balance,
  care = { plans: [], more: false, hasDraft: false },
  plansPage = 1,
  priceRequestId,
  priceSaved = false,
  confirmedPriceVersion,
}: {
  role: Role;
  consultation: Consultation;
  history: ConsultationHistory[];
  page: number;
  more: boolean;
  now: string;
  balance?: ConsultationBalance;
  care?: {
    plans: Pick<CarePlan, "id" | "title" | "revision" | "published_at">[];
    more: boolean;
    hasDraft: boolean;
  };
  plansPage?: number;
  priceRequestId?: string;
  priceSaved?: boolean;
  confirmedPriceVersion?: number;
}) {
  const base = role === "admin" ? "/admin" : "/app";
  const active = c.status === "requested" || c.status === "scheduled";
  const canComplete =
    role === "admin" &&
    c.status === "scheduled" &&
    c.starts_at &&
    new Date(c.starts_at).getTime() + (c.duration_minutes || 0) * 60000 <=
      new Date(now).getTime();
  const canCancel =
    active &&
    (role === "admin" || !c.starts_at || new Date(c.starts_at) > new Date(now));
  return (
    <div className="stack">
      <Link className="ghost-button" href={`${base}/consultations`}>
        ← Konsultacje
      </Link>
      <header className={styles.header}>
        <div>
          <span className={styles.eyebrow}>
            <CalendarDays size={17} /> Konsultacja indywidualna
          </span>
          <h2>{c.dogs.name} — czas dla Was.</h2>
          <Status value={c.status} />
        </div>
        <Link className="ghost-button" href={`${base}/dogs/${c.dog_id}`}>
          Karta psa →
        </Link>
      </header>
      <div className={styles.detailGrid}>
        <div className="stack">
          <article className={`card pad ${styles.meeting}`}>
            {c.service_name && (
              <p>
                <strong>{c.service_name}</strong>
              </p>
            )}
            <p>
              {c.agreed_price_cents !== null ? (
                <>
                  <strong>{money(c.agreed_price_cents)}</strong>
                  {c.service_name
                    ? " · cena zachowana przy zgłoszeniu"
                    : " · kwota uzgodniona z opiekunem"}
                  {c.is_test_price ? " · robocza" : ""}
                </>
              ) : (
                "Cena do ustalenia z prowadzącą"
              )}
            </p>
            <span className={styles.eyebrow}>
              <Clock3 size={17} />{" "}
              {c.status === "cancelled"
                ? "Odwołane spotkanie"
                : "Szczegóły spotkania"}
            </span>
            <h3>
              {c.starts_at
                ? dateLabel(c.starts_at)
                : "Termin do wspólnego ustalenia"}
            </h3>
            {c.starts_at ? (
              <>
                <p>
                  {c.duration_minutes} minut ·{" "}
                  {c.meeting_mode === "online"
                    ? "Spotkanie online"
                    : "Spotkanie na miejscu"}
                </p>
                <p className={styles.preserve}>{c.location}</p>
              </>
            ) : (
              <p className="muted">
                Prowadząca zapozna się ze zgłoszeniem i zapisze uzgodniony z
                Tobą termin.
              </p>
            )}
            {c.status === "cancelled" && (
              <p className="muted">
                Ten termin już nie obowiązuje. Powód znajdziesz w historii
                poniżej.
              </p>
            )}
          </article>
          <article className="card pad">
            <h3>O czym porozmawiamy</h3>
            <p className={styles.preserve}>{c.topic}</p>
            {c.availability && (
              <>
                <h4>Dostępność opiekuna</h4>
                <p className={styles.preserve}>{c.availability}</p>
              </>
            )}
          </article>
          {role === "admin" && active && (
            <article className="card pad">
              <h3>
                {c.status === "scheduled"
                  ? "Zmiana szczegółów"
                  : "Ustal termin"}
              </h3>
              <p className="muted">
                Zapisz termin uzgodniony z opiekunem. Wszystkie pola tego
                formularza są widoczne dla opiekuna. Wiadomości e-mail nie są
                jeszcze wysyłane.
              </p>
              {c.status === "requested" && c.agreed_price_cents !== null && (
                <p className="muted">
                  Potwierdzenie terminu doda do finansów należność{" "}
                  {money(c.agreed_price_cents)} zgodną z zapisaną kwotą.
                </p>
              )}
              <ScheduleEditor
                consultation={c}
                confirmedPriceVersion={confirmedPriceVersion}
              />
              <Link
                className="ghost-button"
                href="/admin/calendar"
                target="_blank"
                rel="noreferrer"
              >
                Sprawdź kalendarz w nowej karcie ↗
              </Link>
            </article>
          )}
          <article className="card pad">
            <h3>Historia konsultacji</h3>
            <ol className={styles.timeline}>
              {history.map((h) => (
                <li key={h.id}>
                  <span className={styles.dot} aria-hidden="true" />
                  <div>
                    <strong>{historyLabels[h.action]}</strong>
                    <small>{dateLabel(h.created_at)}</small>
                    {h.action === "price_agreed" &&
                      h.agreed_price_cents != null && (
                        <p>
                          <strong>{money(h.agreed_price_cents)}</strong>
                          {h.is_test_price
                            ? " · cena robocza do testów"
                            : " · kwota uzgodniona z opiekunem"}
                        </p>
                      )}
                    {h.starts_at && (
                      <p>
                        {dateLabel(h.starts_at)} · {h.duration_minutes} min ·{" "}
                        {h.meeting_mode === "online" ? "Online" : "Na miejscu"}
                      </p>
                    )}
                    {h.location && (
                      <p className={styles.preserve}>{h.location}</p>
                    )}
                    {h.note && <p className={styles.preserve}>{h.note}</p>}
                  </div>
                </li>
              ))}
            </ol>
            <Paging
              page={page}
              more={more}
              href={(n) =>
                `${base}/consultations/${c.id}?page=${n}&plans=${plansPage}`
              }
            />
          </article>
        </div>
        <aside className="stack">
          {role === "admin" && priceSaved && c.agreed_price_cents !== null && (
            <div role="status" className="alert green">
              Uzgodniona kwota zapisana. Rozliczenie i historia są aktualne.
            </div>
          )}
          {balance && (
            <ConsultationBilling balance={balance} admin={role === "admin"} />
          )}
          {role === "admin" &&
            c.agreed_price_cents === null &&
            c.status !== "cancelled" &&
            priceRequestId && (
              <ConsultationPriceEditor
                id={c.id}
                version={c.version}
                requestId={priceRequestId}
              />
            )}
          <article className={`card pad ${styles.aside}`}>
            <span className={styles.eyebrow}>Zalecenia ze spotkania</span>
            <h3>Wasz plan po konsultacji</h3>
            {care.plans.map((plan) => (
              <p key={plan.id}>
                <Link
                  className="ghost-button"
                  href={`${base}/care/plans/${plan.id}`}
                >
                  {plan.title} · wersja {plan.revision} →
                </Link>
                <small className="muted">{dateLabel(plan.published_at)}</small>
              </p>
            ))}
            {!care.plans.length && (
              <p className="muted">
                {plansPage > 1
                  ? "Nie ma kolejnych publikacji."
                  : "Nie ma jeszcze opublikowanych zaleceń powiązanych z tym spotkaniem."}
              </p>
            )}
            <Paging
              page={plansPage}
              more={care.more}
              href={(n) =>
                `${base}/consultations/${c.id}?page=${page}&plans=${n}`
              }
            />
            {role === "admin" &&
              (c.status === "scheduled" ||
                c.status === "completed" ||
                care.hasDraft) && (
                <>
                  {care.hasDraft && (
                    <p className="muted">
                      Jest zapisany szkic dla tego spotkania. Opiekun go nie
                      widzi.
                    </p>
                  )}
                  <Link
                    className="primary-button"
                    href={`/admin/dogs/${c.dog_id}/care?consultation=${c.id}#szkic`}
                  >
                    {care.hasDraft
                      ? "Otwórz szkic zaleceń"
                      : "Przygotuj zalecenia"}{" "}
                    →
                  </Link>
                  {c.status === "scheduled" && (
                    <p className="muted">
                      Możesz przygotować szkic. Publikacja będzie dostępna po
                      oznaczeniu konsultacji jako zakończonej.
                    </p>
                  )}
                </>
              )}
            <Link
              className="ghost-button"
              href={`${base}/dogs/${c.dog_id}/care`}
            >
              {role === "admin"
                ? "Przejdź do planu pracy"
                : "Moje plany i postępy"}{" "}
              →
            </Link>
            {role === "admin" && (
              <p className="muted">
                Prywatne notatki zapisuj w karcie psa, wybierając widoczność
                tylko dla prowadzącej.
              </p>
            )}
          </article>
          {canComplete && (
            <article className="card pad">
              <h3>Po spotkaniu</h3>
              <ActionForm
                action={closeConsultation}
                label="Oznacz jako zakończoną"
                key={`complete-${c.version}`}
              >
                <input type="hidden" name="id" value={c.id} />
                <input
                  type="hidden"
                  name="expected_version"
                  value={c.version}
                />
                <input type="hidden" name="intent" value="complete" />
                <label className="field">
                  Podsumowanie dla opiekuna (opcjonalnie)
                  <textarea name="note" rows={4} maxLength={3000} />
                </label>
              </ActionForm>
            </article>
          )}
          {canCancel && (
            <article className="card pad">
              <details>
                <summary className={styles.disclosure}>
                  Potrzebujesz odwołać?
                </summary>
                <p className="muted">
                  Powód będzie widoczny dla obu stron. Odwołanie usuwa
                  niezapłaconą należność. Wcześniejsze wpłaty wymagają osobnego
                  rozliczenia — zapis nie wykonuje zwrotu pieniędzy.
                </p>
                <ActionForm
                  action={closeConsultation}
                  label="Odwołaj konsultację"
                  confirm="Odwołać tę konsultację? Jej historia zostanie zachowana."
                  key={`cancel-${c.version}`}
                >
                  <input type="hidden" name="id" value={c.id} />
                  <input
                    type="hidden"
                    name="expected_version"
                    value={c.version}
                  />
                  <input type="hidden" name="intent" value="cancel" />
                  <label className="field">
                    Powód odwołania
                    <textarea
                      name="note"
                      rows={3}
                      minLength={3}
                      maxLength={3000}
                      required
                    />
                  </label>
                </ActionForm>
              </details>
            </article>
          )}
        </aside>
      </div>
    </div>
  );
}
