import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import {
  assertTpayConfig,
  loadTpayConfig,
  TPAY_SANDBOX_API_ORIGIN,
  TPAY_LIVE_API_ORIGIN,
  TPAY_LIVE_CHECKOUT_ORIGIN,
} from "../src/modules/payments/config";

const local = {
  TPAY_ENABLED: "true",
  TPAY_MODE: "sandbox",
  TPAY_CLIENT_ID: "test-client",
  TPAY_CLIENT_SECRET: "synthetic-secret",
  TPAY_MERCHANT_ID: "12345",
  NEXT_PUBLIC_APP_URL: "http://127.0.0.1:3000",
  NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
};

const hosted = {
  ...local,
  TPAY_HOSTED_ENABLED: "true",
  TPAY_APP_ORIGIN: "https://psy.example",
  TPAY_SECURITY_CODE: "",
  NEXT_PUBLIC_APP_URL: "https://psy.example",
  NEXT_PUBLIC_SUPABASE_URL: "https://project.supabase.co",
};
const live = {
  ...hosted,
  TPAY_MODE: "live",
  TPAY_LIVE_ENABLED: "true",
  NODE_ENV: "production",
};

describe("explicit Tpay environment configuration", () => {
  it("requires explicit environment and credentials, separately from new checkouts", () => {
    expect(loadTpayConfig({})).toBeNull();
    for (const key of Object.keys(local).filter(
      (key) => key !== "TPAY_ENABLED",
    ))
      expect(loadTpayConfig({ ...local, [key]: undefined })).toBeNull();
    for (const TPAY_ENABLED of [undefined, "false", "1", "true"])
      expect(loadTpayConfig({ ...local, TPAY_ENABLED })).not.toBeNull();
  });

  it("accepts only a local sandbox and keeps secret fields server side", () => {
    const config = loadTpayConfig(local)!;
    expect(config).toMatchObject({
      mode: "sandbox",
      appOrigin: local.NEXT_PUBLIC_APP_URL,
      supabaseOrigin: local.NEXT_PUBLIC_SUPABASE_URL,
      apiOrigin: TPAY_SANDBOX_API_ORIGIN,
    });
    expect(Object.isFrozen(config)).toBe(true);
    expect(() => assertTpayConfig(config)).not.toThrow();
  });

  it.each(["live", "production", "test", "simulator"])(
    "rejects non-sandbox mode %s",
    (mode) => {
      expect(loadTpayConfig({ ...local, TPAY_MODE: mode })).toBeNull();
    },
  );

  it.each(["VERCEL", "VERCEL_ENV", "VERCEL_URL"])(
    "blocks hosted deployment marker %s",
    (key) => {
      expect(loadTpayConfig({ ...local, [key]: "production" })).toBeNull();
    },
  );

  it.each([
    "TPAY_API_URL",
    "TPAY_API_ORIGIN",
    "TPAY_API_BASE_URL",
    "TPAY_BASE_URL",
  ])("does not permit a configurable provider base %s", (key) => {
    expect(
      loadTpayConfig({ ...local, [key]: "https://api.tpay.com" }),
    ).toBeNull();
  });

  it.each([
    "https://project.supabase.co",
    "https://psy.example",
    "http://localhost.evil.test",
    "http://127.0.0.1@evil.test",
    "http://evil@localhost",
    "http://localhost/path",
    "http://localhost?query=1",
    "http://localhost#hash",
    "ftp://localhost",
  ])("rejects hosted or ambiguous application/database location %s", (url) => {
    expect(loadTpayConfig({ ...local, NEXT_PUBLIC_APP_URL: url })).toBeNull();
    expect(
      loadTpayConfig({ ...local, NEXT_PUBLIC_SUPABASE_URL: url }),
    ).toBeNull();
  });

  it.each([
    "http://localhost:3000",
    "https://127.0.0.1:3000/",
    "http://[::1]:3000",
  ])("accepts loopback %s", (url) => {
    expect(
      loadTpayConfig({ ...local, NEXT_PUBLIC_APP_URL: url }),
    ).not.toBeNull();
  });

  it("distinguishes an explicit empty confirmation code from a missing code", () => {
    expect(loadTpayConfig(local)?.securityCode).toBeUndefined();
    expect(
      loadTpayConfig({ ...local, TPAY_SECURITY_CODE: "" })?.securityCode,
    ).toBe("");
  });

  it("defends transport against a forged configuration", () => {
    const config = loadTpayConfig(local)!;
    expect(() =>
      assertTpayConfig({
        ...config,
        apiOrigin: "https://api.tpay.com" as typeof config.apiOrigin,
      }),
    ).toThrow();
    expect(() =>
      assertTpayConfig({
        ...config,
        supabaseOrigin: "https://project.supabase.co",
      }),
    ).toThrow();
  });

  it("prepares hosted sandbox with a fixed HTTPS callback without enabling live", () => {
    const config = loadTpayConfig({ ...hosted, VERCEL_ENV: "preview" })!;
    expect(config).toMatchObject({
      mode: "sandbox",
      deployment: "hosted",
      notificationUrl: "https://psy.example/api/payments/tpay/notification",
    });
    expect(() => assertTpayConfig(config)).not.toThrow();
    expect(
      loadTpayConfig({ ...hosted, TPAY_HOSTED_ENABLED: undefined }),
    ).toBeNull();
    expect(
      loadTpayConfig({ ...hosted, TPAY_APP_ORIGIN: undefined }),
    ).toBeNull();
    expect(
      loadTpayConfig({ ...hosted, TPAY_APP_ORIGIN: "https://other.example" }),
    ).toBeNull();
    expect(
      loadTpayConfig({ ...hosted, TPAY_SECURITY_CODE: undefined }),
    ).toBeNull();
  });

  it("prepares live only with a separate explicit production contract", () => {
    const config = loadTpayConfig(live)!;
    expect(config).toMatchObject({
      mode: "live",
      apiOrigin: TPAY_LIVE_API_ORIGIN,
      checkoutOrigin: TPAY_LIVE_CHECKOUT_ORIGIN,
    });
    expect(() => assertTpayConfig(config)).not.toThrow();
    expect(loadTpayConfig({ ...live, TPAY_ENABLED: "false" })).not.toBeNull();
    for (const change of [
      { TPAY_LIVE_ENABLED: undefined },
      { TPAY_LIVE_ENABLED: "false" },
      { TPAY_HOSTED_ENABLED: undefined },
      { NODE_ENV: "development" },
      { NODE_ENV: "test" },
      { NODE_ENV: undefined },
      { VERCEL_ENV: "preview" },
      { VERCEL_ENV: "development" },
      { VERCEL: "1" },
      { NEXT_PUBLIC_APP_URL: local.NEXT_PUBLIC_APP_URL },
      { NEXT_PUBLIC_SUPABASE_URL: local.NEXT_PUBLIC_SUPABASE_URL },
    ])
      expect(loadTpayConfig({ ...live, ...change })).toBeNull();
    expect(
      loadTpayConfig({ ...live, VERCEL: "1", VERCEL_ENV: "production" }),
    ).not.toBeNull();
    expect(
      loadTpayConfig({
        ...local,
        TPAY_MODE: "live",
        TPAY_LIVE_ENABLED: "true",
        NODE_ENV: "production",
      }),
    ).toBeNull();
  });

  it.each([
    "http://psy.example",
    "https://localhost",
    "https://127.0.0.1",
    "https://[::1]",
    "https://10.0.0.1",
    "https://psy.local",
    "https://service.internal",
    "https://psy.example:444",
    "https://psy.example/path",
    "https://psy.example?query=1",
    "https://evil@psy.example",
    "https://psy.example#hash",
    "https://psy.example/\\evil",
  ])("rejects insecure or ambiguous hosted origin %s", (origin) => {
    expect(
      loadTpayConfig({
        ...hosted,
        TPAY_APP_ORIGIN: origin,
        NEXT_PUBLIC_APP_URL: origin,
      }),
    ).toBeNull();
    expect(
      loadTpayConfig({ ...hosted, NEXT_PUBLIC_SUPABASE_URL: origin }),
    ).toBeNull();
  });

  it.each([
    { clientId: "x".repeat(1025) },
    { clientSecret: "x".repeat(4097) },
    { clientId: "user\n" },
    { clientSecret: "x\u0000y" },
    { securityCode: "x".repeat(4097) },
    { merchantId: "0" },
    { merchantId: "123e3" },
    { securityCode: "x\ny" },
    { notificationUrl: "https://evil.example/callback" },
    { checkoutOrigin: "https://secure.sandbox.tpay.com" },
  ])("rejects forged live configuration %j", (change) => {
    expect(() =>
      assertTpayConfig({ ...loadTpayConfig(live)!, ...change } as Parameters<
        typeof assertTpayConfig
      >[0]),
    ).toThrow();
  });
});
