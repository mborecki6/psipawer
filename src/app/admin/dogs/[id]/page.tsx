import { DogDetail } from "@/components/dogs";
import { WorkReturnLink } from "@/modules/work/return-link";
export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ saved?: string; returnTo?: string }>;
}) {
  const search = await searchParams;
  return (
    <>
      <WorkReturnLink target={search.returnTo} />
      <DogDetail id={(await params).id} saved={search.saved} />
    </>
  );
}
