import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ session: vi.fn(), rpc: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ requireSession: mocks.session }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("server-only", () => ({}));
import {
  loadChat,
  sendChatMessage,
} from "../src/modules/community-chat/actions";
const chat = "16000000-0000-4000-8000-000000000001",
  request = "26000000-0000-4000-8000-000000000001",
  message = "36000000-0000-4000-8000-000000000001";
beforeEach(() => {
  vi.resetAllMocks();
  mocks.session.mockResolvedValue({ db: { rpc: mocks.rpc }, role: "client" });
});
it("does not freeze a deterministically rejected invalid draft", async () => {
  expect(await sendChatMessage(chat, request, "   ")).toMatchObject({
    uncertain: false,
  });
  expect(await sendChatMessage(chat, request, "x".repeat(2001))).toMatchObject({
    uncertain: false,
  });
  expect(mocks.rpc).not.toHaveBeenCalled();
});
it("distinguishes definite SQL rejection from an unacknowledged transport outcome", async () => {
  mocks.rpc.mockResolvedValueOnce({
    error: { message: "PRIVATE" },
    status: 400,
  });
  expect(await sendChatMessage(chat, request, "Text")).toMatchObject({
    uncertain: false,
  });
  mocks.rpc.mockResolvedValueOnce({
    error: { message: "PRIVATE" },
    status: 503,
  });
  expect(await sendChatMessage(chat, request, "Text")).toMatchObject({
    uncertain: true,
  });
  mocks.rpc.mockRejectedValueOnce(new Error("PRIVATE"));
  const result = await sendChatMessage(chat, request, "Text");
  expect(result).toMatchObject({ uncertain: true });
  expect(JSON.stringify(result)).not.toContain("PRIVATE");
});
it("acknowledges the SQL message ID and transmits the exact request identity", async () => {
  mocks.rpc.mockResolvedValue({ data: message, error: null, status: 200 });
  expect(await sendChatMessage(chat, request, " Text ")).toEqual({
    success: true,
  });
  expect(mocks.rpc).toHaveBeenCalledWith("send_community_chat_message", {
    p_chat: chat,
    p_request: request,
    p_body: "Text",
  });
});
it("clears history if access is lost between state lookup and the older page", async () => {
  mocks.rpc
    .mockResolvedValueOnce({ data: { id: chat, state: "active" }, error: null })
    .mockResolvedValueOnce({ data: null, error: { message: "PRIVATE" } })
    .mockResolvedValueOnce({
      data: { id: chat, state: "access_lost" },
      error: null,
    });
  expect(await loadChat(chat, message)).toEqual({
    data: {
      chat: { id: chat, state: "access_lost", canUnblock: false },
      messages: [],
      more: false,
    },
  });
  expect(mocks.rpc).toHaveBeenNthCalledWith(2, "community_chat_messages_page", {
    p_chat: chat,
    p_before: message,
  });
});
it("returns a private-safe error for failed state retrieval and can retry", async () => {
  mocks.rpc.mockRejectedValueOnce(new Error("PRIVATE"));
  const result = await loadChat(chat);
  expect(result).toHaveProperty("error");
  expect(JSON.stringify(result)).not.toContain("PRIVATE");
  mocks.rpc.mockResolvedValueOnce({
    data: { id: chat, state: "withdrawn" },
    error: null,
  });
  expect(await loadChat(chat)).toMatchObject({
    data: { messages: [], chat: { state: "withdrawn" } },
  });
});
