import { EventEmitter } from "node:events";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({
  read: vi.fn(),
  spawn: vi.fn(),
  mkdir: vi.fn(),
  write: vi.fn(),
  chmod: vi.fn(),
}));
vi.mock("node:fs", () => ({
  readFileSync: m.read,
  mkdirSync: m.mkdir,
  writeFileSync: m.write,
  chmodSync: m.chmod,
}));
vi.mock("node:child_process", () => ({ spawn: m.spawn }));
const argv = process.argv;
const exitCode = process.exitCode;
let completed = false;
let child: EventEmitter & { kill: ReturnType<typeof vi.fn> };
function environment(
  api = "http://127.0.0.1:54321",
  app = "http://localhost:3000",
) {
  return `NEXT_PUBLIC_SUPABASE_URL=${api}\nNEXT_PUBLIC_APP_URL=${app}\nNEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=local-public\nSUPABASE_SECRET_KEY=local-private\n`;
}
beforeEach(() => {
  vi.resetModules();
  vi.resetAllMocks();
  process.argv = [process.execPath, "scripts/local-app.mjs", "dev"];
  child = Object.assign(new EventEmitter(), { kill: vi.fn() });
  completed = false;
  m.spawn.mockReturnValue(child);
  m.read.mockReturnValue(environment());
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  if (!completed) child.emit("exit", 0);
  process.argv = argv;
  process.exitCode = exitCode;
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});
it("overrides inherited cloud credentials before Next starts and never prints either key", async () => {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://hosted.supabase.co");
  vi.stubEnv("SUPABASE_SECRET_KEY", "hosted-secret");
  vi.stubEnv("NODE_OPTIONS", "--env-file=.env.local");
  await import("../scripts/local-app.mjs");
  expect(m.read.mock.calls[0][0]).toMatch(/\/\.env\.test\.local$/);
  const [, args, options] = m.spawn.mock.calls[0];
  expect(args).toEqual([
    "node_modules/next/dist/bin/next",
    "dev",
    "--hostname",
    "127.0.0.1",
    "--port",
    "3000",
  ]);
  expect(options.env).toMatchObject({
    NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
    SUPABASE_SECRET_KEY: "local-private",
    NEXT_PUBLIC_APP_URL: "http://localhost:3000",
    NODE_ENV: "development",
  });
  expect(options.env.NODE_OPTIONS).toBeUndefined();
  expect(JSON.stringify(vi.mocked(console.log).mock.calls)).not.toMatch(
    /local-private|local-public|hosted-secret/,
  );
});
it.each([
  ["https://hosted.supabase.co", "http://localhost:3000"],
  ["http://localhost.evil.test", "http://localhost:3000"],
  ["http://u:password@localhost", "http://localhost:3000"],
  ["http://localhost/path", "http://localhost:3000"],
  ["http://localhost?redirect=cloud", "http://localhost:3000"],
  ["http://127.0.0.1:54321", "https://psipawer.vercel.app"],
])(
  "refuses an unsafe environment before spawning: %s, %s",
  async (api, app) => {
    m.read.mockReturnValue(environment(api, app));
    await import("../scripts/local-app.mjs");
    expect(m.spawn).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
  },
);
it("does not fall back to hosted configuration when the local file is missing", async () => {
  m.read.mockImplementation(() => {
    throw new Error("ENOENT");
  });
  await import("../scripts/local-app.mjs");
  expect(m.spawn).not.toHaveBeenCalled();
  expect(process.exitCode).toBe(1);
});
it("runs selected browser tests with the same explicitly local environment", async () => {
  process.argv = [
    process.execPath,
    "scripts/local-app.mjs",
    "e2e",
    "registration.spec.ts",
  ];
  await import("../scripts/local-app.mjs");
  expect(m.spawn.mock.calls[0][1]).toEqual([
    "node_modules/@playwright/test/cli.js",
    "test",
    "registration.spec.ts",
  ]);
  expect(m.spawn.mock.calls[0][2].env.NODE_ENV).toBe("test");
});

it("builds an isolated local preview and seals its exact public configuration only after success", async () => {
  process.argv[2] = "build";
  m.read.mockImplementation((path: string) =>
    path.endsWith("BUILD_ID") ? "build-fixture\n" : environment(),
  );
  await import("../scripts/local-app.mjs");
  expect(m.spawn.mock.calls[0][1]).toEqual([
    "node_modules/next/dist/bin/next",
    "build",
  ]);
  expect(m.spawn.mock.calls[0][2].env).toMatchObject({
    NODE_ENV: "production",
    PSI_LOCAL_PREVIEW: "1",
  });
  expect(JSON.parse(m.write.mock.calls[0][1])).toMatchObject({
    status: "building",
    buildId: null,
  });
  child.emit("exit", 0);
  completed = true;
  expect(JSON.parse(m.write.mock.calls[1][1])).toMatchObject({
    status: "ready",
    buildId: "build-fixture",
  });
  expect(m.write.mock.calls[1][1]).not.toMatch(/local-public|local-private/);
  expect(m.chmod).toHaveBeenCalledWith(
    expect.stringMatching(/preview-build\.json$/),
    0o600,
  );
});

it("does not mark a failed build ready", async () => {
  process.argv[2] = "build";
  await import("../scripts/local-app.mjs");
  child.emit("exit", 1);
  completed = true;
  expect(m.write).toHaveBeenCalledTimes(1);
  expect(JSON.parse(m.write.mock.calls[0][1]).status).toBe("building");
  expect(process.exitCode).toBe(1);
});

it.each(["same", "new-key", "different-build", "unfinished"])(
  "validates preview provenance: %s",
  async (scenario) => {
    process.argv[2] = "build";
    m.read.mockImplementation((path: string) =>
      path.endsWith("BUILD_ID") ? "build-fixture" : environment(),
    );
    await import("../scripts/local-app.mjs");
    child.emit("exit", 0);
    completed = true;
    const manifest = JSON.parse(m.write.mock.calls[1][1]);
    if (scenario === "unfinished") manifest.status = "building";
    vi.resetModules();
    m.spawn.mockClear();
    process.exitCode = undefined;
    process.argv[2] = "preview";
    child = Object.assign(new EventEmitter(), { kill: vi.fn() });
    completed = false;
    m.spawn.mockReturnValue(child);
    m.read.mockImplementation((path: string) => {
      if (path.endsWith("preview-build.json")) return JSON.stringify(manifest);
      if (path.endsWith("BUILD_ID"))
        return scenario === "different-build"
          ? "unknown-build"
          : "build-fixture";
      return scenario === "new-key"
        ? environment().replace("local-public", "changed-public")
        : environment();
    });
    await import("../scripts/local-app.mjs");
    if (scenario === "same") {
      expect(m.spawn.mock.calls[0][1]).toEqual([
        "node_modules/next/dist/bin/next",
        "start",
        "--hostname",
        "127.0.0.1",
        "--port",
        "3000",
      ]);
      expect(m.spawn.mock.calls[0][2].env).toMatchObject({
        NODE_ENV: "production",
        PSI_LOCAL_PREVIEW: "1",
      });
    } else {
      expect(m.spawn).not.toHaveBeenCalled();
      expect(process.exitCode).toBe(1);
    }
  },
);
