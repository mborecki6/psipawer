import "server-only";
import { requireSession } from "@/lib/auth/session";
import { notFound } from "next/navigation";
import { z } from "zod";
import type { Invitation, InvitationAttempt } from "./types";
export async function getInvitations(
  page: number,
  archived = false,
  search = "",
) {
  const { db } = await requireSession("admin");
  const { data, error } = await db.rpc("client_invitation_feed", {
    p_offset: (page - 1) * 20,
    p_archived: archived,
    p_search: search,
  });
  if (error || !data) throw new Error("Nie udało się pobrać zaproszeń.");
  return { items: data.slice(0, 20) as Invitation[], more: data.length > 20 };
}
export async function getInvitation(id: string, page: number) {
  const { db } = await requireSession("admin");
  if (!z.uuid().safeParse(id).success) notFound();
  const [detail, history] = await Promise.all([
    db.rpc("client_invitation_detail", { p_id: id }),
    db.rpc("client_invitation_attempt_feed", {
      p_id: id,
      p_offset: (page - 1) * 20,
    }),
  ]);
  if (detail.error || history.error || !detail.data || !history.data)
    throw new Error("Nie udało się pobrać historii zaproszenia.");
  if (!detail.data.length) notFound();
  return {
    invitation: detail.data[0] as Invitation,
    attempts: history.data.slice(0, 20) as InvitationAttempt[],
    more: history.data.length > 20,
  };
}
