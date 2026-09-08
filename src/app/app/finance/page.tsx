import { requireSession } from "@/lib/auth/session";
import { getFinanceData } from "@/lib/data/finance-queries";
import { FinanceView } from "@/components/finance";

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string }>;
}) {
  await requireSession("client");
  return (
    <FinanceView
      data={await getFinanceData()}
      admin={false}
      dueOnly={(await searchParams).filter === "due"}
    />
  );
}
