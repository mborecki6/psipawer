import { getInvitation } from "@/modules/invitations/queries";
import { invitationDeliveryConfig } from "@/modules/invitations/config";
import { InvitationDetailView } from "@/modules/invitations/views";

export default async function InvitationDetail({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ page?: string }>;
}) {
  const [{ id }, query] = await Promise.all([params, searchParams]);
  const page =
    query.page && /^\d{1,5}$/.test(query.page)
      ? Math.max(1, Number(query.page))
      : 1;
  return (
    <InvitationDetailView
      {...await getInvitation(id, page)}
      page={page}
      enabled={Boolean(invitationDeliveryConfig())}
    />
  );
}
