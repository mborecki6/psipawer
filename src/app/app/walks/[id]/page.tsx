import { WalkDetail } from "@/components/walks";
export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  return <WalkDetail id={(await params).id} />;
}
