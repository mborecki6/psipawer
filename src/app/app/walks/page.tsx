import { WalksList } from "@/components/walks";
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string }>;
}) {
  return <WalksList filter={(await searchParams).filter} />;
}
