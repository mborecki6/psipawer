import { expect, it } from "vitest";
import {
  localEmailConfig,
  localEmailKeys,
} from "../scripts/lib/local-email-config.mjs";

it("clears every hosted SMTP setting by default", () => {
  const config = localEmailConfig();
  expect(config.BUSINESS_EMAIL_ENABLED).toBe("false");
  for (const key of localEmailKeys.filter(
    (key) => key !== "BUSINESS_EMAIL_ENABLED",
  ))
    expect(config[key]).toBe("");
});
it("allows only the explicit local SMTP sink", () => {
  expect(
    localEmailConfig({
      BUSINESS_EMAIL_ENABLED: "true",
      BUSINESS_EMAIL_DEPLOYMENT: "local",
      BUSINESS_EMAIL_SMTP_HOST: "127.0.0.1",
      BUSINESS_EMAIL_SMTP_PORT: "54325",
    }),
  ).toMatchObject({
    BUSINESS_EMAIL_ENABLED: "true",
    BUSINESS_EMAIL_SMTP_HOST: "127.0.0.1",
  });
});
it.each([
  { BUSINESS_EMAIL_SMTP_HOST: "smtp.example.com" },
  { BUSINESS_EMAIL_HOSTED_ENABLED: "true" },
  { BUSINESS_EMAIL_DEPLOYMENT: "hosted" },
  { BUSINESS_EMAIL_ENABLED: "yes" },
  { BUSINESS_EMAIL_SMTP_HOST: "localhost.evil.test" },
])("rejects a hosted or ambiguous local configuration: %j", (config) => {
  expect(() => localEmailConfig(config)).toThrow();
});
