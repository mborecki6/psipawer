import Link from "next/link";
import Image from "next/image";
import { notFound } from "next/navigation";
import { PawPrint } from "lucide-react";
import { requireSession } from "@/lib/auth/session";
import { getSnapshot } from "@/lib/data/queries";
import { dogStatuses, uuid } from "@/lib/validation/schemas";
import { labels, dateLabel } from "@/lib/domain";
import { ActionForm, Field } from "./action-form";
import { Badge, Empty } from "./ui";
import {
  saveDog,
  saveBehavior,
  setDogStatus,
  addNote,
  uploadAvatar,
} from "@/lib/data/actions";
import type { Dog } from "@/lib/data/types";
export function DogForm({ dog }: { dog?: Dog }) {
  return (
    <ActionForm action={saveDog} label={dog ? "Zapisz profil" : "Dodaj psa"}>
      {dog && <input type="hidden" name="id" value={dog.id} />}
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
  return (
    <div className="stack">
      <Link
        className="ghost-button"
        href={`${role === "admin" ? "/admin" : "/app"}/dogs`}
      >
        ← Wszystkie psy
      </Link>
      {saved && (
        <div className="alert green" role="status">
          Profil psa zapisany.
        </div>
      )}
      <div className="profile-layout">
        <aside className="card pad profile-summary">
          {photo?.data?.signedUrl ? (
            <Image
              unoptimized
              width={320}
              height={320}
              className="dog-avatar-photo"
              src={photo.data.signedUrl}
              alt={dog.name}
            />
          ) : (
            <div className="dog-monogram">
              <PawPrint size={50} />
            </div>
          )}
          <h2>{dog.name}</h2>
          <Badge status={dog.status} />
          <p>
            {dog.breed} · {dog.approximate_age}
          </p>
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
          <ActionForm action={uploadAvatar} label="Zapisz zdjęcie">
            <input type="hidden" name="dog_id" value={id} />
            <label className="field">
              <span>Zdjęcie (JPG, PNG, WebP do 1,5 MB)</span>
              <input
                type="file"
                name="photo"
                accept="image/jpeg,image/png,image/webp"
                required
              />
            </label>
          </ActionForm>
        </aside>
        <div className="stack">
          <article className="card pad">
            <h2>Profil psa</h2>
            <DogForm dog={dog as Dog} />
          </article>
          <article className="card pad">
            <h2>Poznajmy psie potrzeby</h2>
            <p className="muted">
              Kwestionariusz jest prywatny. Widzi go opiekun i behawiorysta.
              Zmiana reakcji lub historii pogryzień może wymagać ponownej oceny.
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
          </article>
          {role === "admin" && (
            <article className="card pad">
              <h2>Kwalifikacja do spacerów</h2>
              <ActionForm action={setDogStatus} label="Zapisz kwalifikację">
                <input type="hidden" name="dog_id" value={id} />
                <label className="field">
                  <span>Status</span>
                  <select name="status" defaultValue={dog.status}>
                    {dogStatuses.map((s) => (
                      <option key={s} value={s}>
                        {labels[s]}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  <span>Powód / zalecenia (notatka prywatna)</span>
                  <textarea
                    name="note"
                    required
                    minLength={3}
                    maxLength={8000}
                  />
                </label>
              </ActionForm>
            </article>
          )}
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
            )}
          </article>
        </div>
      </div>
    </div>
  );
}
