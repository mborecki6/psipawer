import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({
  session: vi.fn(),
  rpc: vi.fn(),
  provider: vi.fn(),
  send: vi.fn(),
  finish: vi.fn(),
  config: vi.fn(),
  refresh: vi.fn(),
  redirect: vi.fn((url: string): never => {
    throw new Error(`REDIRECT:${url}`);
  }),
}));
vi.mock("@/lib/auth/session", () => ({ requireSession: m.session }));
vi.mock("next/cache", () => ({ revalidatePath: m.refresh }));
vi.mock("next/navigation", () => ({ redirect: m.redirect }));
vi.mock("../src/modules/invitations/config", () => ({
  invitationDeliveryConfig: m.config,
}));
vi.mock("../src/modules/invitations/delivery", () => ({
  invitationDeliveryClient: m.provider,
}));
import {
  prepareInvitation,
  sendInvitation,
  setInvitationArchive,
} from "../src/modules/invitations/actions";
const id = "17000000-0000-4000-8000-000000000001";
function form(extra: Record<string, string> = {}) {
  const f = new FormData();
  for (const [k, v] of Object.entries({
    id,
    version: "1",
    name: "Opiekun Test",
    email: "owner@example.test",
    ...extra,
  }))
    f.set(k, v);
  return f;
}
beforeEach(() => {
  vi.clearAllMocks();
  m.session.mockResolvedValue({ db: { rpc: m.rpc } });
  m.config.mockReturnValue({
    origin: "http://localhost:3000",
    url: "http://127.0.0.1:54321",
    key: "test-only-secret",
  });
  m.provider.mockReturnValue({
    auth: { admin: { inviteUserByEmail: m.send } },
    rpc: m.finish,
  });
  m.rpc.mockResolvedValue({ data: "db-recipient@example.test", error: null });
  m.send.mockResolvedValue({
    data: { user: { id: "recipient" } },
    error: null,
  });
  m.finish.mockResolvedValue({ data: true, error: null });
});
it.each(["true", "false"])(
  "changes archive state %s without using Auth or the email adapter",
  async (archived) => {
    m.rpc.mockResolvedValue({ data: 2, error: null });
    await expect(setInvitationArchive({}, form({ archived }))).rejects.toThrow(
      `REDIRECT:/admin/invitations/${id}`,
    );
    expect(m.session).toHaveBeenCalledWith("admin");
    expect(m.rpc).toHaveBeenCalledWith("set_client_invitation_archived", {
      p_id: id,
      p_expected_version: 1,
      p_archived: archived === "true",
    });
    expect(m.send).not.toHaveBeenCalled();
    expect(m.provider).not.toHaveBeenCalled();
    expect(m.refresh).toHaveBeenCalledWith(`/admin/invitations/${id}`);
  },
);
it("rejects malformed archive flags and surfaces only safe conflict messages", async () => {
  expect(
    (await setInvitationArchive({}, form({ archived: "yes" }))).error,
  ).toContain("Odśwież");
  expect(m.rpc).not.toHaveBeenCalled();
  m.rpc.mockResolvedValueOnce({
    data: null,
    error: { message: "Zaproszenie zmieniło się. Odśwież widok przed zmianą." },
  });
  expect(
    (await setInvitationArchive({}, form({ archived: "true" }))).error,
  ).toContain("zmieniło się");
  m.rpc.mockRejectedValueOnce(new Error("PRIVATE"));
  expect(
    (await setInvitationArchive({}, form({ archived: "true" }))).error,
  ).toContain("Nie udało się potwierdzić");
  expect(m.redirect).not.toHaveBeenCalled();
});
it("does not send archived invitations even when a stale form has an eligible version", async () => {
  m.rpc.mockResolvedValueOnce({
    data: null,
    error: {
      message: "To zaproszenie jest w archiwum. Przywróć je przed wysłaniem.",
    },
  });
  expect((await sendInvitation({}, form())).error).toContain("Przywróć");
  expect(m.provider).not.toHaveBeenCalled();
});
it("prepares with session authorization and no provider call, then redirects outside the error handler", async () => {
  m.rpc.mockResolvedValue({ data: id, error: null });
  await expect(prepareInvitation({}, form({ role: "admin" }))).rejects.toThrow(
    `REDIRECT:/admin/invitations?saved=${id}`,
  );
  expect(m.session).toHaveBeenCalledWith("admin");
  expect(m.rpc).toHaveBeenCalledWith("prepare_client_invitation", {
    p_id: id,
    p_email: "owner@example.test",
    p_name: "Opiekun Test",
  });
  expect(m.provider).not.toHaveBeenCalled();
  expect(m.send).not.toHaveBeenCalled();
});
it("rejects invalid preparation and hides unrecognized database errors", async () => {
  expect(
    (await prepareInvitation({}, form({ email: "bad" }))).error,
  ).toBeTruthy();
  expect(m.rpc).not.toHaveBeenCalled();
  m.rpc.mockResolvedValue({ data: null, error: { message: "PRIVATE" } });
  expect((await prepareInvitation({}, form())).error).not.toContain("PRIVATE");
});
it("requires local delivery to be configured before claiming or sending", async () => {
  m.config.mockReturnValue(null);
  expect((await sendInvitation({}, form())).error).toContain("wyłączona");
  expect(m.rpc).not.toHaveBeenCalled();
  expect(m.provider).not.toHaveBeenCalled();
});
it("uses the claimed database recipient and fixed destination, never browser email, role or redirect", async () => {
  expect(
    (
      await sendInvitation(
        {},
        form({
          email: "forged@example.test",
          role: "admin",
          redirectTo: "https://evil.test",
        }),
      )
    ).success,
  ).toContain("Serwer przyjął");
  expect(m.rpc).toHaveBeenCalledWith("claim_client_invitation", {
    p_id: id,
    p_expected_version: 1,
    p_attempt: expect.any(String),
  });
  const attempt = m.rpc.mock.calls[0][1].p_attempt;
  expect(m.send).toHaveBeenCalledWith("db-recipient@example.test", {
    redirectTo: "http://localhost:3000/auth/invitation",
  });
  expect(m.finish).toHaveBeenCalledWith("finish_client_invitation", {
    p_id: id,
    p_attempt: attempt,
    p_outcome: "sent",
    p_error: null,
  });
  expect(m.refresh).toHaveBeenCalledWith(`/admin/invitations/${id}`);
});
it("does not send after a stale claim or a claim response lost over the network", async () => {
  m.rpc.mockResolvedValueOnce({
    data: null,
    error: { message: "Odśwież zaproszenie przed wysłaniem." },
  });
  expect((await sendInvitation({}, form())).error).toContain("Odśwież");
  m.rpc.mockRejectedValueOnce(new Error("PRIVATE"));
  expect((await sendInvitation({}, form())).error).not.toContain("PRIVATE");
  expect(m.send).not.toHaveBeenCalled();
});
it.each([408, 500, 503])(
  "keeps HTTP %s outcomes uncertain without retrying the provider",
  async (status) => {
    m.send.mockResolvedValue({
      data: { user: null },
      error: { status, message: "PRIVATE" },
    });
    const result = await sendInvitation({}, form());
    expect(result.error).toContain("mogła trafić");
    expect(JSON.stringify(result)).not.toContain("PRIVATE");
    expect(m.send).toHaveBeenCalledTimes(1);
    expect(m.finish.mock.calls[0][1]).toMatchObject({
      p_outcome: "uncertain",
      p_error: "unknown_result",
    });
  },
);
it("classifies explicit rejection and rate limiting while preserving safe error codes", async () => {
  m.send.mockResolvedValueOnce({
    data: { user: null },
    error: { status: 429 },
  });
  expect((await sendInvitation({}, form())).error).toContain("ograniczył");
  expect(m.finish.mock.calls[0][1]).toMatchObject({
    p_outcome: "failed",
    p_error: "rate_limited",
  });
  m.send.mockResolvedValueOnce({
    data: { user: null },
    error: { status: 422 },
  });
  expect((await sendInvitation({}, form())).error).toContain("nie przyjął");
});
it("does not claim success if the acknowledgment is lost, even after provider acceptance", async () => {
  m.finish.mockRejectedValueOnce(new Error("PRIVATE"));
  expect((await sendInvitation({}, form())).error).toContain(
    "Nie można potwierdzić",
  );
  expect(m.send).toHaveBeenCalledTimes(1);
});
it("keeps a thrown network failure uncertain and refuses a malformed or unauthorized request", async () => {
  m.send.mockRejectedValueOnce(new Error("PRIVATE secret"));
  expect((await sendInvitation({}, form())).error).toContain("mogła trafić");
  m.rpc.mockClear();
  expect((await sendInvitation({}, form({ id: "bad" }))).error).toBeTruthy();
  expect(m.rpc).not.toHaveBeenCalled();
  m.session.mockRejectedValueOnce(new Error("denied"));
  await expect(sendInvitation({}, form())).rejects.toThrow("denied");
});
