import Link from "next/link";
import { ArrowRight, CheckCheck, ClipboardCheck } from "lucide-react";
import { careDate } from "@/modules/care/types";
import { FollowUpEditor } from "./editor";
import {
  workKinds,
  workHref,
  followUpStates,
  followUpActions,
  type WorkItem,
  type WorkCount,
  type WorkKind,
  type FollowUp,
  type FollowUpHistory,
} from "./types";
import styles from "./work.module.css";
function WorkRow({ item, today }: { item: WorkItem; today: string }) {
  const overdue =
    ["followups", "fitness"].includes(item.kind) &&
    item.due_on !== null &&
    item.due_on < today;
  const title =
    item.kind === "profiles"
      ? item.title === "Nowy profil do oceny"
        ? "Nowy pies do kwalifikacji"
        : "Kwalifikacja do ponownego sprawdzenia"
      : item.title;
  return (
    <Link className={styles.row} href={workHref(item)}>
      <div className={`${styles.mark} ${overdue ? styles.overdue : ""}`}>
        {item.dog_name.slice(0, 1)}
      </div>
      <div className={styles.body}>
        <div className={styles.tags}>
          <span>{workKinds[item.kind]}</span>
          {overdue && <strong>Po terminie</strong>}
          {["followups", "fitness"].includes(item.kind) &&
            item.due_on === today && <strong>Na dziś</strong>}
        </div>
        <h3>
          {item.dog_name} · {title}
        </h3>
        <p>
          {item.due_on
            ? `${item.kind === "walks" ? "Spacer" : item.kind === "fitness" ? "Spotkanie" : "Kontakt"}: ${careDate(item.due_on)}`
            : `Oczekuje od ${careDate(item.created_at)}`}
        </p>
      </div>
      <ArrowRight size={19} aria-hidden="true" />
    </Link>
  );
}
export function WorkPreview({
  items,
  counts,
  today,
}: {
  items: WorkItem[];
  counts: WorkCount[];
  today: string;
}) {
  const total = counts.reduce((s, c) => s + Number(c.total), 0),
    overdue = counts.reduce((s, c) => s + Number(c.overdue), 0);
  return (
    <article className="card">
      <div className="card-head">
        <div>
          <h3>Do zrobienia</h3>
          <p>
            {total} otwartych spraw
            {overdue > 0 ? ` · ${overdue} spraw po terminie` : ""}
          </p>
        </div>
        <Link className="ghost-button" href="/admin/work">
          Wszystkie →
        </Link>
      </div>
      <div className="card-body">
        {items.slice(0, 4).map((item) => (
          <WorkRow key={item.kind + item.id} item={item} today={today} />
        ))}
        {!items.length && (
          <p className="muted">Wszystkie bieżące sprawy są obsłużone.</p>
        )}
      </div>
    </article>
  );
}
export function WorkQueueView({
  items,
  counts,
  filter,
  page,
  more,
  today,
}: {
  items: WorkItem[];
  counts: WorkCount[];
  filter: WorkKind | "all";
  page: number;
  more: boolean;
  today: string;
}) {
  const total = counts.reduce((s, c) => s + Number(c.total), 0);
  const url = (f: string, p = 1) => `/admin/work?filter=${f}&page=${p}`;
  return (
    <div className="stack">
      <header className={styles.header}>
        <span className={styles.eyebrow}>
          <ClipboardCheck size={18} /> Sprawy prowadzącej
        </span>
        <h2>Sprawy do obsłużenia</h2>
        <p className="muted">
          Zgłoszenia, kwalifikacje psów, odpowiedzi i kontakty kontrolne. Obsłuż
          sprawę w jej karcie, a zniknie z tej listy.
        </p>
      </header>
      <nav className={styles.filters} aria-label="Rodzaj sprawy">
        <Link
          href={url("all")}
          className={filter === "all" ? styles.active : ""}
          aria-current={filter === "all" ? "page" : undefined}
        >
          Wszystkie <span>{total}</span>
        </Link>
        {Object.entries(workKinds).map(([kind, label]) => (
          <Link
            key={kind}
            href={url(kind)}
            className={filter === kind ? styles.active : ""}
            aria-current={filter === kind ? "page" : undefined}
          >
            {label}
            <span>{counts.find((c) => c.kind === kind)?.total || 0}</span>
          </Link>
        ))}
      </nav>
      <article className="card pad">
        {filter === "profiles" && (
          <p className="muted">
            Sprawdź informacje o psie i zdecyduj, czy może bezpiecznie brać
            udział w zajęciach grupowych. To kwalifikacja psa do zajęć.
          </p>
        )}
        {filter === "followups" && (
          <p className="muted">
            To zadania dla prowadzącej: skontaktuj się z opiekunem i sprawdź
            postępy. Termin przypomina zespołowi o kontakcie w aplikacji; nie
            wysyła opiekunowi prośby o umówienie kolejnej wizyty.
          </p>
        )}
        {filter === "walks" && (
          <p className="muted">
            Zgłoszenia na przyszłe spacery oczekujące na Twoją decyzję. Po
            przyjęciu lub odmowie znikają z tej kolejki; pozostają w karcie
            spaceru.
          </p>
        )}
        {filter === "progress" && (
          <p className="muted">
            Nowe odpowiedzi opiekunów do opublikowanych zaleceń. Oznacz wpis
            jako przeczytany po jego sprawdzeniu, aby zamknąć sprawę w kolejce.
          </p>
        )}
        <div className={styles.list}>
          {items.map((item) => (
            <WorkRow key={item.kind + item.id} item={item} today={today} />
          ))}
        </div>
        {!items.length && (
          <div className={styles.empty}>
            <CheckCheck size={30} />
            <h3>
              {page > 1
                ? "Na tej stronie nie ma już spraw"
                : "Na teraz wszystko pod kontrolą"}
            </h3>
            <p>
              {page > 1
                ? "Wróć do poprzedniej strony lub zmień filtr."
                : "Nowe sprawy pojawią się tutaj. Samo otwarcie listy nie oznacza ich jako obsłużonych."}
            </p>
          </div>
        )}
      </article>
      <nav className={styles.links} aria-label="Strony spraw">
        {page > 1 && (
          <Link className="ghost-button" href={url(filter, page - 1)}>
            ← Poprzednie
          </Link>
        )}
        <span className="muted">Strona {page}</span>
        {more && (
          <Link className="ghost-button" href={url(filter, page + 1)}>
            Następne →
          </Link>
        )}
      </nav>
      <Link className="ghost-button" href="/admin/work/follow-ups">
        Kontakty kontrolne i ich historia →
      </Link>
    </div>
  );
}
type Detail = FollowUp & {
  dogs: { name: string };
  care_plan_versions: { title: string; revision: number };
};
export function FollowUpView({
  item,
  history,
  more,
  page,
  isCurrent,
  today,
}: {
  item: Detail;
  history: FollowUpHistory[];
  more: boolean;
  page: number;
  isCurrent: boolean;
  today: string;
}) {
  return (
    <div className="stack">
      <Link className="ghost-button" href="/admin/work?filter=followups">
        ← Kontakty do obsłużenia
      </Link>
      <header className={styles.header}>
        <span className={styles.eyebrow}>Kontakt kontrolny</span>
        <h2>{item.dogs.name} · kontakt kontrolny</h2>
        <p>
          <strong>{careDate(item.due_on)}</strong> ·{" "}
          {followUpStates[item.status]}
        </p>
        <p className="muted">
          Plan: {item.care_plan_versions.title} · wersja{" "}
          {item.care_plan_versions.revision}
        </p>
        <p className="muted">
          Zadanie dla prowadzącej na wskazany dzień. Skontaktuj się z opiekunem
          i zapisz ustalenia; termin nie rezerwuje wizyty w kalendarzu.
        </p>
        <div className={styles.links}>
          <Link
            className="ghost-button"
            href={`/admin/dogs/${item.dog_id}/care`}
          >
            Plan i odpowiedzi opiekuna →
          </Link>
          <Link
            className="ghost-button"
            href={`/admin/work/follow-ups?dog=${item.dog_id}`}
          >
            Wszystkie kontakty tego psa →
          </Link>
        </div>
      </header>
      <div className={styles.detail}>
        <article className="card pad">
          <h3>Obsługa kontaktu</h3>
          {isCurrent && item.status !== "superseded" ? (
            <FollowUpEditor item={item} today={today} />
          ) : (
            <p className="muted">
              Ten kontakt należy do wcześniejszego planu. Jego historia
              pozostaje dostępna; dalszą pracę zaplanuj przy aktualnych
              zaleceniach.
            </p>
          )}
        </article>
        <article className="card pad">
          <h3>Historia dla prowadzącej</h3>
          <p className="muted">
            Notatki poniżej nie są udostępniane opiekunowi.
          </p>
          <ol className={styles.history}>
            {history.map((h) => (
              <li key={h.version}>
                <strong>{followUpActions[h.action]}</strong>
                <small>
                  {careDate(h.created_at)} · termin {careDate(h.due_on)}
                </small>
                {h.note && <p>{h.note}</p>}
              </li>
            ))}
          </ol>
          <nav className={styles.links} aria-label="Historia kontaktu">
            {page > 1 && (
              <Link className="ghost-button" href={`?page=${page - 1}`}>
                ← Nowsze
              </Link>
            )}
            {more && (
              <Link className="ghost-button" href={`?page=${page + 1}`}>
                Starsze →
              </Link>
            )}
          </nav>
        </article>
      </div>
    </div>
  );
}
export function FollowUpArchiveView({
  items,
  more,
  page,
  dogId,
}: {
  items: Detail[];
  more: boolean;
  page: number;
  dogId?: string;
}) {
  const url = (p: number) =>
    `?${new URLSearchParams({ page: String(p), ...(dogId ? { dog: dogId } : {}) })}`;
  return (
    <div className="stack">
      <Link className="ghost-button" href="/admin/work">
        ← Do zrobienia
      </Link>
      <header className={styles.header}>
        <h2>Kontakty kontrolne i historia</h2>
        <p className="muted">
          Zadania kontaktowe dla prowadzącej: zaplanowane, zakończone i
          zastąpione przez kolejne wersje planu.
        </p>
        {dogId && (
          <Link className="ghost-button" href="/admin/work/follow-ups">
            Pokaż wszystkie psy →
          </Link>
        )}
      </header>
      <article className="card pad">
        {items.map((item) => (
          <Link
            className={styles.row}
            key={item.id}
            href={`/admin/work/follow-ups/${item.id}`}
          >
            <div className={styles.body}>
              <span className="badge">{followUpStates[item.status]}</span>
              <h3>
                {item.dogs.name} · {careDate(item.due_on)}
              </h3>
              <p>
                {item.care_plan_versions.title} · wersja{" "}
                {item.care_plan_versions.revision}
              </p>
            </div>
            <ArrowRight size={19} />
          </Link>
        ))}
        {!items.length && <p>Na tej stronie nie ma kontaktów kontrolnych.</p>}
      </article>
      <nav className={styles.links} aria-label="Kontakty kontrolne">
        {page > 1 && (
          <Link className="ghost-button" href={url(page - 1)}>
            ← Nowsze
          </Link>
        )}
        {more && (
          <Link className="ghost-button" href={url(page + 1)}>
            Starsze →
          </Link>
        )}
      </nav>
    </div>
  );
}
