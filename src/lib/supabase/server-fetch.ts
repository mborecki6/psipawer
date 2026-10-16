import "server-only";

type Release = () => void;
type Acquire = (signal?: AbortSignal) => Promise<Release>;
type Waiting = {
  signal?: AbortSignal;
  abort: () => void;
  resolve: (release: Release) => void;
  reject: (reason: unknown) => void;
};

function createPool(maximum: number): Acquire {
  if (!Number.isInteger(maximum) || maximum < 1)
    throw new RangeError("Transport concurrency must be a positive integer.");
  let active = 0;
  const waiting: Waiting[] = [];
  function drain() {
    while (active < maximum && waiting.length) {
      const entry = waiting.shift()!;
      entry.signal?.removeEventListener("abort", entry.abort);
      if (entry.signal?.aborted) {
        entry.reject(entry.signal.reason);
        continue;
      }
      active++;
      let released = false;
      entry.resolve(() => {
        if (released) return;
        released = true;
        active--;
        drain();
      });
    }
  }
  return (signal) => {
    if (signal?.aborted) return Promise.reject(signal.reason);
    return new Promise<Release>((resolve, reject) => {
      const entry: Waiting = {
        signal,
        resolve,
        reject,
        abort() {
          const index = waiting.indexOf(entry);
          if (index < 0) return;
          waiting.splice(index, 1);
          signal?.removeEventListener("abort", entry.abort);
          reject(signal?.reason);
        },
      };
      signal?.addEventListener("abort", entry.abort, { once: true });
      waiting.push(entry);
      drain();
    });
  };
}

async function finishResponse(response: Response) {
  if (!response.body) return;
  // Supabase consumes finite JSON/Blob responses. Drain a standard clone so a
  // slot represents the full HTTP operation, not just arrival of its headers.
  // The original remains untouched, including URL/status/headers and its body.
  // Its unread branch buffers at most one response per occupied slot.
  const reader = response.clone().body!.getReader();
  try {
    while (!(await reader.read()).done) {
      // Drain without accumulating a second copy of the response.
    }
  } catch {
    // A fetch body error (including an active abort) errors both tee branches.
    // Return the original errored Response: the SDK distinguishes a body error
    // from a rejected fetch and must not gain a new transport retry here.
    // Canceling the original would replace its body error with "body used".
  } finally {
    reader.releaseLock();
  }
}

const nativeRequestOptions = [
  "body",
  "cache",
  "credentials",
  "headers",
  "integrity",
  "keepalive",
  "method",
  "mode",
  "redirect",
  "referrer",
  "referrerPolicy",
  "signal",
  "window",
];

function snapshotRequest(input: RequestInfo | URL, init?: RequestInit) {
  // Request captures mutable URL/headers/body/options synchronously, as fetch
  // does, before this operation can wait for another operation's transport.
  // It also applies an explicit null signal override on an input Request.
  const request = new Request(input, init);
  const extensions: RequestInit & Record<string, unknown> = { ...init };
  for (const option of nativeRequestOptions) delete extensions[option];
  // Next's documented memoization opt-out checks init.signal, not the signal
  // always present on a Request. Preserve only the caller's explicit intent.
  if (init?.signal !== undefined) {
    extensions.signal = init.signal === null ? null : request.signal;
  }
  // Request drops Next's documented revalidation metadata. Keep extensions
  // separate, with their mutable tags captured for this operation as well.
  const next =
    init?.next ??
    (input instanceof Request
      ? (input as Request & { next?: RequestInit["next"] }).next
      : undefined);
  if (next) {
    extensions.next = { ...next };
    if (next.tags) extensions.next.tags = [...next.tags];
  }
  return {
    request,
    extensions: Object.keys(extensions).length ? extensions : undefined,
  };
}

function withPool(transport: typeof fetch, acquire: Acquire): typeof fetch {
  return async (input, init) => {
    const { request, extensions } = snapshotRequest(input, init);
    // Next's full fetch patch moves Request+init.signal onto the Request before
    // its memoizer checks init.signal. Keep an explicit GET/HEAD opt-out visible
    // by forwarding the already captured URL/options. Other calls keep their
    // Request shape, including inherited signals and streamed mutation bodies.
    const explicitReadSignal =
      extensions?.signal &&
      (request.method === "GET" || request.method === "HEAD");
    const transportInput = explicitReadSignal ? request.url : request;
    const transportInit = explicitReadSignal
      ? {
          ...extensions,
          cache: request.cache,
          credentials: request.credentials,
          headers: request.headers,
          integrity: request.integrity,
          keepalive: request.keepalive,
          method: request.method,
          mode: request.mode,
          redirect: request.redirect,
          referrer: request.referrer,
          referrerPolicy: request.referrerPolicy,
          signal: request.signal,
        }
      : extensions;
    const signal = request.signal;
    let release: Release | undefined;
    let started = false;
    try {
      release = await acquire(signal);
      signal.throwIfAborted();
      started = true;
      const response = await transport(transportInput, transportInit);
      await finishResponse(response);
      return response;
    } finally {
      if (!started) {
        // Request may have taken ownership of an input stream before queueing.
        // Cancel unsent bodies, but never wait for a producer's cancel promise
        // before rejecting the caller or releasing a granted transport slot.
        void request.body?.cancel(signal.reason).catch(() => {});
      }
      release?.();
    }
  };
}

// A factory makes the transport contract independently testable. The live
// server below always uses 48 slots; no request can select another bound.
export function createServerFetch(transport: typeof fetch, maximum = 48) {
  return withPool(transport, createPool(maximum));
}

const poolKey: unique symbol = Symbol.for("psi-pawer.supabase.transport-pool");
const processState = globalThis as typeof globalThis & { [poolKey]?: Acquire };
// Route/action bundles share scheduling only. No client, credentials, identity
// or response is cached here, and commands still execute exactly once.
const acquire = (processState[poolKey] ??= createPool(48));
export const serverFetch = withPool(
  (input, init) => globalThis.fetch(input, init),
  acquire,
);
