import Link from "next/link";
import { CalendarDays } from "lucide-react";
import { dateLabel } from "@/lib/domain";
import type { Appointment } from "./types";
import { calendarAppointmentHref, clockTime, localDate } from "./dates";
import styles from "./next-appointment.module.css";
import { appointmentDetailHref } from "./meeting-links";

const fullDate = new Intl.DateTimeFormat("pl-PL", {
  timeZone: "Europe/Warsaw",
  weekday: "long",
  day: "numeric",
  month: "long",
  year: "numeric",
});

export function NextAppointment({
  appointment,
  admin,
}: {
  appointment: Appointment | null;
  admin: boolean;
}) {
  const base = admin ? "/admin" : "/app";
  const detailHref = appointment
    ? appointmentDetailHref(base, appointment)
    : null;
  if (admin) {
    return (
      <article className={styles.appointment} aria-label="Najbliższe spotkanie">
        <h2 className={styles.eyebrow}>
          <CalendarDays size={17} aria-hidden="true" /> Najbliższe spotkanie
        </h2>
        {appointment ? (
          <>
            <p className={styles.time}>
              <time dateTime={appointment.starts_at}>
                {clockTime(appointment.starts_at)}
              </time>
              <span>
                {" – "}
                <time dateTime={appointment.ends_at}>
                  {clockTime(appointment.ends_at)}
                </time>
              </span>
            </p>
            <p className={styles.date}>
              {fullDate.format(new Date(appointment.starts_at))}
              {localDate(appointment.starts_at) !==
              localDate(appointment.ends_at)
                ? ` – ${fullDate.format(new Date(appointment.ends_at))}`
                : ""}
            </p>
            <h3 className={styles.title}>{appointment.title}</h3>
            <dl className={styles.details}>
              {appointment.location && (
                <div>
                  <dt>Miejsce</dt>
                  <dd>{appointment.location}</dd>
                </div>
              )}
              {appointment.resource_name && (
                <div>
                  <dt>Sala / zasób</dt>
                  <dd>{appointment.resource_name}</dd>
                </div>
              )}
            </dl>
            {(appointment.assigned_staff_name ||
              appointment.created_by_name) && (
              <details>
                <summary>Szczegóły wpisu</summary>
                <dl className={styles.details}>
                  {appointment.assigned_staff_name && (
                    <div>
                      <dt>Dotychczasowe przypisanie</dt>
                      <dd>{appointment.assigned_staff_name}</dd>
                    </div>
                  )}
                  {appointment.created_by_name && (
                    <div>
                      <dt>Wpis dodał(a)</dt>
                      <dd>{appointment.created_by_name}</dd>
                    </div>
                  )}
                </dl>
              </details>
            )}
          </>
        ) : (
          <p className={styles.empty}>
            Brak potwierdzonych spotkań w najbliższych 31 dniach.
          </p>
        )}
        <div className={styles.actions}>
          {detailHref && (
            <Link className={styles.primaryLink} href={detailHref}>
              Szczegóły spotkania →
            </Link>
          )}
          <Link
            className={appointment ? styles.quietLink : styles.primaryLink}
            href={
              appointment
                ? calendarAppointmentHref(base, appointment)
                : `${base}/calendar`
            }
          >
            Otwórz kalendarz →
          </Link>
          {!appointment && (
            <Link
              className={styles.quietLink}
              href="/admin/consultations?filter=requested"
            >
              Zgłoszenia do ustalenia →
            </Link>
          )}
        </div>
      </article>
    );
  }
  return (
    <article className={`card hero-card ${styles.clientAppointment}`}>
      <div className="hero-content">
        <span className="hero-eyebrow">
          <CalendarDays /> Najbliższe spotkanie
        </span>
        <h2>
          {appointment
            ? dateLabel(appointment.starts_at)
            : "Miejsce na kolejny wspólny krok."}
        </h2>
        <p>
          {appointment
            ? appointment.title
            : "Brak potwierdzonych spotkań w najbliższych 31 dniach."}
        </p>
        {appointment?.location && (
          <p style={{ overflowWrap: "anywhere" }}>{appointment.location}</p>
        )}
        <div className="hero-actions">
          {detailHref && (
            <Link className="primary-button" href={detailHref}>
              Szczegóły spotkania →
            </Link>
          )}
          <Link
            className={appointment ? "ghost-button" : "primary-button"}
            href={
              appointment
                ? calendarAppointmentHref(base, appointment)
                : `${base}/calendar`
            }
          >
            Otwórz kalendarz →
          </Link>
          {!appointment && (
            <Link
              className="ghost-button"
              href={
                admin
                  ? "/admin/consultations?filter=requested"
                  : "/app/services"
              }
            >
              {admin ? "Zgłoszenia do ustalenia →" : "Wybierz usługę →"}
            </Link>
          )}
        </div>
      </div>
    </article>
  );
}
