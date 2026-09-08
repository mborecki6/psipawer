import { ActionForm, Field } from "@/components/action-form";
import { reopenRegistration } from "@/lib/data/registration-actions";

export function ReopenRegistration({
  id,
  admin,
}: {
  id: string;
  admin: boolean;
}) {
  if (!admin)
    return (
      <p className="alert">
        Chcesz wrócić na ten spacer? Skontaktuj się z prowadzącą, która może
        przywrócić Twoje zgłoszenie do decyzji.
      </p>
    );
  return (
    <details className="card pad">
      <summary>Przywróć zgłoszenie do decyzji</summary>
      <p className="muted">
        Użyj po uzgodnieniu powrotu z opiekunem. Przywrócenie wymaga ponownej
        akceptacji; historia wpłat i poprzedniej rezygnacji zostaje zachowana.
        Poprzedni pakiet przypiszesz ponownie, jeśli nadal jest dostępny.
      </p>
      <ActionForm action={reopenRegistration} label="Przywróć do decyzji">
        <input type="hidden" name="registration_id" value={id} />
        <Field
          name="note"
          label="Powód przywrócenia"
          required
          maxLength={2000}
          hint="Wiadomość będzie widoczna dla opiekuna."
        />
      </ActionForm>
    </details>
  );
}
