import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import {
  loadBusinessEmailConfig,
  validMailbox,
} from "../src/modules/email/config";
import { buildBusinessEmail } from "../src/modules/email/message";
import { classifySmtpError } from "../src/modules/email/transport";

const local = {
  BUSINESS_EMAIL_ENABLED: "true",
  BUSINESS_EMAIL_DEPLOYMENT: "local",
  NEXT_PUBLIC_APP_URL: "http://127.0.0.1:3000",
  NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
  SUPABASE_SECRET_KEY: "synthetic-key",
  BUSINESS_EMAIL_SMTP_HOST: "127.0.0.1",
  BUSINESS_EMAIL_SMTP_PORT: "1025",
  BUSINESS_EMAIL_SMTP_SECURE: "false",
  BUSINESS_EMAIL_SMTP_FROM: "panel@psi-pawer.test",
};
const hosted = {
  ...local,
  BUSINESS_EMAIL_DEPLOYMENT: "hosted",
  BUSINESS_EMAIL_HOSTED_ENABLED: "true",
  NODE_ENV: "production",
  NEXT_PUBLIC_APP_URL: "https://panel.example.com",
  NEXT_PUBLIC_SUPABASE_URL: "https://abcdefghijklmnopqrst.supabase.co",
  BUSINESS_EMAIL_SMTP_HOST: "smtp.example.com",
  BUSINESS_EMAIL_SMTP_PORT: "587",
  BUSINESS_EMAIL_SMTP_USER: "synthetic-user",
  BUSINESS_EMAIL_SMTP_PASSWORD: "synthetic-password",
};
const id = "aaaaaaaa-0000-4000-8000-000000000001";

describe("business email configuration and safe content", () => {
  it("is off by default and admits only explicit local loopback configuration", () => {
    expect(loadBusinessEmailConfig({})).toBeNull();
    expect(loadBusinessEmailConfig(local)?.deployment).toBe("local");
    for (const override of [
      { BUSINESS_EMAIL_SMTP_HOST: "smtp.example.com" },
      { NEXT_PUBLIC_SUPABASE_URL: hosted.NEXT_PUBLIC_SUPABASE_URL },
      { NEXT_PUBLIC_APP_URL: "http://localhost:3000/redirect" },
      { VERCEL_ENV: "preview" },
      { BUSINESS_EMAIL_SMTP_SECURE: "maybe" },
    ])
      expect(loadBusinessEmailConfig({ ...local, ...override })).toBeNull();
  });
  it("requires the hosted production gates and never accepts credentials in URLs", () => {
    expect(loadBusinessEmailConfig(hosted)?.deployment).toBe("hosted");
    for (const override of [
      { BUSINESS_EMAIL_HOSTED_ENABLED: "false" },
      { NODE_ENV: "development" },
      { VERCEL_ENV: "preview" },
      { VERCEL: "1" },
      { BUSINESS_EMAIL_SMTP_PASSWORD: "" },
      { BUSINESS_EMAIL_SMTP_HOST: "127.0.0.1" },
      { NEXT_PUBLIC_APP_URL: "https://user:secret@panel.example.com" },
      { BUSINESS_EMAIL_SMTP_HOST: "smtp://smtp.example.com" },
    ])
      expect(loadBusinessEmailConfig({ ...hosted, ...override })).toBeNull();
  });
  it("rejects header injection and multiple mailboxes", () => {
    for (const from of [
      "panel@example.com\r\nBcc:other@example.com",
      "panel@example.com,other@example.com",
      "Name <panel@example.com>",
      "x@x\n",
    ])
      expect(
        loadBusinessEmailConfig({ ...local, BUSINESS_EMAIL_SMTP_FROM: from }),
      ).toBeNull();
    expect(
      loadBusinessEmailConfig({
        ...local,
        BUSINESS_EMAIL_REPLY_TO: "help@example.com",
      })?.replyTo,
    ).toBe("help@example.com");
    expect(
      loadBusinessEmailConfig({ ...local, BUSINESS_EMAIL_REPLY_TO: "" })
        ?.replyTo,
    ).toBeUndefined();
    expect(validMailbox("owner@example.com")).toBe(true);
  });
  it("uses fixed authenticated views and minimal text, with no private domain content", () => {
    const config = loadBusinessEmailConfig(local)!;
    const message = buildBusinessEmail(config, id, {
      recipient: "owner@example.test",
      recipient_role: "client",
      kind: "payment_confirmed",
      entity_id: id,
      enrollment_id: null,
      session_id: null,
    });
    expect(message.text).toContain(
      `http://127.0.0.1:3000/app/finance#payment-${id}`,
    );
    expect(message.text).toContain("nie jest fakturą ani paragonem");
    expect(message.messageId).toContain(id);
    expect(() =>
      buildBusinessEmail(config, id, {
        recipient: "owner@example.test",
        recipient_role: "client",
        kind: "community_chat_message",
        entity_id: id,
        enrollment_id: null,
        session_id: null,
      }),
    ).toThrow("Invalid email");
    expect(() =>
      buildBusinessEmail(config, id, {
        recipient: "owner@example.test",
        recipient_role: "client",
        kind: "walk_reminder",
        entity_id: "https://evil.example",
        enrollment_id: null,
        session_id: null,
      }),
    ).toThrow("Invalid email");
  });
  it("retries only provably pre-DATA transient failures", () => {
    expect(classifySmtpError({ command: "CONN", code: "EDNS" })).toBe("retry");
    expect(
      classifySmtpError({
        command: "CONN",
        code: "ESOCKET",
        syscall: "connect",
      }),
    ).toBe("retry");
    expect(classifySmtpError({ command: "CONN", code: "ECONNECTION" })).toBe(
      "uncertain",
    );
    expect(classifySmtpError({ command: "RCPT TO", responseCode: 450 })).toBe(
      "retry",
    );
    expect(classifySmtpError({ command: "RCPT TO", responseCode: 550 })).toBe(
      "failed",
    );
    expect(
      classifySmtpError({ command: "AUTH PLAIN", responseCode: 535 }),
    ).toBe("failed");
    expect(classifySmtpError({ command: "DATA", code: "ESOCKET" })).toBe(
      "uncertain",
    );
    expect(classifySmtpError({ command: "DATA", responseCode: 451 })).toBe(
      "uncertain",
    );
    expect(classifySmtpError(new Error("unknown"))).toBe("uncertain");
  });
  it("renders package cancellation with a fixed fitness view and no individual meeting anchor", () => {
    const message = buildBusinessEmail(loadBusinessEmailConfig(local)!, id, {
      recipient: "owner@example.test",
      recipient_role: "client",
      kind: "fitness_cancelled",
      entity_id: id,
      enrollment_id: null,
      session_id: null,
    });
    expect(message.subject).toBe("Psi Pawer — Odwołano pakiet fitness");
    expect(message.text).toContain(`http://127.0.0.1:3000/app/fitness/${id}`);
    expect(message.text).not.toContain("#spotkanie-");
    expect(message.text).not.toContain("Poufny");
  });
});
