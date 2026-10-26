import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { loadTpayConfig } from "../src/modules/payments/config";
import {
  createTpayTransaction,
  getTpayTransaction,
  isTrustedTpayCheckoutUrl,
  tpayAmountToCents,
} from "../src/modules/payments/provider";

const config = loadTpayConfig({
  TPAY_ENABLED: "true",
  TPAY_MODE: "sandbox",
  TPAY_CLIENT_ID: "synthetic-client",
  TPAY_CLIENT_SECRET: "synthetic-secret",
  TPAY_MERCHANT_ID: "12345",
  NEXT_PUBLIC_APP_URL: "http://127.0.0.1:3000",
  NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
})!;
const hosted = (mode: "sandbox" | "live") =>
  loadTpayConfig({
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
    TPAY_SECURITY_CODE: "",
  })!;
const attemptId = "a1cd44ba-149e-4cc4-8493-2f9cdbfe0d57";
const input = {
  attemptId,
  amountCents: 12345,
  payerName: "Testowa Osoba",
  payerEmail: "test@example.invalid",
};
const checkoutUrl =
  "https://secure.sandbox.tpay.com/?title=TR-TEST&uid=synthetic";
const response = (change: Record<string, unknown> = {}) => ({
  result: "success",
  transactionId: "ta_test123",
  title: "TR-TEST",
  hiddenDescription: attemptId,
  currency: "PLN",
  amount: 123.45,
  status: "pending",
  payments: { amountPaid: 0, status: "pending" },
  transactionPaymentUrl: checkoutUrl,
  ...change,
});
const oauth = () =>
  Response.json({
    access_token: "synthetic-access-token",
    expires_in: 3600,
    token_type: "Bearer",
  });
function transport(body = response()) {
  return vi
    .fn<typeof fetch>()
    .mockImplementation(async (url) =>
      String(url).endsWith("/oauth/auth") ? oauth() : Response.json(body),
    );
}
afterEach(() => vi.useRealTimers());

describe("Tpay transport (mocked HTTP, no actual operator calls)", () => {
  it("creates a BLIK redirect using trusted server values and local read-only return pages", async () => {
    const request = transport();
    const created = await createTpayTransaction(config, input, {
      fetch: request,
    });
    expect(created).toMatchObject({
      attemptId,
      transactionId: "ta_test123",
      transactionTitle: "TR-TEST",
      merchantId: "12345",
      amountCents: 12345,
      status: "pending",
      checkoutUrl,
    });
    const [url, options] = request.mock.calls[1];
    expect(url).toBe("https://openapi.sandbox.tpay.com/transactions");
    expect(options).toMatchObject({
      method: "POST",
      redirect: "error",
      cache: "no-store",
      headers: { authorization: "Bearer synthetic-access-token" },
    });
    expect(options?.signal).toBeInstanceOf(AbortSignal);
    expect(JSON.parse(String(options?.body))).toEqual({
      amount: 123.45,
      currency: "PLN",
      description: "Psi Pawer — płatność testowa",
      hiddenDescription: attemptId,
      lang: "pl",
      payer: { name: input.payerName, email: input.payerEmail },
      pay: { groupId: 150 },
      callbacks: {
        notification: {},
        payerUrls: {
          success: `http://127.0.0.1:3000/app/payments/${attemptId}`,
          error: `http://127.0.0.1:3000/app/payments/${attemptId}`,
        },
      },
    });
    const auth = request.mock.calls[0][1];
    expect(auth?.body).toBeInstanceOf(URLSearchParams);
    expect(String(auth?.body)).toContain("client_id=synthetic-client");
  });

  it("shares an OAuth request across concurrent transactions and reuses the token across config objects", async () => {
    const request = transport();
    await Promise.all([
      createTpayTransaction(config, input, { fetch: request }),
      createTpayTransaction({ ...config }, input, { fetch: request }),
    ]);
    await getTpayTransaction(config, "ta_test123", { fetch: request });
    expect(
      request.mock.calls.filter(([url]) => String(url).endsWith("/oauth/auth")),
    ).toHaveLength(1);
  });

  it("refreshes the OAuth token after expiry", async () => {
    let now = 1000;
    const request = transport();
    await getTpayTransaction(config, "ta_test123", {
      fetch: request,
      now: () => now,
    });
    now += 3600 * 1000;
    await getTpayTransaction(config, "ta_test123", {
      fetch: request,
      now: () => now,
    });
    expect(
      request.mock.calls.filter(([url]) => String(url).endsWith("/oauth/auth")),
    ).toHaveLength(2);
  });

  it("accepts integer-string token expiry used in the public OpenAPI example", async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json({
          access_token: "synthetic-access-token",
          expires_in: "7200",
          token_type: "Bearer",
        }),
      )
      .mockResolvedValueOnce(Response.json(response()));
    await expect(
      getTpayTransaction(config, "ta_test123", { fetch: request }),
    ).resolves.toMatchObject({ status: "pending" });
  });

  it.each([400, 401, 403, 422])(
    "marks a definite HTTP %i rejection without retrying creation",
    async (code) => {
      const request = vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(oauth())
        .mockResolvedValueOnce(
          new Response("private-detail", { status: code }),
        );
      await expect(
        createTpayTransaction(config, input, { fetch: request }),
      ).rejects.toMatchObject({ kind: "rejected" });
      expect(request).toHaveBeenCalledTimes(2);
    },
  );

  it.each([408, 500, 502, 503])(
    "keeps HTTP %i creation result uncertain and never retries",
    async (code) => {
      const request = vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(oauth())
        .mockResolvedValueOnce(
          new Response("private-detail", { status: code }),
        );
      await expect(
        createTpayTransaction(config, input, { fetch: request }),
      ).rejects.toMatchObject({ kind: "uncertain" });
      expect(request).toHaveBeenCalledTimes(2);
    },
  );

  it("does not retry after a lost connection or expose the underlying private error", async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(oauth())
      .mockRejectedValueOnce(new Error("private-token-and-body"));
    await expect(
      createTpayTransaction(config, input, { fetch: request }),
    ).rejects.toMatchObject({
      kind: "uncertain",
      message: "Nie udało się pewnie ustalić wyniku operacji Tpay.",
    });
    expect(request).toHaveBeenCalledTimes(2);
  });

  it("bounds a hung request and aborts it without repeating transaction creation", async () => {
    vi.useFakeTimers();
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(oauth())
      .mockImplementationOnce(() => new Promise(() => {}));
    const pending = createTpayTransaction(config, input, { fetch: request });
    const assertion = expect(pending).rejects.toMatchObject({
      kind: "uncertain",
    });
    await vi.advanceTimersByTimeAsync(15001);
    await assertion;
    expect(request).toHaveBeenCalledTimes(2);
    expect(request.mock.calls[1][1]?.signal?.aborted).toBe(true);
  });

  it("bounds a streamed response even when content-length is absent", async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(oauth())
      .mockResolvedValueOnce(new Response("x".repeat(65537)));
    await expect(
      createTpayTransaction(config, input, { fetch: request }),
    ).rejects.toMatchObject({ kind: "uncertain" });
  });

  it.each(["paid", "correct"])(
    "recognizes verified settled status %s and actual paid amount",
    async (status) => {
      const request = transport(
        response({
          status,
          payments: { amountPaid: "123.45", status: "correct" },
        }),
      );
      await expect(
        getTpayTransaction(config, "ta_test123", { fetch: request }),
      ).resolves.toMatchObject({
        status: "paid",
        amountCents: 12345,
        paidCents: 12345,
      });
    },
  );

  it.each(["pending", "success", "unknown"])(
    "does not treat %s or a declined BLIK attempt as terminal success/failure",
    async (status) => {
      const request = transport(
        response({ status, payments: { amountPaid: 0, status: "declined" } }),
      );
      await expect(
        getTpayTransaction(config, "ta_test123", { fetch: request }),
      ).resolves.toMatchObject({ status: "pending", paidCents: 0 });
    },
  );

  it.each([
    ["refund", "refunded"],
    ["canceled", "failed"],
  ])("maps actual terminal status %s to %s", async (status, expected) => {
    const request = transport(
      response({
        status,
        payments: { amountPaid: status === "refund" ? 123.45 : 0 },
      }),
    );
    await expect(
      getTpayTransaction(config, "ta_test123", { fetch: request }),
    ).resolves.toMatchObject({ status: expected });
  });

  it("never substitutes the requested amount for missing actual paid money", async () => {
    const request = transport(
      response({ status: "correct", payments: { attempts: [] } }),
    );
    await expect(
      getTpayTransaction(config, "ta_test123", { fetch: request }),
    ).resolves.toMatchObject({
      paidCents: null,
      amountCents: 12345,
      status: "paid",
    });
  });

  it.each(["sandbox", "live"] as const)(
    "uses fixed %s API, checkout and HTTPS callback for hosted processing",
    async (mode) => {
      const cfg = hosted(mode);
      const checkout = `${cfg.checkoutOrigin}/?title=TR-TEST&uid=synthetic`;
      const request = transport(response({ transactionPaymentUrl: checkout }));
      const result = await createTpayTransaction(cfg, input, {
        fetch: request,
      });
      expect(result.checkoutUrl).toBe(checkout);
      expect(request.mock.calls[0][0]).toBe(`${cfg.apiOrigin}/oauth/auth`);
      expect(request.mock.calls[1][0]).toBe(`${cfg.apiOrigin}/transactions`);
      expect(JSON.parse(String(request.mock.calls[1][1]?.body))).toMatchObject({
        amount: 123.45,
        currency: "PLN",
        hiddenDescription: attemptId,
        callbacks: {
          notification: {
            url: "https://psy.example/api/payments/tpay/notification",
          },
          payerUrls: {
            success: `https://psy.example/app/payments/${attemptId}`,
            error: `https://psy.example/app/payments/${attemptId}`,
          },
        },
      });
      const otherCheckout = `${mode === "live" ? hosted("sandbox").checkoutOrigin : hosted("live").checkoutOrigin}/`;
      expect(isTrustedTpayCheckoutUrl(otherCheckout, cfg)).toBe(false);
      await expect(
        createTpayTransaction(cfg, input, {
          fetch: transport(response({ transactionPaymentUrl: otherCheckout })),
        }),
      ).rejects.toMatchObject({ kind: "uncertain" });
    },
  );

  it("never reuses a sandbox OAuth token for live, even with identical synthetic credential values", async () => {
    const request = vi.fn<typeof fetch>().mockImplementation(async (url) => {
      if (String(url).endsWith("/oauth/auth")) return oauth();
      return Response.json(
        response({
          transactionPaymentUrl: String(url).startsWith(
            hosted("live").apiOrigin,
          )
            ? "https://secure.tpay.com/"
            : checkoutUrl,
        }),
      );
    });
    await getTpayTransaction(hosted("sandbox"), "ta_test123", {
      fetch: request,
    });
    await getTpayTransaction(hosted("live"), "ta_test123", { fetch: request });
    expect(
      request.mock.calls.filter(([url]) => String(url).endsWith("/oauth/auth")),
    ).toHaveLength(2);
  });

  it.each(["sandbox", "live"] as const)(
    "returns metadata without an invented receipt for documented %s GET shape",
    async (mode) => {
      const cfg = hosted(mode);
      const details = response({
        status: "correct",
        payments: { attempts: [] },
        transactionPaymentUrl: undefined,
      });
      await expect(
        getTpayTransaction(cfg, "ta_test123", { fetch: transport(details) }),
      ).resolves.toMatchObject({
        transactionId: "ta_test123",
        attemptId,
        paidCents: null,
        currency: "PLN",
      });
      await expect(
        createTpayTransaction(cfg, input, { fetch: transport(details) }),
      ).rejects.toMatchObject({ kind: "uncertain" });
    },
  );

  it.each(["sandbox", "live"] as const)(
    "rejects %s merchant/body environment mismatches before returning a receipt",
    async (mode) => {
      const cfg = hosted(mode);
      for (const change of [
        { merchantId: "54321" },
        { test_mode: mode === "live" ? "1" : "0" },
        { currency: "EUR" },
        { currency: undefined },
        { status: "correct", payments: { amountPaid: "Infinity" } },
        { status: "correct", payments: { amountPaid: "21474836.48" } },
      ]) {
        await expect(
          getTpayTransaction(cfg, "ta_test123", {
            fetch: transport(
              response({ transactionPaymentUrl: undefined, ...change }),
            ),
          }),
        ).rejects.toMatchObject({ kind: "uncertain" });
      }
    },
  );

  it.each([Number.NaN, Infinity, -Infinity])(
    "rejects non-finite token clock %s without making a request",
    async (now) => {
      const request = transport();
      await expect(
        getTpayTransaction(config, "ta_test123", {
          fetch: request,
          now: () => now,
        }),
      ).rejects.toMatchObject({ kind: "uncertain" });
      expect(request).not.toHaveBeenCalled();
    },
  );

  it.each([
    { transactionId: "ta_other" },
    { hiddenDescription: "untrusted" },
    { currency: "EUR" },
    { amount: "123.456" },
    { status: "paid", payments: { amountPaid: 0 } },
  ])("rejects an inconsistent status response %j", async (change) => {
    await expect(
      getTpayTransaction(config, "ta_test123", {
        fetch: transport(response(change)),
      }),
    ).rejects.toMatchObject({ kind: "uncertain" });
  });

  it("rejects changed server amount/attempt identity after create", async () => {
    await expect(
      createTpayTransaction(config, input, {
        fetch: transport(response({ amount: 1 })),
      }),
    ).rejects.toMatchObject({ kind: "uncertain" });
    await expect(
      createTpayTransaction(config, input, {
        fetch: transport(
          response({
            hiddenDescription: "b1cd44ba-149e-4cc4-8493-2f9cdbfe0d57",
          }),
        ),
      }),
    ).rejects.toMatchObject({ kind: "uncertain" });
  });

  it.each([
    "https://secure.tpay.com/",
    "http://secure.sandbox.tpay.com/",
    "https://secure.sandbox.tpay.com.evil.test/",
    "https://secure.sandbox.tpay.com@evil.test/",
    "https://evil@secure.sandbox.tpay.com/",
    "https://secure.sandbox.tpay.com:444/",
    "https://secure.sandbox.tpay.com/#secret",
    "https://secure.sandbox.tpay.com/\\evil",
  ])("blocks an untrusted checkout URL %s", async (url) => {
    expect(isTrustedTpayCheckoutUrl(url)).toBe(false);
    await expect(
      createTpayTransaction(config, input, {
        fetch: transport(response({ transactionPaymentUrl: url })),
      }),
    ).rejects.toMatchObject({ kind: "uncertain" });
  });

  it.each([0, -1, 0.5, Number.NaN, 2147483648])(
    "rejects invalid cents %s before contacting the provider",
    async (amountCents) => {
      const request = transport();
      await expect(
        createTpayTransaction(
          config,
          { ...input, amountCents },
          { fetch: request },
        ),
      ).rejects.toMatchObject({ kind: "rejected" });
      expect(request).not.toHaveBeenCalled();
    },
  );

  it.each([
    "1e2",
    "1,23",
    "01.23",
    "12.345",
    "-1",
    "+1",
    " 1",
    "1.",
    "NaN",
    Infinity,
    null,
  ])("rejects an ambiguous or malformed money representation %s", (value) => {
    expect(() => tpayAmountToCents(value)).toThrow();
  });
  it.each([
    ["0.29", 29],
    [0.29, 29],
    ["123.4", 12340],
    ["0", 0],
    ["21474836.47", 2147483647],
  ])("parses valid decimal %s exactly", (value, cents) => {
    expect(tpayAmountToCents(value)).toBe(cents);
  });
});
