import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
const m = vi.hoisted(() => ({
  create: vi.fn(),
  verify: vi.fn(),
  configured: vi.fn(() => true),
  redirect: vi.fn((url: string): never => {
    throw new Error(`REDIRECT:${url}`);
  }),
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/config", () => ({ isConfigured: m.configured }));
vi.mock("@/lib/supabase/server", () => ({ createClient: m.create }));
vi.mock("next/navigation", () => ({
  redirect: m.redirect,
  RedirectType: { replace: "replace" },
}));
vi.mock(
  "@/lib/auth/invitation-actions",
  async () => import("../src/lib/auth/invitation-actions"),
);
vi.mock("@/components/action-form", () => ({
  ActionForm: ({ children, label }: { children: ReactNode; label: string }) =>
    createElement("form", null, children, createElement("button", null, label)),
}));
import { invitationDeliveryConfig } from "../src/modules/invitations/config";
import { acceptInvitation } from "../src/lib/auth/invitation-actions";
import Invitation, { metadata } from "../src/app/auth/invitation/page";
import nextConfig from "../next.config";
const token = "a".repeat(64);
const form = () => {
  const f = new FormData();
  f.set("token_hash", token);
  return f;
};
beforeEach(() => {
  vi.clearAllMocks();
  m.configured.mockReturnValue(true);
  m.create.mockResolvedValue({ auth: { verifyOtp: m.verify } });
  m.verify.mockResolvedValue({
    data: { user: { id: "user" }, session: { access_token: "fake" } },
    error: null,
  });
  vi.stubEnv("AUTH_EMAIL_ENABLED", "true");
  vi.stubEnv("CLIENT_INVITATIONS_ENABLED", "true");
  vi.stubEnv("SUPABASE_SECRET_KEY", "local-test-only");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:54321");
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "http://localhost:3000");
});
afterEach(() => vi.unstubAllEnvs());
it("enables delivery only with both switches and a server key", () => {
  expect(invitationDeliveryConfig()?.origin).toBe("http://localhost:3000");
  for (const name of [
    "AUTH_EMAIL_ENABLED",
    "CLIENT_INVITATIONS_ENABLED",
    "SUPABASE_SECRET_KEY",
  ]) {
    const before = process.env[name];
    vi.stubEnv(name, "");
    expect(invitationDeliveryConfig()).toBeNull();
    vi.stubEnv(name, before!);
  }
});
it("rejects external origins, malformed or credentialed URLs even in production mode", () => {
  vi.stubEnv("NODE_ENV", "production");
  for (const variable of ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_APP_URL"]) {
    const before = process.env[variable];
    for (const value of [
      "https://project.supabase.co",
      "http://localhost.evil.test",
      "http://u:p@localhost",
      "http://localhost/path",
      "http://localhost?x=1",
      "http://localhost#x",
      "bad",
    ]) {
      vi.stubEnv(variable, value);
      expect(invitationDeliveryConfig()).toBeNull();
    }
    vi.stubEnv(variable, before!);
  }
});
it("does not consume tokens during GET/render, and never reveals a supplied redirect", async () => {
  const html = renderToStaticMarkup(
    await Invitation({ searchParams: Promise.resolve({ token_hash: token }) }),
  );
  expect(html).toContain("Przyjmij zaproszenie");
  expect(m.verify).not.toHaveBeenCalled();
  expect(m.create).not.toHaveBeenCalled();
  const invalid = renderToStaticMarkup(
    await Invitation({
      searchParams: Promise.resolve({
        token_hash: token,
        next: "https://evil.test",
      }),
    }),
  );
  expect(invalid).not.toContain('name="token_hash"');
  expect(invalid).not.toContain("https://evil.test");
});
it("verifies only invite tokens, then uses the fixed password-setting destination", async () => {
  await expect(acceptInvitation({}, form())).rejects.toThrow(
    "REDIRECT:/account/security?activated=1",
  );
  expect(m.verify).toHaveBeenCalledWith({ token_hash: token, type: "invite" });
  expect(m.redirect).toHaveBeenCalledWith(
    "/account/security?activated=1",
    "replace",
  );
});
it("rejects duplicate tokens, token type switching and browser-controlled redirects before Auth", async () => {
  for (const field of [
    "type",
    "redirect",
    "redirect_to",
    "redirectTo",
    "next",
    "code",
  ]) {
    const f = form();
    f.set(field, "forged");
    expect((await acceptInvitation({}, f)).error).toBeTruthy();
  }
  const f = form();
  f.append("token_hash", token);
  expect((await acceptInvitation({}, f)).error).toBeTruthy();
  expect(m.verify).not.toHaveBeenCalled();
});
it("keeps expired/used tokens and provider errors generic", async () => {
  m.verify.mockResolvedValueOnce({
    data: {},
    error: { message: "PRIVATE token" },
  });
  expect((await acceptInvitation({}, form())).error).not.toContain("PRIVATE");
  m.verify.mockRejectedValueOnce(new Error("PRIVATE token"));
  expect((await acceptInvitation({}, form())).error).not.toContain("PRIVATE");
  expect(m.redirect).not.toHaveBeenCalled();
});
it("configures private headers and a non-consuming email landing page", async () => {
  expect(metadata.referrer).toBe("no-referrer");
  const headers = await nextConfig.headers!();
  expect(
    headers.find((h) => h.source === "/auth/invitation")?.headers,
  ).toContainEqual({ key: "Cache-Control", value: "private, no-store" });
  const template = readFileSync("supabase/templates/invite.html", "utf8");
  expect(template).toContain(
    "{{ .SiteURL }}/auth/invitation?token_hash={{ .TokenHash }}",
  );
  expect(template).not.toContain(".ConfirmationURL");
});
