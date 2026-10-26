import { expect, it } from "vitest";
import {
  localTpayConfig,
  localTpayKeys,
} from "../scripts/lib/local-tpay-config.mjs";
it("explicitly disables absent settings so hosted dotenv credentials cannot enable local payments", () => {
  const config = localTpayConfig();
  expect(config.TPAY_ENABLED).toBe("false");
  for (const key of localTpayKeys.filter((k) => k !== "TPAY_ENABLED"))
    expect(config[key]).toBe("");
});
it("accepts explicit local simulator or sandbox and rejects live or overridden endpoints", () => {
  expect(
    localTpayConfig({ TPAY_ENABLED: "true", TPAY_MODE: "simulator" }).TPAY_MODE,
  ).toBe("simulator");
  expect(
    localTpayConfig({ TPAY_ENABLED: "true", TPAY_MODE: "sandbox" }).TPAY_MODE,
  ).toBe("sandbox");
  expect(() =>
    localTpayConfig({ TPAY_ENABLED: "true", TPAY_MODE: "production" }),
  ).toThrow();
  expect(() =>
    localTpayConfig({ TPAY_API_URL: "https://api.tpay.com" }),
  ).toThrow();
  for (const key of [
    "TPAY_API_BASE_URL",
    "TPAY_API_ORIGIN",
    "TPAY_HOSTED_ENABLED",
    "TPAY_LIVE_ENABLED",
    "TPAY_APP_ORIGIN",
  ])
    expect(() => localTpayConfig({ [key]: "hosted-value" })).toThrow();
});
