import { randomUUID } from "node:crypto";
import { z } from "zod";
import { getInvitations } from "@/modules/invitations/queries";
import { invitationDeliveryConfig } from "@/modules/invitations/config";
import { InvitationsView } from "@/modules/invitations/views";
export default async function Invitations({
  searchParams,
}: {
  searchParams: Promise<{
    page?: string;
    saved?: string;
    archived?: string;
    q?: string;
  }>;
}) {
  const p = await searchParams;
  const page =
    p.page && /^\d{1,5}$/.test(p.page) ? Math.max(1, Number(p.page)) : 1;
  const archived = p.archived === "1";
  const search = typeof p.q === "string" ? p.q.trim().slice(0, 254) : "";
  return (
    <InvitationsView
      {...await getInvitations(page, archived, search)}
      archived={archived}
      search={search}
      page={page}
      draftId={randomUUID()}
      saved={z.uuid().safeParse(p.saved).success}
      enabled={Boolean(invitationDeliveryConfig())}
    />
  );
}
