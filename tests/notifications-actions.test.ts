import { beforeEach, it, expect, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  rpc: vi.fn(),
  from: vi.fn(),
  select: vi.fn(),
  eq: vi.fn(),
  one: vi.fn(),
  refresh: vi.fn(),
  redirect: vi.fn((href: string): never => {
    throw new Error(`REDIRECT:${href}`);
  }),
}));
vi.mock("@/lib/auth/session", () => ({ requireSession: mocks.session }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.refresh }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
import {
  markNotificationsRead,
  openNotification,
} from "../src/modules/notifications/actions";
import {
  notificationHref,
  notificationCountLabel,
  notificationFilter,
  type NotificationKind,
} from "../src/modules/notifications/types";
const id = "13000000-0000-4000-8000-000000000001";
const dog = "23000000-0000-4000-8000-000000000001";
const entity = "33000000-0000-4000-8000-000000000001";
const enrollment = "43000000-0000-4000-8000-000000000001";
const meeting = "53000000-0000-4000-8000-000000000001";
it.each([
  ["fitness_session_scheduled", meeting, `#spotkanie-${meeting}`],
  ["fitness_payment_refunded", null, `#rozliczenie-${entity}`],
  ["fitness_accepted", null, ""],
])(
  "opens stored %s fitness context, ignoring forged browser fields",
  async (kind, session, anchor) => {
    const f = form();
    f.set("fitness_package_id", id);
    f.set("fitness_session_id", id);
    f.set("href", "https://evil.example");
    mocks.one.mockResolvedValueOnce({
      data: {
        kind,
        dog_id: dog,
        entity_id: entity,
        fitness_package_id: entity,
        fitness_session_id: session,
      },
      error: null,
    });
    await expect(openNotification({}, f)).rejects.toThrow(
      `REDIRECT:/app/fitness/${entity}${anchor}`,
    );
    expect(mocks.rpc).toHaveBeenCalledWith("read_notifications", {
      p_ids: [id],
    });
  },
);
it("does not mark a fitness message read if its stored package or meeting context is invalid", async () => {
  for (const context of [
    { fitness_package_id: null, fitness_session_id: null },
    { fitness_package_id: id, fitness_session_id: null },
    { fitness_package_id: entity, fitness_session_id: "invalid" },
  ]) {
    mocks.one.mockResolvedValueOnce({
      data: {
        kind: "fitness_session_scheduled",
        dog_id: dog,
        entity_id: entity,
        ...context,
      },
      error: null,
    });
    expect((await openNotification({}, form())).error).toBeTruthy();
  }
  expect(mocks.rpc).not.toHaveBeenCalled();
  expect(mocks.redirect).not.toHaveBeenCalled();
});
function form(ids = [id]) {
  const f = new FormData();
  ids.forEach((x) => f.append("id", x));
  return f;
}
beforeEach(() => {
  vi.resetAllMocks();
  mocks.session.mockResolvedValue({
    db: { from: mocks.from, rpc: mocks.rpc },
    role: "client",
  });
  mocks.from.mockReturnValue({ select: mocks.select });
  mocks.select.mockReturnValue({ eq: mocks.eq });
  mocks.eq.mockReturnValue({ maybeSingle: mocks.one });
  mocks.one.mockResolvedValue({
    data: { kind: "consultation_scheduled", dog_id: dog, entity_id: entity },
    error: null,
  });
  mocks.rpc.mockResolvedValue({ data: 1, error: null });
});
it("marks only the listed IDs, ignoring forged recipient and destination fields", async () => {
  const f = form([id, entity]);
  f.set("recipient_id", "other");
  f.set("next", "https://evil.example");
  expect((await markNotificationsRead({}, f)).success).toContain(
    "Status spraw pozostaje bez zmian",
  );
  expect(mocks.session).toHaveBeenCalled();
  expect(mocks.rpc).toHaveBeenCalledWith("read_notifications", {
    p_ids: [id, entity],
  });
  expect(mocks.refresh).toHaveBeenCalledWith("/admin", "layout");
  expect(mocks.refresh).toHaveBeenCalledWith("/app", "layout");
});
it("accepts an idempotent zero-change response", async () => {
  mocks.rpc.mockResolvedValue({ data: 0, error: null });
  expect((await markNotificationsRead({}, form())).success).toBeTruthy();
});
it("rejects malformed, empty, duplicate and oversized ID selections", async () => {
  for (const ids of [
    [],
    ["invalid"],
    [id, id],
    Array.from({ length: 21 }, () => id),
  ])
    expect((await markNotificationsRead({}, form(ids))).error).toBeTruthy();
  expect(mocks.rpc).not.toHaveBeenCalled();
});
it("does not show a successful read when the result is invalid or the provider fails", async () => {
  for (const result of [
    { data: null, error: null },
    { data: -1, error: null },
    { data: 2, error: null },
    { data: 1, error: { message: "private SQL detail" } },
  ]) {
    mocks.rpc.mockResolvedValueOnce(result);
    expect((await markNotificationsRead({}, form())).error).not.toContain(
      "private",
    );
  }
  mocks.rpc.mockRejectedValueOnce(new Error("private network failure"));
  expect((await markNotificationsRead({}, form())).error).not.toContain(
    "private",
  );
  expect(mocks.refresh).not.toHaveBeenCalled();
});
it("looks up a notification with RLS, marks it read and derives the destination from stored data", async () => {
  const f = form();
  f.set("href", "https://evil.example");
  f.set("kind", "payment_recorded");
  f.set("entity_id", id);
  await expect(openNotification({}, f)).rejects.toThrow(
    `REDIRECT:/app/consultations/${entity}`,
  );
  expect(mocks.from).toHaveBeenCalledWith("notifications");
  expect(mocks.eq).toHaveBeenCalledWith("id", id);
  expect(mocks.rpc).toHaveBeenCalledWith("read_notifications", { p_ids: [id] });
  expect(mocks.refresh).toHaveBeenCalledWith("/app", "layout");
});
it("does not mark or navigate an inaccessible notification, bad target or unknown kind", async () => {
  for (const data of [
    null,
    { kind: "__proto__", dog_id: dog, entity_id: entity },
    {
      kind: "consultation_scheduled",
      dog_id: dog,
      entity_id: "https://evil.example",
    },
  ]) {
    mocks.one.mockResolvedValueOnce({ data, error: null });
    expect((await openNotification({}, form())).error).toBeTruthy();
  }
  expect(mocks.rpc).not.toHaveBeenCalled();
  expect(mocks.redirect).not.toHaveBeenCalled();
});
it("does not navigate if access is lost before marking read", async () => {
  mocks.rpc.mockResolvedValueOnce({
    data: null,
    error: { message: "Nie znaleziono Twoich powiadomień." },
  });
  expect((await openNotification({}, form())).error).toBeTruthy();
  expect(mocks.redirect).not.toHaveBeenCalled();
});
it("opens the stored course enrollment or meeting, regardless of a forged browser target", async () => {
  const f = form();
  f.set("course_enrollment_id", id);
  f.set("href", "https://evil.example");
  mocks.one.mockResolvedValueOnce({
    data: {
      kind: "course_payment_refunded",
      dog_id: dog,
      entity_id: entity,
      course_enrollment_id: enrollment,
      course_session_id: null,
    },
    error: null,
  });
  await expect(openNotification({}, f)).rejects.toThrow(
    `REDIRECT:/app/courses/${entity}?enrollment=${enrollment}#rozliczenie-${enrollment}`,
  );
  mocks.one.mockResolvedValueOnce({
    data: {
      kind: "course_reminder",
      dog_id: dog,
      entity_id: entity,
      course_enrollment_id: enrollment,
      course_session_id: meeting,
    },
    error: null,
  });
  await expect(openNotification({}, f)).rejects.toThrow(
    `REDIRECT:/app/courses/${entity}?enrollment=${enrollment}#spotkanie-${meeting}`,
  );
});
it("does not mark malformed course context as read or build an unsafe destination", async () => {
  for (const context of [
    { course_enrollment_id: null, course_session_id: null },
    { course_enrollment_id: "https://evil.example", course_session_id: null },
    { course_enrollment_id: enrollment, course_session_id: "../other" },
  ]) {
    mocks.one.mockResolvedValueOnce({
      data: {
        kind: "course_reminder",
        dog_id: dog,
        entity_id: entity,
        ...context,
      },
      error: null,
    });
    expect((await openNotification({}, form())).error).toBeTruthy();
  }
  expect(mocks.rpc).not.toHaveBeenCalled();
  expect(mocks.redirect).not.toHaveBeenCalled();
});
it("requires a session before either action and rejects repeated open IDs", async () => {
  expect((await openNotification({}, form([id, id]))).error).toBeTruthy();
  expect(mocks.from).not.toHaveBeenCalled();
  mocks.session.mockRejectedValue(new Error("NO_SESSION"));
  await expect(openNotification({}, form())).rejects.toThrow("NO_SESSION");
  await expect(markNotificationsRead({}, form())).rejects.toThrow("NO_SESSION");
  expect(mocks.rpc).not.toHaveBeenCalled();
});
it("links all event families to the correct role's existing screen", () => {
  const routes: [NotificationKind, string, string][] = [
    [
      "progress_submitted",
      `/admin/work/progress/${entity}`,
      `/app/dogs/${dog}/care`,
    ],
    [
      "plan_published",
      `/admin/care/plans/${entity}`,
      `/app/care/plans/${entity}`,
    ],
    ["progress_reviewed", `/admin/dogs/${dog}/care`, `/app/dogs/${dog}/care`],
    [
      "follow_up_changed",
      `/admin/work/follow-ups/${entity}`,
      `/app/dogs/${dog}/care`,
    ],
    [
      "payment_recorded",
      `/admin/finance#payment-${entity}`,
      `/app/finance#payment-${entity}`,
    ],
    ["walk_invitation", `/admin/walks/${entity}`, `/app/walks/${entity}`],
    ["registration_changed", `/admin/walks/${entity}`, `/app/walks/${entity}`],
  ];
  for (const [kind, staff, client] of routes) {
    const n = { kind, dog_id: dog, entity_id: entity };
    expect(notificationHref(n, "admin")).toBe(staff);
    expect(notificationHref(n, "client")).toBe(client);
  }
  expect(notificationFilter("all")).toBe("all");
  expect(notificationFilter("anything")).toBe("unread");
  expect(notificationCountLabel(null)).toContain("niedostępny");
  expect(notificationCountLabel(0)).toContain("wszystkie przeczytane");
  expect(notificationCountLabel(1005)).toContain("1005");
});
