// One-shot cleanup of retired files in this project's local Storage only.
import { readFileSync } from "node:fs";
import { parseEnv } from "node:util";
import { pathToFileURL } from "node:url";
import { processLocalAvatarCleanup } from "./lib/avatar-cleanup.mjs";
export { processLocalAvatarCleanup } from "./lib/avatar-cleanup.mjs";

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  (async () => {
    if (process.argv.length !== 2) throw new Error("Unknown option");
    const result = await processLocalAvatarCleanup(
      parseEnv(readFileSync(".env.test.local", "utf8")),
    );
    console.log(
      `Zdjęcia lokalne: usunięte ${result.completed}, do ponowienia ${result.failed}.`,
    );
    if (result.failed) process.exitCode = 1;
  })().catch(() => {
    console.error(
      "Nie udało się posprzątać zdjęć. Sprawdź lokalny Supabase i migracje.",
    );
    process.exitCode = 1;
  });
}
