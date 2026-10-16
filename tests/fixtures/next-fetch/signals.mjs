import { AsyncLocalStorage } from "node:async_hooks";
import { readFile } from "node:fs/promises";

globalThis.AsyncLocalStorage ??= AsyncLocalStorage;
// Every origin response below is a finite fixture. A mistaken native fetch
// must fail rather than perform network I/O in this isolated unit process.
globalThis.fetch = async () => {
  throw new Error("Next fetch fixture forbids network I/O");
};

const { default: React } = await import("react");
const { default: ts } = await import("typescript");
const { createPatchedFetcher } =
  await import("next/dist/server/lib/patch-fetch.js");
const { createDedupeFetch } =
  await import("next/dist/server/lib/dedupe-fetch.js");
const { workAsyncStorage } =
  await import("next/dist/server/app-render/work-async-storage.external.js");
const { workUnitAsyncStorage } =
  await import("next/dist/server/app-render/work-unit-async-storage.external.js");

const source = await readFile(
  new URL("../../../src/lib/supabase/server-fetch.ts", import.meta.url),
  "utf8",
);
const compiled = ts.transpileModule(
  source.replace('import "server-only";', ""),
  {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
    },
  },
).outputText;
const { createServerFetch } = await import(
  "data:text/javascript;base64," + Buffer.from(compiled).toString("base64")
);

const cache = new Map();
React.__SERVER_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE.A = {
  getCacheForType(factory) {
    if (!cache.has(factory)) cache.set(factory, factory());
    return cache.get(factory);
  },
};
const workStore = {
  route: "/fixture",
  isStaticGeneration: false,
  isBuildTimePrerendering: false,
  isDraftMode: false,
  forceDynamic: true,
  nextFetchId: 1,
  shouldTrackFetchMetrics: false,
};
const requestStore = { type: "request", phase: "render", isHmrRefresh: false };
const results = [];
let current;
const origin = async (input, init) => {
  if (
    workAsyncStorage.getStore() !== workStore ||
    workUnitAsyncStorage.getStore() !== requestStore
  ) {
    throw new Error("Next fetch fixture lost its shared stores");
  }
  const request = new Request(input, init);
  request.signal.throwIfAborted();
  const ordinal = String(++current.calls);
  return new Response(request.method === "HEAD" ? null : `result ${ordinal}`, {
    headers: { "x-fixture-call": ordinal },
  });
};
const nextFetch = createPatchedFetcher(createDedupeFetch(origin), {
  workAsyncStorage,
  workUnitAsyncStorage,
});
const wrappedFetch = createServerFetch(nextFetch, 1);

await workAsyncStorage.run(workStore, () =>
  workUnitAsyncStorage.run(requestStore, async () => {
    for (const method of ["GET", "HEAD"]) {
      for (const mode of [
        "explicit",
        "absent",
        "undefined",
        "null",
        "inherited",
      ]) {
        for (const inputType of ["url", "request"]) {
          if (mode === "inherited" && inputType === "url") continue;
          for (const wrapped of [false, true]) {
            current = { method, mode, inputType, wrapped, calls: 0 };
            // Cases share actual Next/React stores but use separate fixture URLs,
            // so an earlier case cannot supply a later case's cached response.
            const url = `https://fixture.invalid/${method}/${mode}/${inputType}/${wrapped}`;
            const receipts = await Promise.all(
              [1, 2].map(async () => {
                const controller = new AbortController();
                // A null override must detach an already aborted Request signal.
                if (mode === "null") controller.abort();
                const input =
                  inputType === "request"
                    ? new Request(url, { method, signal: controller.signal })
                    : url;
                const signalOptions =
                  mode === "explicit"
                    ? { signal: new AbortController().signal }
                    : mode === "null"
                      ? { signal: null }
                      : mode === "undefined"
                        ? { signal: undefined }
                        : undefined;
                const init =
                  inputType === "url"
                    ? { method, ...signalOptions }
                    : signalOptions;
                const response = await (wrapped ? wrappedFetch : nextFetch)(
                  input,
                  init,
                );
                return {
                  receipt: response.headers.get("x-fixture-call"),
                  body: await response.text(),
                };
              }),
            );
            results.push({ ...current, receipts });
          }
        }
      }
    }
  }),
);

console.log(JSON.stringify(results));
