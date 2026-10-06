import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isConfigured } from "@/lib/supabase/config";
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
    db.from("profiles").select("*").eq("id", user.id).single(),
  ]);
  const { data: r, error: roleError } = roleResult;
  if (roleError || !r || !["admin", "client"].includes(r.role))
    redirect("/login?error=role");
  const userRole = r.role as Role;
  const { data: profile, error: profileError } = profileResult;
  if (profileError)
    throw new Error("Nie udało się pobrać profilu. Spróbuj ponownie.");
  return { db, user, role: userRole, profile };
});

export async function requireSession(role?: Role, complete = true) {
  const session = await verifiedSession();
  if (role && role !== session.role)
    redirect(session.role === "admin" ? "/admin" : "/app");
  const { profile } = session;
  if (complete && (!profile?.full_name || !profile?.phone || !profile?.area))
    redirect("/complete-profile");
  return session;
}
