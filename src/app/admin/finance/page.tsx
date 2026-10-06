import { requireSession } from "@/lib/auth/session";
import { getFinanceData } from "@/lib/data/finance-queries";
import { FinanceView } from "@/components/finance";
import type { FinanceSearch } from "@/lib/finance-pagination";

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<FinanceSearch>;
}) {
  await requireSession("admin");
  const data = await getFinanceData();
  const search = await searchParams;
  return (
    <FinanceView
      data={data}
      admin
      dueOnly={search.filter === "due"}
      search={search}
    />
  );
}
