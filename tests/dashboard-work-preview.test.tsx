import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
vi.mock(
  "@/modules/care/types",
  async () => import("../src/modules/care/types"),
);
vi.mock("../src/modules/work/editor", () => ({ FollowUpEditor: () => null }));
import { WorkPreview, WorkQueueView } from "../src/modules/work/views";
import type { WorkItem } from "../src/modules/work/types";

const item: WorkItem = {
  kind: "consultations",
  id: "consultation",
  dog_id: "dog",
  dog_name: "Figa",
  title: "Konsultacja",
  due_on: null,
  created_at: "2030-01-01T12:00:00Z",
  priority: 1,
  source_id: "consultation",
};
it("describes an empty queue without claiming all work is complete and exposes the other existing destinations", () => {
  const html = renderToStaticMarkup(
    <WorkPreview items={[]} counts={[]} today="2030-01-10" />,
  );
  expect(html).toContain("W tej kolejce nie ma teraz spraw do obsłużenia.");
  expect(html).not.toContain("Wszystkie bieżące sprawy są obsłużone");
  expect(html).toContain('href="/admin/courses"');
  expect(html).toContain('href="/admin/service-requests?filter=open"');
  expect(html).not.toContain("/admin/courses?filter=requested");
});
it("retains the dashboard or filtered queue as the return destination for the existing item kind", () => {
  const preview = renderToStaticMarkup(
    <WorkPreview
      items={[item]}
      counts={[{ kind: "consultations", total: 1, overdue: 0 }]}
      today="2030-01-10"
    />,
  );
  expect(preview).toContain(
    'href="/admin/consultations/consultation?returnTo=%2Fadmin"',
  );
  const queue = renderToStaticMarkup(
    <WorkQueueView
      items={[item]}
      counts={[]}
      filter="consultations"
      page={3}
      more={false}
      today="2030-01-10"
    />,
  );
  expect(queue).toContain(
    'href="/admin/consultations/consultation?returnTo=%2Fadmin%2Fwork%3Ffilter%3Dconsultations%26page%3D3"',
  );
});

it("limits the empty first full queue to its actual scope and offers the omitted case types", () => {
  const html = renderToStaticMarkup(
    <WorkQueueView
      items={[]}
      counts={[]}
      filter="all"
      page={1}
      more={false}
      today="2030-01-10"
    />,
  );
  expect(html).toContain("W tej kolejce nie ma teraz spraw do obsłużenia");
  expect(html).not.toContain("Na teraz wszystko pod kontrolą");
  expect(html).toContain('href="/admin/courses"');
  expect(html).toContain('href="/admin/service-requests?filter=open"');
  expect(html).toContain(
    "Zgłoszenia kursowe i prośby o termin sprawdzisz osobno",
  );
  expect(html).not.toContain("← Poprzednie");
  expect(html).not.toContain("Następne →");
});

it("does not call the full queue empty when only the selected filter is empty", () => {
  const html = renderToStaticMarkup(
    <WorkQueueView
      items={[]}
      counts={[{ kind: "fitness", total: 7, overdue: 2 }]}
      filter="consultations"
      page={1}
      more={false}
      today="2030-01-10"
    />,
  );
  expect(html).toContain("W tym filtrze nie ma teraz spraw");
  expect(html).not.toContain("W tej kolejce nie ma teraz spraw do obsłużenia");
  expect(html).not.toContain("Na teraz wszystko pod kontrolą");
  expect(html).toContain("Wszystkie <span>7</span>");
  expect(html).toContain('href="/admin/work?filter=fitness&amp;page=1"');
  expect(html).toContain('href="/admin/courses"');
  expect(html).toContain('href="/admin/service-requests?filter=open"');
});

it("preserves filtered pagination and the other case destinations on an empty later page", () => {
  const html = renderToStaticMarkup(
    <WorkQueueView
      items={[]}
      counts={[{ kind: "fitness", total: 30, overdue: 2 }]}
      filter="fitness"
      page={3}
      more={false}
      today="2030-01-10"
    />,
  );
  expect(html).toContain("Na tej stronie nie ma już spraw");
  expect(html).toContain("Wróć do poprzedniej strony lub zmień filtr.");
  expect(html).not.toContain("Na teraz wszystko pod kontrolą");
  expect(html).toContain('href="/admin/work?filter=fitness&amp;page=2"');
  expect(html).not.toContain("Następne →");
  expect(html).toContain("Strona 3");
  expect(html).toContain('href="/admin/courses"');
  expect(html).toContain('href="/admin/service-requests?filter=open"');
});
