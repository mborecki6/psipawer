"use server";

import { revalidatePath } from "next/cache";
import type { ActionState } from "@/components/action-form";
import { requireSession } from "@/lib/auth/session";
import { profileSchema } from "@/lib/validation/schemas";

export async function updateOwnProfile(
  _: ActionState,
  form: FormData,
): Promise<ActionState> {
  const { db, user, role } = await requireSession(undefined, false);
  const result = profileSchema.safeParse({
    full_name: form.get("full_name"),
    phone: form.get("phone"),
    area: form.get("area"),
  });
  if (!result.success)
    return {
      error: "Sprawdź dane profilu.",
      fields: result.error.flatten().fieldErrors,
    };

  try {
    const { data, error } = await db
      .from("profiles")
      .update(result.data)
      .eq("id", user.id)
      .select("id")
      .single();
    if (error || !data)
      return { error: "Nie udało się zapisać profilu. Spróbuj ponownie." };
  } catch {
    return { error: "Nie udało się zapisać profilu. Spróbuj ponownie." };
  }

  revalidatePath("/profile");
  revalidatePath(role === "admin" ? "/admin" : "/app", "layout");
  return { success: "Zmiany w profilu zostały zapisane." };
}
