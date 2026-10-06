// Reads only the local CLI status; never links, migrates, resets or contacts a hosted project.
import { execFileSync } from "node:child_process";
import { writeFileSync, openSync, fchmodSync, closeSync } from "node:fs";
import { parseEnv } from "node:util";

function writePrivateEnv(path, content) {
  const fd = openSync(path, "w", 0o600);
  try {
    fchmodSync(fd, 0o600);
    writeFileSync(fd, content);
  } finally {
    closeSync(fd);
  }
}

try {
  const values = parseEnv(
    execFileSync("supabase", ["status", "-o", "env"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }),
  );
  const url = new URL(values.API_URL);
  if (
    !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) ||
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    !values.ANON_KEY ||
    !values.SERVICE_ROLE_KEY
  )
    throw new Error("Invalid local status");
  const publicEnv = [
    `NEXT_PUBLIC_SUPABASE_URL=${url.origin}`,
    `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=${values.ANON_KEY}`,
    "NEXT_PUBLIC_APP_URL=http://localhost:3000",
    "AUTH_EMAIL_ENABLED=true",
    "CLIENT_INVITATIONS_ENABLED=true",
  ].join("\n");
  writePrivateEnv(
    ".env.development.local",
    `${publicEnv}\nSUPABASE_SECRET_KEY=${values.SERVICE_ROLE_KEY}\n`,
  );
  writePrivateEnv(
    ".env.test.local",
    `${publicEnv}\nSUPABASE_SECRET_KEY=${values.SERVICE_ROLE_KEY}\n`,
  );
  console.log(
    "Lokalna aplikacja i testy wskazują lokalny Supabase. Konfiguracja chmury pozostaje bez zmian.",
  );
} catch {
  console.error(
    "Najpierw uruchom Docker i lokalny Supabase (supabase start). Następnie ponów pnpm local:env. Żadnych kluczy nie zapisano w logach.",
  );
  process.exitCode = 1;
}
