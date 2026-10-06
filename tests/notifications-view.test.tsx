import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  open: vi.fn(),
  read: vi.fn(),
  path: vi.fn(() => "/app/notifications"),
}));
vi.mock("@/lib/domain", async () => import("../src/lib/domain"));
vi.mock(
  "@/modules/notifications/types",
  async () => import("../src/modules/notifications/types"),
);
vi.mock("@/lib/auth/actions", () => ({ signOut: vi.fn() }));
vi.mock("next/navigation", () => ({
  usePathname: mocks.path,
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));
vi.mock("../src/modules/notifications/actions", () => ({
  openNotification: mocks.open,
  markNotificationsRead: mocks.read,
}));
vi.mock("@/components/action-form", () => ({
  ActionForm: ({ children, label }: { children: ReactNode; label: string }) =>
    createElement(
      "form",
      { "aria-label": label },
      children,
      createElement("button", null, label),
    ),
}));
import { NotificationInboxView } from "../src/modules/notifications/views";
import { Shell } from "../src/components/shell";
import type { Notification } from "../src/modules/notifications/types";
const first: Notification = {
  id: "one",
  dog_id: "dog",
  dog_name: "Figa",
  entity_id: "plan",
  kind: "plan_published",
  created_at: "2026-09-19T10:00:00Z",
  read_at: null,
};
const second: Notification = {
  ...first,
  id: "two",
  kind: "payment_recorded",
  read_at: "2026-09-19T11:00:00Z",
};
const props = {
  role: "client" as const,
  items: [first, second],
  count: 1005,
  filter: "all" as const,
  more: true,
  resetRequired: false,
};
beforeEach(() => {
  vi.clearAllMocks();
  mocks.path.mockReturnValue("/app/notifications");
});
it("renders only the unread visible ID in the page-wide read form and never mutates on render", () => {
  const html = renderToStaticMarkup(
    createElement(NotificationInboxView, props),
  );
  const bulk =
    html.match(
      /<form aria-label="Oznacz tę stronę jako przeczytaną">(.*?)<\/form>/,
    )?.[1] || "";
  expect(bulk).toContain('value="one"');
  expect(bulk).not.toContain('value="two"');
  expect(html).toContain("1005");
  expect(html).toContain("Nowa wersja zaleceń");
  expect(html).toContain("Zapisano wpłatę");
  expect(html).toContain("Przeczytanie wiadomości nie kończy sprawy");
  expect(html).toContain("/app/notifications?filter=all&amp;before=two");
  expect(html).not.toContain("/admin/");
  expect(mocks.open).not.toHaveBeenCalled();
  expect(mocks.read).not.toHaveBeenCalled();
});
it("does not offer a bulk read button on an already-read page and escapes dog names", () => {
  const html = renderToStaticMarkup(
    createElement(NotificationInboxView, {
      ...props,
      items: [{ ...second, dog_name: '<script>alert("x")</script>' }],
      more: false,
    }),
  );
  expect(html).not.toContain("Oznacz tę stronę");
  expect(html).toContain("&lt;script&gt;");
  expect(html).not.toContain("<script>alert");
});
it("has distinct empty, older-page and unavailable-cursor states without falsely saying everything is read", () => {
  const empty = renderToStaticMarkup(
    createElement(NotificationInboxView, {
      ...props,
      items: [],
      count: 0,
      filter: "unread",
      more: false,
    }),
  );
  expect(empty).toContain("Wszystko przeczytane");
  const older = renderToStaticMarkup(
    createElement(NotificationInboxView, {
      ...props,
      items: [],
      before: "old",
      filter: "unread",
      more: false,
    }),
  );
  expect(older).toContain("Sprawdź najnowsze powiadomienia");
  expect(older).toContain("Wróć do najnowszych");
  expect(older).not.toContain("Wszystko przeczytane");
  const reset = renderToStaticMarkup(
    createElement(NotificationInboxView, {
      ...props,
      items: [],
      before: "old",
      more: false,
      resetRequired: true,
    }),
  );
  expect(reset).toContain("Pokaż początek listy");
  expect(reset).not.toContain("Otwórz sprawę");
});
it("shows a compact count in both navigation entries with an exact accessible label", () => {
  const html = renderToStaticMarkup(
    <Shell role="client" name="Opiekun" unreadNotifications={1005}>
      Treść
    </Shell>,
  );
  expect(html.match(/class="notification-count"/g)).toHaveLength(2);
  expect(html.match(/99\+/g)).toHaveLength(2);
  expect(html).toContain("nieprzeczytane: 1005");
  expect(html).toContain('href="/app/notifications"');
  expect(html).not.toContain('href="/admin/notifications"');
});
it("does not show zero unread when the navigation count is unavailable", () => {
  const unknown = renderToStaticMarkup(
    <Shell role="admin" name="Prowadząca" unreadNotifications={null}>
      Treść
    </Shell>,
  );
  expect(unknown).toContain("licznik chwilowo niedostępny");
  expect(unknown).not.toContain("wszystkie przeczytane");
  const zero = renderToStaticMarkup(
    <Shell role="client" name="Opiekun" unreadNotifications={0}>
      Treść
    </Shell>,
  );
  expect(zero).toContain("wszystkie przeczytane");
  expect(zero).not.toContain('class="notification-count"');
});
