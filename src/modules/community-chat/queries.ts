import "server-only";
import { z } from "zod";
import { requireSession } from "@/lib/auth/session";
import type { ChatMessage, ChatSnapshot, ChatState } from "./types";
const stateSchema = z.object({
  id: z.uuid(),
  state: z.enum([
    "active",
    "waiting_me",
    "waiting_other",
    "withdrawn",
    "blocked",
    "access_lost",
    "unavailable",
  ]),
  ownDog: z.uuid().optional(),
  otherDog: z.uuid().optional(),
  canUnblock: z.boolean().nullable().optional(),
  canStart: z.boolean().optional(),
});
export async function chatSnapshot(
  id: string,
  before?: string,
): Promise<ChatSnapshot> {
  const { db } = await requireSession();
  if (
    !z.uuid().safeParse(id).success ||
    (before && !z.uuid().safeParse(before).success)
  )
    throw new Error("Nieprawidłowa rozmowa lub strona.");
  const state = await db.rpc("community_chat_state", { p_chat: id });
  const parsed = stateSchema.safeParse(state.data);
  if (state.error || !parsed.success)
    throw new Error("Nie udało się sprawdzić rozmowy.");
  const chat = {
    ...parsed.data,
    canUnblock: Boolean(parsed.data.canUnblock),
  } as ChatState;
  if (chat.state !== "active") return { chat, messages: [], more: false };
  const page = await db.rpc("community_chat_messages_page", {
    p_chat: id,
    p_before: before || null,
  });
  if (page.error || !Array.isArray(page.data)) {
    const latest = await db.rpc("community_chat_state", { p_chat: id });
    const current = stateSchema.safeParse(latest.data);
    if (!latest.error && current.success && current.data.state !== "active")
      return {
        chat: {
          ...current.data,
          canUnblock: Boolean(current.data.canUnblock),
        } as ChatState,
        messages: [],
        more: false,
      };
    throw new Error("Nie udało się pobrać wiadomości.");
  }
  return {
    chat,
    messages: (page.data.slice(0, 30) as ChatMessage[]).reverse(),
    more: page.data.length > 30,
  };
}
