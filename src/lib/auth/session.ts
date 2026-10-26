import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isConfigured } from "@/lib/supabase/config";
import { OnboardingRecordSchema } from "@/modules/onboarding/schemas";
export type Role = "admin" | "client";
// React's render cache is confined to one request. Layouts and modules share
// its verified identity; a later request always checks Auth and roles again.
const verifiedSession = cache(async () => {
  if (!isConfigured()) redirect("/login");
  const db = await createClient();
  const {
    data: { user },
    error,
  } = await db.auth.getUser();
  if (error || !user) redirect("/login");
  const [roleResult, profileResult] = await Promise.all([
    db.from("user_roles").select("role").eq("user_id", user.id).single(),
    db
      .from("profiles")
      .select("*, guardian_onboarding(*)")
      .eq("id", user.id)
      .single(),
  ]);
  const { data: r, error: roleError } = roleResult;
  if (roleError || !r || !["admin", "client"].includes(r.role))
    redirect("/login?error=role");
  const userRole = r.role as Role;
  const { data: profile, error: profileError } = profileResult;
  if (profileError || !profile)
    throw new Error("Nie udało się pobrać profilu. Spróbuj ponownie.");
  // No row is the permanent exemption for accounts present before migration 66.
  // A failed/malformed read must never become that exemption.
  const related = profile?.guardian_onboarding;
  const row = Array.isArray(related)
    ? related.length === 0
      ? null
      : related.length === 1
        ? related[0]
        : undefined
    : related;
  if (row === undefined)
    throw new Error("Nie udało się pobrać karty startu. Spróbuj ponownie.");
  const parsed = row === null ? null : OnboardingRecordSchema.safeParse(row);
  if (parsed && (!parsed.success || parsed.data.guardian_id !== user.id))
    throw new Error("Nie udało się pobrać karty startu. Spróbuj ponownie.");
  const onboarding = parsed?.success ? parsed.data : null;
  // Keep private answers out of the general profile DTO used by other modules.
  const { guardian_onboarding: privateBrief, ...contactProfile } = profile;
  void privateBrief;
  return { db, user, role: userRole, profile: contactProfile, onboarding };
});

export async function requireSession(role?: Role, complete = true) {
  const session = await verifiedSession();
  if (role && role !== session.role)
    redirect(session.role === "admin" ? "/admin" : "/app");
  const { profile } = session;
  if (complete && (!profile?.full_name || !profile?.phone || !profile?.area))
    redirect("/complete-profile");
  if (
    complete &&
    session.role === "client" &&
    session.onboarding &&
    !session.onboarding.completed_at
  )
    redirect("/onboarding");
  return session;
}
