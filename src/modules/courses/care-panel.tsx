import Link from "next/link";
import type { CourseCarePage } from "@/modules/care/types";
import type { EnrollmentDetail, SessionDetail } from "./types";
import { dateLabel } from "@/lib/domain";
import styles from "./courses.module.css";

export function CourseCarePanel({
  care,
  enrollment,
  sessions,
  admin,
  available,
  page,
  href,
}: {
  care: CourseCarePage;
  enrollment: EnrollmentDetail;
  sessions: SessionDetail[];
  admin: boolean;
  available: boolean;
  page: number;
  href: (n: number) => string;
}) {
  const base = admin ? "/admin" : "/app";
  const editor = `/admin/dogs/${enrollment.dog_id}/care?enrollment=${enrollment.id}`;
  return (
    <section
      className={styles.billing}
      id={`zalecenia-${enrollment.id}`}
      aria-label={`Zalecenia: ${enrollment.dogs?.name || "Pies zgłoszenia"}`}
    >
      <h5>Zalecenia dla uczestnika</h5>
      {care.plans.length ? (
        <ul className={styles.carePlans}>
          {care.plans.map((p) => (
            <li key={p.id}>
              <Link href={`${base}/care/plans/${p.id}`}>
                <strong>{p.title}</strong>
              </Link>
              <small>
                Wersja {p.revision} · {dateLabel(p.published_at)} ·{" "}
                {p.course_session_id
                  ? `po spotkaniu ${sessions.find((s) => s.id === p.course_session_id)?.ordinal || "kursu"}`
                  : "plan całego kursu"}
              </small>
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted">
          {page > 1
            ? "Nie ma kolejnych publikacji."
            : "Opublikowane zalecenia dla tego psa pojawią się tutaj."}
        </p>
      )}
      {(page > 1 || care.more) && (
        <nav className={styles.paging} aria-label="Strony zaleceń kursowych">
          {page > 1 && (
            <Link className="ghost-button" href={href(page - 1)}>
              Nowsze zalecenia
            </Link>
          )}
          {care.more && (
            <Link className="ghost-button" href={href(page + 1)}>
              Wcześniejsze zalecenia
            </Link>
          )}
        </nav>
      )}
      {admin && (available || care.hasDraft) && (
        <div className="stack">
          {care.hasDraft && (
            <p className="muted">
              Jest zapisany szkic dla tego kursu. Opiekun go nie widzi.
            </p>
          )}
          <Link className="secondary-button" href={`${editor}#szkic`}>
            {care.hasDraft
              ? "Otwórz szkic zaleceń"
              : "Przygotuj plan całego kursu"}
          </Link>
          {available && (
            <details>
              <summary>Przygotuj zalecenia po spotkaniu</summary>
              <div className="stack">
                {sessions
                  .filter((s) => s.status !== "cancelled")
                  .map((s) => (
                    <Link
                      key={s.id}
                      className="ghost-button"
                      href={`${editor}&session=${s.id}#szkic`}
                    >
                      Spotkanie {s.ordinal} · {dateLabel(s.starts_at)}
                    </Link>
                  ))}
                <p className="muted">
                  Szkic możesz przygotować wcześniej. Publikacja po spotkaniu
                  wymaga jego zakończenia.
                </p>
              </div>
            </details>
          )}
        </div>
      )}
      {enrollment.dogs && (
        <Link
          className="ghost-button"
          href={`${base}/dogs/${enrollment.dog_id}/care`}
        >
          Plan pracy i postępy psa →
        </Link>
      )}
    </section>
  );
}
