import Link from "next/link";
import { getCalendar } from "@/modules/calendar/queries";
import { CalendarSettingsEditor } from "@/modules/calendar/settings-editor";
import styles from "@/components/admin-workspace.module.css";
export default async function Page() {
  const { settings } = await getCalendar(true);
  if (!settings) throw new Error("Nie udało się pobrać ustawień kalendarza.");
  return (
    <div className={`stack ${styles.calendarEditor}`}>
      <Link className="ghost-button" href="/admin/settings">
        ← Ustawienia
      </Link>
      <p className={styles.intro}>
        Ustal stałe godziny pracy i przerwy. Pojedynczy urlop lub dojazd
        zarezerwujesz bezpośrednio w kalendarzu.
      </p>
      <article className="card pad" id="calendar-settings">
        <CalendarSettingsEditor initial={settings} />
      </article>
    </div>
  );
}
