// Operator-only tool. Does not read .env files, send messages, verify tokens,
// update passwords/roles/profiles, or use the application's SMTP adapter.
import { createClient } from "@supabase/supabase-js";
import { closeSync, unlinkSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  AccessError,
  accessTarget,
  planAccess,
  applyAccess,
  supabaseAccessAdapter,
  privateAccessFiles,
  writeAccessCheckpoint,
} from "./lib/manual-client-access.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const writeDurable = writeAccessCheckpoint;
function fail(code) {
  throw new AccessError(code);
}
function argumentsFor(argv) {
  const [command, ...rest] = argv;
  if (!["plan", "apply"].includes(command)) fail("usage_plan_or_apply");
  const args = { command };
  for (let index = 0; index < rest.length; index++) {
    const key = rest[index];
    if (key === "--allow-hosted") {
      if (args.allowHosted) fail("invalid_arguments");
      args.allowHosted = true;
      continue;
    }
    if (
      !["--input", "--plan", "--out", "--expiry", "--confirm-project"].includes(
        key,
      ) ||
      !rest[index + 1] ||
      rest[index + 1].startsWith("--")
    )
      fail("invalid_arguments");
    const name = key.slice(2);
    if (args[name]) fail("invalid_arguments");
    args[name] = rest[++index];
  }
  if (
    !args.out ||
    (command === "plan"
      ? !args.input || args.plan || args["confirm-project"]
      : !args.plan || args.input || args.expiry)
  )
    fail("invalid_arguments");
  return args;
}

async function main() {
  const args = argumentsFor(process.argv.slice(2));
  const {
    privateRoot,
    read: readPrivate,
    open: openPrivate,
  } = privateAccessFiles(root, process.env.PSI_MANUAL_PRIVATE_DIR);
  const target = accessTarget(process.env, args.allowHosted);
  const key = process.env.SUPABASE_SECRET_KEY?.trim();
  if (!key) fail("server_secret_required");
  const client = createClient(target.supabaseOrigin, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
    global: {
      fetch: (url, init) =>
        fetch(url, {
          ...init,
          redirect: "error",
          signal: AbortSignal.timeout(20000),
        }),
    },
  });
  const adapter = supabaseAccessAdapter(client);
  if (args.command === "plan") {
    const input = readPrivate(args.input);
    const expiry = args.expiry ? readPrivate(args.expiry) : null;
    const plan = await planAccess({ input, adapter, target, expiry });
    const output = openPrivate(args.out);
    try {
      writeDurable(output.fd, plan);
    } finally {
      closeSync(output.fd);
    }
    console.log(
      `Plan zapisany prywatnie. Adresy: ${plan.rows.length}; zablokowane: ${plan.rows.filter((r) => r.status === "blocked").length}. Auth bez zmian.`,
    );
    return;
  }
  if (args["confirm-project"] !== target.supabaseOrigin)
    fail("explicit_project_confirmation_required");
  const plan = readPrivate(args.plan);
  // A project-local lock coordinates this tool's operator processes. Other
  // account/role administration must be paused by the coordinator separately.
  const lock = openPrivate(resolve(privateRoot, "apply.lock"));
  try {
    writeDurable(lock.fd, { pid: process.pid, planId: plan.id });
    const output = openPrivate(args.out);
    try {
      writeDurable(output.fd, {
        version: 1,
        kind: "manual-client-access-result",
        planId: plan.id,
        target,
        expiry: plan.expiry,
        startedAt: new Date().toISOString(),
      });
      const result = await applyAccess({
        plan,
        adapter,
        target,
        checkpoint: (record) => writeDurable(output.fd, record),
      });
      writeDurable(output.fd, {
        kind: "completion",
        complete: result.complete,
        ready: result.records.filter((r) => r.status === "ready").length,
      });
      console.log(
        `Wynik zapisany prywatnie. Gotowe linki: ${result.records.filter((r) => r.status === "ready").length}; ukończono: ${result.complete ? "tak" : "nie"}. Nie wysłano wiadomości.`,
      );
      if (!result.complete) process.exitCode = 1;
    } finally {
      closeSync(output.fd);
    }
  } finally {
    closeSync(lock.fd);
    unlinkSync(lock.full);
  }
}
main().catch((error) => {
  // Never serialize provider errors, requests, URLs, recipient data or tokens.
  console.error(
    error instanceof AccessError
      ? error.message
      : "manual_access_operation_failed",
  );
  process.exitCode = 1;
});
