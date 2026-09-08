import { beforeEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

const mocks = vi.hoisted(() => ({
  verifyOtp: vi.fn(),
  signInWithPassword: vi.fn(),
  updateUser: vi.fn(),
  createClient: vi.fn(),
  requireSession: vi.fn(),
  redirect: vi.fn((path: string): never => {
    throw new Error(`REDIRECT:${path}`);
  }),
  isConfigured: vi.fn(() => true),
}));

vi.mock("next/navigation", () => ({
  redirect: mocks.redirect,
  RedirectType: { replace: "replace", push: "push" },
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.createClient }));
vi.mock("@/lib/supabase/config", () => ({ isConfigured: mocks.isConfigured }));
vi.mock("../src/lib/auth/session", () => ({
  requireSession: mocks.requireSession,
}));
vi.mock("@/components/action-form", () => ({
  ActionForm: ({
    children,
    label,
  }: {
    children: React.ReactNode;
    label: string;
  }) =>
    createElement("form", null, children, createElement("button", null, label)),
  Field: ({ name, type }: { name: string; type: string }) =>
    createElement("input", { name, type }),
}));
vi.mock(
  "@/lib/auth/access-actions",
  async () => import("../src/lib/auth/access-actions"),
);

import {
  activateAccess,
  signInWithPassword,
  saveOwnPassword,
} from "../src/lib/auth/access-actions";
import Access, { metadata } from "../src/app/auth/access/page";
import Login from "../src/app/login/page";

const token = "a".repeat(64);
const form = (values: Record<string, string>) => {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
};
const authSuccess = {
  data: {
    user: { id: "current-user" },
    session: { access_token: "mock-session" },
  },
  error: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.isConfigured.mockReturnValue(true);
  const db = {
    auth: {
      verifyOtp: mocks.verifyOtp,
      signInWithPassword: mocks.signInWithPassword,
      updateUser: mocks.updateUser,
    },
  };
  mocks.createClient.mockResolvedValue(db);
  mocks.verifyOtp.mockResolvedValue(authSuccess);
  mocks.signInWithPassword.mockResolvedValue(authSuccess);
  mocks.updateUser.mockResolvedValue({
    data: { user: { id: "current-user" } },
    error: null,
  });
  mocks.requireSession.mockResolvedValue({
    db,
    role: "admin",
    profile: {
      full_name: "Osoba testowa",
      phone: "000000000",
      area: "Okolica",
    },
  });
});

describe("one-time access and own-account passwords", () => {
  it("GET renders a confirmation button without consuming the token or creating an auth client", async () => {
    const element = await Access({
      searchParams: Promise.resolve({ token_hash: token }),
    });
    const markup = renderToStaticMarkup(element);
    expect(markup).toContain("Otwórz konto i ustaw hasło");
    expect(markup).toContain('name="token_hash"');
    expect(mocks.createClient).not.toHaveBeenCalled();
    expect(mocks.verifyOtp).not.toHaveBeenCalled();
    expect(metadata.referrer).toBe("no-referrer");
    expect(metadata.robots).toEqual({
      index: false,
      follow: false,
      nocache: true,
    });
  });

  it("rejects malformed, duplicated and externally redirected activation links without verifying them", async () => {
    for (const params of [
      {},
      { token_hash: "invalid" },
      { token_hash: [token, token] },
      { token_hash: token, next: "https://example.com" },
    ]) {
      const markup = renderToStaticMarkup(
        await Access({ searchParams: Promise.resolve(params) }),
      );
      expect(markup).not.toContain('name="token_hash"');
    }
    const invalidForms: Record<string, string>[] = [
      { token_hash: "invalid" },
      { token_hash: token, type: "recovery" },
      { token_hash: token, redirect_to: "https://example.com" },
    ];
    for (const extra of invalidForms) {
      expect(await activateAccess({}, form(extra))).toHaveProperty("error");
    }
    const duplicate = form({ token_hash: token });
    duplicate.append("token_hash", token);
    expect(await activateAccess({}, duplicate)).toHaveProperty("error");
    expect(mocks.verifyOtp).not.toHaveBeenCalled();
  });

  it("POST verifies exactly a magic-link hash and redirects to fixed password setup", async () => {
    await expect(
      activateAccess({}, form({ token_hash: token })),
    ).rejects.toThrow("REDIRECT:/account/security?activated=1");
    expect(mocks.verifyOtp).toHaveBeenCalledExactlyOnceWith({
      token_hash: token,
      type: "magiclink",
    });
    expect(mocks.redirect).toHaveBeenCalledWith(
      "/account/security?activated=1",
      "replace",
    );
  });

  it("offers password login without exposing the unavailable email sending form", async () => {
    const markup = renderToStaticMarkup(
      await Login({ searchParams: Promise.resolve({}) }),
    );
    expect(markup.match(/<input[^>]+name="password"[^>]*>/)?.[0]).toContain(
      'type="password"',
    );
    expect(markup).toContain("Zaloguj się");
    expect(markup).toContain("Potrzebujesz linku dostępu?");
    expect(markup).not.toContain("Wyślij link do logowania");
    expect(mocks.createClient).not.toHaveBeenCalled();
  });

  it("does not redirect after an expired token or a response without a session", async () => {
    for (const response of [
      {
        data: { user: null, session: null },
        error: { code: "otp_expired", message: "Sensitive provider details" },
      },
      { data: { user: { id: "user" }, session: null }, error: null },
    ]) {
      mocks.verifyOtp.mockResolvedValueOnce(response);
      const result = await activateAccess({}, form({ token_hash: token }));
      expect(result.error).toContain("Poproś o nowy link dostępu");
      expect(JSON.stringify(result)).not.toContain(
        "Sensitive provider details",
      );
      expect(JSON.stringify(result)).not.toContain(token);
    }
    expect(mocks.redirect).not.toHaveBeenCalled();
  });

  it("returns the same password-login error for invalid credentials, unconfirmed email and rate limits", async () => {
    const results = [];
    for (const code of [
      "invalid_credentials",
      "email_not_confirmed",
      "over_request_rate_limit",
    ]) {
      mocks.signInWithPassword.mockResolvedValueOnce({
        data: { user: null, session: null },
        error: { code, status: code === "over_request_rate_limit" ? 429 : 400 },
      });
      results.push(
        await signInWithPassword(
          {},
          form({ email: "test@example.com", password: "not-a-real-password" }),
        ),
      );
    }
    expect(results[0]).toEqual(results[1]);
    expect(results[1]).toEqual(results[2]);
    expect(mocks.requireSession).not.toHaveBeenCalled();
    expect(mocks.redirect).not.toHaveBeenCalled();
  });

  it("routes password login using the verified role and profile, never a supplied destination", async () => {
    await expect(
      signInWithPassword(
        {},
        form({
          email: " test@example.com ",
          password: "not-a-real-password",
          next: "https://example.com",
          role: "client",
        }),
      ),
    ).rejects.toThrow("REDIRECT:/admin");
    expect(mocks.signInWithPassword).toHaveBeenCalledWith({
      email: "test@example.com",
      password: "not-a-real-password",
    });
    expect(mocks.requireSession).toHaveBeenCalledWith(undefined, false);
    mocks.requireSession.mockResolvedValueOnce({
      role: "client",
      profile: { full_name: "", phone: null, area: null },
    });
    await expect(
      signInWithPassword(
        {},
        form({ email: "test@example.com", password: "not-a-real-password" }),
      ),
    ).rejects.toThrow("REDIRECT:/complete-profile");
  });

  it("requires a current verified session before setting a password", async () => {
    mocks.requireSession.mockRejectedValueOnce(new Error("REDIRECT:/login"));
    await expect(
      saveOwnPassword(
        {},
        form({
          password: "not-a-real-password",
          confirm_password: "not-a-real-password",
        }),
      ),
    ).rejects.toThrow("REDIRECT:/login");
    expect(mocks.updateUser).not.toHaveBeenCalled();
  });

  it("validates password length and confirmation without sending invalid credentials to Auth", async () => {
    for (const values of [
      { password: "short", confirm_password: "short" },
      { password: "x".repeat(129), confirm_password: "x".repeat(129) },
      {
        password: "not-a-real-password",
        confirm_password: "a-different-password",
      },
    ]) {
      expect(await saveOwnPassword({}, form(values))).toHaveProperty("error");
    }
    expect(mocks.updateUser).not.toHaveBeenCalled();
  });

  it("updates only the current user's password, ignores identity fields, then continues to their profile", async () => {
    await expect(
      saveOwnPassword(
        {},
        form({
          password: "not-a-real-password",
          confirm_password: "not-a-real-password",
          user_id: "someone-else",
          email: "someone@example.com",
          role: "admin",
        }),
      ),
    ).rejects.toThrow("REDIRECT:/complete-profile");
    expect(mocks.updateUser).toHaveBeenCalledExactlyOnceWith({
      password: "not-a-real-password",
    });
  });
});
