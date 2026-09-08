import Link from "next/link";
import { dateLabel } from "@/lib/domain";
import type { QualificationWarning } from "@/lib/qualification";
import { Badge } from "./ui";

export function QualificationAlerts({
  warnings,
  role,
}: {
  warnings: QualificationWarning[];
  role: "admin" | "client";
}) {
  if (!warnings.length) return null;
  const base = role === "admin" ? "/admin" : "/app";
  return (
    <section className="alert red" role="status">
      <div style={{ minWidth: 0, overflowWrap: "anywhere" }}>
        <strong>Kwalifikacja wymaga ponownej decyzji przed spacerem</strong>
        <p>
          {role === "admin"
            ? "Poniższe psy mają zaakceptowane zgłoszenia, ale ich aktualny status wymaga sprawdzenia. Otwórz profil i zdecyduj o udziale."
            : "Twój pies nadal ma zaakceptowane zgłoszenie, ale jego profil wymaga ponownej decyzji prowadzącej. Skontaktuj się z behawiorystą, aby potwierdzić udział."}
        </p>
        <div className="stack">
          {warnings.map((warning) => (
            <div key={warning.registrationId}>
              <div className="walk-meta">
                <strong>{warning.dogName}</strong>
                <Badge status={warning.dogStatus} />
              </div>
              <p>
                {dateLabel(warning.startsAt)} · {warning.publicLocation}
              </p>
              <div className="walk-meta">
                {role === "admin" && (
                  <Link
                    className="ghost-button"
                    href={`/admin/dogs/${warning.dogId}`}
                  >
                    Sprawdź profil psa →
                  </Link>
                )}
                <Link
                  className="ghost-button"
                  href={`${base}/walks/${warning.walkId}#registration-${warning.registrationId}`}
                >
                  {role === "admin"
                    ? "Przejdź do decyzji →"
                    : "Zobacz zgłoszenie →"}
                </Link>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
