// Project-scoped macOS/Apple Silicon runtime. Never reads hosted .env.local,
// uses the default Docker context, logs in, links or sends a migration to cloud.
import { spawn, execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  openSync,
  closeSync,
  fchmodSync,
} from "node:fs";
import { resolve, dirname, delimiter } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const local = resolve(root, ".local");
const lima = resolve(local, "tools/lima-2.2.0/bin/limactl");
const docker = resolve(local, "tools/docker-29.8.1/docker/docker");
const supabase = resolve(local, "tools/supabase-2.117.0/supabase");
const network = "psi-pawer-local";
const env = {
  ...process.env,
  PATH: [
    dirname(lima),
    dirname(docker),
    dirname(supabase),
    dirname(process.execPath),
    process.env.PATH || "",
  ].join(delimiter),
  LIMA_HOME: resolve(local, "lima"),
  SUPABASE_HOME: resolve(local, "supabase-home"),
  SUPABASE_TELEMETRY_DISABLED: "1",
  DO_NOT_TRACK: "1",
  DOCKER_HOST: `unix://${resolve(local, "lima/psi/sock/docker.sock")}`,
  DOCKER_CONFIG: resolve(local, "docker-config"),
};
for (const key of [
  "SUPABASE_ACCESS_TOKEN",
  "SUPABASE_DB_PASSWORD",
  "SUPABASE_PROJECT_ID",
  "SUPABASE_PROJECT_REF",
  "SUPABASE_PROFILE",
  "DOCKER_CONTEXT",
  "DOCKER_TLS_VERIFY",
  "DOCKER_CERT_PATH",
])
  delete env[key];

function capture(file, args) {
  return execFileSync(file, args, {
    cwd: root,
    env,
    encoding: "utf8",
    timeout: 30000,
    stdio: ["ignore", "pipe", "pipe"],
  });
}
async function run(file, args, logName) {
  const fd = openSync(resolve(local, logName), "w", 0o600);
  fchmodSync(fd, 0o600);
  try {
    await new Promise((done, fail) => {
      const child = spawn(file, args, {
        cwd: root,
        env,
        stdio: ["ignore", fd, fd],
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
        fail(
          new Error(
            `Nie udało się uruchomić narzędzia. Log: .local/${logName}`,
          ),
        );
      });
      child.once("exit", (code) => {
        cleanup();
        if (code === 0) done();
        else
          fail(
            new Error(
              `Operacja nie zakończyła się poprawnie. Prywatny log: .local/${logName}`,
            ),
          );
      });
    });
  } finally {
    closeSync(fd);
  }
}
function vmRunning() {
  const rows = capture(lima, ["list", "--json"])
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  return rows.some((row) => row.name === "psi" && row.status === "Running");
}
async function waitForExistingDatabase() {
  // Docker restarts preserved containers with the VM. The CLI fails early if
  // it sees an existing DB whose initial health check is still in progress.
  const deadline = Date.now() + 60000;
  while (true) {
    let state;
    try {
      state = capture(docker, [
        "inspect",
        "--format",
        "{{.State.Status}} {{if .State.Health}}{{.State.Health.Status}}{{end}}",
        "supabase_db_psi-pawer",
      ]).trim();
    } catch {
      return;
    } // First installation: Supabase will create the DB.
    if (state !== "running starting") return;
    if (Date.now() >= deadline)
      throw new Error(
        "Lokalna baza nadal się uruchamia. Sprawdź jej stan przed ponowieniem startu.",
      );
    await new Promise((done) => setTimeout(done, 1000));
  }
}
async function main() {
  const command = process.argv[2];
  if (!["start", "stop", "status", "env"].includes(command))
    throw new Error(
      "Użycie: node scripts/local-stack.mjs start|stop|status|env",
    );
  if (process.platform !== "darwin" || process.arch !== "arm64")
    throw new Error(
      "Ten pomocnik dotyczy przygotowanego środowiska macOS Apple Silicon. Inne środowiska: docs/LOCAL-DEVELOPMENT.md.",
    );
  for (const file of [lima, docker, supabase])
    if (!existsSync(file))
      throw new Error(
        "Brakuje lokalnych narzędzi. Zobacz docs/LOCAL-DEVELOPMENT.md.",
      );
  for (const dir of [local, env.SUPABASE_HOME, env.DOCKER_CONFIG])
    mkdirSync(dir, { recursive: true, mode: 0o700 });
  if (command === "start") {
    console.log("Uruchamiam lokalną maszynę testową (2 rdzenie, 4 GB RAM).");
    const exists = existsSync(resolve(env.LIMA_HOME, "psi/lima.yaml"));
    await run(
      lima,
      exists
        ? ["start", "psi", "--tty=false"]
        : [
            "start",
            "--name=psi",
            "--vm-type=vz",
            "--cpus=2",
            "--memory=4",
            "--disk=24",
            "--image-variant=minimal",
            `--mount-only=${resolve(root, "supabase")}:w`,
            "--tty=false",
            "template:docker-rootful",
          ],
      "vm-start.log",
    );
    // A VM first created with a read-only mount may retain that flag in its
    // guest mount table after limactl edit. Only repair this project's mount.
    const mount = resolve(root, "supabase");
    const mountOptions = capture(lima, [
      "shell",
      "psi",
      "findmnt",
      "-n",
      "-o",
      "OPTIONS",
      "--mountpoint",
      mount,
    ])
      .trim()
      .split(",");
    if (mountOptions.includes("ro")) {
      capture(lima, [
        "shell",
        "psi",
        "sudo",
        "mount",
        "-o",
        "remount,rw",
        mount,
      ]);
    }
    let inspected;
    try {
      inspected = capture(docker, ["network", "inspect", network]);
    } catch {
      capture(docker, [
        "network",
        "create",
        "--driver",
        "bridge",
        "--opt",
        "com.docker.network.bridge.host_binding_ipv4=127.0.0.1",
        network,
      ]);
    }
    if (
      inspected &&
      JSON.parse(inspected)[0]?.Options?.[
        "com.docker.network.bridge.host_binding_ipv4"
      ] !== "127.0.0.1"
    )
      throw new Error(
        "Sieć testowa nie ogranicza portów do localhost. Popraw jej konfigurację przed startem.",
      );
    console.log("Uruchamiam Supabase i sprawdzam gotowość lokalnych usług.");
    await waitForExistingDatabase();
    await run(
      supabase,
      [
        "start",
        "--network-id",
        network,
        "--exclude",
        "imgproxy,edge-runtime,logflare,vector,supavisor",
      ],
      "stack-start.log",
    );
    console.log(
      capture(process.execPath, [
        resolve(root, "scripts/local-env.mjs"),
      ]).trim(),
    );
    console.log("Baza gotowa. Uruchom aplikację poleceniem pnpm local:dev.");
  } else if (command === "env") {
    console.log(
      capture(process.execPath, [
        resolve(root, "scripts/local-env.mjs"),
      ]).trim(),
    );
  } else if (command === "stop") {
    if (!vmRunning()) {
      console.log("Lokalna maszyna jest zatrzymana.");
      return;
    }
    await run(supabase, ["stop"], "stack-stop.log");
    await run(lima, ["stop", "psi", "--tty=false"], "vm-stop.log");
    console.log("Lokalne usługi zatrzymane. Dane testowe są zachowane.");
  } else {
    if (!vmRunning()) {
      console.log("Lokalna maszyna jest zatrzymana.");
      return;
    }
    const status = JSON.parse(capture(supabase, ["status", "-o", "json"]));
    console.log(
      JSON.stringify(
        {
          running: true,
          api: status.API_URL || null,
          studio: status.STUDIO_URL || null,
          mailbox: status.INBUCKET_URL || status.MAILPIT_URL || null,
        },
        null,
        2,
      ),
    );
  }
}
main().catch((error) => {
  // Do not print child-process errors: CLI status can contain local credentials.
  console.error(
    error.status !== undefined
      ? "Narzędzie lokalne zgłosiło błąd. Sprawdź stan maszyny i prywatne logi w .local/."
      : error.message,
  );
  process.exitCode = 1;
});
