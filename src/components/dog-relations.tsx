import Link from "next/link";
import { ArrowRightLeft, LockKeyhole, Plus, ShieldAlert } from "lucide-react";
import { ActionForm, Field } from "./action-form";
import { saveDogRelation } from "@/lib/data/relation-actions";
import { dateLabel } from "@/lib/domain";
import { warsawDateTimeInput } from "@/lib/time";
import styles from "./dog-relations.module.css";

export const relationLevels = {
  unknown: "Do poznania",
  good: "Dobra relacja",
  neutral: "Neutralnie",
  caution: "Zachowaj ostrożność",
  block: "Nie łączyć",
  possible_duet: "Możliwy duet",
};

export type DogRelation = {
  id: string;
  dog_a: string;
  dog_b: string;
  level: keyof typeof relationLevels;
  note: string;
  last_met_at: string | null;
  author_id: string;
  updated_at: string;
};
export type RelationDog = {
  id: string;
  name: string;
  guardian_id: string;
  breed: string | null;
};
export type RelationProfile = { id: string; full_name: string | null };

function RelationForm({
  dogs,
  profiles,
  relation,
}: {
  dogs: RelationDog[];
  profiles: Map<string, string>;
  relation?: DogRelation;
}) {
  return (
    <ActionForm
      action={saveDogRelation}
      label={relation ? "Zapisz ocenę" : "Dodaj relację"}
    >
      <input
        type="hidden"
        name="expected_updated_at"
        value={relation?.updated_at || ""}
      />
      {relation ? (
        <>
          <input type="hidden" name="dog_a" value={relation.dog_a} />
          <input type="hidden" name="dog_b" value={relation.dog_b} />
        </>
      ) : (
        <div className="form-grid">
          {[
            ["dog_a", "Pierwszy pies"],
            ["dog_b", "Drugi pies"],
          ].map(([name, label]) => (
            <label className="field" key={name}>
              <span>{label}</span>
              <select name={name} required defaultValue="">
                <option value="" disabled>
                  Wybierz psa
                </option>
                {dogs.map((dog) => (
                  <option key={dog.id} value={dog.id}>
                    {dog.name} ·{" "}
                    {profiles.get(dog.guardian_id) ||
                      dog.breed ||
                      "Opiekun bez nazwiska"}
                  </option>
                ))}
              </select>
            </label>
          ))}
        </div>
      )}
      <div className="form-grid">
        <label className="field">
          <span>Ocena relacji</span>
          <select
            name="level"
            defaultValue={relation?.level || "unknown"}
            required
          >
            {Object.entries(relationLevels).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <Field
          name="last_met_at"
          label="Ostatnie spotkanie (opcjonalnie)"
          type="datetime-local"
          value={
            relation?.last_met_at
              ? warsawDateTimeInput(relation.last_met_at)
              : ""
          }
          hint="Data i godzina w Polsce. Pozostaw puste, jeśli psy jeszcze się nie spotkały."
        />
      </div>
      <label className="field">
        <span>Prywatna notatka behawiorysty</span>
        <textarea
          name="note"
          required
          minLength={3}
          maxLength={2000}
          rows={3}
          defaultValue={relation?.note || ""}
          placeholder="Co warto uwzględnić przy wspólnym spacerze? Dystans, przebieg spotkania, zalecenia…"
        />
      </label>
      <p className={styles.hint}>
        Ocena i notatka są wewnętrzne. Opiekunowie ich nie zobaczą.
      </p>
    </ActionForm>
  );
}

export function DogRelationsView({
  dogs,
  relations,
  profiles,
  query = "",
  level = "all",
}: {
  dogs: RelationDog[];
  relations: DogRelation[];
  profiles: RelationProfile[];
  query?: string;
  level?: string;
}) {
  const dogsById = new Map(dogs.map((dog) => [dog.id, dog]));
  const profileNames = new Map(
    profiles.map((profile) => [profile.id, profile.full_name || ""]),
  );
  const normalized = query.trim().toLocaleLowerCase("pl");
  const selected = relations.filter(
    (relation) =>
      (level === "all" || relation.level === level) &&
      [
        dogsById.get(relation.dog_a)?.name,
        dogsById.get(relation.dog_b)?.name,
        relation.note,
      ]
        .join(" ")
        .toLocaleLowerCase("pl")
        .includes(normalized),
  );
  return (
    <div className={styles.root}>
      <section className={`card ${styles.intro}`}>
        <div>
          <span className={styles.eyebrow}>
            <LockKeyhole size={15} /> Tylko behawiorysta
          </span>
          <h2>Dobry skład zaczyna się od poznania psów.</h2>
          <p>
            Zapisuj doświadczenia par, zauważaj dobre duety i oznaczaj
            połączenia wymagające ostrożności.
          </p>
        </div>
        <a href="#new-relation" className="primary-button">
          <Plus size={18} /> Dodaj relację
        </a>
      </section>
      <div className={styles.summary}>
        <div>
          <ArrowRightLeft size={19} />
          <strong>{relations.length}</strong>
          <span>opisanych relacji</span>
        </div>
        <div>
          <ShieldAlert size={19} />
          <strong>
            {
              relations.filter((relation) =>
                ["caution", "block"].includes(relation.level),
              ).length
            }
          </strong>
          <span>wymaga ostrożności</span>
        </div>
      </div>
      <section className={`card ${styles.section}`}>
        <div className={styles.sectionHead}>
          <div>
            <h2>Relacje psów</h2>
            <p>Wyszukaj parę lub fragment prywatnej notatki.</p>
          </div>
          <span className="badge neutral">{selected.length} par</span>
        </div>
        <form className={styles.filters} action="/admin/relations">
          <Field
            name="q"
            label="Szukaj relacji"
            value={query}
            placeholder="Imię psa lub notatka…"
            maxLength={200}
          />
          <label className="field">
            <span>Ocena</span>
            <select name="level" defaultValue={level}>
              <option value="all">Wszystkie relacje</option>
              {Object.entries(relationLevels).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <button className="secondary-button" type="submit">
            Pokaż
          </button>
          {(query || level !== "all") && (
            <Link className="ghost-button" href="/admin/relations">
              Wyczyść
            </Link>
          )}
        </form>
        <div className={styles.list}>
          {selected.map((relation) => (
            <article
              className={styles.relation}
              key={relation.id}
              id={`relation-${relation.id}`}
            >
              <div className={styles.pairHeading}>
                <h3>
                  <Link href={`/admin/dogs/${relation.dog_a}`}>
                    {dogsById.get(relation.dog_a)?.name || "Profil psa"}
                  </Link>
                  <span aria-hidden="true"> + </span>
                  <Link href={`/admin/dogs/${relation.dog_b}`}>
                    {dogsById.get(relation.dog_b)?.name || "Profil psa"}
                  </Link>
                </h3>
                <span
                  className={`badge ${relation.level === "block" ? "red" : relation.level === "caution" ? "amber" : ["good", "possible_duet"].includes(relation.level) ? "green" : "neutral"}`}
                >
                  {relationLevels[relation.level]}
                </span>
              </div>
              <p className={styles.note}>{relation.note}</p>
              <div className={styles.meta}>
                <span>
                  {relation.last_met_at
                    ? `Ostatnie spotkanie: ${dateLabel(relation.last_met_at)}`
                    : "Data spotkania nie została podana"}
                </span>
                <span>
                  Ocena: {dateLabel(relation.updated_at)} ·{" "}
                  {profileNames.get(relation.author_id) || "Behawiorysta"}
                </span>
              </div>
              <details className={styles.edit}>
                <summary>Edytuj ocenę i notatkę</summary>
                <div>
                  <RelationForm
                    dogs={dogs}
                    profiles={profileNames}
                    relation={relation}
                  />
                </div>
              </details>
            </article>
          ))}
          {!selected.length && (
            <div className="empty-state">
              <ArrowRightLeft size={32} />
              <h3>
                {relations.length
                  ? "Brak relacji pasujących do wyszukiwania"
                  : "Każde spotkanie to nowa obserwacja"}
              </h3>
              <p>
                {relations.length
                  ? "Zmień imię psa, fragment notatki lub ocenę."
                  : "Dodaj pierwszą parę i zapisz, co pomaga tym psom spacerować razem."}
              </p>
            </div>
          )}
        </div>
      </section>
      <section className={`card ${styles.section}`} id="new-relation">
        <div className={styles.sectionHead}>
          <div>
            <h2>Nowa relacja</h2>
            <p>
              Jedna para ma jedną aktualną ocenę. Wcześniejsze decyzje pozostają
              w historii.
            </p>
          </div>
        </div>
        <div className={styles.formBody}>
          {dogs.length >= 2 ? (
            <RelationForm dogs={dogs} profiles={profileNames} />
          ) : (
            <div className="alert">
              Do opisania relacji potrzebne są co najmniej dwa profile psów.{" "}
              <Link href="/admin/dogs">Przejdź do psów i opiekunów →</Link>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
