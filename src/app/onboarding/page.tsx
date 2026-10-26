import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth/session";
import { Onboarding } from "@/modules/onboarding/views";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Wasz start — Psi Pawer",
  robots: { index: false, follow: false, nocache: true },
};

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ edit?: string }>;
}) {
  const { profile, onboarding } = await requireSession("client", false);
  if (!profile?.full_name || !profile?.phone || !profile?.area)
    redirect("/complete-profile");
  if (!onboarding) redirect("/app");
  const params = await searchParams;
  return <Onboarding record={onboarding} edit={params.edit === "1"} />;
}
