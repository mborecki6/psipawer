"use client";
import { useEffect, useRef, useState } from "react";
import { ActionForm } from "@/components/action-form";
import { ChatConsent } from "./entry";
import { changeChat, loadChat, sendChatMessage } from "./actions";
import { chatStates, type ChatSnapshot } from "./types";
import {
  freezeChatSubmission,
  mergeChatWindow,
  type ChatSubmission,
  type ChatWindow,
} from "./client-state";
import styles from "./chat.module.css";

export function ChatView({
  initial,
  requestId,
}: {
  initial: ChatSnapshot;
  requestId: string;
}) {
  const [snapshot, setSnapshot] = useState<ChatWindow>(initial);
  const [body, setBody] = useState("");
  const [request, setRequest] = useState(requestId);
  const [pending, setPending] = useState(false);
  const [submission, setSubmission] = useState<ChatSubmission | null>(null);
  const [error, setError] = useState("");
  const loading = useRef(false);
  const id = initial.chat.id;
  async function reload(before?: string) {
    if (loading.current) return;
    loading.current = true;
    try {
      const result = await loadChat(id, before);
      if ("error" in result) {
        setError(result.error);
        return;
      }
      setError("");
      setSnapshot((current) =>
        mergeChatWindow(current, result.data, Boolean(before)),
      );
    } catch {
      setError(
        "Nie udało się odświeżyć rozmowy. Sprawdź połączenie i spróbuj ponownie.",
      );
    } finally {
      loading.current = false;
    }
  }
  useEffect(() => {
    let stopped = false;
    const update = () => {
      if (!stopped && document.visibilityState === "visible") void reload();
    };
    const timer = window.setInterval(update, 20000);
    document.addEventListener("visibilitychange", update);
    return () => {
      stopped = true;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", update);
    };
    // Poll only this mounted conversation, with the latest state merged safely.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    setError("");
    const attempt = freezeChatSubmission(submission, request, body);
    setSubmission(attempt);
    try {
      const result = await sendChatMessage(id, attempt.requestId, attempt.body);
      if ("error" in result) {
        if (!result.uncertain) setSubmission(null);
        await reload();
        setError(result.error);
        return;
      }
      setBody("");
      setSubmission(null);
      setRequest(crypto.randomUUID());
      await reload();
    } catch {
      setError("Nie udało się potwierdzić wysłania. Ponów tę samą wiadomość.");
    } finally {
      setPending(false);
    }
  }
  const chat = snapshot.chat;
  return (
    <div className="stack">
      <p role="status">{chatStates[chat.state]}</p>
      {chat.state === "waiting_me" && chat.ownDog && chat.otherDog && (
        <ChatConsent
          from={chat.ownDog}
          to={chat.otherDog}
          label="Dołącz do rozmowy"
        />
      )}
      {chat.canStart && chat.ownDog && chat.otherDog && (
        <details>
          <summary>Rozpocznij nową rozmowę</summary>
          <p>
            Poprzednia pozostanie zamknięta. Oboje ponownie decydujecie o
            udziale.
          </p>
          <ChatConsent from={chat.ownDog} to={chat.otherDog} />
        </details>
      )}
      {chat.state === "active" && (
        <>
          {snapshot.historyReset && (
            <p role="status">
              Pod Twoją nieobecność pojawiło się wiele wiadomości. Pokazujemy
              najnowsze; wcześniejsze odczytasz przyciskiem „Starsze
              wiadomości”.
            </p>
          )}
          {snapshot.more && (
            <button
              type="button"
              className="ghost-button"
              onClick={() => void reload(snapshot.messages[0]?.id)}
            >
              Starsze wiadomości
            </button>
          )}
          <ol className={styles.messages} aria-label="Wiadomości rozmowy">
            {snapshot.messages.map((message) => (
              <li
                key={message.id}
                className={message.own ? styles.own : styles.other}
              >
                <div className={styles.meta}>
                  <strong>{message.own ? "Ty" : "Drugi opiekun"}</strong>
                  <time dateTime={message.created_at}>
                    {new Intl.DateTimeFormat("pl-PL", {
                      dateStyle: "short",
                      timeStyle: "short",
                      timeZone: "Europe/Warsaw",
                    }).format(new Date(message.created_at))}
                  </time>
                </div>
                <p>{message.body}</p>
              </li>
            ))}
          </ol>
          {!snapshot.messages.length && (
            <p className="muted">
              Nie ma jeszcze wiadomości. Możecie przywitać się i ustalić, o czym
              chcecie porozmawiać.
            </p>
          )}
          <form className="form-stack" onSubmit={submit}>
            <label className="field">
              <span>Twoja wiadomość</span>
              <textarea
                name="message"
                value={body}
                onChange={(event) => setBody(event.target.value)}
                required
                maxLength={2000}
                rows={4}
                disabled={pending}
                readOnly={Boolean(submission)}
              />
            </label>
            <button
              className="primary-button"
              disabled={pending || !body.trim()}
            >
              {pending
                ? "Wysyłam…"
                : submission
                  ? "Ponów tę samą wiadomość"
                  : "Wyślij wiadomość"}
            </button>
            {submission && !pending && (
              <p className="muted">
                Wysyłka nie została potwierdzona. Treść jest zachowana do
                bezpiecznego ponowienia; kolejną wiadomość napiszesz po
                potwierdzeniu.
              </p>
            )}
          </form>
        </>
      )}
      {error && <p role="alert">{error}</p>}
      <button
        type="button"
        className="ghost-button"
        onClick={() => void reload()}
      >
        Odśwież rozmowę
      </button>
      {["active", "waiting_me", "waiting_other"].includes(chat.state) && (
        <details>
          <summary>Ustawienia rozmowy</summary>
          <div className="stack">
            <ActionForm
              action={changeChat}
              label="Wycofaj zgodę"
              confirm="Wycofać zgodę i zamknąć dostęp do wiadomości dla obojga?"
            >
              <input type="hidden" name="id" value={id} />
              <input type="hidden" name="action" value="withdraw" />
            </ActionForm>
            <ActionForm
              action={changeChat}
              label="Zablokuj rozmowę"
              confirm="Zablokować rozmowę? Tylko Ty możesz cofnąć swoją blokadę."
            >
              <input type="hidden" name="id" value={id} />
              <input type="hidden" name="action" value="block" />
            </ActionForm>
          </div>
        </details>
      )}
      {chat.canUnblock && (
        <ActionForm action={changeChat} label="Cofnij własną blokadę">
          <input type="hidden" name="id" value={id} />
          <input type="hidden" name="action" value="unblock" />
        </ActionForm>
      )}
    </div>
  );
}
