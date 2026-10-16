import type { Locator, Page, Request } from "@playwright/test";

const actionTimeout = 15_000;

// Observe the next action dispatched by this click, never an earlier response.
// The action result can acknowledge the write before the RSC stream ends.
export async function completeServerAction(
  page: Page,
  button: Locator,
  acknowledge: (remaining: () => number) => Promise<void>,
) {
  const current = new URL(page.url());
  const started = performance.now();
  const elapsed = () => Math.round(performance.now() - started);
  const timeoutError = () =>
    new Error("Server Action was not acknowledged within 15000 ms");
  const remaining = () => {
    const left = actionTimeout - (performance.now() - started);
    if (left <= 0) throw timeoutError();
    return Math.max(1, Math.floor(left));
  };
  let dispatchMs: number | null = null,
    headersMs: number | null = null,
    ackMs: number | null = null,
    finishedMs: number | null = null,
    finishedError: boolean | null = null,
    status: number | null = null;
  let active = true;
  let timer!: ReturnType<typeof setTimeout>;
  let onRequest!: (request: Request) => void;
  const completed = new Promise<void>((resolve, reject) => {
    onRequest = (request) => {
      if (request.method() !== "POST" || !request.headers()["next-action"])
        return;
      const target = new URL(request.url());
      if (
        target.origin !== current.origin ||
        target.pathname !== current.pathname
      )
        return;
      page.off("request", onRequest);
      dispatchMs = elapsed();
      void request
        .response()
        .then(async (response) => {
          if (!active) return;
          if (!response) {
            reject(new Error("Server Action has no HTTP response"));
            return;
          }
          headersMs = elapsed();
          status = response.status();
          void response.finished().then(
            (error) => {
              if (!active) return;
              finishedMs = elapsed();
              finishedError = Boolean(error);
            },
            () => {
              if (active) finishedError = true;
            },
          );
          if (!response.ok()) {
            reject(new Error("Server Action HTTP response was unsuccessful"));
            return;
          }
          await acknowledge(remaining);
          ackMs = elapsed();
          resolve();
        })
        .catch(reject);
    };
    page.on("request", onRequest);
    timer = setTimeout(
      () => reject(timeoutError()),
      actionTimeout,
    );
  });
  try {
    await Promise.all([completed, button.click({ timeout: remaining() })]);
  } finally {
    active = false;
    clearTimeout(timer);
    page.off("request", onRequest);
    console.info(
      JSON.stringify({
        event: "local_action_completion",
        dispatch_ms: dispatchMs,
        headers_ms: headersMs,
        ack_ms: ackMs,
        finished_ms: finishedMs,
        finished_error: finishedError,
        elapsed_ms: elapsed(),
        status,
      }),
    );
  }
}
