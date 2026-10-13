import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { requireSession } from "@/lib/auth/session";
export default async function ControlInvitationPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const { db } = await requireSession("admin");
  const { data, error } = await db
    .from("care_control_invitations")
    .select("dog_id,plan_id")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error("Nie udało się pobrać zaproszenia.");
  if (!data) notFound();
  redirect(`/admin/dogs/${data.dog_id}/care?plan=${data.plan_id}`);
}
