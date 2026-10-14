import Link from "next/link";
import { randomUUID } from "node:crypto";
import { getCalendarSetup } from "@/modules/calendar/queries";
import { CalendarSettingsEditor } from "@/modules/calendar/settings-editor";
import { CalendarResourcesEditor } from "@/modules/calendar/resource-editor";
import styles from "@/components/admin-workspace.module.css";
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ staff?: string }>;
}) {
  const { staff } = await searchParams;
  const { settings, members, activeMembers, resources, staffId } =
    await getCalendarSetup(staff);
  const person = members.find((member) => member.user_id === staffId);
  return (
    <div className={`stack ${styles.calendarEditor}`}>
      <Link className="ghost-button" href="/admin/settings">
        ← Ustawienia
      </Link>
      <p className={styles.intro}>
        Ustal domyślny rytm pracy lub godziny prowadzącej. Pojedynczy urlop lub
        dojazd zarezerwujesz bezpośrednio w kalendarzu.
      </p>
      <form className="form-stack">
        <div className="field">
          <label htmlFor="calendar-settings-staff">
            Czyj rytm pracy ustawiasz?
          </label>
          <select
            id="calendar-settings-staff"
            name="staff"
            defaultValue={staffId || ""}
          >
            <option value="">Domyślny rytm pracy</option>
            {activeMembers.map((member) => (
              <option key={member.user_id} value={member.user_id}>
                {member.full_name}
              </option>
            ))}
          </select>
        </div>
        <button className="small-button">Pokaż ustawienia</button>
      </form>
      {!activeMembers.length && (
        <p className="alert" role="status">
          Brak aktywnej prowadzącej w konfiguracji kalendarza. Domyślne godziny
          i dotychczasowe przypisania pozostają dostępne.
        </p>
      )}
      <article className="card pad" id="calendar-settings">
        <h2>{person ? person.full_name : "Domyślny rytm pracy"}</h2>
        <CalendarSettingsEditor
          key={staffId || "default"}
          initial={settings}
          staffId={staffId}
        />
      </article>
      <details className="card pad">
        <summary>Miejsca i wspólne sale</summary>
        <p className="muted">
          Dodaj tylko miejsca, których dostępność chcesz planować. Sala może
          przyjmować jedne zajęcia naraz; dla otwartej przestrzeni możesz
          dopuścić równoległe zajęcia.
        </p>
        <CalendarResourcesEditor
          resources={resources}
          newResourceId={randomUUID()}
        />
      </details>
    </div>
  );
}
