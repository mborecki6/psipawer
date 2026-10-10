import Link from "next/link";
import { CalendarDays } from "lucide-react";
import { dateLabel } from "@/lib/domain";
import type { Appointment } from "./types";
import { calendarAppointmentHref } from "./dates";
export function NextAppointment({
  appointment,
  admin,
}: {
  appointment: Appointment | null;
  admin: boolean;
}) {
  const base = admin ? "/admin" : "/app";
  return (
    <article className="card hero-card">
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
        {admin && appointment?.assigned_staff_name && (
          <p>
            Prowadzący: {appointment.assigned_staff_name}
            {appointment.resource_name ? ` · ${appointment.resource_name}` : ""}
          </p>
        )}
        <div className="hero-actions">
          {appointment && (
            <Link
              className="primary-button"
              href={`${base}/${appointment.kind === "walk" ? "walks" : appointment.kind === "course" ? "courses" : appointment.kind === "fitness" ? "fitness" : "consultations"}/${appointment.id}`}
            >
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
