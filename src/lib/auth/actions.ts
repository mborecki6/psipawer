"use server";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isConfigured } from "@/lib/supabase/config";
import { requireSession } from "./session";
import { emailSchema, profileSchema } from "@/lib/validation/schemas";
import type { ActionState } from "@/components/action-form";
export async function signIn(
  _: ActionState,
  form: FormData,
): Promise<ActionState> {
  const result = emailSchema.safeParse(Object.fromEntries(form));
  if (!result.success) return { error: result.error.issues[0].message };
  if (!isConfigured())
    return { error: "Logowanie nie jest jeszcze skonfigurowane." };
  const db = await createClient();
  const origin = process.env.NEXT_PUBLIC_APP_URL;
  if (!origin)
    return { error: "Brakuje adresu aplikacji. Skontaktuj się z prowadzącą." };
  const { error } = await db.auth.signInWithOtp({
    email: result.data.email,
    options: { emailRedirectTo: `${origin}/auth/callback` },
  });
  if (error)
    return { error: "Nie udało się wysłać linku. Spróbuj ponownie za chwilę." };
  return {
    success:
      "Sprawdź skrzynkę i folder spam. Jeśli adres jest prawidłowy, otrzymasz link do logowania.",
  };
}
export async function saveProfile(
  _: ActionState,
  form: FormData,
): Promise<ActionState> {
  const { db, user, role } = await requireSession(undefined, false);
  const result = profileSchema.safeParse(Object.fromEntries(form));
  if (!result.success)
    return {
      error: "Sprawdź dane profilu.",
      fields: result.error.flatten().fieldErrors,
    };
  const { error } = await db
    .from("profiles")
    .update(result.data)
    .eq("id", user.id);
  if (error) return { error: "Nie udało się zapisać profilu." };
  redirect(role === "admin" ? "/admin" : "/app");
}
export async function signOut() {
  const { db } = await requireSession(undefined, false);
  await db.auth.signOut();
  redirect("/login");
}
