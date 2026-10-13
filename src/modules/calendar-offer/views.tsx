import Link from "next/link";
import { CalendarDays, Clock3 } from "lucide-react";
import {
  clockTime,
  dayLabel,
  localDate,
  monthRange,
} from "@/modules/calendar/dates";
import { serviceTime, type Service } from "@/modules/services/types";
import {
  arrangeServiceHref,
  listOffer,
  offerBookingNote,
  offerHref,
  offerStatus,
} from "./model";
import { offerCategories, type OfferCategory, type OfferItem } from "./types";
import styles from "./offer.module.css";

export function CalendarOfferView({
  items,
  services,
  range,
  focus,
  now,
  category,
  day,
}: {
  items: OfferItem[];
  services: Service[];
  range: ReturnType<typeof monthRange>;
  focus: string;
  now: string;
  category: OfferCategory;
  day?: string;
}) {
  const visible = items.filter(
    (item) => category === "all" || item.category === category,
  );
  const list = listOffer(visible, focus, now, day);
  const today = localDate(now);
  const monthTitle = new Intl.DateTimeFormat("pl-PL", {
    timeZone: "Europe/Warsaw",
    month: "long",
    year: "numeric",
  }).format(new Date(`${focus}T12:00:00Z`));
  const href = (date: string, filter = category, selectedDay?: string) =>
    `/app/calendar/offer?date=${date}&category=${filter}${selectedDay ? `&day=${selectedDay}#offer-list` : ""}`;
  return (
    <div className="stack">
      <header className={styles.header}>
        <span className={styles.eyebrow}>
          <CalendarDays size={17} /> Oferta w kalendarzu
        </span>
        <h2>Znajdź czas na wspólne zajęcia.</h2>
        <p className="muted">
          Zobacz opublikowane terminy spacerów i kursów. W szczegółach
          wybierzesz psa i sprawdzisz zasady zapisu.
        </p>
        <div className={styles.controls}>
          <Link className="ghost-button" href="/app/calendar">
            Moje potwierdzone terminy →
          </Link>
          <Link className="ghost-button" href="/app/services">
            Oferta i ceny →
          </Link>
        </div>
      </header>
      <nav aria-label="Forma zajęć" className={styles.controls}>
        {(Object.keys(offerCategories) as OfferCategory[]).map((filter) => (
          <Link
            key={filter}
            href={href(focus, filter, day)}
            className={category === filter ? "small-button" : "ghost-button"}
            aria-current={category === filter ? "page" : undefined}
          >
            {offerCategories[filter]}
          </Link>
        ))}
      </nav>
      <div className={styles.layout}>
        <section
          className={`card pad ${styles.month}`}
          aria-label={`Oferta: ${monthTitle}`}
        >
          <h3>{monthTitle}</h3>
          <nav aria-label="Miesiące oferty" className={styles.controls}>
            <Link
              className="ghost-button"
              href={href(range.previous)}
              aria-label="Poprzedni miesiąc"
            >
              ← Wstecz
            </Link>
            <Link className="ghost-button" href={href(today)}>
              Dzisiaj
            </Link>
            <Link
              className="ghost-button"
              href={href(range.next)}
              aria-label="Następny miesiąc"
            >
              Dalej →
            </Link>
          </nav>
          <p className="muted">
            Wybierz dzień, aby sprawdzić godziny i dostępność.
          </p>
          <div className={styles.monthGrid}>
            {["Pon", "Wt", "Śr", "Czw", "Pt", "Sob", "Ndz"].map((label) => (
              <span className={styles.weekday} key={label}>
                {label}
              </span>
            ))}
            {range.days.map((date) => {
              const count = visible.filter(
                (item) => localDate(item.starts_at) === date,
              ).length;
              return (
                <Link
                  key={date}
                  href={href(date, category, date)}
                  className={`${styles.day} ${date.slice(0, 7) !== focus.slice(0, 7) ? styles.outside : ""} ${date === day ? styles.selected : ""} ${date === today ? styles.today : ""}`}
                  aria-label={`${dayLabel(date)}: ${count ? `${count} zajęć w ofercie` : "brak zajęć"}`}
                  aria-current={date === today ? "date" : undefined}
                >
                  <strong>{Number(date.slice(-2))}</strong>
                  {count > 0 && (
                    <span className={styles.count}>
                      {count}
                      <span className={styles.countLabel}> zaj.</span>
                    </span>
                  )}
                </Link>
              );
            })}
          </div>
        </section>
        <section
          className={styles.list}
          id="offer-list"
          aria-labelledby="offer-list-title"
          tabIndex={-1}
        >
          <div className={styles.listHeader}>
            <h3 id="offer-list-title">
              {day ? dayLabel(day) : `Nadchodzące · ${monthTitle}`}
            </h3>
            {day && (
              <Link className="ghost-button" href={href(focus)}>
                Cały miesiąc →
              </Link>
            )}
          </div>
          {list.map((item) => (
            <article
              key={`${item.kind}-${item.id}`}
              className={`card pad ${styles.item}`}
            >
              <div className={styles.badges}>
                <span className="badge">
                  {item.kind === "walk" ? "Spacer" : "Kurs"} ·{" "}
                  {offerCategories[item.category]}
                </span>
                <span
                  className={`badge ${item.availability === "available" ? styles.available : styles.unavailable}`}
                >
                  {offerStatus(item)}
                </span>
              </div>
              <h4>{item.title}</h4>
              <p className={styles.time}>
                <Clock3 size={15} aria-hidden="true" />
                <span>
                  {dayLabel(localDate(item.starts_at))} ·{" "}
                  {clockTime(item.starts_at)}–{clockTime(item.ends_at)}
                </span>
              </p>
              {item.kind === "course" && (
                <p className="muted">
                  Spotkanie {item.session_ordinal} z {item.sessions_count} ·
                  zapis na cały kurs
                </p>
              )}
              <p>{item.public_location}</p>
              <p className="muted">{offerBookingNote(item)}</p>
              <Link
                className={
                  item.availability === "available" &&
                  item.eligibility === "eligible"
                    ? "primary-button"
                    : "ghost-button"
                }
                href={offerHref(item)}
              >
                {item.availability === "available" &&
                item.eligibility === "eligible"
                  ? "Szczegóły i zapisy →"
                  : "Sprawdź szczegóły →"}
              </Link>
            </article>
          ))}
          {!list.length && (
            <article className="card pad">
              <h4>
                {day
                  ? "Tego dnia nie ma zajęć w tej kategorii"
                  : "Brak nadchodzących zajęć w tym miesiącu"}
              </h4>
              <p className="muted">
                Sprawdź inny dzień, kolejny miesiąc lub inną formę pracy.
              </p>
              <Link className="ghost-button" href={href(range.next)}>
                Następny miesiąc →
              </Link>
            </article>
          )}
          <p className={`muted ${styles.note}`}>
            Dostępność może się zmienić. Samo otwarcie terminu nie rezerwuje
            miejsca.
          </p>
        </section>
      </div>
      {category !== "group" && services.length > 0 && (
        <section className="stack" aria-labelledby="arrange-title">
          <header>
            <h3 id="arrange-title">Indywidualnie — ustalmy termin</h3>
            <p className="muted">
              Wybierz usługę i zgłoś potrzebę spotkania. Termin ustalicie z
              prowadzącą.
            </p>
          </header>
          <div className={styles.services}>
            {services.map((service) => (
              <article key={service.id} className="card pad">
                <h4>{service.name}</h4>
                <p className="muted">
                  {serviceTime(service)}
                  {service.meeting_mode === "online" ? " · Online" : ""}
                </p>
                <Link
                  className="ghost-button"
                  href={arrangeServiceHref(service)}
                >
                  Uzgodnij termin →
                </Link>
              </article>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
