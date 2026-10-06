import Link from "next/link";
import type { FitnessCarePage } from "@/modules/care/types";
import type { FitnessPackage, FitnessSession } from "./types";
import { dateLabel } from "@/lib/domain";
import styles from "./fitness.module.css";

export function FitnessCarePanel({
  care,
  pack,
  sessions,
  admin,
  page,
  href,
}: {
  care: FitnessCarePage;
  pack: FitnessPackage;
  sessions: FitnessSession[];
  admin: boolean;
  page: number;
  href: (page: number) => string;
}) {
  const base = admin ? "/admin" : "/app";
  const editor = `/admin/dogs/${pack.dog_id}/care?fitness=${pack.id}`;
  return (
    <section
      className="card pad stack"
      id="zalecenia"
      aria-label="Zalecenia fitness"
    >
      <h3>Zalecenia i praca między spotkaniami</h3>
      {care.plans.length ? (
        <ul className={styles.history}>
          {care.plans.map((p) => (
            <li key={p.id}>
              <Link href={`${base}/care/plans/${p.id}`}>
                <strong>{p.title}</strong>
              </Link>
              <small>
                Wersja {p.revision} · {dateLabel(p.published_at)} ·{" "}
                {p.fitness_session_id
                  ? `po spotkaniu ${sessions.find((s) => s.id === p.fitness_session_id)?.ordinal || "fitness"}`
                  : "plan całego pakietu"}
              </small>
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted">
          {page > 1
            ? "Nie ma kolejnych publikacji."
            : "Zalecenia udostępnione przez prowadzącą pojawią się tutaj."}
        </p>
      )}
      {(page > 1 || care.more) && (
        <nav className={styles.toolbar} aria-label="Strony zaleceń fitness">
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
      {admin && (care.canPrepare || care.hasDraft) && (
        <div className="stack">
          {care.hasDraft && (
            <p className="muted">
              Jest zapisany szkic dla tego pakietu. Opiekun go nie widzi.
            </p>
          )}
          <Link className="secondary-button" href={`${editor}#szkic`}>
            {care.hasDraft
              ? "Otwórz szkic zaleceń fitness"
              : "Przygotuj plan całego pakietu"}
          </Link>
          {care.canPrepare &&
            sessions.some((s) =>
              ["scheduled", "completed"].includes(s.status),
            ) && (
              <details>
                <summary>Przygotuj zalecenia po spotkaniu fitness</summary>
                <div className="stack">
                  {sessions
                    .filter((s) =>
                      ["scheduled", "completed"].includes(s.status),
                    )
                    .map((s) => (
                      <Link
                        key={s.id}
                        className="ghost-button"
                        href={`${editor}&fitness_session=${s.id}#szkic`}
                      >
                        Spotkanie {s.ordinal}
                        {s.starts_at ? ` · ${dateLabel(s.starts_at)}` : ""}
                      </Link>
                    ))}
                  <p className="muted">
                    Szkic możesz przygotować przed spotkaniem. Publikacja wymaga
                    jego zakończenia.
                  </p>
                </div>
              </details>
            )}
        </div>
      )}
      {pack.dogs && (
        <Link
          className="ghost-button"
          href={`${base}/dogs/${pack.dog_id}/care`}
        >
          Plan pracy i postępy psa →
        </Link>
      )}
    </section>
  );
}
