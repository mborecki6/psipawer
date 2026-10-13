"use server";
import { z } from "zod";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/auth/session";
import type { ActionState } from "@/components/action-form";
import { chatSnapshot } from "./queries";
import type { ChatSnapshot } from "./types";
export async function joinChat(
  _: ActionState,
  form: FormData,
): Promise<ActionState> {
  const { db, role } = await requireSession();
  const parsed = z
    .object({ from: z.uuid(), to: z.uuid(), consent: z.literal("yes") })
    .safeParse({
      from: form.get("from_dog_id"),
      to: form.get("to_dog_id"),
      consent: form.get("consent"),
    });
  if (!parsed.success)
    return { error: "Wybierz własnego psa i potwierdź udział w rozmowie." };
  let id: string;
  try {
    const result = await db.rpc("join_community_chat", {
      p_from_dog: parsed.data.from,
      p_to_dog: parsed.data.to,
      p_consent: true,
    });
    if (result.error || !z.uuid().safeParse(result.data).success)
      return {
        error:
          "Rozmowa jest niedostępna. Sprawdź aktualne zainteresowania, wizytówki i blokady.",
      };
    id = result.data;
  } catch {
    return { error: "Nie udało się zapisać zgody. Spróbuj ponownie." };
  }
  revalidatePath("/app/community");
  revalidatePath("/admin/community");
  redirect(`${role === "admin" ? "/admin" : "/app"}/community/chat/${id}`);
}
export async function changeChat(
  _: ActionState,
  form: FormData,
): Promise<ActionState> {
  const { db } = await requireSession();
  const parsed = z
    .object({ id: z.uuid(), action: z.enum(["withdraw", "block", "unblock"]) })
    .safeParse({ id: form.get("id"), action: form.get("action") });
  if (!parsed.success) return { error: "Wybierz zmianę rozmowy." };
  try {
    const result = await db.rpc("change_community_chat", {
      p_chat: parsed.data.id,
      p_action: parsed.data.action,
    });
    if (result.error)
      return { error: "Nie udało się zmienić rozmowy. Odśwież jej stan." };
  } catch {
    return { error: "Nie udało się zapisać zmiany. Spróbuj ponownie." };
  }
  revalidatePath("/app/community", "layout");
  revalidatePath("/admin/community", "layout");
  return { success: "Ustawienie rozmowy zapisane." };
}
export async function loadChat(
  id: string,
  before?: string,
): Promise<{ data: ChatSnapshot } | { error: string }> {
  try {
    return { data: await chatSnapshot(id, before) };
  } catch {
    return {
      error:
        "Nie udało się odświeżyć rozmowy. Sprawdź połączenie i spróbuj ponownie.",
    };
  }
}
export async function sendChatMessage(
  id: string,
  requestId: string,
  body: string,
): Promise<{ success: true } | { error: string; uncertain: boolean }> {
  const { db } = await requireSession();
  const parsed = z
    .object({
      id: z.uuid(),
      requestId: z.uuid(),
      body: z
        .string()
        .trim()
        .min(1)
        .max(2000)
        .refine((value) => Buffer.byteLength(value, "utf8") <= 8000),
    })
    .safeParse({ id, requestId, body });
  if (!parsed.success)
    return { error: "Wpisz wiadomość od 1 do 2000 znaków.", uncertain: false };
  try {
    const result = await db.rpc("send_community_chat_message", {
      p_chat: parsed.data.id,
      p_request: parsed.data.requestId,
      p_body: parsed.data.body,
    });
    if (result.error || !z.uuid().safeParse(result.data).success)
      return {
        error:
          "Nie udało się wysłać. Rozmowa mogła zostać zamknięta; po wielu wiadomościach odczekaj minutę.",
        uncertain: !(
          result.error &&
          result.status >= 400 &&
          result.status < 500
        ),
      };
    return { success: true };
  } catch {
    return {
      error:
        "Nie udało się potwierdzić wysłania. Możesz bezpiecznie ponowić tę samą wiadomość.",
      uncertain: true,
    };
  }
}
