// Local worker only. Explicit configuration; no fallback to hosted .env.local.
import { readFileSync } from "node:fs";
import { parseEnv } from "node:util";
import { pathToFileURL } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { localServiceConfig } from "./lib/local-service-config.mjs";

export const localReminderConfig = localServiceConfig;
export async function processLocalReminders(values, request = fetch) {
  const config = localReminderConfig(values);
  const response = await request(
    `${config.origin}/rest/v1/rpc/worker_process_due_reminders`,
    {
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(25000),
      headers: {
        "Content-Type": "application/json",
        apikey: config.key,
        Authorization: `Bearer ${config.key}`,
      },
      body: JSON.stringify({ p_limit: 50 }),
    },
  );
  if (!response.ok) throw new Error("Local reminder delivery failed");
  const result = await response.json();
  if (
    !result ||
    !["sent", "failed", "cancelled", "skipped"].every(
      (k) =>
        Number.isSafeInteger(result[k]) && result[k] >= 0 && result[k] <= 50,
    )
  )
    throw new Error("Invalid delivery response");
  // Output is rebuilt from counts, never raw provider responses or identifiers.
  return {
    sent: result.sent,
    failed: result.failed,
    cancelled: result.cancelled,
    skipped: result.skipped,
  };
}
async function main() {
  const flags = process.argv.slice(2);
  if (flags.some((f) => !["--once", "--watch"].includes(f)) || flags.length > 1)
    throw new Error("Unknown option");
  const watch = flags.includes("--watch");
  const values = parseEnv(readFileSync(".env.test.local", "utf8"));
  localReminderConfig(values);
  const shutdown = new AbortController();
  for (const signal of ["SIGINT", "SIGTERM"])
    process.once(signal, () => shutdown.abort());
  do {
    try {
      const result = await processLocalReminders(values);
      console.log(
        `Przypomnienia lokalne: w skrzynkach ${result.sent}, błędy ${result.failed}, wycofane ${result.cancelled}, odłożone ${result.skipped}.`,
      );
    } catch {
      console.error(
        "Nie udało się sprawdzić lokalnych przypomnień. Sprawdź lokalny Supabase i migracje.",
      );
      if (!watch) {
        process.exitCode = 1;
        return;
      }
    }
    if (watch && !shutdown.signal.aborted)
      await delay(30000, undefined, { signal: shutdown.signal }).catch(
        () => {},
      );
  } while (watch && !shutdown.signal.aborted);
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main().catch(() => {
    console.error(
      "Uruchom lokalny Supabase i pnpm local:env. Przypomnienia korzystają wyłącznie z lokalnego .env.test.local.",
    );
    process.exitCode = 1;
  });
}
