import Link from "next/link";
import {
  Activity,
  ArrowRight,
  CalendarDays,
  Clock3,
  GraduationCap,
  MessageCircle,
  Tags,
  UserRound,
  Bell,
} from "lucide-react";
import styles from "./admin-workspace.module.css";

export function AdminActivities() {
  const activities = [
    {
      title: "Spacery",
      copy: "Terminy, zapisy i obecności na wspólnych spacerach.",
      href: "/admin/walks",
      icon: CalendarDays,
      action: "Dodaj spacer",
      create: "/admin/walks/new",
    },
    {
      title: "Konsultacje",
      copy: "Zgłoszenia opiekunów i indywidualne spotkania.",
      href: "/admin/consultations",
      icon: MessageCircle,
    },
    {
      title: "Kursy",
      copy: "Cykle zajęć, uczestnicy i kolejne spotkania.",
      href: "/admin/courses",
      icon: GraduationCap,
      action: "Dodaj kurs",
      create: "/admin/courses/new",
    },
    {
      title: "PSI FITNESS",
      copy: "Indywidualne pakiety i terminy ćwiczeń.",
      href: "/admin/fitness",
      icon: Activity,
    },
  ];
  return (
    <div className="stack">
      <p className={styles.intro}>
        Wybierz rodzaj zajęć. Wszystkie potwierdzone terminy znajdziesz we
        wspólnym kalendarzu.
      </p>
      <div className={styles.grid}>
        {activities.map((item) => (
          <article className={`card pad ${styles.tile}`} key={item.href}>
            <div className={styles.mark}>
              <item.icon aria-hidden="true" />
            </div>
            <h2>{item.title}</h2>
            <p className="muted">{item.copy}</p>
            <div className={styles.actions}>
              <Link className="secondary-button" href={item.href}>
                Otwórz <ArrowRight size={16} aria-hidden="true" />
                <span className="sr-only"> {item.title}</span>
              </Link>
              {item.create && (
                <Link className="ghost-button" href={item.create}>
                  {item.action}
                </Link>
              )}
            </div>
          </article>
        ))}
      </div>
      <Link className="ghost-button" href="/admin/work">
        Przejrzyj zgłoszenia do decyzji →
      </Link>
    </div>
  );
}

export function AdminSettings() {
  const settings = [
    {
      title: "Usługi i ceny",
      copy: "Oferta, robocze ceny i dostępność usług.",
      href: "/admin/services",
      icon: Tags,
    },
    {
      title: "Godziny i przerwy",
      copy: "Stały tydzień pracy oraz czas między spotkaniami.",
      href: "/admin/settings/calendar",
      icon: Clock3,
    },
    {
      title: "Dostęp opiekunów",
      copy: "Zaproszenia do kont i historia ich aktywacji.",
      href: "/admin/invitations",
      icon: UserRound,
    },
  ];
  return (
    <div className="stack">
      <p className={styles.intro}>
        Rzeczy, które ustalasz na początku i zmieniasz od czasu do czasu.
      </p>
      <div className={styles.settingsGrid}>
        {settings.map((item) => (
          <Link
            className={`card pad ${styles.setting}`}
            href={item.href}
            key={item.href}
          >
            <div className={styles.mark}>
              <item.icon aria-hidden="true" />
            </div>
            <div>
              <h2>{item.title}</h2>
              <p className="muted">{item.copy}</p>
            </div>
            <ArrowRight className={styles.arrow} size={18} aria-hidden="true" />
          </Link>
        ))}
      </div>
      <details className={`card pad ${styles.disclosure}`}>
        <summary>
          <Bell size={18} aria-hidden="true" /> Kontrola przypomnień
        </summary>
        <p className="muted">
          Zajrzyj tutaj, jeśli przypomnienie nie dotarło lub chcesz sprawdzić
          jego historię.
        </p>
        <Link className="ghost-button" href="/admin/reminders">
          Sprawdź przypomnienia →
        </Link>
      </details>
    </div>
  );
}
