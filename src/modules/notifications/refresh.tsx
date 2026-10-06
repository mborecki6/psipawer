"use client";
import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";
export function RefreshInbox() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <button
      className="ghost-button"
      disabled={pending}
      onClick={() => startTransition(() => router.refresh())}
    >
      <RefreshCw size={16} aria-hidden="true" />
      {pending ? "Odświeżam…" : "Odśwież"}
    </button>
  );
}
