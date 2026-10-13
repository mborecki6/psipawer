// Explicit local configuration only; never reads hosted .env.local.
import { readFileSync } from "node:fs";
import { parseEnv } from "node:util";
import { pathToFileURL } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { localServiceConfig } from "./lib/local-service-config.mjs";
import { processPushDeliveries } from "../src/lib/push-worker.mjs";

export async function processLocalPush(values, request = fetch, send) {
  return processPushDeliveries(
    localServiceConfig(values),
    values,
    request,
    send,
  );
}
async function main() {
  const flags = process.argv.slice(2);
  if (
    flags.length > 1 ||
    flags.some((flag) => !["--once", "--watch"].includes(flag))
  )
    throw new Error("Unknown option");
  const watch = flags.includes("--watch");
  const values = parseEnv(readFileSync(".env.test.local", "utf8"));
  const shutdown = new AbortController();
  for (const signal of ["SIGINT", "SIGTERM"])
    process.once(signal, () => shutdown.abort());
  do {
    try {
      const result = await processLocalPush(values);
      if (!result.configured)
        console.log(
          "Push lokalny: brak konfiguracji VAPID. Skrzynka aplikacji działa niezależnie.",
        );
      else
        console.log(
          `Push lokalny: przyjęte ${result.accepted}, ponowienia ${result.retry}, błędy ${result.failed}, wygasłe ${result.expired}, pominięte ${result.skipped}.`,
        );
    } catch {
      console.error(
        "Nie udało się obsłużyć lokalnej kolejki push. Sprawdź konfigurację i lokalny Supabase.",
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
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  main().catch(() => {
    console.error(
      "Push korzysta wyłącznie z lokalnego .env.test.local. Uruchom lokalny Supabase i przygotuj konfigurację.",
    );
    process.exitCode = 1;
  });
