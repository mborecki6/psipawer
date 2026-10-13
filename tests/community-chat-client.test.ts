import { describe, expect, it } from "vitest";
import {
  freezeChatSubmission,
  mergeChatWindow,
} from "../src/modules/community-chat/client-state";
import type { ChatSnapshot } from "../src/modules/community-chat/types";
const chat: ChatSnapshot["chat"] = { id: "chat", state: "active" };
const page = (from: number, to: number, more = from > 1): ChatSnapshot => ({
  chat,
  messages: Array.from({ length: to - from + 1 }, (_, offset) => {
    const n = from + offset;
    return {
      id: String(n),
      body: `Message ${n}`,
      own: false,
      created_at: new Date(n * 1000).toISOString(),
    };
  }),
  more,
});
describe("continuous chat history", () => {
  it("bridges a short refresh while preserving loaded history and its cursor", () => {
    const current = mergeChatWindow(page(31, 60), page(1, 30), true);
    const refreshed = mergeChatWindow(current, page(36, 65));
    expect(refreshed.messages.map((m) => m.id)).toEqual(
      page(1, 65).messages.map((m) => m.id),
    );
    expect(refreshed.more).toBe(false);
  });
  it("resets after 40 unseen messages so pagination reaches the missing middle", () => {
    const refreshed = mergeChatWindow(page(1, 30, false), page(41, 70));
    expect(refreshed.historyReset).toBe(true);
    expect(refreshed.messages[0].id).toBe("41");
    expect(refreshed.more).toBe(true);
    const older = mergeChatWindow(refreshed, page(11, 40), true);
    const complete = mergeChatWindow(older, page(1, 10, false), true);
    expect(complete.messages.map((m) => m.id)).toEqual(
      page(1, 70).messages.map((m) => m.id),
    );
    expect(complete.more).toBe(false);
    expect(complete.historyReset).toBe(false);
  });
  it("immediately clears private history after access loss on any page", () => {
    for (const older of [false, true]) {
      const closed: ChatSnapshot = {
        chat: { ...chat, state: "access_lost" },
        messages: [],
        more: false,
      };
      expect(mergeChatWindow(page(1, 60), closed, older)).toEqual(closed);
    }
  });
});
describe("unacknowledged chat submission", () => {
  it("retries the frozen request and body even if a draft or candidate ID changes", () => {
    const first = freezeChatSubmission(null, "request-1", "  Original text  ");
    const retry = freezeChatSubmission(first, "request-2", "Different text");
    expect(retry).toBe(first);
    expect(retry).toEqual({ requestId: "request-1", body: "Original text" });
    // Only acknowledgement clears the stored attempt; the following send can
    // then carry a new identity and text without duplicating the lost response.
    expect(freezeChatSubmission(null, "request-2", "Different text")).toEqual({
      requestId: "request-2",
      body: "Different text",
    });
  });
});
