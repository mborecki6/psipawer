import { afterEach, describe, expect, it, vi } from "vitest";
import { config, isConfigured } from "../src/lib/supabase/config";

afterEach(() => vi.unstubAllEnvs());
describe("local development isolation", () => {
  it.each([
    "https://project.supabase.co",
    "http://localhost.evil.test",
    "http://user:password@localhost",
    "file:///tmp/db",
    "invalid",
  ])("blocks %s before creating a client", (url) => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", url);
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "public-test-key");
    expect(isConfigured()).toBe(false);
    expect(() => config()).toThrow("Połączenie z chmurą jest wyłączone");
  });
  it.each([
    "http://localhost:54321",
    "http://127.0.0.1:54321",
    "http://[::1]:54321",
  ])("allows the local stack at %s", (url) => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", url);
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "public-test-key");
    expect(config().url).toBe(url);
  });
  it("does not change the deployed application's environment rules", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://project.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "public-test-key");
    expect(isConfigured()).toBe(true);
  });
});
