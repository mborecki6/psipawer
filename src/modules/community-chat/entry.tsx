import Link from "next/link";
import { ActionForm } from "@/components/action-form";
import { joinChat } from "./actions";
import type { ChatState } from "./types";
export function ChatConsent({
  from,
  to,
  label = "Włącz rozmowę",
}: {
  from: string;
  to: string;
  label?: string;
}) {
  return (
    <ActionForm action={joinChat} label={label}>
      <input type="hidden" name="from_dog_id" value={from} />
      <input type="hidden" name="to_dog_id" value={to} />
      <label className="field">
        <span>
          <input type="checkbox" name="consent" value="yes" required /> Chcę
          rozmawiać z drugim opiekunem w Psiutkach. Mogę wycofać zgodę lub
          zablokować rozmowę.
        </span>
      </label>
    </ActionForm>
  );
}
export function ChatEntry({
  from,
  to,
  chat,
  base,
}: {
  from: string;
  to: string;
  chat?: ChatState;
  base: string;
}) {
  if (chat)
    return (
      <Link className="ghost-button" href={`${base}/community/chat/${chat.id}`}>
        {chat.state === "active"
          ? "Otwórz rozmowę"
          : chat.state === "waiting_me"
            ? "Zaproszenie do rozmowy"
            : chat.state === "waiting_other"
              ? "Rozmowa — czekamy na zgodę"
              : "Sprawdź stan rozmowy"}
      </Link>
    );
  return (
    <details>
      <summary>Rozmowa z drugim opiekunem</summary>
      <div className="stack">
        <p>
          Po zgodzie obojga możecie napisać do siebie tutaj. Numery telefonów i
          adresy e-mail nie są udostępniane.
        </p>
        <ChatConsent from={from} to={to} />
      </div>
    </details>
  );
}
