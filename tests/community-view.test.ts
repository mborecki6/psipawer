import { expect, it } from "vitest";
import {
  buildCommunityData,
  communityProfileSchema,
  communityTab,
  type CommunityProfile,
  type CommunityInterestRecord,
} from "../src/lib/community";

const profile = (
  dog_id: string,
  extra: Partial<CommunityProfile> = {},
): CommunityProfile => ({
  dog_id,
  display_name: dog_id,
  area: "Okolica parku",
  headline: "Spokojny obserwator",
  seeking: "Spokojnego kumpla",
  traits: [],
  likes: "Trawa",
  dislikes: "Hałas",
  avatar_path: null,
  moderation_status: "approved",
  published: true,
  created_at: "2026-09-08T10:00:00Z",
  updated_at: "2026-09-08T10:00:00Z",
  ...extra,
});
const interest = (
  id: string,
  from: string,
  to: string,
  extra: Partial<CommunityInterestRecord> = {},
): CommunityInterestRecord => ({
  id,
  from_dog_id: from,
  to_dog_id: to,
  status: "matched",
  created_at: "2026-09-08T10:00:00Z",
  updated_at: "2026-09-08T10:00:00Z",
  review_note: null,
  reviewed_at: null,
  confirmed_at: "2026-09-08T10:00:00Z",
  rejection_active: false,
  ...extra,
});
const input = () => ({
  profiles: [profile("a"), profile("b")],
  reviews: [],
  dogs: [{ id: "a", name: "Mój pies", guardian_id: "owner" }],
  guardians: [],
  interests: [] as CommunityInterestRecord[],
  userId: "owner",
  admin: false,
});

it("keeps pending/rejected and hidden profiles outside catalog, but lets owner manage own submission", () => {
  const data = buildCommunityData({
    ...input(),
    profiles: [
      profile("a", { published: false, moderation_status: "pending" }),
      profile("b"),
      profile("c", { moderation_status: "rejected" }),
    ],
  });
  expect(data.catalog.map((p) => p.dog_id)).toEqual(["b"]);
  expect(data.mine[0].profile?.moderation_status).toBe("pending");
  expect(data.senders).toEqual([]);
  expect(data.moderation).toEqual([]);
});
it("does not resolve an unavailable other profile through private dog information for a client", () => {
  const data = buildCommunityData({
    ...input(),
    profiles: [profile("a")],
    interests: [interest("i", "a", "b")],
    dogs: [
      ...input().dogs,
      { id: "b", name: "Prywatne imię", guardian_id: "other" },
    ],
  });
  expect(data.interests[0].toName).toBe("Profil niedostępny");
  expect(data.interests[0].profilesAvailable).toBe(false);
  expect(data.totals.mutual).toBe(0);
  expect(data.mine).toHaveLength(1);
});
it("shows one admin card for a mutual pair while preserving each owner's outgoing interest", () => {
  const interests = [interest("ab", "a", "b"), interest("ba", "b", "a")];
  const admin = buildCommunityData({ ...input(), interests, admin: true });
  expect(admin.interests).toHaveLength(1);
  expect(admin.totals.mutual).toBe(1);
  const owner = buildCommunityData({ ...input(), interests });
  expect(owner.interests.map((i) => i.id)).toEqual(["ab"]);
  expect(owner.interests[0].canWithdraw).toBe(true);
});
it("requires fresh confirmation after changed content but never offers re-confirmation to bypass active rejection", () => {
  const changed = buildCommunityData({
    ...input(),
    interests: [
      interest("i", "a", "b", { status: "open", confirmed_at: null }),
    ],
  });
  expect(changed.interests[0].needsConfirmation).toBe(true);
  expect(changed.sentPairs[0].confirmedAt).toBeNull();
  const rejected = buildCommunityData({
    ...input(),
    interests: [
      interest("i", "a", "b", {
        status: "rejected",
        confirmed_at: null,
        rejection_active: true,
      }),
    ],
  });
  expect(rejected.interests[0].needsConfirmation).toBe(false);
  expect(rejected.sentPairs[0].rejectionActive).toBe(true);
});
it("keeps the active direction visible to admins when the other owner withdraws", () => {
  for (const withdrawnId of ["ab", "ba"]) {
    const interests = [interest("ab", "a", "b"), interest("ba", "b", "a")].map(
      (i) => ({
        ...i,
        status:
          i.id === withdrawnId ? ("withdrawn" as const) : ("open" as const),
      }),
    );
    const data = buildCommunityData({ ...input(), interests, admin: true });
    expect(data.interests).toHaveLength(1);
    expect(data.interests[0].status).toBe("open");
    expect(data.interests[0].id).not.toBe(withdrawnId);
  }
});
it("does not put revoked consent in pending moderator count, and rejects unsupported client tabs", () => {
  const data = buildCommunityData({
    ...input(),
    admin: true,
    profiles: [
      profile("a", { moderation_status: "pending", published: false }),
    ],
    reviews: [
      {
        dog_id: "a",
        consented_at: null,
        moderation_note: null,
        reviewed_at: null,
      },
    ],
  });
  expect(data.totals.pending).toBe(0);
  expect(communityTab("moderation", false)).toBe("catalog");
  expect(communityTab("moderation", true)).toBe("moderation");
});
it("rejects incomplete or oversized public profile content", () => {
  const valid = profile("a");
  expect(communityProfileSchema.safeParse(valid).success).toBe(true);
  for (const extra of [
    { headline: "" },
    { display_name: "x".repeat(81) },
    { traits: Array.from({ length: 9 }, (_, i) => String(i)) },
    { seeking: "x".repeat(501) },
  ]) {
    expect(
      communityProfileSchema.safeParse({ ...valid, ...extra }).success,
    ).toBe(false);
  }
});
