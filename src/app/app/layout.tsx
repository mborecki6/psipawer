export const dynamic = "force-dynamic";
import { requireSession } from "@/lib/auth/session";
import { Shell } from "@/components/shell";
export default async function Layout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { profile } = await requireSession("client");
  return (
    <Shell role="client" name={profile.full_name}>
      {children}
    </Shell>
  );
}
