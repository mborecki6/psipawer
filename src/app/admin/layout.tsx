export const dynamic = "force-dynamic";
import { requireSession } from "@/lib/auth/session";
import { Shell } from "@/components/shell";
export default async function Layout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { profile } = await requireSession("admin");
  return (
    <Shell role="admin" name={profile.full_name}>
      {children}
    </Shell>
  );
}
