import type { Registration } from "./data/types";

export type WalkRelation = {
  id: string;
  dog_a: string;
  dog_b: string;
  level: string;
  note: string;
};

export function getWalkRelationWarnings(
  relations: WalkRelation[],
  registrations: Pick<Registration, "dog_id" | "status">[],
) {
  const active = new Set(
    registrations
      .filter((r) => ["pending", "accepted", "waitlisted"].includes(r.status))
      .map((r) => r.dog_id),
  );
  const accepted = new Set(
    registrations.filter((r) => r.status === "accepted").map((r) => r.dog_id),
  );
  return relations.filter(
    (r) =>
      ["caution", "block"].includes(r.level) &&
      active.has(r.dog_a) &&
      active.has(r.dog_b) &&
      (accepted.has(r.dog_a) || accepted.has(r.dog_b)),
  );
}
