import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  reset: vi.fn(),
  verify: vi.fn(),
  session: vi.fn(),
  configured: vi.fn(() => true),
  redirect: vi.fn((url: string): never => {
    throw new Error(`REDIRECT:${url}`);
  }),
}));
vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({
  redirect: mocks.redirect,
  RedirectType: { replace: "replace" },
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.createClient }));
vi.mock("@/lib/supabase/config", () => ({ isConfigured: mocks.configured }));
vi.mock("@/lib/auth/session", () => ({ requireSession: mocks.session }));
vi.mock("@/lib/auth/access-actions", () => ({ saveOwnPassword: vi.fn() }));
vi.mock(
  "@/lib/auth/email-config",
  async () => import("../src/lib/auth/email-config"),
);
vi.mock(
  "@/lib/auth/recovery-actions",
  async () => import("../src/lib/auth/recovery-actions"),
);
vi.mock("@/components/action-form", () => ({
  ActionForm: ({ children, label }: { children: ReactNode; label: string }) =>
    createElement("form", null, children, createElement("button", null, label)),
  Field: ({ name, type }: { name: string; type: string }) =>
    createElement("input", { name, type }),
}));

import { authEmailOrigin } from "../src/lib/auth/email-config";
import {
  requestPasswordRecovery,
  confirmPasswordRecovery,
} from "../src/lib/auth/recovery-actions";
import Recovery, { metadata } from "../src/app/auth/recovery/page";
import ForgotPassword from "../src/app/forgot-password/page";
import Security from "../src/app/account/security/page";
import nextConfig from "../next.config";

const token = "a".repeat(64);
function form(values: Record<string, string>) {
  const result = new FormData();
  for (const [key, value] of Object.entries(values)) result.set(key, value);
  return result;
}
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("NODE_ENV", "test");
  vi.stubEnv("AUTH_EMAIL_ENABLED", "true");
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "http://localhost:3000");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:54321");
  mocks.configured.mockReturnValue(true);
  mocks.createClient.mockResolvedValue({
    auth: { resetPasswordForEmail: mocks.reset, verifyOtp: mocks.verify },
  });
  mocks.reset.mockResolvedValue({ data: {}, error: null });
  mocks.verify.mockResolvedValue({
    data: {
      user: { id: "owner" },
      session: { access_token: "test-only-session" },
    },
    error: null,
  });
  mocks.redirect.mockImplementation((url: string): never => {
    throw new Error(`REDIRECT:${url}`);
  });
  mocks.session.mockResolvedValue({
    user: { id: "owner", email: "owner@example.test" },
    role: "client",
    profile: {
      full_name: "Osoba testowa",
      phone: "000000000",
      area: "Okolica",
    },
  });
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("password recovery: no enumeration, no GET consumption, fixed destinations", () => {
  it("requires an explicit switch and rejects a direct send request while unavailable", async () => {
    vi.stubEnv("AUTH_EMAIL_ENABLED", "false");
    expect(authEmailOrigin()).toBeNull();
    expect(renderToStaticMarkup(createElement(ForgotPassword))).not.toContain(
      'name="email"',
    );
    expect(
      await requestPasswordRecovery({}, form({ email: "owner@example.test" })),
    ).toHaveProperty("error");
    expect(mocks.createClient).not.toHaveBeenCalled();
  });

  it.each([
    "http://example.test",
    "https://user:password@example.test",
    "javascript:alert(1)",
    "http://localhost:3000/another/path",
    "http://localhost:3000?next=evil",
    "http://localhost:3000#fragment",
    "https://example.test",
    "not-a-url",
  ])("rejects an unsafe or mixed local/remote app origin: %s", (url) => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", url);
    expect(authEmailOrigin()).toBeNull();
  });

  it("accepts configured HTTPS outside development, but never a remote origin in development", () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://app.example.test");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://project.supabase.co");
    expect(authEmailOrigin()).toBe("https://app.example.test");
    vi.stubEnv("NODE_ENV", "development");
    expect(authEmailOrigin()).toBeNull();
  });

  it("sends only the validated email and the fixed configured return URL, never supplied redirects", async () => {
    const result = await requestPasswordRecovery(
      {},
      form({
        email: " owner@example.test ",
        redirectTo: "https://evil.test",
        type: "signup",
        role: "admin",
      }),
    );
    expect(result).toHaveProperty("success");
    expect(mocks.reset).toHaveBeenCalledExactlyOnceWith("owner@example.test", {
      redirectTo: "http://localhost:3000/auth/recovery",
    });
  });

  it("keeps the same response for success, unknown accounts, delivery errors, rate limits and network failures", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const input = form({ email: "owner@example.test" });
    const normal = await requestPasswordRecovery({}, input);
    for (const code of [
      "user_not_found",
      "email_address_not_authorized",
      "over_email_send_rate_limit",
      "unexpected_failure",
    ]) {
      mocks.reset.mockResolvedValueOnce({
        data: {},
        error: { code, message: `sensitive ${token}` },
      });
      expect(await requestPasswordRecovery({}, input)).toEqual(normal);
    }
    mocks.reset.mockRejectedValueOnce(new Error(`private data ${token}`));
    expect(await requestPasswordRecovery({}, input)).toEqual(normal);
    expect(
      warn.mock.calls.every(
        (call) =>
          JSON.stringify(call) === '["auth_recovery_request_unavailable"]',
      ),
    ).toBe(true);
  });

  it("rejects malformed and duplicate emails before requesting mail", async () => {
    for (const email of ["invalid", "", "a".repeat(260) + "@example.test"])
      expect(await requestPasswordRecovery({}, form({ email }))).toHaveProperty(
        "error",
      );
    const duplicate = form({ email: "owner@example.test" });
    duplicate.append("email", "someone@example.test");
    expect(await requestPasswordRecovery({}, duplicate)).toHaveProperty(
      "error",
    );
    expect(mocks.reset).not.toHaveBeenCalled();
  });

  it("GET renders a confirmation button without calling Auth or consuming the token", async () => {
    const markup = renderToStaticMarkup(
      await Recovery({ searchParams: Promise.resolve({ token_hash: token }) }),
    );
    expect(markup).toContain("Przejdź do zmiany hasła");
    expect(markup).toContain('name="token_hash"');
    expect(mocks.createClient).not.toHaveBeenCalled();
    expect(metadata.referrer).toBe("no-referrer");
  });

  it("rejects duplicate hashes, alternate OTP types, codes and redirect parameters in links and forms", async () => {
    for (const params of [
      {},
      { token_hash: "invalid" },
      { token_hash: [token, token] },
      ...["type", "next", "redirect", "redirectTo", "redirect_to", "code"].map(
        (key) => ({ token_hash: token, [key]: "unexpected" }),
      ),
    ]) {
      const markup = renderToStaticMarkup(
        await Recovery({ searchParams: Promise.resolve(params) }),
      );
      expect(markup).not.toContain('name="token_hash"');
      const data = new FormData();
      for (const [key, values] of Object.entries(params))
        for (const value of Array.isArray(values) ? values : [values])
          data.append(key, value);
      expect(await confirmPasswordRecovery({}, data)).toHaveProperty("error");
    }
    expect(mocks.verify).not.toHaveBeenCalled();
  });

  it("POST accepts only a recovery hash and removes it from the destination URL", async () => {
    await expect(
      confirmPasswordRecovery({}, form({ token_hash: token })),
    ).rejects.toThrow("REDIRECT:/account/security?recovered=1");
    expect(mocks.verify).toHaveBeenCalledExactlyOnceWith({
      token_hash: token,
      type: "recovery",
    });
    expect(mocks.redirect).toHaveBeenCalledWith(
      "/account/security?recovered=1",
      "replace",
    );
  });

  it("does not replace an existing session or redirect on an expired link, a missing session or a network error", async () => {
    for (const response of [
      {
        data: { user: null, session: null },
        error: { message: `expired ${token}` },
      },
      { data: { user: { id: "owner" }, session: null }, error: null },
    ]) {
      mocks.verify.mockResolvedValueOnce(response);
      const result = await confirmPasswordRecovery(
        {},
        form({ token_hash: token }),
      );
      expect(result.error).toContain("Zamów nowy link");
      expect(JSON.stringify(result)).not.toContain(token);
    }
    mocks.verify.mockRejectedValueOnce(new Error(token));
    expect(
      await confirmPasswordRecovery({}, form({ token_hash: token })),
    ).toHaveProperty("error");
    expect(mocks.redirect).not.toHaveBeenCalled();
  });

  it("honors disabled configuration on GET and POST without creating an auth client", async () => {
    mocks.configured.mockReturnValue(false);
    expect(
      renderToStaticMarkup(
        await Recovery({
          searchParams: Promise.resolve({ token_hash: token }),
        }),
      ),
    ).not.toContain('name="token_hash"');
    expect(
      await confirmPasswordRecovery({}, form({ token_hash: token })),
    ).toHaveProperty("error");
    expect(mocks.createClient).not.toHaveBeenCalled();
  });

  it("shows the verified account before a password change and directs completed users to their panel", async () => {
    const markup = renderToStaticMarkup(
      await Security({ searchParams: Promise.resolve({ recovered: "1" }) }),
    );
    expect(mocks.session).toHaveBeenCalledWith(undefined, false);
    expect(markup).toContain("owner@example.test");
    expect(markup).toContain('name="password"');
    const done = renderToStaticMarkup(
      await Security({ searchParams: Promise.resolve({ updated: "1" }) }),
    );
    expect(done).toContain("Hasło zostało zapisane");
    expect(done).toContain('href="/app"');
    expect(done).not.toContain('name="password"');
  });

  it("configures private, non-indexed, no-referrer recovery pages and a confirmation-page email template", async () => {
    const headers = await nextConfig.headers!();
    for (const source of [
      "/auth/recovery",
      "/forgot-password",
      "/account/security",
    ])
      expect(headers.find((h) => h.source === source)?.headers).toEqual(
        expect.arrayContaining([
          { key: "Cache-Control", value: "private, no-store" },
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "X-Robots-Tag", value: "noindex, nofollow, noarchive" },
        ]),
      );
    const template = readFileSync("supabase/templates/recovery.html", "utf8");
    expect(template).toContain(
      "{{ .SiteURL }}/auth/recovery?token_hash={{ .TokenHash }}",
    );
    expect(template).not.toContain(".ConfirmationURL");
    expect(readFileSync("supabase/config.toml", "utf8")).toContain(
      "[auth.email.template.recovery]",
    );
  });
});
