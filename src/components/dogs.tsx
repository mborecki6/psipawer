import Link from "next/link";
import { randomUUID } from "node:crypto";
import Image from "next/image";
import { notFound } from "next/navigation";
import { PawPrint } from "lucide-react";
import { requireSession } from "@/lib/auth/session";
import { getSnapshot } from "@/lib/data/queries";
import { dogStatuses, uuid } from "@/lib/validation/schemas";
import { labels, dateLabel } from "@/lib/domain";
import { ActionForm, Field } from "./action-form";
import { AvatarEditor } from "./avatar-editor";
import { DogQualificationForm } from "./dog-qualification-form";
import { DogCreationRequest } from "./dog-creation-request";
import { Badge, Empty } from "./ui";
import { saveDog, saveBehavior, addNote } from "@/lib/data/actions";
import type { Dog } from "@/lib/data/types";
import { DetailsNavigation, ProgressiveDetails } from "./progressive-details";
import styles from "./dogs.module.css";
export function DogForm({ dog }: { dog?: Dog }) {
  return (
    <ActionForm
      action={saveDog}
      label={dog ? "Zapisz profil" : "Dodaj psa"}
      failureMessage="Nie udało się potwierdzić zapisu. Twoje dane pozostały w formularzu. Sprawdź połączenie i spróbuj ponownie."
    >
      {dog ? (
        <input type="hidden" name="id" value={dog.id} />
      ) : (
        <DogCreationRequest requestId={randomUUID()} />
      )}
      <div className="form-grid">
        <Field
          label="Imię psa"
          name="name"
          value={dog?.name}
          required
          maxLength={80}
        />
        <Field label="Rasa / typ" name="breed" value={dog?.breed || ""} />
        <Field
          label="Przybliżony wiek"
          name="approximate_age"
          value={dog?.approximate_age || ""}
        />
        <label className="field">
          <span>Płeć</span>
          <select name="sex" defaultValue={dog?.sex || "unknown"}>
            <option value="unknown">Nie podano</option>
            <option value="female">Suka</option>
            <option value="male">Pies</option>
          </select>
        </label>
        <Field
          label="Waga w kg"
          name="weight_kg"
          type="number"
          value={dog?.weight_kg || ""}
        />
        <Field label="Umaszczenie" name="color" value={dog?.color || ""} />
      </div>
    </ActionForm>
  );
}
export async function DogsList({
  query = "",
  status = "all",
}: {
  query?: string;
  status?: string;
}) {
  const { dogs, role } = await getSnapshot();
  const base = role === "admin" ? "/admin" : "/app";
  const selected = dogs.filter(
    (d) =>
      (status === "all" || d.status === status) &&
      `${d.name} ${d.breed || ""}`
        .toLocaleLowerCase("pl")
        .includes(query.toLocaleLowerCase("pl")),
  );
  return (
    <div className="stack">
      <div className="toolbar">
        <form className="search-filters">
          <label className="field">
            <span>Szukaj psa</span>
            <input name="q" placeholder="Imię lub rasa…" defaultValue={query} />
          </label>
          <label className="field">
            <span>Status</span>
            <select name="status" defaultValue={status}>
              <option value="all">Wszystkie statusy</option>
              {dogStatuses.map((s) => (
                <option key={s} value={s}>
                  {labels[s]}
                </option>
              ))}
            </select>
          </label>
          <button className="secondary-button">Pokaż</button>
        </form>
        {role === "client" && (
          <Link className="primary-button" href="/app/dogs/new">
            Dodaj psa +
          </Link>
        )}
        {role === "admin" && (
          <Link className="primary-button" href="/admin/invitations">
            Zaproszenia opiekunów
          </Link>
        )}
      </div>
      <div className="dog-grid">
        {selected.map((d) => (
          <Link
            key={d.id}
            className="card pad native-dog-card"
            href={`${base}/dogs/${d.id}`}
          >
            <div className="dog-monogram">
              <PawPrint />
            </div>
            <Badge status={d.status} />
            <h2>{d.name}</h2>
            <p>
              {d.breed || "Jedyny w swoim rodzaju"} ·{" "}
              {d.approximate_age || "Wiek niepodany"}
            </p>
            <span className="ghost-button">Otwórz profil →</span>
          </Link>
        ))}
      </div>
      {!selected.length && (
        <article className="card">
          <Empty
            title="Nie ma tu jeszcze psów"
            copy={
              query || status !== "all"
                ? "Zmień kryteria wyszukiwania."
                : "Dodaj profil psa, żeby rozpocząć przygodę ze spacerami."
            }
            href={role === "client" ? "/app/dogs/new" : undefined}
            action="Dodaj psa"
          />
        </article>
      )}
    </div>
  );
}
export async function DogDetail({ id, saved }: { id: string; saved?: string }) {
  if (!uuid.safeParse(id).success) notFound();
  const { db, role } = await requireSession();
  const { data: dog, error } = await db
    .from("dogs")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error("Nie udało się pobrać psa.");
  if (!dog) notFound();
  const [behavior, notes, guardian] = await Promise.all([
    db.from("dog_behavior_profiles").select("*").eq("dog_id", id).maybeSingle(),
    db
      .from("dog_notes")
      .select("id,body,visibility,created_at")
      .eq("dog_id", id)
      .order("created_at", { ascending: false }),
    db
      .from("profiles")
      .select("full_name,phone,area")
      .eq("id", dog.guardian_id)
      .maybeSingle(),
  ]);
  if (behavior.error || notes.error || guardian.error)
    throw new Error("Nie udało się pobrać szczegółów psa.");
  const photo = dog.avatar_path
    ? await db.storage.from("dog-avatars").createSignedUrl(dog.avatar_path, 300)
    : null;
  const questions = [
    ["comfort_distance", "Dystans komfortu"],
    ["reactions", "Reakcje na inne psy"],
    ["triggers", "Co wywołuje trudności?"],
    ["helps", "Co pomaga?"],
    ["health", "Zdrowie"],
    ["medications", "Leki"],
    ["allergies", "Alergie"],
    ["muzzle", "Kaganiec"],
    ["bite_history", "Historia pogryzień"],
    ["goals", "Wasze cele"],
  ];
  const completedAnswers = questions.filter(([name]) =>
    behavior.data?.[name]?.trim(),
  ).length;
  const base = role === "admin" ? "/admin" : "/app";
  return (
    <DetailsNavigation navigationKey={`dog-${id}`} className="stack">
      <Link className="ghost-button" href={`${base}/dogs`}>
        ← Wszystkie psy
      </Link>
      {saved && (
        <div className="alert green" role="status">
          Profil psa zapisany.
        </div>
      )}
      <div className="profile-layout">
        <aside className={`card pad profile-summary ${styles.summary}`}>
          {photo?.data?.signedUrl ? (
            <Image
              unoptimized
              width={320}
              height={320}
              className={`dog-avatar-photo ${styles.photo}`}
              src={photo.data.signedUrl}
              alt={dog.name}
            />
          ) : (
            <div className={`dog-monogram ${styles.monogram}`}>
              <PawPrint size={42} />
            </div>
          )}
          <h2>{dog.name}</h2>
          <Badge status={dog.status} />
          <dl className={styles.profileFacts}>
            {[
              ["Rasa / typ", dog.breed],
              ["Przybliżony wiek", dog.approximate_age],
              ["Płeć", dog.sex === "unknown" ? null : labels[dog.sex]],
              ["Waga", dog.weight_kg == null ? null : `${dog.weight_kg} kg`],
              ["Umaszczenie", dog.color],
            ].map(([label, value]) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd>{value || "Nie podano"}</dd>
              </div>
            ))}
          </dl>
          <p
            className={completedAnswers < questions.length ? "alert" : "muted"}
          >
            <span>
              <strong>
                Informacje o potrzebach: {completedAnswers} / {questions.length}
              </strong>
              <br />
              {completedAnswers === 0
                ? "Kwestionariusz psa nie został jeszcze uzupełniony."
                : completedAnswers < questions.length
                  ? "Część informacji czeka na uzupełnienie."
                  : "Wszystkie pola są uzupełnione."}
            </span>
          </p>
          <a className="ghost-button" href="#dog-needs">
            Potrzeby i bezpieczeństwo ↓
          </a>
          <h3>Opiekun</h3>
          <p>
            {guardian.data?.full_name}
            <br />
            {guardian.data?.area}
          </p>
          {role === "admin" && guardian.data?.phone && (
            <a className="secondary-button" href={`tel:${guardian.data.phone}`}>
              Zadzwoń do opiekuna
            </a>
          )}
          <ProgressiveDetails label="Zmień zdjęcie" className={styles.details}>
            <AvatarEditor
              key={id}
              scope="dog"
              dogId={id}
              initialPath={dog.avatar_path}
            />
          </ProgressiveDetails>
        </aside>
        <div className="stack">
          {role === "admin" && (
            <article className="card pad" id="kwalifikacja" data-detail-item>
              <h2>Kwalifikacja do spacerów</h2>
              <Badge status={dog.status} />
              <ProgressiveDetails
                label="Zmień kwalifikację"
                primary
                className={styles.details}
              >
                <DogQualificationForm
                  key={id}
                  dogId={id}
                  requestId={randomUUID()}
                  status={dog.status}
                  version={dog.qualification_version}
                />
              </ProgressiveDetails>
            </article>
          )}
          <article className="card pad" id="dog-needs">
            <h2>Potrzeby i bezpieczeństwo</h2>
            <p className="muted">
              Kwestionariusz jest prywatny. Widzi go opiekun i behawiorysta.
              Zmiana reakcji lub historii pogryzień może wymagać ponownej oceny.
            </p>
            <dl className={styles.needs}>
              {questions.map(([name, label]) => (
                <div key={name}>
                  <dt>{label}</dt>
                  <dd className="preserve-lines">
                    {behavior.data?.[name]?.trim() || "Nie uzupełniono"}
                  </dd>
                </div>
              ))}
            </dl>
          </article>
          <article className="card pad">
            <h2>
              {role === "admin"
                ? "Notatki behawiorysty"
                : "Wiadomości od behawiorysty"}
            </h2>
            {notes.data?.map((n) => (
              <section key={n.id} className="note-row">
                <span className="muted">
                  {dateLabel(n.created_at)} ·{" "}
                  {n.visibility === "admin_only"
                    ? "Tylko behawiorysta"
                    : "Widoczna dla opiekuna"}
                </span>
                <p className="preserve-lines">{n.body}</p>
              </section>
            ))}
            {!notes.data?.length && (
              <p className="muted">Brak notatek do wyświetlenia.</p>
            )}
            {role === "admin" && (
              <ProgressiveDetails
                label="Dodaj notatkę"
                className={styles.details}
              >
                <ActionForm action={addNote} label="Dodaj notatkę">
                  <input type="hidden" name="dog_id" value={id} />
                  <label className="field">
                    <span>Treść notatki</span>
                    <textarea name="body" required maxLength={8000} />
                  </label>
                  <label className="field">
                    <span>Widoczność</span>
                    <select name="visibility" defaultValue="admin_only">
                      <option value="admin_only">
                        Prywatna — tylko behawiorysta
                      </option>
                      <option value="client_visible">
                        Udostępniona opiekunowi
                      </option>
                    </select>
                  </label>
                </ActionForm>
              </ProgressiveDetails>
            )}
          </article>
          <article className="card pad">
            <h2>Plan pracy i postępy</h2>
            <p className="muted">
              {role === "admin"
                ? "Przygotuj zalecenia dla tego psa i wróć do odpowiedzi opiekuna."
                : "Przeczytaj wskazówki prowadzącej i opowiedz, jak Wam idzie."}
            </p>
            <Link className="primary-button" href={`${base}/dogs/${id}/care`}>
              Otwórz plan i postępy →
            </Link>
            <Link
              className="ghost-button"
              href={`${base}/consultations?dog=${id}`}
            >
              Konsultacje indywidualne →
            </Link>
          </article>
          <article className="card pad">
            <ProgressiveDetails
              label="Edytuj profil"
              className={styles.details}
            >
              <DogForm dog={dog as Dog} />
            </ProgressiveDetails>
            <ProgressiveDetails
              label={
                completedAnswers === 0
                  ? "Uzupełnij informacje o psie"
                  : "Zmień informacje o psie"
              }
              className={styles.details}
            >
              <p className="muted">
                Informacje są prywatne dla opiekuna i behawiorysty. Zmiana
                reakcji lub historii pogryzień może wymagać ponownej oceny.
              </p>
              <ActionForm action={saveBehavior} label="Zapisz kwestionariusz">
                <input type="hidden" name="dog_id" value={id} />
                <div className="form-grid">
                  {questions.map(([name, label]) => (
                    <label className="field" key={name}>
                      <span>{label}</span>
                      <textarea
                        name={name}
                        maxLength={4000}
                        defaultValue={behavior.data?.[name] || ""}
                      />
                    </label>
                  ))}
                </div>
              </ActionForm>
            </ProgressiveDetails>
          </article>
        </div>
      </div>
    </DetailsNavigation>
  );
}
