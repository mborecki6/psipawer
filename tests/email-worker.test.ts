import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import {
  handleBusinessEmail,
  processBusinessEmail,
  type EmailWorkerDatabase,
} from "../src/modules/email/worker";
const id = "aaaaaaaa-0000-4000-8000-000000000001";
const token = "aaaaaaaa-0000-4000-8000-000000000002";
const values = {
  BUSINESS_EMAIL_ENABLED: "true",
  BUSINESS_EMAIL_DEPLOYMENT: "local",
  BUSINESS_EMAIL_SECRET: "A".repeat(43),
  NEXT_PUBLIC_APP_URL: "http://127.0.0.1:3000",
  NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
  SUPABASE_SECRET_KEY: "synthetic-key",
  BUSINESS_EMAIL_SMTP_HOST: "127.0.0.1",
  BUSINESS_EMAIL_SMTP_PORT: "1025",
  BUSINESS_EMAIL_SMTP_SECURE: "false",
  BUSINESS_EMAIL_SMTP_FROM: "panel@example.test",
};
const request = (secret = values.BUSINESS_EMAIL_SECRET) =>
  new Request("http://localhost/api/internal/email", {
    method: "POST",
    headers: { authorization: `Bearer ${secret}` },
  });
const prepared = {
  recipient: "owner@example.test",
  recipient_role: "client",
  kind: "payment_confirmed",
  entity_id: id,
  enrollment_id: null,
  session_id: null,
};
function fixture(prepare: unknown = [prepared]) {
  const rpc = vi.fn(
    async (name: string): Promise<{ data: unknown; error: unknown }> => ({
      data:
        name === "worker_claim_business_email"
          ? [{ id, claim_token: token }]
          : name === "worker_prepare_business_email"
            ? prepare
            : true,
      error: null,
    }),
  );
  const send = vi.fn(async () => "accepted" as const);
  const close = vi.fn();
  return {
    rpc,
    send,
    close,
    dependencies: {
      database: () => ({ rpc }) as EmailWorkerDatabase,
      transport: () => ({ send, close }),
    },
  };
}

describe("private business email worker", () => {
  it("checks its own bearer secret before DB or transport and never echoes it", async () => {
    const f = fixture();
    const response = await handleBusinessEmail(
      request("wrong"),
      values,
      f.dependencies,
    );
    expect(response.status).toBe(401);
    expect(f.rpc).not.toHaveBeenCalled();
    expect(f.send).not.toHaveBeenCalled();
    expect(await response.text()).not.toContain(values.BUSINESS_EMAIL_SECRET);
  });
  it("reports disabled without reading or sending, and rejects enabled bad configuration", async () => {
    const f = fixture();
    expect((await processBusinessEmail({}, f.dependencies)).configured).toBe(
      false,
    );
    expect(f.rpc).not.toHaveBeenCalled();
    const response = await handleBusinessEmail(
      request(),
      { ...values, BUSINESS_EMAIL_SMTP_HOST: "external.example" },
      f.dependencies,
    );
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: "Email processing unavailable",
    });
  });
  it("claims a bounded batch, revalidates before transport and records accepted rather than delivered", async () => {
    const f = fixture();
    const response = await handleBusinessEmail(
      request(),
      values,
      f.dependencies,
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      configured: true,
      claimed: 1,
      accepted: 1,
      retry: 0,
      failed: 0,
      uncertain: 0,
      cancelled: 0,
    });
    expect(f.rpc.mock.calls.map((c) => c[0])).toEqual([
      "worker_claim_business_email",
      "worker_prepare_business_email",
      "worker_finish_business_email",
    ]);
    expect(f.rpc).toHaveBeenNthCalledWith(1, "worker_claim_business_email", {
      p_limit: 1,
    });
    expect(f.rpc).toHaveBeenLastCalledWith("worker_finish_business_email", {
      p_id: id,
      p_token: token,
      p_outcome: "accepted",
    });
    expect(f.send).toHaveBeenCalledTimes(1);
    expect(f.close).toHaveBeenCalledTimes(1);
  });
  it("does not deliver an event cancelled by current-source preparation", async () => {
    const f = fixture([]);
    expect((await processBusinessEmail(values, f.dependencies)).cancelled).toBe(
      1,
    );
    expect(f.send).not.toHaveBeenCalled();
    expect(f.rpc).toHaveBeenCalledTimes(2);
  });
  it("turns an unknown transport failure into uncertain without an in-request retry", async () => {
    const f = fixture();
    f.send.mockRejectedValueOnce(
      new Error("synthetic SMTP reply lost with private details"),
    );
    const response = await handleBusinessEmail(
      request(),
      values,
      f.dependencies,
    );
    expect(response.status).toBe(503);
    const body = await response.text();
    expect(body).toContain('"uncertain":1');
    expect(body).not.toContain("private");
    expect(f.send).toHaveBeenCalledTimes(1);
    expect(f.rpc).toHaveBeenLastCalledWith("worker_finish_business_email", {
      p_id: id,
      p_token: token,
      p_outcome: "uncertain",
    });
  });
  it("does not resend after SMTP acceptance when saving the result fails", async () => {
    const f = fixture();
    f.rpc.mockImplementation(async (name: string) => ({
      data:
        name === "worker_claim_business_email"
          ? [{ id, claim_token: token }]
          : name === "worker_prepare_business_email"
            ? [prepared]
            : null,
      error:
        name === "worker_finish_business_email" ? { private: "details" } : null,
    }));
    const response = await handleBusinessEmail(
      request(),
      values,
      f.dependencies,
    );
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: "Email processing unavailable",
    });
    expect(f.send).toHaveBeenCalledTimes(1);
    expect(f.close).toHaveBeenCalledTimes(1);
  });
  it("finishes a stalled SMTP request as uncertain within its overall deadline", async () => {
    vi.useFakeTimers();
    const f = fixture();
    f.send.mockImplementation(() => new Promise(() => {}));
    try {
      const processing = processBusinessEmail(values, f.dependencies);
      await vi.advanceTimersByTimeAsync(20001);
      expect((await processing).uncertain).toBe(1);
      expect(f.send).toHaveBeenCalledTimes(1);
      expect(f.close).toHaveBeenCalledTimes(1);
      expect(f.rpc).toHaveBeenLastCalledWith("worker_finish_business_email", {
        p_id: id,
        p_token: token,
        p_outcome: "uncertain",
      });
    } finally {
      vi.useRealTimers();
    }
  });
});
