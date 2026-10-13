import type { ChatSnapshot } from "./types";

export type ChatWindow = ChatSnapshot & { historyReset?: boolean };

/** Keep a continuous range. A latest page with no overlap cannot bridge a gap. */
export function mergeChatWindow(
  current: ChatWindow,
  incoming: ChatSnapshot,
  older = false,
): ChatWindow {
  if (incoming.chat.state !== "active") return incoming;
  const incomingIds = new Set(incoming.messages.map((message) => message.id));
  const overlaps = current.messages.some((message) =>
    incomingIds.has(message.id),
  );
  if (!older && (!overlaps || !incoming.more)) {
    return {
      ...incoming,
      historyReset: incoming.more && current.messages.length > 0 && !overlaps,
    };
  }
  const messages = new Map(
    [...current.messages, ...incoming.messages].map((message) => [
      message.id,
      message,
    ]),
  );
  return {
    ...incoming,
    messages: [...messages.values()].sort(
      (a, b) =>
        a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id),
    ),
    more: older ? incoming.more : current.more,
    historyReset: older ? false : current.historyReset,
  };
}

export type ChatSubmission = { requestId: string; body: string };

/** An unacknowledged request always retries its original identity and content. */
export function freezeChatSubmission(
  pending: ChatSubmission | null,
  requestId: string,
  draft: string,
): ChatSubmission {
  return pending ?? { requestId, body: draft.trim() };
}
