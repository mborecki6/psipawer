import { requireSession } from "@/lib/auth/session";
import { NewWalk } from "@/components/walks";
export default async function Page() {
  await requireSession("admin");
  return <NewWalk />;
}
