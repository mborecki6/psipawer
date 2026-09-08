import type { Dog, Registration, Walk } from "./data/types";

type QualificationSnapshot = {
  dogs: readonly Pick<Dog, "id" | "name" | "status">[];
  walks: readonly Pick<
    Walk,
    "id" | "starts_at" | "public_location" | "status"
  >[];
  registrations: readonly Pick<
    Registration,
    "id" | "walk_id" | "dog_id" | "status"
  >[];
};

export type QualificationWarning = {
  registrationId: string;
  dogId: string;
  dogName: string;
  dogStatus: string;
  walkId: string;
  startsAt: string;
  publicLocation: string;
};

export function getQualificationWarnings(
  { dogs, walks, registrations }: QualificationSnapshot,
  now = new Date(),
): QualificationWarning[] {
  const dogsById = new Map(dogs.map((dog) => [dog.id, dog]));
  const walksById = new Map(walks.map((walk) => [walk.id, walk]));
  return registrations
    .flatMap((registration) => {
      const dog = dogsById.get(registration.dog_id);
      const walk = walksById.get(registration.walk_id);
      if (
        registration.status !== "accepted" ||
        !dog ||
        !walk ||
        ["approved", "approved_conditional"].includes(dog.status) ||
        !["open", "full", "closed"].includes(walk.status) ||
        !(Date.parse(walk.starts_at) > now.getTime())
      )
        return [];
      return [
        {
          registrationId: registration.id,
          dogId: dog.id,
          dogName: dog.name,
          dogStatus: dog.status,
          walkId: walk.id,
          startsAt: walk.starts_at,
          publicLocation: walk.public_location,
        },
      ];
    })
    .sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt));
}
