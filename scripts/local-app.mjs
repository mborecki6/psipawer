// Explicit local-only environment for Next and browser tests. Passing Node's
// --env-file to Next dev is unsupported by its child-process NODE_OPTIONS.
import { spawn } from "node:child_process";
import { readFileSync, mkdirSync, writeFileSync, chmodSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, resolve, delimiter } from "node:path";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
function localOrigin(value) {
  const url = new URL(value);
  if (
    !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) ||
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  )
    throw new Error("nonlocal");
  return url.origin;
}
try {
  const command = process.argv[2] || "dev";
  if (!["dev", "e2e", "build", "preview"].includes(command))
    throw new Error("command");
  const values = parseEnv(
    readFileSync(resolve(root, ".env.test.local"), "utf8"),
  );
  const api = localOrigin(values.NEXT_PUBLIC_SUPABASE_URL);
  const app = localOrigin(values.NEXT_PUBLIC_APP_URL);
  if (
    app !== "http://localhost:3000" ||
    !values.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
    !values.SUPABASE_SECRET_KEY
  )
    throw new Error("configuration");
  const preview = command === "build" || command === "preview";
  const manifestPath = resolve(root, ".local/preview-build.json");
  const buildIdPath = resolve(root, ".next-local/BUILD_ID");
  const fingerprint = createHash("sha256")
    .update(
      JSON.stringify([api, app, values.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY]),
    )
    .digest("hex");
  function saveManifest(status, buildId = null) {
    mkdirSync(dirname(manifestPath), { recursive: true });
    writeFileSync(
      manifestPath,
      JSON.stringify({ version: 1, status, fingerprint, buildId }) + "\n",
      { mode: 0o600 },
    );
    chmodSync(manifestPath, 0o600);
  }
  if (command === "preview") {
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    if (
      manifest.version !== 1 ||
      manifest.status !== "ready" ||
      manifest.fingerprint !== fingerprint ||
      manifest.buildId !== readFileSync(buildIdPath, "utf8").trim()
    )
      throw new Error("preview-build");
  }
  // A failed/interrupted build cannot be mistaken for a ready local preview.
  if (command === "build") saveManifest("building");
  const env = {
    ...process.env,
    PATH: [dirname(process.execPath), process.env.PATH || ""].join(delimiter),
    NEXT_PUBLIC_SUPABASE_URL: api,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:
      values.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    SUPABASE_SECRET_KEY: values.SUPABASE_SECRET_KEY,
    NEXT_PUBLIC_APP_URL: app,
    AUTH_EMAIL_ENABLED: "true",
    CLIENT_INVITATIONS_ENABLED: "true",
    NEXT_TELEMETRY_DISABLED: "1",
    NODE_ENV:
      command === "dev" ? "development" : preview ? "production" : "test",
    PSI_LOCAL_PREVIEW: preview ? "1" : "0",
  };
  delete env.NODE_OPTIONS;
  const args =
    command === "dev" || command === "preview"
      ? [
          "node_modules/next/dist/bin/next",
          command === "preview" ? "start" : "dev",
          "--hostname",
          "127.0.0.1",
          "--port",
          "3000",
        ]
      : command === "build"
        ? ["node_modules/next/dist/bin/next", "build"]
        : [
            "node_modules/@playwright/test/cli.js",
            "test",
            ...process.argv.slice(3),
          ];
  console.log(`Lokalny tryb ${command}: ${app}, baza: ${api}`);
  const child = spawn(process.execPath, args, {
    cwd: root,
    env,
    stdio: "inherit",
  });
  const interrupt = () => child.kill("SIGINT");
  const terminate = () => child.kill("SIGTERM");
  const cleanup = () => {
    process.off("SIGINT", interrupt);
    process.off("SIGTERM", terminate);
  };
  process.on("SIGINT", interrupt);
  process.on("SIGTERM", terminate);
  child.once("error", () => {
    cleanup();
    console.error("Nie udało się uruchomić lokalnej aplikacji lub testów.");
    process.exitCode = 1;
  });
  child.once("exit", (code) => {
    cleanup();
    process.exitCode = code ?? 1;
    if (command === "build" && code === 0) {
      try {
        const buildId = readFileSync(buildIdPath, "utf8").trim();
        if (!buildId) throw new Error("missing-build");
        saveManifest("ready", buildId);
      } catch {
        console.error(
          "Nie udało się potwierdzić lokalnego builda. Uruchom pnpm local:build ponownie.",
        );
        process.exitCode = 1;
      }
    }
  });
} catch {
  console.error(
    "Wymagana poprawna lokalna konfiguracja .env.test.local. Uruchom pnpm local:start. Podgląd wymaga wcześniejszego pnpm local:build z tymi samymi ustawieniami. Dostępne tryby: dev, e2e, build, preview.",
  );
  process.exitCode = 1;
}
