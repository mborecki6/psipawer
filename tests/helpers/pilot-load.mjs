import assert from "node:assert/strict";
import { createHash } from "node:crypto";

// The runner reads .env.test.local itself; inherited cloud credentials are
// ignored. Restrict origins before any account, network or SQL operation.
export function pilotConfiguration(values, manifest, buildId) {
  const api = new URL(values.NEXT_PUBLIC_SUPABASE_URL);
  const app = new URL(values.NEXT_PUBLIC_APP_URL);
  for (const url of [api, app]) {
    assert(
      url.protocol === "http:" &&
        ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) &&
        !url.username &&
        !url.password &&
        url.pathname === "/" &&
        !url.search &&
        !url.hash,
      "Pilot load requires local origins without credentials or redirects",
    );
  }
  assert.equal(api.origin, "http://127.0.0.1:54321");
  assert.equal(app.origin, "http://localhost:3000");
  const key = values.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  const secret = values.SUPABASE_SECRET_KEY;
  assert(key && secret, "Local credentials are required");
  const fingerprint = createHash("sha256")
    .update(JSON.stringify([api.origin, app.origin, key]))
    .digest("hex");
  assert(
    manifest.version === 1 &&
      manifest.status === "ready" &&
      manifest.fingerprint === fingerprint &&
      manifest.buildId === buildId.trim(),
    "Build local:build before running the pilot load",
  );
  return { api: api.origin, app: app.origin, key, secret };
}

// Await every started worker before cleanup, including on a failed operation.
export async function pooled(items, concurrency, operation) {
  assert(Number.isInteger(concurrency) && concurrency > 0);
  let cursor = 0;
  const results = new Array(items.length);
  const workers = await Promise.allSettled(
    Array.from({ length: Math.min(items.length, concurrency) }, async () => {
      for (;;) {
        const index = cursor++;
        if (index >= items.length) return;
        results[index] = await operation(items[index], index);
      }
    }),
  );
  const failed = workers.find((worker) => worker.status === "rejected");
  if (failed) throw failed.reason;
  return results;
}

export function measurements(samples) {
  assert(samples.length > 0);
  const times = samples.map((sample) => sample.ms).sort((a, b) => a - b);
  assert(times.every((ms) => Number.isFinite(ms) && ms >= 0));
  const percentile = (p) =>
    Math.round(times[Math.ceil(times.length * p) - 1] * 100) / 100;
  return {
    requests: samples.length,
    p50_ms: percentile(0.5),
    p95_ms: percentile(0.95),
    max_ms: times.at(-1),
    errors: samples.filter((sample) => !sample.ok).length,
  };
}
