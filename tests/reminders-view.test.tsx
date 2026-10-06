import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ process: vi.fn(), retry: vi.fn() }));
vi.mock("@/lib/domain", async () => import("../src/lib/domain"));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("../src/modules/reminders/actions", () => ({
  processReminders: mocks.process,
  retryReminder: mocks.retry,
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
import {
  ReminderQueueView,
  ReminderDetailView,
} from "../src/modules/reminders/views";
import type { Reminder } from "../src/modules/reminders/types";
const job: Reminder = {
  id: "job",
  kind: "consultation",
  dog_id: "dog",
  entity_id: "meeting",
  target_at: "2030-01-10T10:00:00Z",
  due_at: "2030-01-09T10:00:00Z",
  next_attempt_at: "2030-01-09T11:00:00Z",
  status: "failed",
  attempts: 5,
  cycle_attempts: 5,
  last_error_code: "delivery_failed",
  created_at: "2030-01-05T10:00:00Z",
  finished_at: "2030-01-09T11:00:00Z",
  dogs: { name: "Figa" },
};
it("renders full counts, no-run state, retry version and no mutations from a GET", () => {
  const html = renderToStaticMarkup(
    createElement(ReminderQueueView, {
      items: [job],
      counts: [
        { status: "failed", total: 1005, due: 0 },
        { status: "pending", total: 17, due: 12 },
      ],
      worker: null,
      filter: "failed",
      page: 1,
      more: true,
    }),
  );
  expect(html).toContain("1005");
  expect(html).toContain("Do sprawdzenia teraz: 12");
  expect(html).toContain("Kolejka nie została jeszcze uruchomiona");
  expect(html).toContain('name="attempts" value="5"');
  expect(html).toContain('name="id" value="job"');
  expect(html).toContain("pięciu próbach");
  expect(html).toContain("/admin/reminders/job");
  expect(mocks.process).not.toHaveBeenCalled();
  expect(mocks.retry).not.toHaveBeenCalled();
});
it("does not offer retry for delivered or cancelled jobs or imply read/email confirmation", () => {
  const html = renderToStaticMarkup(
    createElement(ReminderQueueView, {
      items: [
        { ...job, status: "sent" },
        { ...job, id: "cancelled", status: "cancelled" },
      ],
      counts: [],
      worker: {
        last_run_at: "2030-01-09T11:00:00Z",
        result: { sent: 1, failed: 0, cancelled: 0, skipped: 0 },
      },
      filter: "all",
      page: 2,
      more: false,
    }),
  );
  expect(html).not.toContain("Ponów przypomnienie");
  expect(html).toContain("nie potwierdza przeczytania ani wysłania e-maila");
  expect(html).toContain("nie oznacza, że proces nadal działa");
  expect(html).toContain("Nowsze");
});
it("keeps the manual retry confirmation after the form disappears and distinguishes automatic retries", () => {
  const render = (cycle: number) =>
    renderToStaticMarkup(
      createElement(ReminderDetailView, {
        job: { ...job, status: "retry", cycle_attempts: cycle },
        history: [],
        page: 1,
        more: false,
      }),
    );
  const manual = render(0);
  expect(manual).toContain('role="status"');
  expect(manual).toContain("Przypomnienie czeka na ponowną próbę");
  expect(manual).not.toContain("Ponów przypomnienie");
  expect(render(1)).not.toContain("Przypomnienie czeka na ponowną próbę");
});
it("shows chronological attempt outcomes without raw error messages and routes to the source", () => {
  const html = renderToStaticMarkup(
    createElement(ReminderDetailView, {
      job,
      history: [
        {
          attempt: 5,
          outcome: "failed",
          error_code: "PRIVATE",
          created_at: job.created_at,
        },
      ],
      page: 1,
      more: false,
    }),
  );
  expect(html).toContain("Próba 5");
  expect(html).toContain("Nie udało się dostarczyć");
  expect(html).not.toContain("PRIVATE");
  expect(html).toContain('href="/admin/consultations/meeting"');
});
it("describes contact tasks as a day, without an appointment time or fake delivery history", () => {
  const html = renderToStaticMarkup(
    createElement(ReminderDetailView, {
      job: { ...job, kind: "follow_up", status: "pending", attempts: 0 },
      history: [],
      page: 1,
      more: false,
    }),
  );
  expect(html).toContain("Dzień kontaktu");
  expect(html).toContain("Nie wykonano jeszcze próby dostarczenia");
  expect(html).toContain("/admin/work/follow-ups/meeting");
});
it("opens the exact course meeting and enrollment from a course reminder", () => {
  const html = renderToStaticMarkup(
    createElement(ReminderDetailView, {
      job: {
        ...job,
        kind: "course",
        course_enrollment_id: "enrollment",
        course_session_id: "session",
      },
      history: [],
      page: 1,
      more: false,
    }),
  );
  expect(html).toContain("Przed spotkaniem kursu");
  expect(html).toContain(
    'href="/admin/courses/meeting?enrollment=enrollment#spotkanie-session"',
  );
  expect(html).not.toContain("/admin/consultations/");
});
it("opens the individual fitness meeting without exposing its private location", () => {
  const html = renderToStaticMarkup(
    createElement(ReminderDetailView, {
      job: {
        ...job,
        kind: "fitness",
        fitness_package_id: "package",
        fitness_session_id: "session",
      },
      history: [],
      page: 1,
      more: false,
    }),
  );
  expect(html).toContain("Przed spotkaniem PSI FITNESS");
  expect(html).toContain('href="/admin/fitness/package#spotkanie-session"');
  expect(html).not.toContain("/admin/consultations/");
});
