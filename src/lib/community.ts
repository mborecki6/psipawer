import { z } from "zod";

export const communityProfileSchema = z.object({
  display_name: z.string().trim().min(1, "Podaj imię psa.").max(80),
  area: z.string().trim().max(120),
  headline: z.string().trim().min(3, "Dodaj kilka słów o psie.").max(280),
  seeking: z
    .string()
    .trim()
    .min(3, "Opisz, jakiego towarzystwa szukacie.")
    .max(500),
  traits: z.array(z.string().trim().min(1).max(40)).max(8),
  likes: z.string().trim().max(500),
  dislikes: z.string().trim().max(500),
  avatar_path: z.string().max(500).nullable(),
});

export type CommunityProfile = z.infer<typeof communityProfileSchema> & {
  dog_id: string;
  moderation_status: "pending" | "approved" | "rejected";
  published: boolean;
  created_at: string;
  updated_at: string;
  avatarUrl?: string | null;
};
export type CommunityReview = {
  dog_id: string;
  consented_at: string | null;
  moderation_note: string | null;
  reviewed_at: string | null;
};
export type CommunityManagedProfile = {
  dogId: string;
  dogName: string;
  guardianName: string;
  profile: CommunityProfile | null;
  review: CommunityReview | null;
};
export type CommunityInterestRecord = {
  id: string;
  from_dog_id: string;
  to_dog_id: string;
  status: "open" | "matched" | "reviewed" | "rejected" | "withdrawn";
  created_at: string;
  updated_at: string;
  review_note: string | null;
  reviewed_at: string | null;
  confirmed_at: string | null;
  rejection_active: boolean;
};
export type CommunityInterest = CommunityInterestRecord & {
  fromName: string;
  toName: string;
  profilesAvailable: boolean;
  canWithdraw: boolean;
  needsConfirmation: boolean;
};
export type CommunityData = {
  catalog: CommunityProfile[];
  mine: CommunityManagedProfile[];
  moderation: CommunityManagedProfile[];
  interests: CommunityInterest[];
  senders: { id: string; name: string }[];
  sentPairs: {
    fromDogId: string;
    toDogId: string;
    status: CommunityInterestRecord["status"];
    confirmedAt: string | null;
    rejectionActive: boolean;
  }[];
  totals: { published: number; pending: number; mutual: number };
};
export type CommunityTab = "catalog" | "mine" | "moderation" | "interests";

export function communityTab(
  value: string | undefined,
  admin: boolean,
): CommunityTab {
  return value === "mine" ||
    value === "interests" ||
    (admin && value === "moderation")
    ? value
    : "catalog";
}

export function buildCommunityData(input: {
  profiles: CommunityProfile[];
  reviews: CommunityReview[];
  dogs: { id: string; name: string; guardian_id: string }[];
  guardians: { id: string; full_name: string | null }[];
  interests: CommunityInterestRecord[];
  userId: string;
  admin: boolean;
}): CommunityData {
  const dogMap = new Map(input.dogs.map((d) => [d.id, d]));
  const profileMap = new Map(input.profiles.map((p) => [p.dog_id, p]));
  const reviews = new Map(input.reviews.map((r) => [r.dog_id, r]));
  const guardians = new Map(input.guardians.map((g) => [g.id, g.full_name]));
  const ownIds = new Set(
    input.dogs.filter((d) => d.guardian_id === input.userId).map((d) => d.id),
  );
  const catalog = input.profiles.filter(
    (p) => p.published && p.moderation_status === "approved",
  );
  const publishedIds = new Set(catalog.map((p) => p.dog_id));
  const managed = (dogId: string): CommunityManagedProfile => {
    const dog = dogMap.get(dogId);
    const profile = profileMap.get(dogId) || null;
    return {
      dogId,
      dogName: dog?.name || profile?.display_name || "Pies",
      guardianName: guardians.get(dog?.guardian_id || "") || "Opiekun",
      profile,
      review: reviews.get(dogId) || null,
    };
  };
  const interests: CommunityInterest[] = input.interests
    .filter((i) => input.admin || ownIds.has(i.from_dog_id))
    .map((i) => ({
      ...i,
      fromName:
        profileMap.get(i.from_dog_id)?.display_name ||
        dogMap.get(i.from_dog_id)?.name ||
        "Profil niedostępny",
      toName:
        profileMap.get(i.to_dog_id)?.display_name ||
        (input.admin ? dogMap.get(i.to_dog_id)?.name : null) ||
        "Profil niedostępny",
      profilesAvailable:
        publishedIds.has(i.from_dog_id) && publishedIds.has(i.to_dog_id),
      canWithdraw: ownIds.has(i.from_dog_id) && i.status !== "withdrawn",
      needsConfirmation:
        ownIds.has(i.from_dog_id) &&
        !i.confirmed_at &&
        !i.rejection_active &&
        i.status !== "withdrawn",
    }));
  // A reciprocal pair needs one moderation decision, not two duplicate cards.
  const displayed = input.admin
    ? interests.filter((i) => {
        const reverse = interests.find(
          (other) =>
            other.from_dog_id === i.to_dog_id &&
            other.to_dog_id === i.from_dog_id,
        );
        if (!reverse) return true;
        if ((i.status === "withdrawn") !== (reverse.status === "withdrawn"))
          return i.status !== "withdrawn";
        return i.from_dog_id < i.to_dog_id;
      })
    : interests;
  return {
    catalog,
    mine: [...ownIds].map(managed),
    moderation: input.admin ? input.profiles.map((p) => managed(p.dog_id)) : [],
    interests: displayed,
    senders: catalog
      .filter((p) => ownIds.has(p.dog_id))
      .map((p) => ({ id: p.dog_id, name: p.display_name })),
    sentPairs: input.interests
      .filter((i) => ownIds.has(i.from_dog_id))
      .map((i) => ({
        fromDogId: i.from_dog_id,
        toDogId: i.to_dog_id,
        status: i.status,
        confirmedAt: i.confirmed_at,
        rejectionActive: i.rejection_active,
      })),
    totals: {
      published: catalog.length,
      pending: input.admin
        ? input.profiles.filter(
            (p) =>
              p.moderation_status === "pending" &&
              reviews.get(p.dog_id)?.consented_at,
          ).length
        : 0,
      mutual: displayed.filter(
        (i) => i.status === "matched" && i.profilesAvailable,
      ).length,
    },
  };
}
