import "server-only";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isConfigured } from "@/lib/supabase/config";
export type Role = "admin" | "client";
export async function requireSession(role?: Role, complete = true) {
  if (!isConfigured()) redirect("/login");
  const db = await createClient();
  const {
    data: { user },
    error,
  } = await db.auth.getUser();
  if (error || !user) redirect("/login");
  const { data: r, error: roleError } = await db
    .from("user_roles")
    .select("role")
    .eq("user_id", user.id)
    .single();
  if (roleError || !r || !["admin", "client"].includes(r.role))
    redirect("/login?error=role");
  const userRole = r.role as Role;
  if (role && role !== userRole)
    redirect(userRole === "admin" ? "/admin" : "/app");
  const { data: profile, error: profileError } = await db
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .single();
  if (profileError)
    throw new Error("Nie udało się pobrać profilu. Spróbuj ponownie.");
  if (complete && (!profile?.full_name || !profile?.phone || !profile?.area))
    redirect("/complete-profile");
  return { db, user, role: userRole, profile };
}
