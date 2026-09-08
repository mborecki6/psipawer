import { requireSession } from "@/lib/auth/session";
import { getFinanceData } from "@/lib/data/finance-queries";
import { FinanceView } from "@/components/finance";

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string }>;
}) {
  await requireSession("admin");
  const data = await getFinanceData();
  return (
    <FinanceView
      data={data}
      admin
      dueOnly={(await searchParams).filter === "due"}
    />
  );
}
