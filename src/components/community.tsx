import { requireSession } from "@/lib/auth/session";
import { Empty } from "./ui";
import { PawPrint } from "lucide-react";
export async function Community() {
  const { db } = await requireSession();
  const { data, error } = await db
    .from("psiutki_profiles")
    .select("dog_id,display_name,area,headline,seeking,traits,likes,dislikes")
    .eq("published", true)
    .eq("moderation_status", "approved");
  if (error) throw new Error("Nie udało się pobrać Psiutków.");
  return (
    <div className="stack">
      <article className="card pad">
        <h2>Małe psie ogłoszenia. Wielkie osobowości.</h2>
        <p>
          Psiutki to miejsce na psie sympatie i przyzwyczajenia. Pokazujemy
          wyłącznie opublikowane, zatwierdzone opisy.
        </p>
      </article>
      <div className="psinder-grid">
        {data?.map((p) => (
          <article key={p.dog_id} className="card pad">
            <div className="dog-monogram">
              <PawPrint />
            </div>
            <h2>{p.display_name}</h2>
            <span className="muted">{p.area}</span>
            <p>{p.headline}</p>
            <h3>Szukam</h3>
            <p>{p.seeking}</p>
            <div className="walk-meta">
              {p.traits.map((t: string) => (
                <span className="badge" key={t}>
                  {t}
                </span>
              ))}
            </div>
            <p>Lubię: {p.likes}</p>
            <p>Nie lubię: {p.dislikes}</p>
          </article>
        ))}
      </div>
      {!data?.length && (
        <article className="card">
          <Empty
            title="Pierwsze Psiutki już wkrótce"
            copy="Zatwierdzone profile pojawią się tutaj. Prywatne dane psów i opiekunów pozostają w ich panelach."
          />
        </article>
      )}
    </div>
  );
}
