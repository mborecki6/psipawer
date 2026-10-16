import { describe, expect, it, vi } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

vi.mock("server-only", () => ({}));
import { createServerFetch } from "../src/lib/supabase/server-fetch";
type Fetch = typeof globalThis.fetch;

const url = "http://127.0.0.1:54321/rest/v1/fixture";
const bytes = (text: string) => new TextEncoder().encode(text);
function slowBody(text = "fixture response") {
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const cancel = vi.fn();
  const response = new Response(
    new ReadableStream<Uint8Array>({
      start(value) {
        controller = value;
        controller.enqueue(bytes(text));
      },
      cancel,
    }),
  );
  return { response, controller, cancel };
}

function fixtureClient(fetch: Fetch) {
  return createClient("http://127.0.0.1:54321", "fictional-local-key", {
    global: { fetch },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

describe("bounded server Supabase transport", () => {
  it("shares the 48-slot bound across separate server-module evaluations", async () => {
    const firstModule = await import("../src/lib/supabase/server-fetch");
    vi.resetModules();
    const secondModule = await import("../src/lib/supabase/server-fetch");
    const bodies: ReturnType<typeof slowBody>[] = [];
    const transport = vi.fn<Fetch>(async () => {
      const body = slowBody();
      bodies.push(body);
      return body.response;
    });
    vi.stubGlobal("fetch", transport);
    const controllers = Array.from({ length: 64 }, () => new AbortController());
    const requests = controllers.map((controller, index) =>
      (index < 32 ? firstModule : secondModule).serverFetch(url, {
        signal: controller.signal,
      }),
    );
    const all = Promise.all(requests);
    void all.catch(() => {});
    try {
      await vi.waitFor(() => expect(bodies).toHaveLength(48));
      await new Promise(setImmediate);
      expect(transport).toHaveBeenCalledTimes(48);
      for (const body of bodies.slice(0, 16)) body.controller.close();
      await vi.waitFor(() => expect(bodies).toHaveLength(64));
      for (const body of bodies.slice(16)) body.controller.close();
      expect(await all).toHaveLength(64);
    } finally {
      for (const controller of controllers) controller.abort();
      await Promise.allSettled(requests);
      vi.unstubAllGlobals();
    }
  });

  it("starts at most 48 complete HTTP operations and serves all queued calls", async () => {
    const bodies: ReturnType<typeof slowBody>[] = [];
    let active = 0,
      maximum = 0;
    const transport = vi.fn(async () => {
      active++;
      maximum = Math.max(maximum, active);
      const body = slowBody(`row ${bodies.length}`);
      bodies.push(body);
      return body.response;
    });
    const fetch = createServerFetch(transport);
    const requests = Array.from({ length: 64 }, () => fetch(url));
    await vi.waitFor(() => expect(bodies).toHaveLength(48));
    await new Promise(setImmediate);
    expect(transport).toHaveBeenCalledTimes(48);
    for (const body of bodies.slice(0, 16)) {
      active--;
      body.controller.close();
    }
    await vi.waitFor(() => expect(bodies).toHaveLength(64));
    for (const body of bodies.slice(16)) {
      active--;
      body.controller.close();
    }
    const responses = await Promise.all(requests);
    expect(maximum).toBe(48);
    expect(
      await Promise.all(responses.map((response) => response.text())),
    ).toEqual(Array.from({ length: 64 }, (_, index) => `row ${index}`));
    expect(transport).toHaveBeenCalledTimes(64);
  });

  it("retains the slot beyond headers until the slow body reaches EOF and returns the original Response", async () => {
    const body = slowBody("first chunk");
    Object.defineProperty(body.response, "url", {
      value: `${url}?own=fixture`,
    });
    body.response.headers.set("set-cookie", "fictional-cookie=value; HttpOnly");
    const transport = vi
      .fn<Fetch>()
      .mockResolvedValueOnce(body.response)
      .mockResolvedValueOnce(new Response("second"));
    const fetch = createServerFetch(transport, 1);
    let confirmed = false;
    const first = fetch(url).then((response) => {
      confirmed = true;
      return response;
    });
    const second = fetch(url);
    await vi.waitFor(() => expect(transport).toHaveBeenCalledTimes(1));
    await new Promise(setImmediate);
    expect(confirmed).toBe(false);
    body.controller.enqueue(bytes(" and last chunk"));
    body.controller.close();
    const original = await first;
    expect(original).toBe(body.response);
    expect(original.url).toBe(`${url}?own=fixture`);
    expect(original.headers.get("set-cookie")).toBe(
      "fictional-cookie=value; HttpOnly",
    );
    expect(original.bodyUsed).toBe(false);
    expect(await original.text()).toBe("first chunk and last chunk");
    expect(await (await second).text()).toBe("second");
  });

  it("keeps distinct identities and every input option while executing identical requests separately", async () => {
    const calls: Request[] = [];
    const transport = vi.fn<Fetch>(async (input, init) => {
      calls.push(new Request(input, init));
      return new Response(`private result ${calls.length}`, {
        status: 201,
        headers: { "x-fixture": String(calls.length) },
      });
    });
    const fetch = createServerFetch(transport, 1);
    const first: RequestInit = {
      method: "POST",
      body: JSON.stringify({ own_id: "first-fixture", note: "First note" }),
      headers: {
        authorization: "Bearer fictional-first",
        cookie: "fictional-first-cookie=value",
      },
      credentials: "include",
      redirect: "manual",
      cache: "no-store",
      mode: "cors",
      signal: new AbortController().signal,
    };
    const other: RequestInit = {
      ...first,
      body: JSON.stringify({ own_id: "other-fixture", note: "Other note" }),
      headers: {
        authorization: "Bearer fictional-other",
        cookie: "fictional-other-cookie=value",
      },
      signal: new AbortController().signal,
    };
    const responses = await Promise.all([
      fetch(url, first),
      fetch(url, other),
      fetch(url, first),
    ]);
    expect(calls.map((call) => call.url)).toEqual([url, url, url]);
    expect(calls.map((call) => call.headers.get("authorization"))).toEqual([
      "Bearer fictional-first", "Bearer fictional-other", "Bearer fictional-first",
    ]);
    expect(calls.map((call) => call.headers.get("cookie"))).toEqual([
      "fictional-first-cookie=value", "fictional-other-cookie=value", "fictional-first-cookie=value",
    ]);
    expect(await Promise.all(calls.map((call) => call.text()))).toEqual([
      first.body, other.body, first.body,
    ]);
    for (const call of calls) {
      expect(call).toMatchObject({
        method: "POST", credentials: "include", redirect: "manual",
        cache: "no-store", mode: "cors",
      });
      expect(call.signal.aborted).toBe(false);
    }
    expect(
      await Promise.all(responses.map((response) => response.text())),
    ).toEqual(["private result 1", "private result 2", "private result 3"]);
    expect(responses.map((response) => response.status)).toEqual([
      201, 201, 201,
    ]);
    expect(
      responses.map((response) => response.headers.get("x-fixture")),
    ).toEqual(["1", "2", "3"]);
  });

  it("captures a mutable URL at call time, like native fetch", async () => {
    for (const fetch of [globalThis.fetch, createServerFetch(globalThis.fetch, 1)]) {
      const input = new URL("data:text/plain,first");
      const pending = fetch(input);
      input.href = "data:text/plain,second";
      expect(await (await pending).text()).toBe("first");
    }
  });

  it("captures the method before the caller can mutate RequestInit", async () => {
    for (const fetch of [globalThis.fetch, createServerFetch(globalThis.fetch, 1)]) {
      const init: RequestInit = { method: "GET" };
      const pending = fetch("data:text/plain,fixture", init);
      init.method = "INVALID METHOD";
      expect(await (await pending).text()).toBe("fixture");
    }
  });

  it("snapshots queued body, headers, options and Next metadata without changing identities", async () => {
    const body = slowBody();
    const calls: { request: Request; extensions?: RequestInit }[] = [];
    const transport = vi.fn<Fetch>(async (input, extensions) => {
      calls.push({ request: new Request(input, extensions), extensions });
      return calls.length === 1 ? body.response : new Response("after queue");
    });
    const fetch = createServerFetch(transport, 1);
    const first = fetch(url);
    const input = new URL(`${url}?own=first`);
    const headers = new Headers({ authorization: "Bearer fictional-first" });
    const payload = new URLSearchParams({ note: "first note" });
    const init: RequestInit & { fixtureOption: string } = {
      method: "POST", headers, body: payload, cache: "no-store",
      credentials: "include", redirect: "manual", fixtureOption: "first",
      next: { revalidate: 0, tags: ["first-fixture"] },
    };
    const queued = fetch(input, init);
    input.search = "?own=other";
    headers.set("authorization", "Bearer fictional-other");
    payload.set("note", "other note");
    init.method = "DELETE";
    init.cache = "force-cache";
    init.credentials = "omit";
    init.redirect = "follow";
    init.fixtureOption = "other";
    init.next!.revalidate = 999;
    init.next!.tags!.push("other-fixture");
    await vi.waitFor(() => expect(calls).toHaveLength(1));
    body.controller.close();
    await first;
    expect(await (await queued).text()).toBe("after queue");
    expect(calls[1].request).toMatchObject({
      url: `${url}?own=first`, method: "POST", cache: "no-store",
      credentials: "include", redirect: "manual",
    });
    expect(calls[1].request.headers.get("authorization")).toBe("Bearer fictional-first");
    expect(await calls[1].request.text()).toBe("note=first+note");
    expect(calls[1].extensions).toEqual({
      fixtureOption: "first", next: { revalidate: 0, tags: ["first-fixture"] },
    });
  });

  it("preserves explicit signal opt-out in the actual Next render memoizer", () => {
    // Exercise the installed Next implementation in an isolated React server
    // cache context, without starting Next, a browser, a server or a socket.
    const source = readFileSync(new URL("../src/lib/supabase/server-fetch.ts", import.meta.url), "utf8");
    const output = execFileSync(process.execPath, [
      "--conditions=react-server", "--input-type=module", "-e", `
      import React from "react";
      import ts from "typescript";
      import { createDedupeFetch } from "next/dist/server/lib/dedupe-fetch.js";
      const source = ${JSON.stringify(source)}.replace('import "server-only";', "");
      const compiled = ts.transpileModule(source, { compilerOptions: {
        target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext,
      } }).outputText;
      const { createServerFetch } = await import("data:text/javascript;base64," + Buffer.from(compiled).toString("base64"));
      const results = [];
      for (const mode of ["explicit", "absent", "null"]) {
        for (const wrapped of [false, true]) {
          const cache = new Map();
          React.__SERVER_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE.A = {
            getCacheForType(factory) {
              if (!cache.has(factory)) cache.set(factory, factory());
              return cache.get(factory);
            }
          };
          let calls = 0;
          const nextFetch = createDedupeFetch(async () => new Response("independent result " + ++calls));
          const fetch = wrapped ? createServerFetch(nextFetch, 1) : nextFetch;
          const values = await Promise.all([1, 2].map(() => {
            const init = mode === "explicit" ? { signal: new AbortController().signal }
              : mode === "null" ? { signal: null } : undefined;
            return fetch("${url}", init).then(response => response.text());
          }));
          results.push({ mode, wrapped, calls, values });
        }
      }
      console.log(JSON.stringify(results));
    `], { encoding: "utf8", timeout: 5000 });
    const results = JSON.parse(output) as { mode: string; wrapped: boolean; calls: number; values: string[] }[];
    expect(results).toHaveLength(6);
    for (const result of results) {
      const independent = result.mode === "explicit";
      expect(result.calls).toBe(independent ? 2 : 1);
      expect(result.values).toEqual([
        "independent result 1", `independent result ${independent ? 2 : 1}`,
      ]);
    }
  });

  it("preserves GET/HEAD signal intent through the full installed Next fetch patch", () => {
    const output = execFileSync(
      process.execPath,
      [
        "--conditions=react-server",
        fileURLToPath(
          new URL("./fixtures/next-fetch/signals.mjs", import.meta.url),
        ),
      ],
      { encoding: "utf8", timeout: 5000 },
    );
    const results = JSON.parse(output) as {
      method: string;
      mode: string;
      inputType: string;
      wrapped: boolean;
      calls: number;
      receipts: { receipt: string; body: string }[];
    }[];
    expect(results).toHaveLength(36);
    for (const result of results) {
      const explicit = result.mode === "explicit";
      if (explicit && result.inputType === "request" && !result.wrapped) {
        // Next 16.3.8 itself drops Request+init's explicit memoization opt-out.
        // Keep this upstream comparison without requiring the upstream defect.
        expect([1, 2]).toContain(result.calls);
      } else {
        expect(result.calls, JSON.stringify(result)).toBe(explicit ? 2 : 1);
      }
      expect(result.receipts).toEqual(
        [1, result.calls].map((ordinal) => ({
          receipt: String(ordinal),
          body: result.method === "HEAD" ? "" : `result ${ordinal}`,
        })),
      );
    }
  });

  it.each([
    ["GET", "url"],
    ["HEAD", "url"],
    ["GET", "request"],
    ["HEAD", "request"],
  ])(
    "snapshots explicit %s signal options and Next metadata for queued %s input",
    async (method, inputType) => {
      const blocker = slowBody();
      const calls: { request: Request; options?: RequestInit }[] = [];
      const result = new Response(
        method === "HEAD" ? null : "captured response",
        {
          status: 201,
          headers: { "x-fixture": "captured" },
        },
      );
      const transport = vi.fn<Fetch>(async (input, options) => {
        calls.push({ request: new Request(input, options), options });
        return calls.length === 1 ? blocker.response : result;
      });
      const fetch = createServerFetch(transport, 1);
      const first = fetch(`${url}?blocker`);
      const inputUrl = new URL(`${url}?own=first`);
      const headers = new Headers({ authorization: "Bearer fictional-first" });
      const controller = new AbortController();
      const init: RequestInit = {
        method,
        headers,
        signal: controller.signal,
        cache: "no-store",
        credentials: "include",
        mode: "same-origin",
        redirect: "manual",
        referrer: "http://127.0.0.1/fixture",
        referrerPolicy: "no-referrer",
        integrity: "sha256-fictional",
        keepalive: true,
        next: { revalidate: 0, tags: ["first-fixture"] },
      };
      const input =
        inputType === "request" ? new Request(inputUrl, init) : inputUrl;
      const queued = fetch(input, init);
      inputUrl.search = "?own=other";
      headers.set("authorization", "Bearer fictional-other");
      if (input instanceof Request)
        input.headers.set("authorization", "Bearer fictional-other");
      init.method = "POST";
      init.signal = new AbortController().signal;
      init.cache = "force-cache";
      init.credentials = "omit";
      init.mode = "cors";
      init.redirect = "follow";
      init.referrer = "http://127.0.0.1/other";
      init.referrerPolicy = "origin";
      init.integrity = "other";
      init.keepalive = false;
      init.next!.revalidate = 999;
      init.next!.tags!.push("other-fixture");
      await vi.waitFor(() => expect(calls).toHaveLength(1));
      blocker.controller.close();
      await first;
      const response = await queued;
      expect(response).toBe(result);
      expect(response.status).toBe(201);
      expect(response.headers.get("x-fixture")).toBe("captured");
      expect(await response.text()).toBe(
        method === "HEAD" ? "" : "captured response",
      );
      expect(transport.mock.calls[1][0]).toBe(`${url}?own=first`);
      expect(calls[1].request).toMatchObject({
        url: `${url}?own=first`,
        method,
        cache: "no-store",
        credentials: "include",
        mode: "same-origin",
        redirect: "manual",
        referrer: "http://127.0.0.1/fixture",
        referrerPolicy: "no-referrer",
        integrity: "sha256-fictional",
        keepalive: true,
      });
      expect(calls[1].request.headers.get("authorization")).toBe(
        "Bearer fictional-first",
      );
      expect(calls[1].options?.next).toEqual({
        revalidate: 0,
        tags: ["first-fixture"],
      });
      expect(calls[1].request.signal.aborted).toBe(false);
      controller.abort();
      expect(calls[1].request.signal.aborted).toBe(true);
    },
  );

  it.each(["before call", "while queued", "after grant"])(
    "cancels an unsent stream body when aborted %s", async (stage) => {
      const blocker = slowBody();
      const transport = vi.fn<Fetch>(async (input) => {
        const request = input as Request;
        return request.url.endsWith("?blocker") ? blocker.response : new Response("next caller");
      });
      const fetch = createServerFetch(transport, 1);
      const first = stage === "while queued" ? fetch(`${url}?blocker`) : undefined;
      const controller = new AbortController();
      const reason = new DOMException(`Fixture aborted ${stage}`, "AbortError");
      const cancel = vi.fn();
      const request = new Request(`${url}?never-sent`, {
        method: "POST", signal: controller.signal,
        body: new ReadableStream<Uint8Array>({
          start(value) { value.enqueue(bytes("owned stream")); }, cancel,
        }),
        duplex: "half",
      } as RequestInit);
      if (stage === "before call") controller.abort(reason);
      const canceled = fetch(request);
      const rejected = expect(canceled).rejects.toBe(reason);
      if (stage !== "before call") controller.abort(reason);
      await rejected;
      await vi.waitFor(() => {
        expect(cancel).toHaveBeenCalledExactlyOnceWith(reason);
        expect(request.body!.locked).toBe(false);
      });
      expect(transport.mock.calls.some(([input]) => (input as Request).url === request.url)).toBe(false);
      blocker.controller.close();
      await first;
      expect(await (await fetch(`${url}?next`)).text()).toBe("next caller");
    },
  );

  it("does not await a stalled producer cancel or replace the abort with its rejection", async () => {
    for (const stalled of [true, false]) {
      const controller = new AbortController();
      const reason = new DOMException("Fixture owns unsent producer", "AbortError");
      const cancel = vi.fn(() => stalled ? new Promise<void>(() => {}) : Promise.reject(new Error("Fictional producer cleanup failure")));
      const request = new Request(url, {
        method: "POST", signal: controller.signal,
        body: new ReadableStream({ cancel }), duplex: "half",
      } as RequestInit);
      const transport = vi.fn<Fetch>(async () => new Response(null, { status: 204 }));
      const fetch = createServerFetch(transport, 1);
      const canceled = fetch(request);
      const rejected = expect(canceled).rejects.toBe(reason);
      controller.abort(reason);
      await rejected;
      await vi.waitFor(() => expect(cancel).toHaveBeenCalledExactlyOnceWith(reason));
      expect(transport).not.toHaveBeenCalled();
      expect((await fetch(url)).status).toBe(204);
    }
  });

  it("never sends an aborted queued Request and keeps FIFO progress for the next caller", async () => {
    const body = slowBody();
    const sent: string[] = [];
    const transport = vi.fn<Fetch>(async (input) => {
      sent.push(input instanceof Request ? input.url : String(input));
      return sent.length === 1 ? body.response : new Response("after cancel");
    });
    const fetch = createServerFetch(transport, 1);
    const first = fetch(`${url}?first`);
    const controller = new AbortController();
    const reason = new DOMException("Fixture canceled in queue", "AbortError");
    const queued = fetch(
      new Request(`${url}?canceled`, { signal: controller.signal }),
    );
    const rejection = expect(queued).rejects.toBe(reason);
    const last = fetch(`${url}?last`);
    controller.abort(reason);
    await rejection;
    expect(sent).toEqual([`${url}?first`]);
    body.controller.close();
    await first;
    expect(await (await last).text()).toBe("after cancel");
    expect(sent).toEqual([`${url}?first`, `${url}?last`]);
  });

  it("handles cancellation after acquiring a slot but before starting fetch", async () => {
    const transport = vi.fn<Fetch>(
      async () => new Response(null, { status: 204 }),
    );
    const fetch = createServerFetch(transport, 1);
    const controller = new AbortController();
    const reason = new DOMException(
      "Fixture canceled immediately",
      "AbortError",
    );
    const active = fetch(url, { signal: controller.signal });
    const rejection = expect(active).rejects.toBe(reason);
    controller.abort(reason);
    await rejection;
    expect(transport).not.toHaveBeenCalled();
    expect((await fetch(url)).status).toBe(204);
  });

  it("preserves the original body abort and releases the slot after both branches error", async () => {
    // Native fetch binds the supplied signal to its body after headers too.
    // Model that contract: erroring the source errors both standard tee branches.
    const body = slowBody();
    const transport = vi
      .fn<Fetch>()
      .mockImplementationOnce(async (input, init) => {
        const request = new Request(input, init);
        request.signal.addEventListener("abort", () => {
          body.controller.error(request.signal.reason);
        }, { once: true });
        return body.response;
      })
      .mockResolvedValueOnce(new Response("after active abort"));
    const fetch = createServerFetch(transport, 1);
    const controller = new AbortController();
    const reason = new DOMException(
      "Fixture canceled while reading",
      "AbortError",
    );
    const active = fetch(new Request(url, { signal: controller.signal }));
    const queued = fetch(url);
    await vi.waitFor(() => expect(transport).toHaveBeenCalledTimes(1));
    controller.abort(reason);
    const response = await active;
    expect(response).toBe(body.response);
    expect(response.bodyUsed).toBe(false);
    await expect(response.text()).rejects.toBe(reason);
    expect(await (await queued).text()).toBe("after active abort");
  });

  it("releases after a thrown fetch without retrying it", async () => {
    const failure = new TypeError("Fictional transport failure");
    const transport = vi
      .fn<Fetch>()
      .mockRejectedValueOnce(failure)
      .mockResolvedValueOnce(new Response("next response"));
    const fetch = createServerFetch(transport, 1);
    const first = fetch(url);
    const rejection = expect(first).rejects.toBe(failure);
    const second = fetch(url);
    await rejection;
    expect(await (await second).text()).toBe("next response");
    expect(transport).toHaveBeenCalledTimes(2);
  });

  it("releases after a body read error without making another transport attempt", async () => {
    const body = slowBody();
    const failure = new TypeError("Fictional interrupted response body");
    const transport = vi
      .fn<Fetch>()
      .mockResolvedValueOnce(body.response)
      .mockResolvedValueOnce(new Response("after broken stream"));
    const fetch = createServerFetch(transport, 1);
    const first = fetch(url);
    const second = fetch(url);
    await vi.waitFor(() => expect(transport).toHaveBeenCalledTimes(1));
    body.controller.error(failure);
    const response = await first;
    expect(response).toBe(body.response);
    expect(response.bodyUsed).toBe(false);
    await expect(response.text()).rejects.toBe(failure);
    expect(await (await second).text()).toBe("after broken stream");
    expect(transport).toHaveBeenCalledTimes(2);
  });

  it("keeps a real SDK GET body error outside its transport retry boundary", async () => {
    for (const wrapped of [false, true]) {
      const failure = new TypeError("Fictional interrupted SDK response body");
      let calls = 0;
      const transport: Fetch = async () => {
        if (++calls > 1) return new Response('[{"id":"unexpected retry"}]');
        return new Response(new ReadableStream({ start(controller) {
          controller.enqueue(bytes("[{"));
          setTimeout(() => controller.error(failure), 0);
        } }));
      };
      const client = fixtureClient(wrapped ? createServerFetch(transport, 1) : transport);
      const result = await client.from("fictional_fixture").select("id");
      expect(result.status).toBe(0);
      expect(result.data).toBeNull();
      expect(result.error?.message).toBe(`TypeError: ${failure.message}`);
      expect(calls).toBe(1);
    }
  });

  it.each([
    new DOMException("Fictional SDK active abort", "AbortError"),
    new Error("Fictional SDK custom abort reason"),
  ])("keeps a real SDK active body abort outside fetch retries (%s)", async (reason) => {
    for (const wrapped of [false, true]) {
      const body = slowBody("[{");
      const transport = vi.fn<Fetch>(async (input, init) => {
        const request = new Request(input, init);
        request.signal.addEventListener("abort", () => body.controller.error(request.signal.reason), { once: true });
        return body.response;
      });
      const controller = new AbortController();
      const client = fixtureClient(wrapped ? createServerFetch(transport, 1) : transport);
      const pending = Promise.resolve(client.from("fictional_fixture").select("id").abortSignal(controller.signal));
      await vi.waitFor(() => expect(transport).toHaveBeenCalledTimes(1));
      controller.abort(reason);
      const result = await pending;
      expect(result.status).toBe(0);
      expect(result.data).toBeNull();
      expect(result.error?.message).toBe(`${reason.name}: ${reason.message}`);
      expect(transport).toHaveBeenCalledTimes(1);
    }
  });

  it("preserves an HTTP error response after EOF and does not retry", async () => {
    const response = new Response("Fictional gateway response", {
      status: 502,
      statusText: "Bad Gateway",
      headers: { "content-type": "text/plain" },
    });
    const transport = vi.fn<Fetch>(async () => response);
    const fetch = createServerFetch(transport, 1);
    const actual = await fetch(url);
    expect(actual).toBe(response);
    expect(actual.status).toBe(502);
    expect(actual.statusText).toBe("Bad Gateway");
    expect(await actual.text()).toBe("Fictional gateway response");
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it.each(["HEAD", "GET"])(
    "does not block after a bodyless %s/204 response",
    async (method) => {
      const transport = vi.fn<Fetch>(
        async () => new Response(null, { status: 204 }),
      );
      const fetch = createServerFetch(transport, 1);
      const responses = await Promise.all([fetch(url, { method }), fetch(url)]);
      expect(responses.map((response) => response.status)).toEqual([204, 204]);
      expect(transport).toHaveBeenCalledTimes(2);
      expect(new Request(...transport.mock.calls[0]).method).toBe(method);
    },
  );

  it("honors the native null signal override on an input Request", async () => {
    const controller = new AbortController();
    controller.abort();
    const request = new Request(url, { signal: controller.signal });
    const transport = vi.fn<Fetch>(
      async () => new Response(null, { status: 204 }),
    );
    const fetch = createServerFetch(transport, 1);
    expect((await fetch(request, { signal: null })).status).toBe(204);
    await expect(fetch(request)).rejects.toMatchObject({ name: "AbortError" });
    expect(transport).toHaveBeenCalledTimes(1);
    const actual = new Request(...transport.mock.calls[0]);
    expect(actual.url).toBe(request.url);
    expect(actual.signal.aborted).toBe(false);
  });

  it("executes a real SDK mutation once with the original complete payload and authorization", async () => {
    const observed: { request: Request; body: string }[] = [];
    const receipt = "10000000-0000-4000-8000-000000000001";
    const transport = vi.fn<Fetch>(async (input, init) => {
      const request = new Request(input, init);
      observed.push({ request, body: await request.text() });
      return new Response(JSON.stringify(receipt), {
        headers: { "Content-Type": "application/json" },
      });
    });
    const client = createClient(
      "http://127.0.0.1:54321",
      "fictional-local-key",
      {
        global: {
          fetch: createServerFetch(transport),
          headers: { Authorization: "Bearer fictional-own-session" },
        },
        auth: { persistSession: false, autoRefreshToken: false },
      },
    );
    const payload = {
      p_request_id: "20000000-0000-4000-8000-000000000002",
      p_package: "30000000-0000-4000-8000-000000000003",
      p_amount_cents: 2000,
      p_method: "other",
      p_note: "Fikcyjna pełna treść wpłaty: ąę łódź.",
    };
    const result = await client.rpc("record_payment", payload);
    expect(result).toMatchObject({ data: receipt, error: null, status: 200 });
    expect(transport).toHaveBeenCalledTimes(1);
    expect(observed[0].request.url).toBe(
      "http://127.0.0.1:54321/rest/v1/rpc/record_payment",
    );
    expect(observed[0].request.method).toBe("POST");
    expect(JSON.parse(observed[0].body)).toEqual(payload);
    expect(observed[0].request.headers.get("authorization")).toBe(
      "Bearer fictional-own-session",
    );
  });
});
