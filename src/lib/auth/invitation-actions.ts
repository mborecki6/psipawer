"use server";
import { redirect, RedirectType } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { isConfigured } from "@/lib/supabase/config";
import type { ActionState } from "@/components/action-form";
export async function acceptInvitation(
  _: ActionState,
  form: FormData,
): Promise<ActionState> {
  const failure = {
    error:
      "Zaproszenie jest nieprawidłowe, wygasło lub zostało już wykorzystane. Otwórz najnowszą wiadomość albo poproś prowadzącą o nowy link.",
  };
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
    return failure;
  try {
    const db = await createClient();
    const { data, error } = await db.auth.verifyOtp({
      token_hash: token.data,
      type: "invite",
    });
    if (error || !data.user || !data.session) return failure;
  } catch {
    return failure;
  }
  redirect("/account/security?activated=1", RedirectType.replace);
}
