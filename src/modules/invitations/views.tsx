import Link from "next/link";
import { ActionForm, Field } from "@/components/action-form";
import { dateLabel } from "@/lib/domain";
import { RefreshInbox } from "../notifications/refresh";
import {
  prepareInvitation,
  sendInvitation,
  setInvitationArchive,
} from "./actions";
import {
  accountLabels,
  deliveryLabels,
  deliveryErrorLabels,
  type Invitation,
  type InvitationAttempt,
} from "./types";
import styles from "./invitations.module.css";
export function InvitationsView({
  items,
  more,
  page,
  draftId,
  saved,
  enabled,
  archived = false,
  search = "",
}: {
  items: Invitation[];
  more: boolean;
  page: number;
  draftId: string;
  saved: boolean;
  enabled: boolean;
  archived?: boolean;
  search?: string;
}) {
  const listLink = (page: number, archivedView = archived, query = search) => {
    const params = new URLSearchParams({ page: String(page) });
    if (archivedView) params.set("archived", "1");
    if (query) params.set("q", query);
    return `?${params}`;
  };
  return (
    <div className="stack">
      <Link className="ghost-button" href="/admin/dogs">
        ← Psy i opiekunowie
      </Link>
      <header className={styles.header}>
        <div>
          <span className="eyebrow">Dobry początek współpracy</span>
          <h2>Zaproszenia opiekunów</h2>
          <p className="muted">
            Przygotuj dostęp, a potem sprawdź, czy opiekun otworzył konto i
            uzupełnił profil.
          </p>
        </div>
        <RefreshInbox />
      </header>
      <div className="alert">
        {enabled
          ? "Tryb lokalny: wiadomości trafiają do skrzynki testowej. Przygotowanie zaproszenia niczego nie wysyła."
          : "Wysyłka jest wyłączona do czasu konfiguracji poczty i uruchomienia testów. Możesz przygotować listę zaproszeń."}
      </div>
      {saved && (
        <p className="alert green" role="status">
          Zaproszenie jest na liście. Aktualny stan znajdziesz poniżej.
        </p>
      )}
      {!archived && (
        <article className="card pad">
          <h3>Nowe zaproszenie</h3>
          <ActionForm
            action={prepareInvitation}
            label="Przygotuj zaproszenie"
            pendingLabel="Zapisuję…"
          >
            <input type="hidden" name="id" value={draftId} />
            <div className="form-grid">
              <Field
                name="name"
                label="Imię i nazwisko opiekuna"
                required
                maxLength={120}
              />
              <Field
                name="email"
                label="E-mail opiekuna"
                type="email"
                required
                maxLength={254}
              />
            </div>
            <p className="muted">
              To konto opiekuna. Dostęp do panelu zespołu nadawany jest
              oddzielnie.
            </p>
          </ActionForm>
        </article>
      )}
      <div className={styles.filters}>
        <nav className={styles.tabs} aria-label="Widok zaproszeń">
          <Link
            className="ghost-button"
            href={listLink(1, false)}
            aria-current={!archived ? "page" : undefined}
          >
            Aktywna lista
          </Link>
          <Link
            className="ghost-button"
            href={listLink(1, true)}
            aria-current={archived ? "page" : undefined}
          >
            Archiwum
          </Link>
        </nav>
        <form
          role="search"
          action="/admin/invitations"
          method="get"
          className={styles.search}
        >
          {archived && <input type="hidden" name="archived" value="1" />}
          <div className="field">
            <label htmlFor="invitation-search">Szukaj zaproszenia</label>
            <input
              id="invitation-search"
              name="q"
              defaultValue={search}
              maxLength={254}
              placeholder="Imię lub adres e-mail"
            />
          </div>
          <button className="ghost-button">Szukaj</button>
        </form>
      </div>
      {archived && (
        <p className="muted">
          Niewysłane zaproszenia odłożone na później. Możesz przywrócić je na
          aktywną listę.
        </p>
      )}
      {search && (
        <Link className="ghost-button" href={listLink(1, archived, "")}>
          Wyczyść wyszukiwanie
        </Link>
      )}
      <ol className={styles.list}>
        {items.map((i) => (
          <li className="card pad" key={i.id}>
            <InvitationSummary invitation={i} enabled={enabled} />
            <Link className="ghost-button" href={`/admin/invitations/${i.id}`}>
              Historia zaproszenia →
            </Link>
          </li>
        ))}
      </ol>
      {!items.length && (
        <article className="card pad">
          <h3>
            {search
              ? "Brak pasujących zaproszeń"
              : archived
                ? "Archiwum jest puste"
                : page > 1
                  ? "Brak zaproszeń na tej stronie"
                  : "Lista zaproszeń jest pusta"}
          </h3>
          <p className="muted">
            {search
              ? "Zmień wpisane imię lub adres albo sprawdź drugi widok listy."
              : archived
                ? "Trafią tu niewysłane zaproszenia, które przeniesiesz do archiwum."
                : page > 1
                  ? "Wróć do nowszych zaproszeń."
                  : "Przygotuj pierwsze zaproszenie w formularzu powyżej."}
          </p>
        </article>
      )}
      <nav className={styles.header} aria-label="Strony zaproszeń">
        {page > 1 && (
          <Link className="ghost-button" href={listLink(page - 1)}>
            ← Nowsze
          </Link>
        )}
        {more && (
          <Link className="ghost-button" href={listLink(page + 1)}>
            Starsze →
          </Link>
        )}
      </nav>
    </div>
  );
}

function InvitationSummary({
  invitation: i,
  enabled,
}: {
  invitation: Invitation;
  enabled: boolean;
}) {
  return (
    <div className={styles.summaryBody}>
      <div className={styles.header}>
        <h3>{i.display_name}</h3>
        <span className="badge">{accountLabels[i.account_stage]}</span>
      </div>
      <p className={styles.email}>{i.email}</p>
      <p role="status">
        {i.archived_at ? "Szkic w archiwum" : deliveryLabels[i.delivery_status]}
        {i.last_attempt_at
          ? ` · ostatnia próba ${dateLabel(i.last_attempt_at)}`
          : ""}
      </p>
      {i.delivery_status === "failed" && (
        <p className="alert red">
          {i.last_error_code === "rate_limited"
            ? deliveryErrorLabels.rate_limited
            : deliveryErrorLabels.rejected}
        </p>
      )}
      {i.archived_at ? (
        <p className="alert">
          Zaproszenie przeniesiono do archiwum {dateLabel(i.archived_at)}. Aby
          je wysłać, najpierw przywróć je na listę.
        </p>
      ) : i.account_stage === "ready" ? (
        <p className="muted">
          Opiekun potwierdził adres, ustawił hasło i uzupełnił podstawowe dane.
          Może przejść do profilu psa.
        </p>
      ) : i.account_stage === "password_unverified" ? (
        <p className="muted">
          Konto aktywowano przed uruchomieniem śledzenia ustawienia hasła.
          Opiekun może korzystać ze swojego hasła, a jeśli go nie pamięta —
          odzyskać dostęp na stronie logowania. Nie wymaga nowego zaproszenia.
        </p>
      ) : i.account_stage !== "not_activated" ? (
        <p className="muted">
          Konto jest już otwarte. Opiekun może dokończyć ustawienia albo
          skorzystać z odzyskania hasła na stronie logowania.
        </p>
      ) : (
        <>
          {i.delivery_status === "uncertain" && (
            <p className="alert">
              Wiadomość mogła zostać wysłana mimo braku potwierdzenia. Sprawdź
              skrzynkę i odśwież stan przed ponowną próbą.
            </p>
          )}
          {i.delivery_status === "sent" && (
            <p className="muted">
              Przyjęcie wysyłki nie potwierdza odbioru wiadomości. Opiekun
              powinien otworzyć najnowszy link.
            </p>
          )}
          {enabled && i.can_send ? (
            <ActionForm
              action={sendInvitation}
              label={
                i.delivery_status === "draft"
                  ? "Wyślij do skrzynki testowej"
                  : "Wyślij nowe zaproszenie"
              }
              pendingLabel="Wysyłam…"
              confirm={
                i.delivery_status !== "draft"
                  ? "Wysłać nowy link? Poprzedni link może przestać działać."
                  : undefined
              }
            >
              <input type="hidden" name="id" value={i.id} />
              <input type="hidden" name="version" value={i.version} />
            </ActionForm>
          ) : (
            enabled && (
              <p className="muted">
                Odczekaj dwie minuty od poprzedniej próby, potem odśwież listę.
              </p>
            )
          )}
        </>
      )}
      {(i.archived_at || i.can_archive) && (
        <ActionForm
          action={setInvitationArchive}
          className={styles.archiveAction}
          label={i.archived_at ? "Przywróć na listę" : "Przenieś do archiwum"}
          pendingLabel="Zapisuję zmianę…"
          confirm={
            i.archived_at
              ? undefined
              : "Przenieść niewysłane zaproszenie do archiwum? Możesz później przywrócić je na listę."
          }
        >
          <input type="hidden" name="id" value={i.id} />
          <input type="hidden" name="version" value={i.version} />
          <input type="hidden" name="archived" value={String(!i.archived_at)} />
        </ActionForm>
      )}
    </div>
  );
}

export function InvitationDetailView({
  invitation,
  attempts,
  more,
  page,
  enabled,
}: {
  invitation: Invitation;
  attempts: InvitationAttempt[];
  more: boolean;
  page: number;
  enabled: boolean;
}) {
  return (
    <div className="stack">
      <Link
        className="ghost-button"
        href={
          invitation.archived_at
            ? "/admin/invitations?archived=1"
            : "/admin/invitations"
        }
      >
        {invitation.archived_at
          ? "← Archiwum zaproszeń"
          : "← Zaproszenia opiekunów"}
      </Link>
      <header className={styles.header}>
        <div>
          <span className="eyebrow">Dostęp do konta</span>
          <h2>Historia zaproszenia</h2>
          <p className="muted">
            Sprawdź wysyłki i aktualny etap aktywacji konta.
          </p>
        </div>
        <RefreshInbox />
      </header>
      <article className={`card pad ${styles.summary}`}>
        <InvitationSummary invitation={invitation} enabled={enabled} />
        {!enabled && <p className="muted">Wysyłka jest obecnie wyłączona.</p>}
      </article>
      <section className={styles.history} aria-labelledby="invitation-attempts">
        <h3 id="invitation-attempts">Próby wysyłki</h3>
        <p className="muted">
          Przyjęcie wysyłki przez serwer nie potwierdza dostarczenia ani
          otwarcia wiadomości. Opiekun powinien korzystać z najnowszego linku.
          Aktywowane konto odzyskuje dostęp przez „Nie pamiętam hasła”.
        </p>
        <ol className={styles.list}>
          {attempts.map((attempt) => (
            <li className={`card pad ${styles.attempt}`} key={attempt.id}>
              <div className={styles.header}>
                <h4>{deliveryLabels[attempt.outcome]}</h4>
                <time dateTime={attempt.started_at}>
                  {dateLabel(attempt.started_at)}
                </time>
              </div>
              <p className="muted">Wysyłkę rozpoczął: {attempt.author_name}</p>
              {attempt.error_code && (
                <p className="alert">
                  {deliveryErrorLabels[attempt.error_code]}
                </p>
              )}
              {attempt.outcome === "sent" && (
                <p>Serwer przyjął zaproszenie do wysłania.</p>
              )}
              {attempt.outcome === "sending" && (
                <p>Oczekujemy na potwierdzenie. Odśwież widok za chwilę.</p>
              )}
              {attempt.finished_at && (
                <p className="muted">
                  Wynik zapisano:{" "}
                  <time dateTime={attempt.finished_at}>
                    {dateLabel(attempt.finished_at)}
                  </time>
                </p>
              )}
            </li>
          ))}
        </ol>
        {!attempts.length && (
          <article className="card pad">
            <h4>
              {page === 1
                ? "Nie rozpoczęto wysyłki"
                : "Brak prób na tej stronie"}
            </h4>
            <p className="muted">
              {page === 1
                ? "Samo przygotowanie zaproszenia nie wysyła wiadomości."
                : "Wróć do nowszych prób, aby zobaczyć historię."}
            </p>
          </article>
        )}
        <nav className={styles.header} aria-label="Strony historii zaproszenia">
          {page > 1 && (
            <Link className="ghost-button" href={`?page=${page - 1}`}>
              ← Nowsze próby
            </Link>
          )}
          {more && (
            <Link className="ghost-button" href={`?page=${page + 1}`}>
              Starsze próby →
            </Link>
          )}
        </nav>
      </section>
    </div>
  );
}
