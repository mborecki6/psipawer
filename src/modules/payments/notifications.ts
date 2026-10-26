import "server-only";
import {
  createHash,
  timingSafeEqual,
  verify,
  X509Certificate,
} from "node:crypto";
import { assertTpayConfig, type TpayConfig } from "./config";
import { tpayAmountToCents } from "./provider";

export const TPAY_SANDBOX_SIGNING_CERTIFICATE_URL =
  "https://secure.sandbox.tpay.com/x509/notifications-jws.pem";
export const TPAY_LIVE_SIGNING_CERTIFICATE_URL =
  "https://secure.tpay.com/x509/notifications-jws.pem";
// Public CA fingerprints fetched from the official sandbox URL on 18.10.2026.
// A CA rotation requires an explicit source change, never an untrusted JWS header.
const SANDBOX_CA_SHA256 =
  "71:9D:25:CE:72:72:67:6E:F3:42:B2:CF:18:5C:63:1E:A0:09:7B:77:14:F3:A3:4A:25:9D:EF:C8:70:1C:6E:62";
// Public production CA chain downloaded from secure.tpay.com on 23.10.2026;
// its intermediate/root signatures and the current signing leaf were verified locally.
const LIVE_CA_SHA256 =
  "7F:EE:4B:85:62:5F:AF:16:D7:E1:A0:0A:35:6B:0F:FB:8F:2E:56:49:36:6F:EE:BA:DC:78:F0:4E:DB:1B:BA:E8";
const ROOT_SHA256 =
  "E5:12:85:0C:FF:80:F7:BE:D1:1F:38:90:0D:D5:B7:AD:E0:00:37:A5:30:09:FC:B9:4E:8F:65:F1:13:E9:68:84";

export class TpayNotificationError extends Error {
  constructor() {
    super("Nieprawidłowe potwierdzenie płatności Tpay.");
    this.name = "TpayNotificationError";
  }
}
export type TpayNotification = {
  attemptId: string;
  transactionTitle: string;
  merchantId: string;
  amountCents: number;
  paidCents: number;
  currency: "PLN";
  status: "paid" | "refunded";
};
export type TpayNotificationDependencies = {
  fetch?: typeof fetch;
  now?: () => number;
  /** In-memory synthetic CA for unit tests; never populated from environment/request data. */
  trustedCaPem?: string;
};

function reject(): never {
  throw new TpayNotificationError();
}
function certificates(pem: string): X509Certificate[] {
  const blocks = pem.match(
    /-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g,
  );
  if (!blocks || blocks.length > 3) return reject();
  return blocks.map((block) => new X509Certificate(block));
}
function validNow(cert: X509Certificate, now: number) {
  const from = Date.parse(cert.validFrom);
  const to = Date.parse(cert.validTo);
  if (
    !Number.isFinite(now) ||
    !Number.isFinite(from) ||
    !Number.isFinite(to) ||
    now < from ||
    now > to
  )
    reject();
}

async function certificateText(
  transport: typeof fetch,
  url: string,
): Promise<string> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      (async () => {
        const response = await transport(url, {
          redirect: "error",
          cache: "no-store",
          signal: controller.signal,
        });
        if (
          !response.ok ||
          Number(response.headers.get("content-length")) > 32768
        ) {
          void response.body?.cancel().catch(() => {});
          return reject();
        }
        const reader = response.body?.getReader();
        if (!reader) return reject();
        const chunks: Uint8Array[] = [];
        let size = 0;
        try {
          while (true) {
            const chunk = await reader.read();
            if (chunk.done) break;
            size += chunk.value.byteLength;
            if (size > 32768) return reject();
            chunks.push(chunk.value);
          }
        } finally {
          void reader.cancel().catch(() => {});
        }
        return Buffer.concat(chunks).toString("utf8");
      })(),
      new Promise<never>((_, fail) => {
        timer = setTimeout(() => {
          controller.abort();
          fail(new TpayNotificationError());
        }, 10000);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function base64url(value: string): Buffer {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) return reject();
  const decoded = Buffer.from(value, "base64url");
  if (decoded.toString("base64url") !== value) return reject();
  return decoded;
}

function parseForm(rawBody: string): Map<string, string> {
  if (!rawBody || Buffer.byteLength(rawBody) > 16384) return reject();
  const fields = new Map<string, string>();
  for (const pair of rawBody.split("&")) {
    const equals = pair.indexOf("=");
    if (equals < 1) return reject();
    const key = decodeURIComponent(pair.slice(0, equals).replace(/\+/g, " "));
    const value = decodeURIComponent(
      pair.slice(equals + 1).replace(/\+/g, " "),
    );
    if (fields.has(key)) return reject();
    fields.set(key, value);
  }
  return fields;
}

/** Verifies detached RS256 over the exact bytes received, before using any field. */
export async function verifyTpayNotification(
  config: TpayConfig,
  rawBody: string,
  jws: string,
  deps: TpayNotificationDependencies = {},
): Promise<TpayNotification> {
  assertTpayConfig(config);
  try {
    const signingUrl =
      config.mode === "live"
        ? TPAY_LIVE_SIGNING_CERTIFICATE_URL
        : TPAY_SANDBOX_SIGNING_CERTIFICATE_URL;
    const rootUrl = `${config.checkoutOrigin}/x509/tpay-jws-root.pem`;
    if (
      typeof rawBody !== "string" ||
      Buffer.byteLength(rawBody) > 16384 ||
      typeof jws !== "string" ||
      jws.length > 8192
    )
      return reject();
    const parts = jws.split(".");
    if (parts.length !== 3 || parts[1] !== "") return reject();
    const header = JSON.parse(base64url(parts[0]).toString("utf8"));
    if (
      !header ||
      Array.isArray(header) ||
      header.alg !== "RS256" ||
      header.x5u !== signingUrl ||
      header.crit !== undefined ||
      (header.b64 !== undefined && header.b64 !== true)
    )
      return reject();
    const transport = deps.fetch ?? fetch;
    const leafChain = certificates(
      await certificateText(transport, signingUrl),
    );
    const trustedChain = certificates(
      deps.trustedCaPem ?? (await certificateText(transport, rootUrl)),
    );
    const leaf = leafChain[0];
    const ca = trustedChain[0];
    const root = trustedChain[trustedChain.length - 1];
    if (
      leafChain.length !== 1 ||
      leaf.ca ||
      !ca.ca ||
      !root.ca ||
      leaf.publicKey.asymmetricKeyType !== "rsa"
    )
      return reject();
    if (
      deps.trustedCaPem === undefined &&
      (ca.fingerprint256 !==
        (config.mode === "live" ? LIVE_CA_SHA256 : SANDBOX_CA_SHA256) ||
        root.fingerprint256 !== ROOT_SHA256 ||
        trustedChain.length !== 2)
    )
      return reject();
    const now = (deps.now ?? Date.now)();
    for (const cert of [leaf, ...trustedChain]) validNow(cert, now);
    for (let i = 0; i < trustedChain.length - 1; i++) {
      if (
        !trustedChain[i].ca ||
        !trustedChain[i + 1].ca ||
        !trustedChain[i].checkIssued(trustedChain[i + 1]) ||
        !trustedChain[i].verify(trustedChain[i + 1].publicKey)
      )
        return reject();
    }
    if (
      !root.checkIssued(root) ||
      !root.verify(root.publicKey) ||
      !leaf.checkIssued(ca) ||
      !leaf.verify(ca.publicKey)
    )
      return reject();
    const data = Buffer.from(
      `${parts[0]}.${Buffer.from(rawBody, "utf8").toString("base64url")}`,
      "ascii",
    );
    if (!verify("RSA-SHA256", data, leaf.publicKey, base64url(parts[2])))
      return reject();

    const fields = parseForm(rawBody);
    const merchantId = fields.get("id");
    const attemptId = fields.get("tr_crc");
    const transactionTitle = fields.get("tr_id");
    const rawAmount = fields.get("tr_amount");
    const checksum = fields.get("md5sum");
    if (
      merchantId !== config.merchantId ||
      fields.get("test_mode") !== (config.mode === "sandbox" ? "1" : "0") ||
      fields.get("tr_error") !== "none" ||
      !attemptId ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        attemptId,
      ) ||
      !transactionTitle ||
      !/^[A-Za-z0-9_-]{1,128}$/.test(transactionTitle) ||
      (fields.has("tr_currency") && fields.get("tr_currency") !== "PLN") ||
      (fields.get("tr_status") !== "true" &&
        fields.get("tr_status") !== "chargeback") ||
      config.securityCode === undefined ||
      !checksum ||
      !/^[0-9a-f]{32}$/i.test(checksum)
    )
      return reject();
    const expectedChecksum = createHash("md5")
      .update(
        `${merchantId}${transactionTitle}${rawAmount}${attemptId}${config.securityCode}`,
        "utf8",
      )
      .digest();
    if (!timingSafeEqual(Buffer.from(checksum, "hex"), expectedChecksum))
      return reject();
    const amountCents = tpayAmountToCents(rawAmount);
    const paidCents = tpayAmountToCents(fields.get("tr_paid"));
    if (amountCents <= 0 || paidCents <= 0) return reject();
    return {
      attemptId,
      transactionTitle,
      merchantId,
      amountCents,
      paidCents,
      currency: "PLN",
      status: fields.get("tr_status") === "true" ? "paid" : "refunded",
    };
  } catch {
    throw new TpayNotificationError();
  }
}
