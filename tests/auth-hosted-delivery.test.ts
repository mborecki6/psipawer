import { afterEach, beforeEach, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/config", () => ({ isConfigured: () => true }));
import {
  authEmailDelivery,
  authEmailOrigin,
} from "../src/lib/auth/email-config";
import { invitationDeliveryConfig } from "../src/modules/invitations/config";

beforeEach(() => {
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("VERCEL", "1");
  vi.stubEnv("VERCEL_ENV", "production");
  vi.stubEnv("AUTH_EMAIL_ENABLED", "true");
  vi.stubEnv("AUTH_EMAIL_HOSTED_ENABLED", "true");
  vi.stubEnv("AUTH_EMAIL_APP_ORIGIN", "https://app.example.test");
  vi.stubEnv("CLIENT_INVITATIONS_ENABLED", "true");
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://app.example.test");
  vi.stubEnv(
    "NEXT_PUBLIC_SUPABASE_URL",
    "https://abcdefghijklmnopqrst.supabase.co",
  );
  vi.stubEnv("SUPABASE_SECRET_KEY", "hosted-test-only-key");
});
afterEach(() => vi.unstubAllEnvs());

it("prepares hosted Auth and invitations for one deliberate production origin", () => {
  expect(authEmailDelivery()).toEqual({
    origin: "https://app.example.test",
    databaseOrigin: "https://abcdefghijklmnopqrst.supabase.co",
    mode: "smtp",
  });
  expect(invitationDeliveryConfig()).toMatchObject({
    origin: "https://app.example.test",
    url: "https://abcdefghijklmnopqrst.supabase.co",
    mode: "smtp",
    key: "hosted-test-only-key",
  });
});
it.each([
  ["AUTH_EMAIL_ENABLED", "false"],
  ["AUTH_EMAIL_HOSTED_ENABLED", "false"],
  ["AUTH_EMAIL_APP_ORIGIN", "https://other.example.test"],
  ["AUTH_EMAIL_APP_ORIGIN", "https://app.example.test/path"],
  ["NODE_ENV", "development"],
  ["NODE_ENV", "test"],
  ["VERCEL_ENV", "preview"],
  ["NEXT_PUBLIC_APP_URL", "http://app.example.test"],
  ["NEXT_PUBLIC_APP_URL", "https://u:password@app.example.test"],
  ["NEXT_PUBLIC_APP_URL", "https://app.example.test?next=elsewhere"],
  [
    "NEXT_PUBLIC_SUPABASE_URL",
    "https://abcdefghijklmnopqrst.supabase.co.evil.test",
  ],
  ["NEXT_PUBLIC_SUPABASE_URL", "https://abcdefghijklmnopqrst.supabase.co/path"],
  ["NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:54321"],
])(
  "blocks mixed/unsafe or unapproved hosted configuration: %s",
  (key, value) => {
    vi.stubEnv(key, value);
    expect(authEmailOrigin()).toBeNull();
    expect(invitationDeliveryConfig()).toBeNull();
  },
);
it("separately disables new invitations without disabling account recovery", () => {
  vi.stubEnv("CLIENT_INVITATIONS_ENABLED", "false");
  expect(invitationDeliveryConfig()).toBeNull();
  expect(authEmailOrigin()).toBe("https://app.example.test");
});
it("requires the private server key for invitations but never returns it from public email settings", () => {
  expect(JSON.stringify(authEmailDelivery())).not.toContain(
    "hosted-test-only-key",
  );
  vi.stubEnv("SUPABASE_SECRET_KEY", "");
  expect(invitationDeliveryConfig()).toBeNull();
});
it("keeps the local mailbox explicit and impossible to select in a hosted deployment", () => {
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "http://localhost:3000");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:54321");
  expect(authEmailDelivery()).toBeNull();
  vi.stubEnv("VERCEL", "");
  vi.stubEnv("VERCEL_ENV", "");
  vi.stubEnv("AUTH_EMAIL_HOSTED_ENABLED", "false");
  expect(authEmailDelivery()?.mode).toBe("local");
});
