import Link from "next/link";
import { ActionForm } from "@/components/action-form";
import { dateLabel } from "@/lib/domain";
import { changeControlInvitation, changeReporting } from "./actions";
import type { ControlInvitation, ReportingAccess } from "./types";
import { careDate } from "./types";

export function ControlInvitationCard({
  invitation: i,
  admin,
}: {
  invitation: ControlInvitation;
  admin: boolean;
}) {
  return (
    <section className="card pad stack" aria-label="Zaproszenie do kontroli">
      <h3>Zaproszenie do zgłoszenia kontroli</h3>
      <p>
        {i.status === "open"
          ? `Przypomnienie dla opiekuna: ${careDate(i.due_on)} o 9:00.`
          : i.status === "requested"
            ? "Opiekun przekazał zgłoszenie konsultacji kontrolnej."
            : "To zaproszenie jest wycofane."}
      </p>
      <p className="muted">
        Zgłoszenie służy uzgodnieniu terminu. Nie rezerwuje spotkania i nie
        zamyka zadania kontaktu dla prowadzącej.
      </p>
      {i.consultation_id && (
        <Link
          className="ghost-button"
          href={`/${admin ? "admin" : "app"}/consultations/${i.consultation_id}`}
        >
          Otwórz zgłoszenie kontroli →
        </Link>
      )}
      {i.status === "open" && !admin && (
        <Link
          className="primary-button"
          href={`/app/consultations/new?control=${i.id}`}
        >
          Zgłoś konsultację kontrolną →
        </Link>
      )}
      {i.status === "open" && admin && (
        <details>
          <summary>Zmień lub wycofaj zaproszenie</summary>
          <ActionForm
            key={i.id}
            action={changeControlInvitation}
            label="Zapisz zmianę zaproszenia"
          >
            <input type="hidden" name="id" value={i.id} />
            <input type="hidden" name="expected_version" value={i.version} />
            <label className="field">
              Działanie
              <select name="intent">
                <option value="reschedule">Zmień datę</option>
                <option value="cancel">Wycofaj zaproszenie</option>
              </select>
            </label>
            <label className="field">
              Data zaproszenia
              <input name="due_on" type="date" defaultValue={i.due_on} />
            </label>
            <label className="field">
              Powód zmiany
              <textarea
                name="note"
                required
                minLength={3}
                maxLength={2000}
                rows={3}
              />
            </label>
          </ActionForm>
        </details>
      )}
    </section>
  );
}

export function ReportingPanel({
  access: a,
  admin,
}: {
  access: ReportingAccess;
  admin: boolean;
}) {
  const endDate = a.expires_at
    ? new Intl.DateTimeFormat("en-CA", {
        timeZone: "Europe/Warsaw",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(new Date(new Date(a.expires_at).valueOf() - 1))
    : "";
  return (
    <section className="card pad stack" aria-label="Dostęp do raportowania">
      <h3>Raportowanie postępów</h3>
      <p>
        {!a.included
          ? "Raportowanie dla tej usługi jest wyłączone."
          : a.allowed
            ? "Możesz przekazywać odpowiedzi do zaleceń tej usługi."
            : "Okres raportowania dla tej usługi zakończył się."}
      </p>
      <p className="muted">
        {a.starts_at
          ? `Początek: ${dateLabel(a.starts_at)}.`
          : "Początek przy pierwszej publikacji zaleceń."}{" "}
        {a.expires_at
          ? `Dostęp do: ${dateLabel(a.expires_at)} (czas polski).`
          : "Bez daty końca."}
      </p>
      <p className="muted">
        Ten sam dostęp obejmuje plan całego kursu lub pakietu i jego spotkania.
        Zalecenia i wcześniejsze odpowiedzi pozostają dostępne.
      </p>
      {admin && a.id && (
        <details>
          <summary>Zmień dostęp dla tej usługi psa</summary>
          <ActionForm
            key={a.id}
            action={changeReporting}
            label="Zapisz uprawnienie"
          >
            <input type="hidden" name="id" value={a.id} />
            <input type="hidden" name="expected_version" value={a.version} />
            <label className="field">
              Raportowanie
              <select name="included" defaultValue={String(a.included)}>
                <option value="true">Włączone</option>
                <option value="false">Wyłączone</option>
              </select>
            </label>
            <label className="field">
              Ostatni dzień dostępu (puste = bez limitu)
              <input type="date" name="expires_on" defaultValue={endDate} />
            </label>
            <label className="field">
              Uzasadnienie wyjątku
              <textarea
                name="note"
                required
                minLength={3}
                maxLength={2000}
                rows={3}
              />
            </label>
            <p className="muted">
              Ta zmiana dotyczy tylko tego przypisania psa. Ustawienia oferty i
              pozostałe zakupy pozostają niezależne.
            </p>
          </ActionForm>
        </details>
      )}
    </section>
  );
}
