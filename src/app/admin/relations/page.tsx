import { requireSession } from "@/lib/auth/session";
import {
  DogRelationsView,
  relationLevels,
  type DogRelation,
  type RelationDog,
  type RelationProfile,
} from "@/components/dog-relations";

async function allRows<T>(
  query: (
    from: number,
    to: number,
  ) => PromiseLike<{ data: unknown[] | null; error: unknown }>,
) {
  const rows: T[] = [];
  for (let from = 0; ; from += 500) {
    const result = await query(from, from + 499);
    if (result.error || !result.data)
      throw new Error(
        "Nie udało się pobrać relacji psów. Odśwież stronę i spróbuj ponownie.",
      );
    rows.push(...(result.data as T[]));
    if (result.data.length < 500) return rows;
  }
}

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ q?: string | string[]; level?: string | string[] }>;
}) {
  const { db } = await requireSession("admin");
  const params = await searchParams;
  const [dogs, relations, profiles] = await Promise.all([
    allRows<RelationDog>((from, to) =>
      db
        .from("dogs")
        .select("id,name,guardian_id,breed")
        .order("id")
        .range(from, to),
    ),
    allRows<DogRelation>((from, to) =>
      db
        .from("dog_relations")
        .select("id,dog_a,dog_b,level,note,last_met_at,author_id,updated_at")
        .order("id")
        .range(from, to),
    ),
    allRows<RelationProfile>((from, to) =>
      db.from("profiles").select("id,full_name").order("id").range(from, to),
    ),
  ]);
  return (
    <DogRelationsView
      dogs={dogs.sort((a, b) => a.name.localeCompare(b.name, "pl"))}
      relations={relations.sort(
        (a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at),
      )}
      profiles={profiles}
      query={typeof params.q === "string" ? params.q.slice(0, 200) : ""}
      level={
        typeof params.level === "string" &&
        Object.hasOwn(relationLevels, params.level)
          ? params.level
          : "all"
      }
    />
  );
}
