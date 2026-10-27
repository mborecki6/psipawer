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
vi.mock("@/modules/push/browser", () => ({ clearBrowserPush: vi.fn() }));
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
import { getShellNavigation } from "../src/components/shell-navigation";
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
it("keeps one notification bell with the exact unread count after simplifying the owner menu", () => {
  const html = renderToStaticMarkup(
    <Shell role="client" name="Opiekun" unreadNotifications={1005}>
      Treść
    </Shell>,
  );
  expect(html.match(/class="notification-count"/g)).toHaveLength(1);
  expect(html.match(/99\+/g)).toHaveLength(1);
  expect(html).toContain("nieprzeczytane: 1005");
  expect(html).toContain('href="/app/notifications"');
  expect(html).not.toContain('href="/admin/notifications"');
  expect(html).toMatch(/aria-current="page"[^>]*href="\/app\/notifications"/);
});
it("keeps every owner destination within the six main links, two groups, and the bell", () => {
  const { nav, activityNav, extraNav } = getShellNavigation("client", "/app");
  expect(nav).toHaveLength(6);
  const reachable = [
    ...nav,
    ...activityNav,
    ...extraNav,
    { href: "/app/notifications" },
  ].map((item) => item.href);
  expect(new Set(reachable).size).toBe(reachable.length);
  expect(reachable.sort()).toEqual(
    [
      "/app",
      "/app/calendar",
      "/app/dogs",
      "/app/care",
      "/app/services",
      "/app/finance",
      "/app/walks",
      "/app/courses",
      "/app/fitness",
      "/app/consultations",
      "/app/gifts",
      "/app/community",
      "/app/notifications",
    ].sort(),
  );
});
it("identifies owner deep links inside their group and marks care rather than the dog profile", () => {
  for (const section of ["walks", "courses", "fitness", "consultations"]) {
    const navigation = getShellNavigation("client", `/app/${section}/item`);
    expect(navigation.activitiesView).toBe(true);
    expect(navigation.extraView).toBe(false);
    expect(navigation.active(`/app/${section}`)).toBe(true);
    expect(navigation.active("/app")).toBe(false);
  }
  for (const section of ["gifts", "community"]) {
    const navigation = getShellNavigation("client", `/app/${section}/item`);
    expect(navigation.extraView).toBe(true);
    expect(navigation.activitiesView).toBe(false);
    expect(navigation.active(`/app/${section}`)).toBe(true);
  }
  const care = getShellNavigation("client", "/app/dogs/dog/care");
  expect(care.active("/app/care")).toBe(true);
  expect(care.active("/app/dogs")).toBe(false);
});
it("opens the owner's active group and keeps account access without competing walk actions", () => {
  for (const [path, group] of [
    ["/app/fitness/package", "Zajęcia"],
    ["/app/gifts/card", "Więcej"],
  ]) {
    mocks.path.mockReturnValue(path);
    const html = renderToStaticMarkup(
      <Shell role="client" name="Opiekun" unreadNotifications={0}>
        Treść
      </Shell>,
    );
    const opened = html.match(
      /<details[^>]*open=""[^>]*>(.*?)<\/details>/,
    )?.[1];
    expect(opened).toContain(`<span>${group}</span>`);
    expect(html).toContain('href="/profile"');
    expect(html).toContain('href="/account/security"');
    expect(html).toContain("Wyloguj się");
    expect(html).not.toContain('aria-label="Znajdź spacer"');
    expect(html).toContain('href="/app/walks"');
  }
});
it.each(["/app", "/app/walks", "/app/walks/example"])(
  "keeps the quick walk action in its context at %s",
  (path) => {
    mocks.path.mockReturnValue(path);
    const html = renderToStaticMarkup(<Shell role="client" name="Opiekun">Treść</Shell>);
    expect(html).toContain('aria-label="Znajdź spacer"');
  },
);
it("keeps staff activity and settings selection independent of the owner's groups", () => {
  const activities = getShellNavigation("admin", "/admin/fitness/package");
  expect(activities.active("/admin/activities")).toBe(true);
  expect(activities.nav).toHaveLength(6);
  expect(
    getShellNavigation("admin", "/admin/services/service").settingsView,
  ).toBe(true);
  expect(getShellNavigation("admin", "/admin/relations").extraView).toBe(true);
  expect(
    getShellNavigation("client", "/app/fitness-other").activitiesView,
  ).toBe(false);
  expect(
    getShellNavigation("admin", "/admin/service-requests").active(
      "/admin/activities",
    ),
  ).toBe(true);
  expect(
    getShellNavigation("client", "/app/service-requests").active(
      "/app/services",
    ),
  ).toBe(true);
});
it("keeps payment details and confirmation in the finance navigation for both roles", () => {
  for (const role of ["client", "admin"] as const) {
    const base = role === "admin" ? "/admin" : "/app";
    for (const path of [`${base}/payments/new`, `${base}/payments/attempt`]) {
      const navigation = getShellNavigation(role, path);
      expect(navigation.active(`${base}/finance`)).toBe(true);
      expect(navigation.active(base)).toBe(false);
      expect(
        navigation.nav
          .filter((item) => navigation.active(item.href))
          .map((item) => item.href),
      ).toEqual([`${base}/finance`]);
      mocks.path.mockReturnValue(path);
      const html = renderToStaticMarkup(
        <Shell role={role} name="Test" unreadNotifications={0}>
          Płatność
        </Shell>,
      );
      const financeLink = html.match(
        new RegExp(`<a[^>]*href="${base}/finance"[^>]*>`),
      )?.[0];
      expect(financeLink).toContain('aria-current="page"');
    }
    expect(
      getShellNavigation(role, `${base}/payments-other`).active(
        `${base}/finance`,
      ),
    ).toBe(false);
  }
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
it.each([
  ["/app/calendar/offer", "Oferta w kalendarzu"],
  ["/app/services/service/request", "Uzgodnij termin"],
  ["/app/community/chat/thread", "Rozmowa w Psiutkach"],
])(
  "names a nested destination without expanding the primary navigation: %s",
  (path, title) => {
    mocks.path.mockReturnValue(path);
    const html = renderToStaticMarkup(
      <Shell role="client" name="Opiekun">
        Treść
      </Shell>,
    );
    expect(html).toContain(`<h1>${title}</h1>`);
    expect(getShellNavigation("client", path).nav).toHaveLength(6);
  },
);
