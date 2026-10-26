import { createServer, type Socket } from "node:net";
import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { loadBusinessEmailConfig } from "../src/modules/email/config";
import { createBusinessEmailTransport } from "../src/modules/email/transport";

/** Local SMTP sink only. It cannot relay and never contacts a real mailbox. */
async function sink(mode: "accept" | "reject-before-data" | "drop-after-data") {
  let dataCount = 0;
  const sockets = new Set<Socket>();
  const server = createServer((socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    socket.write("220 local-synthetic-sink ESMTP\r\n");
    let buffer = "";
    let data = false;
    socket.on("data", (chunk) => {
      buffer += chunk.toString();
      while (buffer.includes("\r\n")) {
        const line = buffer.slice(0, buffer.indexOf("\r\n"));
        buffer = buffer.slice(buffer.indexOf("\r\n") + 2);
        if (data) {
          if (line === ".") {
            dataCount++;
            data = false;
            if (mode === "drop-after-data") socket.destroy();
            else socket.write("250 2.0.0 accepted by local sink\r\n");
          }
        } else if (/^EHLO|^HELO/.test(line))
          socket.write("250 local-synthetic-sink\r\n");
        else if (line.startsWith("MAIL FROM"))
          socket.write("250 sender OK\r\n");
        else if (line.startsWith("RCPT TO"))
          socket.write(
            mode === "reject-before-data"
              ? "450 4.2.0 synthetic temporary rejection\r\n"
              : "250 recipient OK\r\n",
          );
        else if (line === "DATA") {
          data = true;
          socket.write("354 end with dot\r\n");
        } else if (line === "QUIT") socket.end("221 bye\r\n");
        else socket.write("250 OK\r\n");
      }
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("Synthetic sink unavailable");
  const config = loadBusinessEmailConfig({
    BUSINESS_EMAIL_ENABLED: "true",
    BUSINESS_EMAIL_DEPLOYMENT: "local",
    NEXT_PUBLIC_APP_URL: "http://127.0.0.1:3000",
    NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
    SUPABASE_SECRET_KEY: "synthetic-key",
    BUSINESS_EMAIL_SMTP_HOST: "127.0.0.1",
    BUSINESS_EMAIL_SMTP_PORT: String(address.port),
    BUSINESS_EMAIL_SMTP_SECURE: "false",
    BUSINESS_EMAIL_SMTP_FROM: "panel@example.test",
  })!;
  return {
    config,
    count: () => dataCount,
    async close() {
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

describe("SMTP against a loopback fake server", () => {
  for (const [mode, outcome, count] of [
    ["accept", "accepted", 1],
    ["reject-before-data", "retry", 0],
    ["drop-after-data", "uncertain", 1],
  ] as const)
    it(`${mode} records ${outcome} with no hidden SMTP retry`, async () => {
      const local = await sink(mode);
      const transport = createBusinessEmailTransport(local.config);
      try {
        expect(
          await transport.send({
            from: local.config.from,
            to: "synthetic-owner@example.test",
            subject: "Synthetic email test",
            text: "Local test only.",
            messageId: "<synthetic-1@example.test>",
          }),
        ).toBe(outcome);
        expect(local.count()).toBe(count);
      } finally {
        transport.close();
        await local.close();
      }
    });
  it("accepts 50 synthetic messages without hidden retries, measuring only the local sink", async () => {
    const local = await sink("accept");
    const transport = createBusinessEmailTransport(local.config);
    const started = performance.now();
    try {
      for (let n = 0; n < 50; n++)
        expect(
          await transport.send({
            from: local.config.from,
            to: "synthetic-owner@example.test",
            subject: "Synthetic batch",
            text: "Local test only.",
            messageId: `<synthetic-${n}@example.test>`,
          }),
        ).toBe("accepted");
      expect(local.count()).toBe(50);
      console.info(
        "Synthetic SMTP sink 50: accepted=50 elapsedMs=" +
          Math.ceil(performance.now() - started),
      );
    } finally {
      transport.close();
      await local.close();
    }
  });
});
