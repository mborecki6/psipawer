import "server-only";
import { requireSession } from "@/lib/auth/session";
import {
  buildCommunityData,
  type CommunityProfile,
  type CommunityReview,
  type CommunityInterestRecord,
} from "@/lib/community";

async function allRows<T>(
  query: (
    from: number,
    to: number,
  ) => PromiseLike<{ data: unknown[] | null; error: unknown }>,
): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += 500) {
    const { data, error } = await query(from, from + 499);
    if (error || !data)
      throw new Error(
        "Nie udało się pobrać Psiutków. Odśwież widok i spróbuj ponownie.",
      );
    rows.push(...(data as T[]));
    if (data.length < 500) return rows;
  }
}

export async function getCommunityData() {
  const { db, user, role } = await requireSession();
  const [profiles, reviews, dogs, guardians, interests] = await Promise.all([
    allRows<CommunityProfile>((a, b) =>
      db
        .from("psiutki_profiles")
        .select(
          "dog_id,display_name,area,headline,seeking,traits,likes,dislikes,avatar_path,moderation_status,published,created_at,updated_at",
        )
        .order("dog_id")
        .range(a, b),
    ),
    allRows<CommunityReview>((a, b) =>
      db
        .from("psiutki_profile_reviews")
        .select("dog_id,consented_at,moderation_note,reviewed_at")
        .order("dog_id")
        .range(a, b),
    ),
    allRows<{ id: string; name: string; guardian_id: string }>((a, b) =>
      db.from("dogs").select("id,name,guardian_id").order("id").range(a, b),
    ),
    allRows<{ id: string; full_name: string | null }>((a, b) =>
      db.from("profiles").select("id,full_name").order("id").range(a, b),
    ),
    allRows<CommunityInterestRecord>((a, b) =>
      db
        .from("psiutki_interests")
        .select(
          "id,from_dog_id,to_dog_id,status,created_at,updated_at,review_note,reviewed_at,confirmed_at,rejection_active",
        )
        .order("id")
        .range(a, b),
    ),
  ]);
  const paths = [
    ...new Set(profiles.flatMap((p) => (p.avatar_path ? [p.avatar_path] : []))),
  ];
  const avatarUrls = new Map<string, string>();
  // Community photos have their own private bucket. Never sign dog-avatars for this catalog.
  if (paths.length) {
    const result = await db.storage
      .from("community-avatars")
      .createSignedUrls(paths, 60);
    for (const asset of result.data || [])
      if (!asset.error && asset.path && asset.signedUrl)
        avatarUrls.set(asset.path, asset.signedUrl);
  }
  for (const profile of profiles)
    profile.avatarUrl = profile.avatar_path
      ? avatarUrls.get(profile.avatar_path) || null
      : null;
  profiles.sort((a, b) => a.display_name.localeCompare(b.display_name, "pl"));
  dogs.sort((a, b) => a.name.localeCompare(b.name, "pl"));
  interests.sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  return buildCommunityData({
    profiles,
    reviews,
    dogs,
    guardians,
    interests,
    userId: user.id,
    admin: role === "admin",
  });
}
