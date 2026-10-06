// Test-only preload for a real CLI child. It holds a successful real response
// before the shipped worker consumes it; no API response is fabricated.
import assert from "node:assert/strict";
import { resolve } from "node:path";

assert.equal(process.argv[1], resolve("scripts/reminders.mjs"));
assert.equal(typeof process.send, "function");
const request = globalThis.fetch;
let intercepted = false;
globalThis.fetch = async (input, init) => {
  assert.equal(
    input,
    "http://127.0.0.1:54321/rest/v1/rpc/worker_process_due_reminders",
  );
  assert.equal(init.method, "POST");
  assert.equal(init.redirect, "error");
  const response = await request(input, init);
  if (intercepted || !response.ok) return response;
  intercepted = true;
  const result = await response.clone().json();
  const counters = ["sent", "failed", "cancelled", "skipped"];
  assert(
    counters.every(
      (k) =>
        Number.isSafeInteger(result[k]) && result[k] >= 0 && result[k] <= 50,
    ),
  );
  const release = new Promise((done) => {
    process.on("message", (message) => {
      if (message === "release-reminder-response") done();
    });
  });
  process.send({
    event: "reminder-response-ready",
    status: response.status,
    counts: Object.fromEntries(counters.map((k) => [k, result[k]])),
  });
  await release;
  return response;
};
