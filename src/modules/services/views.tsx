import Link from "next/link";
import { Tags, Clock3, ArrowRight } from "lucide-react";
import { money } from "@/lib/domain";
import { ServiceEditor } from "./editor";
import {
  serviceKinds,
  serviceTime,
  type Service,
  type ServiceRevision,
} from "./types";
import styles from "./services.module.css";
export function ServicesView({
  services,
  admin,
}: {
  services: Service[];
  admin: boolean;
}) {
  return (
    <div className="stack">
      {admin && (
        <Link className="ghost-button" href="/admin/settings">
          ← Ustawienia
        </Link>
      )}
      <header className={styles.header}>
        <span className={styles.eyebrow}>
          <Tags size={17} /> Oferta Psi Pawer
        </span>
        <h2>
          {admin ? "Twoje usługi. Twoje zasady." : "Znajdź wsparcie dla Was."}
        </h2>
        <p className="muted">
          {admin
            ? "Zmieniaj ceny i szczegóły w jednym miejscu. Wcześniejsze zgłoszenia zachowają ustalone kwoty."
            : "Wybierz formę pracy dopasowaną do potrzeb Twojego psa."}
        </p>
      </header>
      {services.some((s) => s.is_test_price) && (
        <div className="alert">
          Ceny oznaczone jako robocze służą do testów aplikacji. Nie są
          aktualnym cennikiem ze strony Psi Pawer.
        </div>
      )}
      <div className={styles.grid}>
        {services.map((s) => (
          <article className={`card pad ${styles.service}`} key={s.id}>
            <div className={styles.badges}>
              <span className="badge">{serviceKinds[s.kind]}</span>
              {!s.active && <span className="badge">Ukryta</span>}
              {s.is_test_price && (
                <span className={styles.testBadge}>Cena robocza</span>
              )}
            </div>
            <h3>{s.name}</h3>
            <p className="muted">{s.description}</p>
            <div className={styles.duration}>
              <Clock3 size={15} />
              {serviceTime(s)}
              {s.meeting_mode === "online" ? " · Online" : ""}
            </div>
            <div className={styles.price}>
              <strong>{money(s.price_cents)}</strong>
              <span>{s.price_unit}</span>
            </div>
            {admin ? (
              <Link className="ghost-button" href={`/admin/services/${s.id}`}>
                Edytuj usługę i cenę <ArrowRight size={16} />
              </Link>
            ) : s.kind === "voucher" ? (
              <Link className="primary-button" href="/app/gifts">
                Aktywuj kartę lub sprawdź saldo →
              </Link>
            ) : s.kind === "course" ? (
              <Link
                className="primary-button"
                href={`/app/courses?service=${s.id}`}
              >
                Zobacz cykle kursu →
              </Link>
            ) : s.booking_flow === "consultation" ? (
              <Link
                className="primary-button"
                href={`/app/consultations/new?service=${s.id}`}
              >
                Wybierz spotkanie →
              </Link>
            ) : s.booking_flow === "fitness" ? (
              <Link
                className="primary-button"
                href={`/app/fitness/new?service=${s.id}`}
              >
                Zgłoś psa na fitness →
              </Link>
            ) : s.booking_flow === "walk" ? (
              <Link className="ghost-button" href="/app/walks">
                Zobacz terminy spacerów →
              </Link>
            ) : (
              <p className={styles.catalogueHint}>
                Zapisy na tę ofertę ustal z prowadzącą.
              </p>
            )}
          </article>
        ))}
      </div>
      {!services.length && (
        <article className="card pad">
          <h3>Oferta jest w przygotowaniu</h3>
          <p>Wróć tutaj później lub skontaktuj się z prowadzącą.</p>
        </article>
      )}
    </div>
  );
}
export function ServiceDetailView({
  service: s,
  history,
  page,
  more,
}: {
  service: Service;
  history: ServiceRevision[];
  page: number;
  more: boolean;
}) {
  return (
    <div className="stack">
      <Link className="ghost-button" href="/admin/services">
        ← Usługi i cennik
      </Link>
      <header className={styles.header}>
        <span className={styles.eyebrow}>{serviceKinds[s.kind]}</span>
        <h2>{s.name}</h2>
      </header>
      <div className={styles.detail}>
        <article className="card pad">
          <h3>Edytuj ofertę</h3>
          <p className="muted">
            Zaktualizuj warunki w katalogu. Aby zakończyć testowanie ceny,
            wybierz „Docelowa”.
          </p>
          <ServiceEditor service={s} />
        </article>
        <aside className="stack">
          <article className={`card pad ${styles.explainer}`}>
            <h3>Co stanie się po zmianie ceny?</h3>
            <p>
              {s.booking_flow === "fitness"
                ? "Nowe zgłoszenia zachowają nową cenę, liczbę spotkań i czas każdego spotkania. Wcześniejsze pakiety zachowają wszystkie warunki z chwili zgłoszenia. Cena dotyczy całego pakietu."
                : s.booking_flow === "consultation"
                  ? "Nowe zgłoszenia przyjmą nową kwotę. Zgłoszenia już zapisane zachowają wcześniejszą cenę i nazwę usługi."
                  : s.booking_flow === "walk"
                    ? "Nowa cena uzupełni formularz podczas tworzenia nowego terminu. Istniejące terminy spacerów zachowają swoje ceny, również dla kolejnych zapisujących się osób."
                    : s.kind === "course"
                      ? "Nowa cena zostanie zapisana przy tworzeniu kolejnego cyklu. Istniejące cykle i wszystkie ich zgłoszenia zachowają cenę za całość."
                      : "Nowa kwota pojawi się w ofercie. Warunki już uzgodnionych pakietów i kart pozostają do obsługi przez prowadzącą."}
            </p>
            <p>
              {s.booking_flow === "fitness"
                ? "Ukrycie zatrzymuje nowe zgłoszenia. Wcześniejsze pakiety, terminy i rozliczenia pozostają dostępne."
                : s.booking_flow === "consultation"
                  ? "Ukrycie oferty zatrzymuje nowe zgłoszenia, ale pozostawia wcześniejsze spotkania i ich historię."
                  : s.booking_flow === "walk"
                    ? "Ukrycie usuwa tę usługę z katalogu i wyboru przy tworzeniu terminu. Zapisy na istniejące spacery pozostają dostępne."
                    : "Ukrycie usuwa pozycję z oferty dla opiekunów."}
            </p>
            <a
              className="ghost-button"
              href={s.source_url}
              target="_blank"
              rel="noreferrer"
            >
              Usługa na psipawer.pl ↗
            </a>
            {s.source_note && <p className="muted">{s.source_note}</p>}
            {s.kind === "course" && (
              <Link
                className="primary-button"
                href={`/admin/courses/new?service=${s.id}`}
              >
                Przygotuj cykl kursu →
              </Link>
            )}
            {s.booking_flow === "fitness" && (
              <Link className="primary-button" href="/admin/fitness">
                Obsługa pakietów fitness →
              </Link>
            )}
          </article>
          <article className="card pad">
            <h3>Historia cennika</h3>
            <ol className={styles.history}>
              {history.map((h) => (
                <li key={h.version}>
                  <div>
                    <strong>{money(h.price_cents)}</strong>
                    <span>{h.price_unit}</span>
                  </div>
                  <small>
                    {new Intl.DateTimeFormat("pl-PL", {
                      dateStyle: "medium",
                      timeStyle: "short",
                      timeZone: "Europe/Warsaw",
                    }).format(new Date(h.created_at))}{" "}
                    · {h.changed_by ? "Zapis prowadzącej" : "Import oferty"}
                  </small>
                  <small>
                    {h.active ? "Aktywna" : "Ukryta"} ·{" "}
                    {h.is_test_price ? "Cena robocza" : "Cena docelowa"}
                  </small>
                </li>
              ))}
            </ol>
            <nav className={styles.badges} aria-label="Historia cennika">
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
        </aside>
      </div>
    </div>
  );
}
