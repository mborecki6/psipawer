import { beforeEach, it, expect, vi } from "vitest";
const m = vi.hoisted(() => ({
  session: vi.fn(),
  rpc: vi.fn(),
  notFound: vi.fn((): never => {
    throw new Error("NOT_FOUND");
  }),
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/session", () => ({ requireSession: m.session }));
vi.mock("next/navigation", () => ({ notFound: m.notFound }));
import {
  getInvitation,
  getInvitations,
} from "../src/modules/invitations/queries";
const id = "17000000-0000-4000-8000-000000000001";
beforeEach(() => {
  vi.clearAllMocks();
  m.session.mockResolvedValue({ db: { rpc: m.rpc } });
  m.rpc.mockImplementation(async (name: string) => ({
    data: name.endsWith("detail")
      ? [{ id }]
      : Array.from({ length: 21 }, (_, n) => ({ id: String(n) })),
    error: null,
  }));
});
it("passes explicit archive and literal search filters while keeping the page bounded", async () => {
  const result = await getInvitations(2, true, "Test %_");
  expect(result.items).toHaveLength(20);
  expect(result.more).toBe(true);
  expect(m.rpc).toHaveBeenCalledWith("client_invitation_feed", {
    p_offset: 20,
    p_archived: true,
    p_search: "Test %_",
  });
  await getInvitations(1);
  expect(m.rpc).toHaveBeenLastCalledWith("client_invitation_feed", {
    p_offset: 0,
    p_archived: false,
    p_search: "",
  });
});
it("requires staff and returns one invitation with a bounded history page", async () => {
  const result = await getInvitation(id, 3);
  expect(m.session).toHaveBeenCalledWith("admin");
  expect(result).toMatchObject({ invitation: { id }, more: true });
  expect(result.attempts).toHaveLength(20);
  expect(m.rpc).toHaveBeenCalledWith("client_invitation_attempt_feed", {
    p_id: id,
    p_offset: 40,
  });
});
it("rejects malformed or missing IDs without presenting an empty invitation", async () => {
  await expect(getInvitation("invalid", 1)).rejects.toThrow("NOT_FOUND");
  expect(m.rpc).not.toHaveBeenCalled();
  m.rpc.mockResolvedValue({ data: [], error: null });
  await expect(getInvitation(id, 1)).rejects.toThrow("NOT_FOUND");
});
it("does not hide missing history behind a success or expose provider errors", async () => {
  m.rpc
    .mockResolvedValueOnce({ data: [{ id }], error: null })
    .mockResolvedValueOnce({ data: null, error: { message: "PRIVATE" } });
  await expect(getInvitation(id, 1)).rejects.toThrow(
    "Nie udało się pobrać historii zaproszenia.",
  );
});
it("does not query invitation details after failed authorization", async () => {
  m.session.mockRejectedValueOnce(new Error("denied"));
  await expect(getInvitation(id, 1)).rejects.toThrow("denied");
  expect(m.rpc).not.toHaveBeenCalled();
});
