import { requireSession } from "@/lib/auth/session";
import { getCommunityData } from "@/lib/data/community-queries";
import { communityTab } from "@/lib/community";
import { CommunityView } from "@/components/community";
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  await requireSession("client");
  return (
    <CommunityView
      data={await getCommunityData()}
      admin={false}
      tab={communityTab((await searchParams).tab, false)}
    />
  );
}
