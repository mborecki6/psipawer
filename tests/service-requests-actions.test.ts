import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  rpc: vi.fn(),
  refresh: vi.fn(),
  redirect: vi.fn(),
}));
vi.mock("@/lib/auth/session", () => ({ requireSession: mocks.session }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.refresh }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
import {
  requestServiceDate,
  changeServiceRequest,
} from "../src/modules/service-requests/actions";
import {
  bookableCourses,
  isDateRequestService,
} from "../src/modules/service-requests/types";
const input = {
  request_id: "87000000-0000-4000-8000-000000000001",
  service_id: "87000000-0000-4000-8000-000000000002",
  dog_id: "87000000-0000-4000-8000-000000000003",
  message: "Potrzebujemy spotkania",
  availability: "Wtorki",
};
function form(values: Record<string, string> = {}) {
  const f = new FormData();
  Object.entries({ ...input, ...values }).forEach(([key, value]) =>
    f.set(key, value),
  );
  return f;
}
beforeEach(() => {
  vi.resetAllMocks();
  mocks.session.mockResolvedValue({ db: { rpc: mocks.rpc } });
  mocks.rpc.mockResolvedValue({ data: input.request_id, error: null });
});
it("authenticates and passes only request fields, then opens the actual server result for a second form", async () => {
  const existing = "87000000-0000-4000-8000-000000000009";
  mocks.rpc.mockResolvedValue({ data: existing, error: null });
  await requestServiceDate(
    {},
    form({ guardian_id: "spoof", status: "handled", price_cents: "1" }),
  );
  expect(mocks.session).toHaveBeenCalledWith("client");
  expect(mocks.rpc).toHaveBeenCalledWith("request_service_date", {
    p_request_id: input.request_id,
    p_service: input.service_id,
    p_dog: input.dog_id,
    p_message: input.message,
    p_availability: input.availability,
  });
  expect(mocks.redirect).toHaveBeenCalledWith(
    `/app/services/${input.service_id}/request?saved=${existing}#request-${existing}`,
  );
});
it("keeps useful service-state errors and hides database internals", async () => {
  mocks.rpc.mockResolvedValueOnce({
    data: null,
    error: {
      message: "Ten kurs ma opublikowany termin. Przejdź do zapisów na kurs.",
    },
  });
  expect((await requestServiceDate({}, form())).error).toContain(
    "opublikowany termin",
  );
  mocks.rpc.mockResolvedValueOnce({
    data: null,
    error: { message: "private SQL info" },
  });
  expect((await requestServiceDate({}, form())).error).not.toContain(
    "private SQL",
  );
  expect(
    (await requestServiceDate({}, form({ message: "x" }))).error,
  ).toContain("opisz");
  expect(mocks.rpc).toHaveBeenCalledTimes(2);
});
it("requires staff and a note to handle, while cancellation authenticates the client", async () => {
  const values = {
    id: input.request_id,
    expected_version: "1",
    intent: "handled",
    note: "Uzgodniono dalsze kroki",
  };
  mocks.rpc.mockResolvedValue({ data: 2, error: null });
  expect((await changeServiceRequest({}, form(values))).success).toBeTruthy();
  expect(mocks.session).toHaveBeenLastCalledWith("admin");
  expect(
    (await changeServiceRequest({}, form({ ...values, note: "" }))).error,
  ).toBeTruthy();
  expect(
    (
      await changeServiceRequest(
        {},
        form({ ...values, intent: "cancelled", note: "" }),
      )
    ).success,
  ).toBeTruthy();
  expect(mocks.session).toHaveBeenLastCalledWith("client");
});
it("uses the same public-cycle start rule as SQL and only supports individual catalogue services", () => {
  const service = {
    id: "x",
    name: "Kurs",
    active: true,
    kind: "course" as const,
    booking_flow: "catalogue" as const,
    course_format: "individual" as const,
  };
  expect(isDateRequestService(service)).toBe(true);
  expect(isDateRequestService({ ...service, active: false })).toBe(false);
  expect(isDateRequestService({ ...service, course_format: "group" })).toBe(
    false,
  );
  const course = {
    id: "x",
    title: "Kurs",
    course_sessions: [
      { starts_at: "2027-01-01T10:00:00Z", status: "scheduled" },
    ],
  };
  expect(bookableCourses([course], new Date("2026-01-01"))).toHaveLength(1);
  expect(
    bookableCourses(
      [
        {
          ...course,
          course_sessions: [
            ...course.course_sessions,
            { starts_at: "2025-01-01T10:00:00Z", status: "cancelled" },
          ],
        },
      ],
      new Date("2026-01-01"),
    ),
  ).toHaveLength(0);
});
