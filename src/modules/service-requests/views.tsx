import Link from "next/link";
import { ActionForm } from "@/components/action-form";
import { changeServiceRequest, requestServiceDate } from "./actions";
import { requestLabels, type PublicCourse, type ServiceRequest } from "./types";
import styles from "./requests.module.css";

const date = (value: string) =>
  new Intl.DateTimeFormat("pl-PL", {
    timeZone: "Europe/Warsaw",
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
export function RequestCard({
  request,
  admin,
}: {
  request: ServiceRequest;
  admin: boolean;
}) {
  const history = [...request.service_request_history].sort(
    (a, b) => a.version - b.version,
  );
  return (
    <article
      className={`card pad ${styles.request}`}
      id={`request-${request.id}`}
      tabIndex={-1}
    >
      <div className={styles.row}>
        <span className="badge">{requestLabels[request.status]}</span>
        <small className="muted">{date(request.created_at)}</small>
      </div>
      <h3>{request.service_name}</h3>
      <p>
        <strong>{request.dogs?.name || "Pies"}</strong>
        {admin && request.profiles?.full_name
          ? ` · ${request.profiles.full_name}`
          : ""}
      </p>
      <p className={styles.text}>{request.message}</p>
      {request.availability && (
        <p className={styles.text}>
          <strong>Dogodne terminy: </strong>
          {request.availability}
        </p>
      )}
      {request.resolution_note && (
        <div className={styles.response}>
          <strong>
            {request.status === "handled"
              ? "Notatka prowadzącej"
              : "Wycofanie zgłoszenia"}
          </strong>
          <p className={styles.text}>{request.resolution_note}</p>
        </div>
      )}
      {request.status === "open" && (
        <ActionForm
          key={`${request.id}-${request.version}`}
          action={changeServiceRequest}
          label={admin ? "Oznacz jako załatwione" : "Wycofaj zgłoszenie"}
          confirm={admin ? undefined : "Wycofać prośbę o ustalenie terminu?"}
        >
          <input type="hidden" name="id" value={request.id} />
          <input type="hidden" name="service_id" value={request.service_id} />
          <input
            type="hidden"
            name="expected_version"
            value={request.version}
          />
          <input
            type="hidden"
            name="intent"
            value={admin ? "handled" : "cancelled"}
          />
          {admin ? (
            <div className="field">
              <label htmlFor={`note-${request.id}`}>Notatka dla opiekuna</label>
              <textarea
                id={`note-${request.id}`}
                name="note"
                minLength={3}
                maxLength={2000}
                rows={3}
                required
              />
              <small className="muted">
                Opiekun zobaczy ją w tym zgłoszeniu. Termin spotkania zapiszesz
                osobno w odpowiedniej usłudze.
              </small>
            </div>
          ) : (
            <input type="hidden" name="note" value="" />
          )}
        </ActionForm>
      )}
      <details className={styles.history}>
        <summary>Historia zgłoszenia</summary>
        <ol>
          {history.map((event) => (
            <li key={event.id}>
              <strong>
                {event.action === "requested"
                  ? "Zgłoszono potrzebę ustalenia terminu"
                  : requestLabels[event.action]}
              </strong>
              <small>{date(event.created_at)}</small>
              {event.note && <p className={styles.text}>{event.note}</p>}
            </li>
          ))}
        </ol>
      </details>
      {admin && (
        <Link className="ghost-button" href={`/admin/dogs/${request.dog_id}`}>
          Profil psa →
        </Link>
      )}
    </article>
  );
}
export function RequestFormView({
  id,
  title,
  dogs,
  hasDogs,
  canRequest,
  offered,
  requestId,
  requests,
  more,
  page,
  saved,
  focused,
}: {
  id: string;
  title: string;
  dogs: { id: string; name: string }[];
  hasDogs: boolean;
  canRequest: boolean;
  offered: PublicCourse[];
  requestId: string;
  requests: ServiceRequest[];
  more: boolean;
  page: number;
  saved: boolean;
  focused: boolean;
}) {
  return (
    <div className="stack">
      <nav className={styles.row} aria-label="Zgłoszenia terminu">
        <Link className="ghost-button" href="/app/calendar/offer">
          ← Kalendarz oferty
        </Link>
        <Link className="ghost-button" href="/app/service-requests">
          Moje zgłoszenia terminów →
        </Link>
      </nav>
      <header>
        <h2>Uzgodnij termin</h2>
        <p className={styles.lead}>{title}</p>
        <p className="muted">
          Opisz, czego potrzebujecie i kiedy możecie się spotkać. Prowadząca
          zobaczy prośbę w aplikacji. To zgłoszenie nie rezerwuje terminu ani
          nie ustala ceny.
        </p>
      </header>
      {saved && (
        <p role="status" className="alert green">
          Zgłoszenie zapisane. Jeśli dla tego psa była już otwarta prośba o tę
          usługę, pokazujemy ją poniżej.
        </p>
      )}
      {offered.length > 0 ? (
        <section className="card pad">
          <h3>Ten kurs ma już opublikowany termin</h3>
          <p>Sprawdź dostępność i zgłoś psa w zapisach na cały cykl.</p>
          <div className={styles.row}>
            {offered.map((course) => (
              <Link
                className="ghost-button"
                key={course.id}
                href={`/app/courses/${course.id}`}
              >
                {course.title} →
              </Link>
            ))}
          </div>
        </section>
      ) : canRequest ? (
        !hasDogs ? (
          <section className="card pad">
            <h3>Najpierw dodaj swojego psa</h3>
            <Link className="primary-button" href="/app/dogs/new">
              Dodaj psa →
            </Link>
          </section>
        ) : dogs.length ? (
          <section className="card pad">
            <h3>Prośba o termin</h3>
            <ActionForm
              action={requestServiceDate}
              label="Zgłoś potrzebę ustalenia terminu"
            >
              <input type="hidden" name="request_id" value={requestId} />
              <input type="hidden" name="service_id" value={id} />
              <div className="field">
                <label htmlFor="request-dog">Pies</label>
                <select id="request-dog" name="dog_id" required defaultValue="">
                  <option value="" disabled>
                    Wybierz psa
                  </option>
                  {dogs.map((dog) => (
                    <option key={dog.id} value={dog.id}>
                      {dog.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label htmlFor="request-message">
                  W czym możemy Wam pomóc?
                </label>
                <textarea
                  id="request-message"
                  name="message"
                  minLength={3}
                  maxLength={2000}
                  rows={4}
                  required
                />
              </div>
              <div className="field">
                <label htmlFor="request-availability">
                  Kiedy możecie się spotkać? (opcjonalnie)
                </label>
                <textarea
                  id="request-availability"
                  name="availability"
                  maxLength={1000}
                  rows={3}
                  placeholder="Np. wtorki i czwartki po 17:00"
                />
              </div>
            </ActionForm>
          </section>
        ) : (
          <p className="alert">
            Twoje psy mają już otwarte zgłoszenia tej usługi. Ich status
            sprawdzisz poniżej lub w „Moich zgłoszeniach terminów”.
          </p>
        )
      ) : (
        <p className="alert">
          Nowe zgłoszenia ustalenia terminu tej usługi nie są dostępne.
          Wcześniejsze zgłoszenia pozostają poniżej.
        </p>
      )}
      <section className="stack" aria-labelledby="service-request-history">
        <h3 id="service-request-history">Twoje zgłoszenia tej usługi</h3>
        {requests.map((request) => (
          <RequestCard key={request.id} request={request} admin={false} />
        ))}
        {!requests.length && (
          <p className="muted">Nie masz jeszcze zgłoszeń tej usługi.</p>
        )}
        {focused ? (
          <Link className="ghost-button" href={`/app/services/${id}/request`}>
            Wszystkie zgłoszenia tej usługi →
          </Link>
        ) : (
          <Pagination
            base={`/app/services/${id}/request`}
            page={page}
            more={more}
          />
        )}
      </section>
    </div>
  );
}
function Pagination({
  base,
  page,
  more,
}: {
  base: string;
  page: number;
  more: boolean;
}) {
  const separator = base.includes("?") ? "&" : "?";
  return (
    <nav className={styles.row} aria-label="Strony zgłoszeń">
      {page > 1 && (
        <Link
          className="ghost-button"
          href={`${base}${separator}page=${page - 1}`}
        >
          ← Nowsze
        </Link>
      )}
      {more && (
        <Link
          className="ghost-button"
          href={`${base}${separator}page=${page + 1}`}
        >
          Starsze →
        </Link>
      )}
    </nav>
  );
}
export function RequestsView({
  requests,
  more,
  admin,
  page,
  filter,
}: {
  requests: ServiceRequest[];
  more: boolean;
  admin: boolean;
  page: number;
  filter: "open" | "history";
}) {
  const base = admin ? "/admin/service-requests" : "/app/service-requests";
  return (
    <div className="stack">
      <Link
        className="ghost-button"
        href={admin ? "/admin/activities" : "/app/services"}
      >
        ← {admin ? "Zajęcia" : "Oferta"}
      </Link>
      <header>
        <h2>
          {admin ? "Prośby o ustalenie terminu" : "Moje zgłoszenia terminów"}
        </h2>
        <p className="muted">
          Prośby o indywidualne zajęcia, dla których nie ma opublikowanego
          cyklu. Potwierdzone spotkania znajdziesz w kalendarzu.
        </p>
      </header>
      <nav className={styles.row} aria-label="Status zgłoszeń">
        {(["open", "history"] as const).map((value) => (
          <Link
            key={value}
            className={value === filter ? "small-button" : "ghost-button"}
            aria-current={value === filter ? "page" : undefined}
            href={`${base}?filter=${value}`}
          >
            {value === "open" ? "Do ustalenia" : "Historia"}
          </Link>
        ))}
      </nav>
      {requests.map((request) => (
        <RequestCard key={request.id} request={request} admin={admin} />
      ))}
      {!requests.length && (
        <article className="card pad">
          <h3>
            {filter === "open"
              ? "Nie ma otwartych zgłoszeń"
              : "Historia jest pusta"}
          </h3>
          <p className="muted">
            {admin
              ? "Nowe prośby opiekunów pojawią się tutaj."
              : "Zgłoszenie możesz utworzyć przy wybranej usłudze indywidualnej."}
          </p>
        </article>
      )}
      <Pagination base={`${base}?filter=${filter}`} page={page} more={more} />
    </div>
  );
}
export function ServiceRequestsActivityCard({ count }: { count: number }) {
  return (
    <section className="card pad">
      <h3>
        Prośby o ustalenie terminu <span className="badge">{count}</span>
      </h3>
      <p className="muted">Indywidualne zajęcia do uzgodnienia z opiekunami.</p>
      <Link className="ghost-button" href="/admin/service-requests">
        Otwórz zgłoszenia →
      </Link>
    </section>
  );
}
