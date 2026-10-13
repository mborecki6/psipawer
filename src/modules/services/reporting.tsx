import Link from "next/link";
import { ActionForm } from "@/components/action-form";
import { getService } from "./queries";
import { saveServiceReporting } from "./reporting-actions";
import { serviceReporting } from "./types";
export async function ServiceReportingPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { service: s } = await getService(id, 1);
  return (
    <div className="stack">
      <Link className="ghost-button" href={`/admin/services/${id}`}>
        ← Usługa i cena
      </Link>
      <section className="card pad stack">
        <h2>Raportowanie · {s.name}</h2>
        <p>{serviceReporting(s)}</p>
        <p className="muted">
          Zmiana dotyczy przyszłych zgłoszeń. Istniejące konsultacje, kursy i
          pakiety zachowują zapisane zasady. Wyjątki dla konkretnego psa
          ustawisz przy jego opublikowanych zaleceniach.
        </p>
        <ActionForm
          key={s.id}
          action={saveServiceReporting}
          label="Zapisz zasady dla nowych zgłoszeń"
        >
          <input type="hidden" name="id" value={s.id} />
          <input type="hidden" name="expected_version" value={s.version} />
          <label className="field">
            Raportowanie w usłudze
            <select
              name="included"
              defaultValue={String(s.reporting_included !== false)}
            >
              <option value="true">Włączone</option>
              <option value="false">Wyłączone</option>
            </select>
          </label>
          <label className="field">
            Okres w dniach (puste = bez limitu)
            <input
              type="number"
              name="days"
              min={1}
              max={36500}
              step={1}
              defaultValue={s.reporting_days ?? ""}
            />
          </label>
          <p className="muted">
            Okres zaczyna się przy pierwszej publikacji zaleceń dla przypisania.
            Spotkania w tym samym kursie lub pakiecie mają wspólny okres.
          </p>
          <label className="field">
            Uzasadnienie zmiany
            <textarea
              name="note"
              required
              minLength={3}
              maxLength={2000}
              rows={3}
            />
          </label>
        </ActionForm>
      </section>
    </div>
  );
}
