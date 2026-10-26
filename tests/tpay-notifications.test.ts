import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash, sign } from "node:crypto";
vi.mock("server-only", () => ({}));
import { loadTpayConfig } from "../src/modules/payments/config";
import {
  TPAY_SANDBOX_SIGNING_CERTIFICATE_URL,
  TPAY_LIVE_SIGNING_CERTIFICATE_URL,
  verifyTpayNotification,
} from "../src/modules/payments/notifications";

const config = loadTpayConfig({
  TPAY_ENABLED: "true",
  TPAY_MODE: "sandbox",
  TPAY_CLIENT_ID: "synthetic-client",
  TPAY_CLIENT_SECRET: "synthetic-secret",
  TPAY_MERCHANT_ID: "12345",
  TPAY_SECURITY_CODE: "synthetic-code",
  NEXT_PUBLIC_APP_URL: "http://127.0.0.1:3000",
  NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
})!;
const hostedConfig = (mode: "sandbox" | "live") =>
  loadTpayConfig({
    TPAY_ENABLED: "false",
    TPAY_MODE: mode,
    TPAY_HOSTED_ENABLED: "true",
    TPAY_LIVE_ENABLED: "true",
    NODE_ENV: "production",
    TPAY_APP_ORIGIN: "https://psy.example",
    NEXT_PUBLIC_APP_URL: "https://psy.example",
    NEXT_PUBLIC_SUPABASE_URL: "https://project.supabase.co",
    TPAY_CLIENT_ID: "synthetic-client",
    TPAY_CLIENT_SECRET: "synthetic-secret",
    TPAY_MERCHANT_ID: "12345",
    TPAY_SECURITY_CODE: "synthetic-code",
  })!;
const attemptId = "a1cd44ba-149e-4cc4-8493-2f9cdbfe0d57";
let directory: string;
let ca: string;
let otherCa: string;
let certificate: string;
let privateKey: string;

beforeAll(() => {
  // These disposable test keys never represent a Tpay account/certificate.
  directory = mkdtempSync(join(tmpdir(), "psi-tpay-synthetic-jws-"));
  writeFileSync(
    join(directory, "ca.conf"),
    "[req]\ndistinguished_name=dn\nx509_extensions=ca\nprompt=no\n[dn]\nCN=Synthetic Tpay Unit Test CA\n[ca]\nbasicConstraints=critical,CA:TRUE\nkeyUsage=critical,keyCertSign,cRLSign\nsubjectKeyIdentifier=hash\n",
  );
  writeFileSync(
    join(directory, "leaf.ext"),
    "basicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature\nsubjectKeyIdentifier=hash\nauthorityKeyIdentifier=keyid\n",
  );
  const openssl = (args: string[]) =>
    execFileSync("openssl", args, { cwd: directory, stdio: "ignore" });
  openssl([
    "req",
    "-new",
    "-newkey",
    "rsa:2048",
    "-nodes",
    "-x509",
    "-days",
    "2",
    "-keyout",
    "ca.key",
    "-out",
    "ca.pem",
    "-config",
    "ca.conf",
  ]);
  openssl([
    "req",
    "-new",
    "-newkey",
    "rsa:2048",
    "-nodes",
    "-subj",
    "/CN=Synthetic Tpay Unit Test Signer",
    "-keyout",
    "leaf.key",
    "-out",
    "leaf.csr",
  ]);
  openssl([
    "x509",
    "-req",
    "-in",
    "leaf.csr",
    "-CA",
    "ca.pem",
    "-CAkey",
    "ca.key",
    "-CAcreateserial",
    "-days",
    "2",
    "-out",
    "leaf.pem",
    "-extfile",
    "leaf.ext",
  ]);
  openssl([
    "req",
    "-new",
    "-newkey",
    "rsa:2048",
    "-nodes",
    "-x509",
    "-days",
    "2",
    "-keyout",
    "other.key",
    "-out",
    "other.pem",
    "-config",
    "ca.conf",
  ]);
  ca = readFileSync(join(directory, "ca.pem"), "utf8");
  otherCa = readFileSync(join(directory, "other.pem"), "utf8");
  certificate = readFileSync(join(directory, "leaf.pem"), "utf8");
  privateKey = readFileSync(join(directory, "leaf.key"), "utf8");
}, 15000);
afterAll(() => {
  if (directory) rmSync(directory, { recursive: true, force: true });
});

function body(change: Record<string, string> = {}, code = "synthetic-code") {
  const fields = {
    id: "12345",
    tr_id: "TR-TEST",
    tr_crc: attemptId,
    tr_amount: "123.45",
    tr_paid: "123.45",
    tr_currency: "PLN",
    tr_status: "true",
    tr_error: "none",
    test_mode: "1",
    ...change,
  };
  const md5sum = createHash("md5")
    .update(fields.id + fields.tr_id + fields.tr_amount + fields.tr_crc + code)
    .digest("hex");
  return new URLSearchParams({ ...fields, md5sum }).toString();
}
function jws(raw: string, change: Record<string, unknown> = {}) {
  const header = Buffer.from(
    JSON.stringify({
      alg: "RS256",
      x5u: TPAY_SANDBOX_SIGNING_CERTIFICATE_URL,
      ...change,
    }),
  ).toString("base64url");
  const signature = sign(
    "RSA-SHA256",
    Buffer.from(`${header}.${Buffer.from(raw).toString("base64url")}`),
    privateKey,
  ).toString("base64url");
  return `${header}..${signature}`;
}
function deps() {
  const transport = vi
    .fn<typeof fetch>()
    .mockResolvedValue(new Response(certificate));
  return { fetch: transport, trustedCaPem: ca };
}

describe("Tpay JWS verification (synthetic CA and signatures; no actual sandbox)", () => {
  it.each(["sandbox", "live"] as const)(
    "verifies %s confirmations after disabling new checkout",
    async (mode) => {
      const cfg = hostedConfig(mode);
      const x5u =
        mode === "live"
          ? TPAY_LIVE_SIGNING_CERTIFICATE_URL
          : TPAY_SANDBOX_SIGNING_CERTIFICATE_URL;
      const raw = body({ test_mode: mode === "live" ? "0" : "1" });
      const dependencies = deps();
      await expect(
        verifyTpayNotification(cfg, raw, jws(raw, { x5u }), dependencies),
      ).resolves.toMatchObject({
        status: "paid",
        paidCents: 12345,
        currency: "PLN",
      });
      expect(dependencies.fetch.mock.calls[0][0]).toBe(x5u);
      const opposite =
        mode === "live"
          ? TPAY_SANDBOX_SIGNING_CERTIFICATE_URL
          : TPAY_LIVE_SIGNING_CERTIFICATE_URL;
      const forbiddenTransport = deps();
      await expect(
        verifyTpayNotification(
          cfg,
          raw,
          jws(raw, { x5u: opposite }),
          forbiddenTransport,
        ),
      ).rejects.toThrow();
      expect(forbiddenTransport.fetch).not.toHaveBeenCalled();
    },
  );

  it.each(["sandbox", "live"] as const)(
    "rejects mismatched %s signed body merchant and test_mode",
    async (mode) => {
      const cfg = hostedConfig(mode);
      const x5u =
        mode === "live"
          ? TPAY_LIVE_SIGNING_CERTIFICATE_URL
          : TPAY_SANDBOX_SIGNING_CERTIFICATE_URL;
      const changes: Record<string, string>[] = [
        { id: "54321", test_mode: mode === "live" ? "0" : "1" },
        { test_mode: mode === "live" ? "1" : "0" },
        { tr_currency: "EUR", test_mode: mode === "live" ? "0" : "1" },
      ];
      for (const change of changes) {
        const raw = body(change);
        await expect(
          verifyTpayNotification(cfg, raw, jws(raw, { x5u }), deps()),
        ).rejects.toThrow();
      }
    },
  );

  it("pins live to the separate official CA/root URL and rejects an injected chain", async () => {
    const raw = body({ test_mode: "0" });
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(certificate))
      .mockResolvedValueOnce(new Response(ca));
    await expect(
      verifyTpayNotification(
        hostedConfig("live"),
        raw,
        jws(raw, { x5u: TPAY_LIVE_SIGNING_CERTIFICATE_URL }),
        { fetch: request },
      ),
    ).rejects.toThrow();
    expect(request.mock.calls.map(([url]) => url)).toEqual([
      TPAY_LIVE_SIGNING_CERTIFICATE_URL,
      "https://secure.tpay.com/x509/tpay-jws-root.pem",
    ]);
  });

  it("verifies exact detached RS256, merchant, test mode, checksum and money", async () => {
    const raw = body();
    const dependencies = deps();
    await expect(
      verifyTpayNotification(config, raw, jws(raw), dependencies),
    ).resolves.toEqual({
      attemptId,
      transactionTitle: "TR-TEST",
      merchantId: "12345",
      amountCents: 12345,
      paidCents: 12345,
      currency: "PLN",
      status: "paid",
    });
    expect(dependencies.fetch).toHaveBeenCalledWith(
      TPAY_SANDBOX_SIGNING_CERTIFICATE_URL,
      expect.objectContaining({
        redirect: "error",
        cache: "no-store",
        signal: expect.any(AbortSignal),
      }),
    );
  });

  it("preserves actual overpayment for the database to reconcile", async () => {
    const raw = body({ tr_paid: "150.00" });
    await expect(
      verifyTpayNotification(config, raw, jws(raw), deps()),
    ).resolves.toMatchObject({ paidCents: 15000, amountCents: 12345 });
  });

  it("interprets chargeback as a refund notification, never another payment", async () => {
    const raw = body({ tr_status: "chargeback" });
    await expect(
      verifyTpayNotification(config, raw, jws(raw), deps()),
    ).resolves.toMatchObject({ status: "refunded" });
  });

  it("accepts the merchant API's optional missing currency as PLN", async () => {
    const raw = body().replace("tr_currency=PLN&", "");
    await expect(
      verifyTpayNotification(config, raw, jws(raw), deps()),
    ).resolves.toMatchObject({ currency: "PLN" });
  });

  it("distinguishes an explicit empty merchant confirmation code from missing configuration", async () => {
    const raw = body({}, "");
    await expect(
      verifyTpayNotification(
        { ...config, securityCode: "" },
        raw,
        jws(raw),
        deps(),
      ),
    ).resolves.toMatchObject({ status: "paid" });
    await expect(
      verifyTpayNotification(
        { ...config, securityCode: undefined },
        raw,
        jws(raw),
        deps(),
      ),
    ).rejects.toThrow("Nieprawidłowe potwierdzenie");
  });

  it.each([
    "https://secure.tpay.com/x509/notifications-jws.pem",
    "https://secure.sandbox.tpay.com.evil.test/x509/notifications-jws.pem",
    "https://secure.sandbox.tpay.com@evil.test/x509/notifications-jws.pem",
    "http://secure.sandbox.tpay.com/x509/notifications-jws.pem",
    "https://secure.sandbox.tpay.com/x509/other.pem",
    "http://127.0.0.1:54321/",
    "https://secure.sandbox.tpay.com/x509/notifications-jws.pem?redirect=evil",
  ])("does not fetch attacker-selected certificate URL %s", async (x5u) => {
    const raw = body();
    const dependencies = deps();
    await expect(
      verifyTpayNotification(config, raw, jws(raw, { x5u }), dependencies),
    ).rejects.toThrow();
    expect(dependencies.fetch).not.toHaveBeenCalled();
  });

  it.each([
    { alg: "none" },
    { alg: "HS256" },
    { alg: "PS256" },
    { b64: false },
    { crit: ["b64"] },
  ])("rejects unsupported or critical JWS headers %j", async (header) => {
    const raw = body();
    const dependencies = deps();
    await expect(
      verifyTpayNotification(config, raw, jws(raw, header), dependencies),
    ).rejects.toThrow();
    expect(dependencies.fetch).not.toHaveBeenCalled();
  });

  it("rejects missing or attached JWS, invalid base64 and altered raw bytes", async () => {
    const raw = body();
    for (const signature of [
      "",
      "bad",
      "a..b",
      jws(raw).replace("..", ".attached."),
      jws(raw) + "=",
    ]) {
      await expect(
        verifyTpayNotification(config, raw, signature, deps()),
      ).rejects.toThrow();
    }
    await expect(
      verifyTpayNotification(config, raw + "&unused=1", jws(raw), deps()),
    ).rejects.toThrow();
    const signed = jws(raw);
    const parts = signed.split(".");
    parts[2] = (parts[2][0] === "A" ? "B" : "A") + parts[2].slice(1);
    await expect(
      verifyTpayNotification(config, raw, parts.join("."), deps()),
    ).rejects.toThrow();
  });

  it("rejects an unrelated CA, CA as signer, or a certificate outside its validity", async () => {
    const raw = body();
    await expect(
      verifyTpayNotification(config, raw, jws(raw), {
        ...deps(),
        trustedCaPem: otherCa,
      }),
    ).rejects.toThrow();
    await expect(
      verifyTpayNotification(config, raw, jws(raw), {
        ...deps(),
        fetch: vi.fn<typeof fetch>().mockResolvedValue(new Response(ca)),
      }),
    ).rejects.toThrow();
    await expect(
      verifyTpayNotification(config, raw, jws(raw), {
        ...deps(),
        now: () => Date.now() + 3 * 86400000,
      }),
    ).rejects.toThrow();
    await expect(
      verifyTpayNotification(config, raw, jws(raw), {
        ...deps(),
        now: () => Date.now() - 3 * 86400000,
      }),
    ).rejects.toThrow();
  });

  it.each([Number.NaN, Infinity, -Infinity])(
    "rejects non-finite certificate verification time %s",
    async (now) => {
      const raw = body();
      await expect(
        verifyTpayNotification(config, raw, jws(raw), {
          ...deps(),
          now: () => now,
        }),
      ).rejects.toThrow();
    },
  );

  it("pins production code to the official sandbox CA/root instead of trusting any downloaded chain", async () => {
    const raw = body();
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(certificate))
      .mockResolvedValueOnce(new Response(ca));
    await expect(
      verifyTpayNotification(config, raw, jws(raw), { fetch: request }),
    ).rejects.toThrow();
    expect(request.mock.calls[1][0]).toBe(
      "https://secure.sandbox.tpay.com/x509/tpay-jws-root.pem",
    );
  });

  it.each<Record<string, string>>([
    { id: "54321" },
    { tr_currency: "EUR" },
    { test_mode: "0" },
    { tr_crc: "foreign-attempt" },
    { tr_id: "TR-TEST/path" },
    { tr_status: "false" },
    { tr_status: "overpay" },
    { tr_error: "payment_failed" },
    { tr_amount: "123.456" },
    { tr_paid: "123.456" },
    { tr_paid: "1e2" },
    { tr_paid: "0" },
    { tr_paid: "-123.45" },
    { tr_paid: "21474836.48" },
    { tr_amount: "21474836.48" },
  ])(
    "rejects a signed but semantically invalid notification %j",
    async (fields) => {
      const raw = body(fields);
      await expect(
        verifyTpayNotification(config, raw, jws(raw), deps()),
      ).rejects.toThrow();
    },
  );

  it("rejects a signed invalid checksum and a checksum made with another merchant code", async () => {
    const raw = body().replace(/md5sum=[0-9a-f]+/, "md5sum=" + "0".repeat(32));
    await expect(
      verifyTpayNotification(config, raw, jws(raw), deps()),
    ).rejects.toThrow();
    const otherCode = body({}, "wrong-code");
    await expect(
      verifyTpayNotification(config, otherCode, jws(otherCode), deps()),
    ).rejects.toThrow();
  });

  it.each([
    "&tr_paid=1.00",
    "&%69d=12345",
    "&tr_crc=another",
    "&broken=%ZZ",
    "&broken",
  ])("rejects signed duplicates/malformed form data %s", async (suffix) => {
    const raw = body() + suffix;
    await expect(
      verifyTpayNotification(config, raw, jws(raw), deps()),
    ).rejects.toThrow();
  });

  it("bounds raw request and certificate response sizes", async () => {
    const raw = body() + "&extra=" + "x".repeat(16384);
    const dependencies = deps();
    await expect(
      verifyTpayNotification(config, raw, jws(raw), dependencies),
    ).rejects.toThrow();
    expect(dependencies.fetch).not.toHaveBeenCalled();
    const validRaw = body();
    await expect(
      verifyTpayNotification(config, validRaw, jws(validRaw), {
        ...deps(),
        fetch: vi
          .fn<typeof fetch>()
          .mockResolvedValue(new Response("x".repeat(32769))),
      }),
    ).rejects.toThrow();
  });

  it("fails closed on certificate redirects and transport errors without exposing details", async () => {
    const raw = body();
    const dependencies = {
      ...deps(),
      fetch: vi
        .fn<typeof fetch>()
        .mockRejectedValue(new Error("private-provider-details")),
    };
    await expect(
      verifyTpayNotification(config, raw, jws(raw), dependencies),
    ).rejects.toMatchObject({
      message: "Nieprawidłowe potwierdzenie płatności Tpay.",
    });
    expect(dependencies.fetch.mock.calls[0][1]?.redirect).toBe("error");
  });
});
