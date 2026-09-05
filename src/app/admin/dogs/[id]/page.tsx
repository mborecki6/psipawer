import { DogDetail } from "@/components/dogs";
export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ saved?: string }>;
}) {
  return (
    <DogDetail id={(await params).id} saved={(await searchParams).saved} />
  );
}
