import { afterEach, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { reportDataReadError } from "../src/lib/observability/server-errors";

afterEach(() => vi.restoreAllMocks());
it("labels a retried gateway read using only safe metadata", () => {
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  reportDataReadError(
    "work.items",
    { message: "Private URL and token" },
    502,
    true,
  );
  expect(log).toHaveBeenCalledWith(
    JSON.stringify({
      event: "data_read_failed",
      operation: "work.items",
      retrying: true,
      code: "unclassified",
      status: 502,
    }),
  );
  expect(JSON.stringify(log.mock.calls)).not.toMatch(/Private|URL|token/);
});
it("classifies a lost connection without exposing the request, token or stack", () => {
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  reportDataReadError(
    "calendar.next",
    {
      message: "TypeError: fetch failed",
      details: "Private request URL and token; caused by UND_ERR_SOCKET",
    },
    0,
  );
  expect(log).toHaveBeenCalledWith(
    JSON.stringify({
      event: "data_read_failed",
      operation: "calendar.next",
      code: "unclassified",
      status: 0,
      network_cause: "UND_ERR_SOCKET",
    }),
  );
  expect(JSON.stringify(log.mock.calls)).not.toMatch(/Private|token|URL|stack/);
});
it.each(["57014", "42501", "PGRST003"])(
  "reports the standard code %s without private provider context",
  (code) => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    reportDataReadError("calendar.next", {
      code,
      message: "Private note, email and token",
      details: "private-body",
      hint: "private-link",
    });
    expect(log).toHaveBeenCalledWith(
      JSON.stringify({
        event: "data_read_failed",
        operation: "calendar.next",
        code,
      }),
    );
    expect(JSON.stringify(log.mock.calls)).not.toMatch(/Private|private/);
  },
);
it.each([
  null,
  new Error("secret"),
  { code: "sb_secret_private" },
  { code: 12345 },
])("omits unrecognized code values and raw error messages", (error) => {
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  reportDataReadError("calendar.next", error);
  expect(log).toHaveBeenCalledWith(
    JSON.stringify({
      event: "data_read_failed",
      operation: "calendar.next",
      code: "unclassified",
    }),
  );
});
