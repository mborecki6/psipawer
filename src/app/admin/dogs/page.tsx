import { DogsList } from "@/components/dogs";
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string }>;
}) {
  const p = await searchParams;
  return <DogsList query={p.q} status={p.status} />;
}
