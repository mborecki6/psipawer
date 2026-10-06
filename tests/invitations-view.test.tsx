import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({
  prepare: vi.fn(),
  send: vi.fn(),
  archive: vi.fn(),
}));
vi.mock("@/lib/domain", async () => import("../src/lib/domain"));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("../src/modules/invitations/actions", () => ({
  prepareInvitation: m.prepare,
  sendInvitation: m.send,
  setInvitationArchive: m.archive,
}));
vi.mock("@/components/action-form", () => ({
  ActionForm: ({ children, label }: { children: ReactNode; label: string }) =>
    createElement(
      "form",
      { "aria-label": label },
      children,
      createElement("button", null, label),
    ),
  Field: ({ name, label }: { name: string; label: string }) =>
    createElement("label", null, label, createElement("input", { name })),
}));
import {
  InvitationsView,
  InvitationDetailView,
} from "../src/modules/invitations/views";
import type { Invitation } from "../src/modules/invitations/types";
const invite: Invitation = {
  id: "invitation",
  email: "owner@example.test",
  display_name: "Opiekun Test",
  version: 3,
  delivery_status: "sent",
  account_stage: "not_activated",
  last_attempt_at: "2026-09-19T10:00:00Z",
  last_sent_at: "2026-09-19T10:00:00Z",
  last_error_code: null,
  created_at: "2026-09-19T09:00:00Z",
  can_send: true,
  archived_at: null,
  can_archive: false,
};
const props = {
  items: [invite],
  more: false,
  page: 1,
  draftId: "draft",
  saved: false,
  enabled: false,
};
it("allows preparation when sending is disabled but exposes no send controls or side effects", () => {
  const html = renderToStaticMarkup(createElement(InvitationsView, props));
  expect(html).toContain("Przygotuj zaproszenie");
  expect(html).toContain("Wysyłka jest wyłączona");
  expect(html).not.toContain("Wyślij nowe zaproszenie");
  expect(m.send).not.toHaveBeenCalled();
  expect(m.prepare).not.toHaveBeenCalled();
});
it("distinguishes accepted delivery from activation and passes only ID and version for sending", () => {
  const html = renderToStaticMarkup(
    createElement(InvitationsView, { ...props, enabled: true }),
  );
  expect(html).toContain("Oczekuje na aktywację");
  expect(html).toContain("Przyjęcie wysyłki nie potwierdza odbioru");
  expect(html).toContain("/admin/invitations/invitation");
  const send =
    html.match(
      /<form aria-label="Wyślij nowe zaproszenie">(.*?)<\/form>/,
    )?.[1] || "";
  expect(send).toContain('name="id" value="invitation"');
  expect(send).toContain('name="version" value="3"');
  expect(send).not.toContain('name="email"');
});
it("keeps the latest failure visible after the sending form disappears during cooldown", () => {
  const html = renderToStaticMarkup(
    createElement(InvitationsView, {
      ...props,
      enabled: true,
      items: [
        {
          ...invite,
          delivery_status: "failed",
          last_error_code: "rate_limited",
          can_send: false,
        },
      ],
    }),
  );
  expect(html).toContain("Serwer ograniczył liczbę wiadomości");
  expect(html).toContain('role="status"');
  expect(html).not.toContain('aria-label="Wyślij nowe zaproszenie"');
});
it("shows dated attempt results and authors independently from activation, with paged history", () => {
  const html = renderToStaticMarkup(
    createElement(InvitationDetailView, {
      invitation: { ...invite, account_stage: "ready", can_send: false },
      enabled: true,
      page: 2,
      more: true,
      attempts: [
        {
          id: "attempt",
          started_at: invite.created_at,
          finished_at: null,
          outcome: "uncertain",
          error_code: "unknown_result",
          author_name: "Prowadząca Test",
        },
      ],
    }),
  );
  expect(html).toContain("Gotowe do korzystania");
  expect(html).toContain("Wynik nieznany");
  expect(html).toContain("Wiadomość mogła już dotrzeć");
  expect(html).toContain("Prowadząca Test");
  expect(html).toMatch(/datetime="2026-09-19T09:00:00Z"/i);
  expect(html).toContain("?page=1");
  expect(html).toContain("?page=3");
  expect(html).not.toContain("Wynik zapisano");
  expect(html).not.toContain('aria-label="Wyślij nowe zaproszenie"');
});
it("does not call an out-of-range history page a never-sent invitation", () => {
  const html = renderToStaticMarkup(
    createElement(InvitationDetailView, {
      invitation: invite,
      enabled: false,
      page: 3,
      more: false,
      attempts: [],
    }),
  );
  expect(html).toContain("Brak prób na tej stronie");
  expect(html).not.toContain("Nie rozpoczęto wysyłki");
  expect(html).toContain("Wysyłka jest obecnie wyłączona");
});
it("keeps unknown delivery visible and hides resend during cooldown or after activation", () => {
  const unknown = renderToStaticMarkup(
    createElement(InvitationsView, {
      ...props,
      enabled: true,
      items: [{ ...invite, delivery_status: "uncertain", can_send: false }],
    }),
  );
  expect(unknown).toContain("mogła zostać wysłana");
  expect(unknown).not.toContain('aria-label="Wyślij nowe zaproszenie"');
  const ready = renderToStaticMarkup(
    createElement(InvitationsView, {
      ...props,
      enabled: true,
      items: [{ ...invite, account_stage: "ready", can_send: false }],
    }),
  );
  expect(ready).toContain("Gotowe do korzystania");
  expect(ready).not.toContain('aria-label="Wyślij nowe zaproszenie"');
});
it("shows empty and paged states without claiming a saved draft has never been sent", () => {
  const html = renderToStaticMarkup(
    createElement(InvitationsView, {
      ...props,
      saved: true,
      items: [],
      more: true,
      page: 2,
    }),
  );
  expect(html).toContain("Brak zaproszeń na tej stronie");
  expect(html).toContain("Aktualny stan znajdziesz poniżej");
  expect(html).not.toContain("Nie wysłano wiadomości");
  expect(html).toContain("?page=1");
  expect(html).toContain("?page=3");
});
it("lets archived drafts be restored without suggesting a send or a cooldown", () => {
  const html = renderToStaticMarkup(
    createElement(InvitationDetailView, {
      invitation: {
        ...invite,
        delivery_status: "draft",
        archived_at: invite.created_at,
        can_send: false,
      },
      enabled: true,
      attempts: [],
      page: 1,
      more: false,
    }),
  );
  expect(html).toContain("Przywróć na listę");
  expect(html).toContain("Szkic w archiwum");
  expect(html).toContain('name="archived" value="false"');
  expect(html).toContain("/admin/invitations?archived=1");
  expect(html).not.toContain("Wyślij do skrzynki testowej");
  expect(html).not.toContain("Odczekaj dwie minuty");
});
it("allows only eligible drafts to be archived even while email sending is disabled", () => {
  const html = renderToStaticMarkup(
    createElement(InvitationsView, {
      ...props,
      items: [
        {
          ...invite,
          delivery_status: "draft",
          can_archive: true,
          last_attempt_at: null,
        },
      ],
    }),
  );
  expect(html).toContain("Przenieś do archiwum");
  expect(html).toContain('name="archived" value="true"');
  expect(html).not.toContain("Wyślij do skrzynki testowej");
  expect(
    renderToStaticMarkup(createElement(InvitationsView, props)),
  ).not.toContain("Przenieś do archiwum");
});
it("keeps archive and literal search in pagination without showing a new invitation form in the archive", () => {
  const html = renderToStaticMarkup(
    createElement(InvitationsView, {
      ...props,
      archived: true,
      search: "Test +%",
      items: [],
      page: 2,
      more: true,
    }),
  );
  expect(html).toContain('name="archived" value="1"');
  expect(html).toContain('value="Test +%"');
  expect(html).toContain("?page=3&amp;archived=1&amp;q=Test+%2B%25");
  expect(html).toContain("Brak pasujących zaproszeń");
  expect(html).not.toContain("Przygotuj zaproszenie");
});
