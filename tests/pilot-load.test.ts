import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import {
  pilotConfiguration,
  pooled,
  measurements,
} from "./helpers/pilot-load.mjs";

const values = {
  NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
  NEXT_PUBLIC_APP_URL: "http://localhost:3000",
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "local-public",
  SUPABASE_SECRET_KEY: "local-secret",
};
const manifest = {
  version: 1,
  status: "ready",
  buildId: "local-build",
  fingerprint: createHash("sha256")
    .update(
      JSON.stringify([
        values.NEXT_PUBLIC_SUPABASE_URL,
        values.NEXT_PUBLIC_APP_URL,
        values.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
      ]),
    )
    .digest("hex"),
};

it.each([
  "https://hosted.supabase.co",
  "http://localhost.evil.test:54321",
  "http://user:password@127.0.0.1:54321",
  "http://127.0.0.1:54321/path",
  "http://127.0.0.1:54321?redirect=remote",
  "http://127.0.0.1:54321#remote",
])("blocks unsafe load configuration before any setup: %s", (url) => {
  expect(() =>
    pilotConfiguration(
      { ...values, NEXT_PUBLIC_SUPABASE_URL: url },
      manifest,
      "local-build",
    ),
  ).toThrow();
});
it("requires the matching compiled local environment, rather than accepting a stale manifest", () => {
  expect(pilotConfiguration(values, manifest, "local-build\n").app).toBe(
    "http://localhost:3000",
  );
  for (const changed of [
    { ...manifest, status: "building" },
    { ...manifest, buildId: "older-build" },
    { ...manifest, fingerprint: "other-key" },
  ])
    expect(() => pilotConfiguration(values, changed, "local-build")).toThrow();
  expect(() =>
    pilotConfiguration(
      { ...values, NEXT_PUBLIC_APP_URL: "https://psipawer.vercel.app" },
      manifest,
      "local-build",
    ),
  ).toThrow();
});
it("measures the nearest-rank p95 over every sample, including failures", () => {
  const samples = Array.from({ length: 100 }, (_, i) => ({
    ms: i + 1,
    ok: i !== 99,
  }));
  expect(measurements(samples)).toEqual({
    requests: 100,
    p50_ms: 50,
    p95_ms: 95,
    max_ms: 100,
    errors: 1,
  });
});
it("waits for other in-flight work to finish after one worker fails, before callers can clean up", async () => {
  const order: number[] = [];
  let finishOther!: () => void;
  const other = new Promise<void>((resolve) => {
    finishOther = resolve;
  });
  const run = pooled([0, 1], 2, async (item: number) => {
    if (item === 0) throw new Error("synthetic failure");
    await other;
    order.push(item);
  });
  let settled = false;
  const result = run.catch((error: Error) => {
    settled = true;
    return error.message;
  });
  await Promise.resolve();
  expect(settled).toBe(false);
  finishOther();
  expect(await result).toBe("synthetic failure");
  expect(order).toEqual([1]);
});
