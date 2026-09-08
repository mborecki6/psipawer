"use server";

import { redirect, RedirectType } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { isConfigured } from "@/lib/supabase/config";
import { requireSession } from "./session";
import type { ActionState } from "@/components/action-form";

const accessSchema = z.string().regex(/^[A-Za-z0-9_-]{32,256}$/);
const accessError =
  "Nie udało się otworzyć konta. Link mógł wygasnąć lub zostać wykorzystany. Poproś o nowy link dostępu.";
const signInError =
  "Nie udało się zalogować. Sprawdź e-mail i hasło lub spróbuj ponownie za chwilę.";

export async function activateAccess(
  _: ActionState,
  form: FormData,
): Promise<ActionState> {
  const token = accessSchema.safeParse(form.get("token_hash"));
  if (
    !token.success ||
    form.getAll("token_hash").length !== 1 ||
    ["type", "redirect", "redirect_to", "redirectTo", "next"].some((key) =>
      form.has(key),
    ) ||
    !isConfigured()
  )
    return { error: accessError };
  try {
    const db = await createClient();
    const { data, error } = await db.auth.verifyOtp({
      token_hash: token.data,
      type: "magiclink",
    });
    if (error || !data.user || !data.session) return { error: accessError };
  } catch {
    // Authentication responses can contain credentials. Keep errors generic
    // and never log the token, response or request URL.
    return { error: accessError };
  }
  redirect("/account/security?activated=1", RedirectType.replace);
}

export async function signInWithPassword(
  _: ActionState,
  form: FormData,
): Promise<ActionState> {
  const parsed = z
    .object({
      email: z.string().trim().pipe(z.email().max(254)),
      password: z.string().min(1).max(128),
    })
    .safeParse(Object.fromEntries(form));
  if (!parsed.success || !isConfigured()) return { error: signInError };
  try {
    const db = await createClient();
    const { data, error } = await db.auth.signInWithPassword(parsed.data);
    if (error || !data.user || !data.session) return { error: signInError };
  } catch {
    return { error: signInError };
  }
  const { role, profile } = await requireSession(undefined, false);
  if (!profile?.full_name || !profile?.phone || !profile?.area)
    redirect("/complete-profile");
  redirect(role === "admin" ? "/admin" : "/app");
}

export async function saveOwnPassword(
  _: ActionState,
  form: FormData,
): Promise<ActionState> {
  const { db } = await requireSession(undefined, false);
  const parsed = z
    .object({
      password: z.string().min(12).max(128),
      confirm_password: z.string().min(12).max(128),
    })
    .refine((values) => values.password === values.confirm_password)
    .safeParse(Object.fromEntries(form));
  if (!parsed.success)
    return {
      error:
        "Wpisz identyczne hasło w obu polach. Powinno mieć od 12 do 128 znaków.",
    };
  try {
    // Identity comes exclusively from the verified current session. No user
    // identifier, email, role or other profile change is accepted from the form.
    const { data, error } = await db.auth.updateUser({
      password: parsed.data.password,
    });
    if (error || !data.user)
      return {
        error:
          "Nie udało się ustawić hasła. Wybierz inne hasło lub zaloguj się ponownie i spróbuj jeszcze raz.",
      };
  } catch {
    return {
      error:
        "Nie udało się ustawić hasła. Zaloguj się ponownie i spróbuj jeszcze raz.",
    };
  }
  redirect("/complete-profile");
}
