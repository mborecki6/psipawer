import Link from "next/link";
import { requireSession } from "@/lib/auth/session";
import { chatSnapshot } from "./queries";
import { ChatView } from "./view";
export async function CommunityChatPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { role } = await requireSession();
  const { id } = await params;
  const initial = await chatSnapshot(id);
  const base = role === "admin" ? "/admin" : "/app";
  return (
    <div className="stack">
      <Link href={`${base}/community?tab=interests`}>
        ← Moje propozycje Psiutków
      </Link>
      <header>
        <h2>Rozmowa opiekunów</h2>
        <p className="muted">
          Wiadomości są dostępne uczestnikom, gdy oboje wyrażają zgodę. Nie
          udostępniamy automatycznie telefonu ani e-maila.
        </p>
      </header>
      <ChatView
        key={`${id}:${initial.chat.state}:${initial.chat.canUnblock}`}
        initial={initial}
        requestId={crypto.randomUUID()}
      />
    </div>
  );
}
