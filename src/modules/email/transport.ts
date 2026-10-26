import "server-only";
import nodemailer from "nodemailer";
import type { BusinessEmailConfig } from "./config";
import type { BusinessEmailMessage } from "./message";

export type EmailSendOutcome = "accepted" | "retry" | "failed" | "uncertain";
export type BusinessEmailTransport = {
  send(message: BusinessEmailMessage): Promise<EmailSendOutcome>;
  close(): void;
};

/** A missing response after DATA can mean acceptance. Never retry that case. */
export function classifySmtpError(error: unknown): EmailSendOutcome {
  if (!error || typeof error !== "object") return "uncertain";
  const { command, responseCode, code, syscall } = error as {
    command?: string;
    responseCode?: number;
    code?: string;
    syscall?: string;
  };
  // Nodemailer labels an unexpected socket close CONN even after DATA. That
  // label alone does not prove that the message has not been accepted.
  if (command === "CONN" && (code === "EDNS" || syscall === "connect"))
    return "retry";
  const beforeData =
    typeof command === "string" &&
    /^(EHLO|HELO|STARTTLS|AUTH(?: .*)?|MAIL FROM|RCPT TO)$/.test(command);
  if (!beforeData) return "uncertain";
  if (responseCode && responseCode >= 500) return "failed";
  if (
    (responseCode && responseCode >= 400 && responseCode < 500) ||
    ["ECONNECTION", "ESOCKET", "ETIMEDOUT", "EDNS"].includes(code || "")
  )
    return "retry";
  return "failed";
}

export function createBusinessEmailTransport(
  config: BusinessEmailConfig,
): BusinessEmailTransport {
  const local = config.deployment === "local";
  const transport = nodemailer.createTransport({
    host: config.host.replace(/^\[|\]$/g, ""),
    port: config.port,
    secure: config.secure,
    requireTLS: !local,
    ignoreTLS: local && !config.secure,
    tls: {
      rejectUnauthorized: true,
      minVersion: "TLSv1.2",
      ...(local ? {} : { servername: config.host }),
    },
    ...(config.user && config.password
      ? { auth: { user: config.user, pass: config.password } }
      : {}),
    connectionTimeout: 4000,
    greetingTimeout: 4000,
    socketTimeout: 6000,
    dnsTimeout: 4000,
    logger: false,
    debug: false,
    transactionLog: false,
    pool: false,
    disableFileAccess: true,
    disableUrlAccess: true,
  });
  return {
    async send(message) {
      try {
        const result = await transport.sendMail({
          ...message,
          envelope: { from: message.from, to: [message.to] },
          disableFileAccess: true,
          disableUrlAccess: true,
        });
        return result.accepted.length === 1 &&
          String(result.accepted[0]).toLowerCase() === message.to.toLowerCase()
          ? "accepted"
          : "failed";
      } catch (error) {
        return classifySmtpError(error);
      }
    },
    close() {
      transport.close();
    },
  };
}
