import type { ActionState } from "@/components/action-form";
import type { requireSession } from "@/lib/auth/session";

export type AvatarState = ActionState & {
  avatarPath?: string | null;
  updatedAt?: string;
};
type Database = Awaited<ReturnType<typeof requireSession>>["db"];
export type AvatarBucket = "dog-avatars" | "community-avatars";

// Persist before sending bytes. An uncertain reservation response must stop the
// upload; if it committed, the expiry worker will still find the reservation.
export async function reserveAvatarUpload(
  db: Database,
  dog: string,
  bucket: AvatarBucket,
  path: string,
) {
  const result = await db.rpc("reserve_avatar_upload", {
    p_dog: dog,
    p_bucket: bucket,
    p_path: path,
  });
  if (result.error || typeof result.data !== "string")
    throw new Error("Upload reservation unavailable");
}

// The profile change already committed. Cleanup failure must preserve its
// success; the database queue keeps the retired key for the local worker.
export async function cleanupRetiredAvatar(
  db: Database,
  bucket: AvatarBucket,
  path: string | null,
) {
  if (!path) return;
  let failed = false;
  try {
    const result = await db.storage.from(bucket).remove([path]);
    failed = !!result.error;
  } catch {
    failed = true;
  }
  try {
    await db.rpc("finish_avatar_cleanup", {
      p_bucket: bucket,
      p_path: path,
      p_failed: failed,
    });
  } catch {
    // A lost acknowledgement leaves the durable queue entry pending.
  }
}

export async function cleanupUnattachedUpload(
  db: Database,
  bucket: AvatarBucket,
  path: string,
) {
  try {
    const result = await db.rpc("retire_avatar_upload", {
      p_bucket: bucket,
      p_path: path,
    });
    // A lost successful attachment response is not permission to erase it.
    if (result.error || result.data !== true) return;
    await cleanupRetiredAvatar(db, bucket, path);
  } catch {
    // The reservation covers a lost connection before retirement is recorded.
  }
}
