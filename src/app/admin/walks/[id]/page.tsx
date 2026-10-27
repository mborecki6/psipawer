import { WalkDetail } from "@/components/walks";
import { WorkReturnLink } from "@/modules/work/return-link";
export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ returnTo?: string }>;
}) {
  return (
    <>
      <WorkReturnLink target={(await searchParams).returnTo} />
      <WalkDetail id={(await params).id} />
    </>
  );
}
