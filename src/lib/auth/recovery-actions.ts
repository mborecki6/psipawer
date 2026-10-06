"use server";

import { redirect, RedirectType } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { isConfigured } from "@/lib/supabase/config";
import type { ActionState } from "@/components/action-form";
import { authEmailOrigin } from "./email-config";

const recoveryError =
  "Link jest nieprawidłowy, wygasł lub został już wykorzystany. Zamów nowy link do zmiany hasła.";
const requestMessage =
  "Jeśli dla tego adresu istnieje konto, otrzymasz wiadomość z linkiem do zmiany hasła. Sprawdź skrzynkę i folder spam. Jeśli wiadomość nie dotrze, spróbuj później lub skontaktuj się z prowadzącą.";

export async function requestPasswordRecovery(
  _: ActionState,
  form: FormData,
): Promise<ActionState> {
  const email = z
    .string()
    .trim()
    .pipe(z.email().max(254))
    .safeParse(form.get("email"));
  if (!email.success || form.getAll("email").length !== 1)
    return {
      error: "Podaj poprawny adres e-mail.",
      fields: { email: ["Sprawdź adres e-mail."] },
    };
  const origin = authEmailOrigin();
  if (!origin)
    return {
      error:
        "Odzyskiwanie hasła przez e-mail nie jest jeszcze dostępne. Poproś prowadzącą o jednorazowy link dostępu.",
    };
  try {
    const db = await createClient();
    const { error } = await db.auth.resetPasswordForEmail(email.data, {
      redirectTo: `${origin}/auth/recovery`,
    });
    // All provider outcomes receive the same response: an SMTP error for an
    // existing address must not distinguish it from a nonexistent account.
    if (error) console.warn("auth_recovery_request_unavailable");
  } catch {
    console.warn("auth_recovery_request_unavailable");
  }
  return { success: requestMessage };
}

export async function confirmPasswordRecovery(
  _: ActionState,
  form: FormData,
): Promise<ActionState> {
  const token = z
    .string()
    .regex(/^[A-Za-z0-9_-]{32,256}$/)
    .safeParse(form.get("token_hash"));
  if (
    !token.success ||
    form.getAll("token_hash").length !== 1 ||
    ["type", "redirect", "redirect_to", "redirectTo", "next", "code"].some(
      (key) => form.has(key),
    ) ||
    !isConfigured()
  )
    return { error: recoveryError };
  try {
    const db = await createClient();
    const { data, error } = await db.auth.verifyOtp({
      token_hash: token.data,
      type: "recovery",
    });
    if (error || !data.user || !data.session) return { error: recoveryError };
  } catch {
    // Tokens, full URLs, credentials and provider responses are never logged.
    return { error: recoveryError };
  }
  redirect("/account/security?recovered=1", RedirectType.replace);
}
