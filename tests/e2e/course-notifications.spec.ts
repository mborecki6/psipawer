import { test, expect } from "@playwright/test";
import { mkdirSync } from "node:fs";
import {
  LocalPostgres,
  literal as q,
  waitForLock,
} from "../helpers/local-postgres.mjs";
import {
  account,
  checked,
  disposeCareFixtures,
  localClients,
  login,
} from "./local-fixtures";

test.use({ trace: "off" });
const service = "60000000-0000-4000-8000-000000000001";
test("course messages: real delivery locks, fresh meeting links, cancellation and guardian privacy", async ({
  browser,
  baseURL,
}) => {
  test.setTimeout(180000);
  const { db, client } = localClients(baseURL),
    staffApi = client(),
    ownerApi = client(),
    otherApi = client();
  const users: string[] = [],
    dogs: string[] = [],
    courses: string[] = [];
  const observer = await new LocalPostgres().ready();
  const ownerContext = await browser.newContext({
    baseURL,
    viewport: { width: 320, height: 844 },
  });
  const staffContext = await browser.newContext({
    baseURL,
    viewport: { width: 390, height: 844 },
  });
  const ownerPage = await ownerContext.newPage(),
    staffPage = await staffContext.newPage();
  let protectedJobs: LocalPostgres | undefined;
  try {
    const admin = await account(db, users, "admin"),
      owner = await account(db, users, "client"),
      other = await account(db, users, "client");
    for (const [api, user] of [
      [staffApi, admin],
      [ownerApi, owner],
      [otherApi, other],
    ] as const)
      await checked(
        api.auth.signInWithPassword({
          email: user.email,
          password: user.password,
        }),
      );
    for (const [index, user] of [owner, other].entries()) {
      const dog = await checked(
        db
          .from("dogs")
          .insert({
            guardian_id: user.id,
            name: `Powiadomienia kursów ${index}`,
            status: "approved",
          })
          .select("id")
          .single(),
      );
      if (!dog) throw new Error("Local course dog fixture missing");
      dogs.push(dog.id);
    }
    protectedJobs = await new LocalPostgres().ready();
    await protectedJobs.query(`set idle_in_transaction_session_timeout='180s'; begin;
      select id from public.reminder_jobs where dog_id not in (${dogs.map(q)}) order by id for update;`);
    const existingSql = `select coalesce(json_agg(to_jsonb(j) order by id),'[]') from public.reminder_jobs j where dog_id not in (${dogs.map(q)});`;
    const existing = await observer.json(existingSql);
    expect(existing.length).toBeLessThan(80);
    const catalog = await checked(
      staffApi.from("services").select("version").eq("id", service).single(),
    );
    if (!catalog) throw new Error("Local course service fixture missing");
    const serviceVersion = catalog.version;
    const starts = await observer.json(`select to_json(min(t)) from (
      select now()+make_interval(hours=>n) t from generate_series(3,18,3) n
    ) candidates where not exists(select 1 from public.calendar_slots slot,generate_series(0,4) week
      where slot.occupied && tstzrange(t+make_interval(days=>week*7),t+make_interval(days=>week*7)+interval '120 minutes','[)'));`);
    expect(typeof starts).toBe("string");
    async function makeCourse(offset = 0) {
      const id = crypto.randomUUID();
      courses.push(id);
      await checked(
        staffApi.rpc("create_course", {
          p_id: id,
          p_service: service,
          p_expected_service_version: serviceVersion,
          p_title: "Powiadomienia — kurs próbny",
          p_capacity: 2,
          p_public_location: "Próbny park",
          p_exact_location: "FIKCYJNA PRYWATNA ZBIÓRKA",
          p_starts: Array.from({ length: 5 }, (_, n) =>
            new Date(
              Date.parse(starts) + (offset + n * 7) * 86400000,
            ).toISOString(),
          ),
        }),
      );
      await checked(
        staffApi.rpc("change_course", {
          p_id: id,
          p_expected_version: 1,
          p_action: "publish",
          p_note: "",
        }),
      );
      const enrollment = crypto.randomUUID();
      await checked(
        ownerApi.rpc("request_course_enrollment", {
          p_id: enrollment,
          p_course: id,
          p_dog: dogs[0],
          p_expected_course_version: 2,
        }),
      );
      await checked(
        staffApi.rpc("change_course_enrollment", {
          p_id: enrollment,
          p_expected_version: 1,
          p_action: "accept",
          p_note: "",
        }),
      );
      const sessions = await checked(
        staffApi
          .from("course_sessions")
          .select("id,starts_at,version")
          .eq("course_id", id)
          .order("ordinal"),
      );
      return { id, enrollment, meeting: sessions![0] };
    }
    const cycle = await makeCourse();
    const waiting = crypto.randomUUID();
    await checked(
      otherApi.rpc("request_course_enrollment", {
        p_id: waiting,
        p_course: cycle.id,
        p_dog: dogs[1],
        p_expected_course_version: 2,
      }),
    );
    await checked(
      staffApi.rpc("change_course_enrollment", {
        p_id: waiting,
        p_expected_version: 1,
        p_action: "waitlist",
        p_note: "",
      }),
    );
    expect(await checked(ownerApi.from("reminder_jobs").select("id"))).toEqual(
      [],
    );
    expect(
      (await ownerApi.rpc("worker_process_due_reminders", { p_limit: 100 }))
        .error,
    ).toBeTruthy();
    expect(
      (await staffApi.rpc("worker_process_due_reminders", { p_limit: 100 }))
        .error,
    ).toBeTruthy();
    expect(
      await checked(
        db
          .from("reminder_jobs")
          .select("id")
          .in("dog_id", dogs)
          .eq("status", "pending"),
      ),
    ).toHaveLength(5);

    const edit = await new LocalPostgres().ready(),
      duringEdit = await new LocalPostgres().ready();
    const newTime = new Date(
      Date.parse(cycle.meeting.starts_at) + 3600000,
    ).toISOString();
    try {
      await edit.asUser(admin.id);
      await edit.query(
        `select public.reschedule_course_session(${q(cycle.meeting.id)},1,${q(newTime)},'Próba zmiany','Nowy próbny park','NOWA FIKCYJNA ZBIÓRKA');`,
      );
      await duringEdit.query("begin; set local role service_role;");
      const result = await duringEdit.json(
        "select public.worker_process_due_reminders(100);",
      );
      expect(result.sent).toBe(0);
      expect(result.skipped).toBeGreaterThan(0);
      await duringEdit.query("commit;");
      await edit.query("commit;");
    } finally {
      await Promise.all([edit.close(), duringEdit.close()]);
    }
    const jobs = await checked(
      db.from("reminder_jobs").select("*").in("dog_id", dogs),
    );
    expect(jobs).toHaveLength(6);
    expect(
      jobs!
        .filter((j) => j.course_session_id === cycle.meeting.id)
        .map((j) => j.status)
        .sort(),
    ).toEqual(["cancelled", "pending"]);

    // Both processes really overlap. The second skips the parent course and
    // waits on the shared worker timestamp; delivery itself remains singular.
    const firstWorker = await new LocalPostgres().ready(),
      secondWorker = await new LocalPostgres().ready();
    let second: Promise<unknown> | undefined;
    try {
      await firstWorker.query("begin; set local role service_role;");
      expect(
        (
          await firstWorker.json(
            "select public.worker_process_due_reminders(100);",
          )
        ).sent,
      ).toBe(1);
      await secondWorker.query("begin; set local role service_role;");
      second = secondWorker.json(
        "select public.worker_process_due_reminders(100);",
      );
      await waitForLock(observer, firstWorker, secondWorker);
      await firstWorker.query("commit;");
      expect(await second).toMatchObject({ sent: 0, failed: 0 });
      await secondWorker.query("commit;");
    } finally {
      await Promise.all([firstWorker.close(), secondWorker.close()]);
      if (second) await second;
    }
    const sent = await checked(
      db
        .from("reminder_jobs")
        .select("id,attempts")
        .in("dog_id", dogs)
        .eq("status", "sent"),
    );
    expect(sent).toHaveLength(1);
    expect(sent![0].attempts).toBe(1);
    const notices = await checked(
      ownerApi.rpc("notification_feed", { p_filter: "all", p_before: null }),
    );
    const reminder = notices!.find(
      (n: { kind: string }) => n.kind === "course_reminder",
    );
    expect(reminder).toMatchObject({
      entity_id: cycle.id,
      course_enrollment_id: cycle.enrollment,
      course_session_id: cycle.meeting.id,
    });
    expect(
      (await checked(
        otherApi.rpc("notification_feed", { p_filter: "all", p_before: null }),
      ))!.filter((n: { kind: string }) => n.kind === "course_reminder"),
    ).toHaveLength(0);
    expect(JSON.stringify(notices)).not.toContain("FIKCYJNA ZBIÓRKA");

    await login(ownerPage, owner, "client");
    await ownerPage.goto("/app/notifications");
    const message = ownerPage.locator("li").filter({
      has: ownerPage.getByRole("heading", {
        name: "Zbliża się spotkanie kursu",
        exact: true,
      }),
    });
    await message
      .getByRole("button", { name: "Otwórz sprawę", exact: true })
      .click();
    await expect(ownerPage).toHaveURL(
      new RegExp(
        `/app/courses/${cycle.id}\\?enrollment=${cycle.enrollment}#spotkanie-${cycle.meeting.id}$`,
      ),
    );
    const meetingCard = ownerPage.locator("#spotkanie-1");
    await expect(meetingCard).toContainText("NOWA FIKCYJNA ZBIÓRKA");
    await expect(meetingCard).toContainText("Nowy próbny park");
    expect(
      await ownerPage.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    mkdirSync("output/course-notifications", { recursive: true });
    await ownerPage.screenshot({
      path: "output/course-notifications/guardian-meeting-320.png",
    });
    await login(staffPage, admin, "admin");
    await staffPage.goto(`/admin/reminders/${sent![0].id}`);
    await expect(
      staffPage.getByRole("heading", { name: /Przed spotkaniem kursu/ }),
    ).toBeVisible();
    const source = staffPage.getByRole("link", {
      name: "Otwórz aktualną sprawę",
      exact: true,
    });
    await expect(source).toHaveAttribute(
      "href",
      `/admin/courses/${cycle.id}?enrollment=${cycle.enrollment}#spotkanie-${cycle.meeting.id}`,
    );
    await staffPage.screenshot({
      path: "output/course-notifications/staff-reminder-390.png",
      fullPage: true,
    });
    await source.click();
    await expect(staffPage.locator("#spotkanie-1")).toContainText(
      "NOWA FIKCYJNA ZBIÓRKA",
    );

    // A later generation can be delivered just before a concurrent cancellation.
    await checked(
      staffApi.rpc("reschedule_course_session", {
        p_id: cycle.meeting.id,
        p_expected_version: 2,
        p_starts_at: new Date(Date.parse(newTime) + 3600000).toISOString(),
        p_note: "Druga zmiana",
        p_public_location: null,
        p_exact_location: null,
      }),
    );
    const delivery = await new LocalPostgres().ready(),
      cancel = await new LocalPostgres().ready();
    let cancellation: Promise<unknown> | undefined;
    try {
      await delivery.query("begin; set local role service_role;");
      expect(
        (
          await delivery.json(
            "select public.worker_process_due_reminders(100);",
          )
        ).sent,
      ).toBe(1);
      await cancel.asUser(owner.id);
      cancellation = cancel.query(
        `select public.change_course_enrollment(${q(cycle.enrollment)},2,'cancel','Rezygnacja z kursu');`,
      );
      await waitForLock(observer, delivery, cancel);
      await delivery.query("commit;");
      await cancellation;
      await cancel.query("commit;");
    } finally {
      await Promise.all([delivery.close(), cancel.close()]);
      if (cancellation) await cancellation;
    }
    const remaining = await checked(
      db
        .from("reminder_jobs")
        .select("status")
        .eq("course_enrollment_id", cycle.enrollment),
    );
    expect(remaining!.filter((j) => j.status === "sent")).toHaveLength(2);
    expect(
      remaining!.every((j) => ["sent", "cancelled"].includes(j.status)),
    ).toBe(true);

    const next = await makeCourse(2);
    // Only this fixture's first job is due; the actual meeting stays future.
    await checked(
      db
        .from("reminder_jobs")
        .update({ next_attempt_at: new Date().toISOString() })
        .eq("course_session_id", next.meeting.id),
    );
    const cancelFirst = await new LocalPostgres().ready(),
      afterCancel = await new LocalPostgres().ready();
    try {
      await cancelFirst.asUser(owner.id);
      await cancelFirst.query(
        `select public.change_course_enrollment(${q(next.enrollment)},2,'cancel','Rezygnacja przed przypomnieniem');`,
      );
      await afterCancel.query("begin; set local role service_role;");
      expect(
        (
          await afterCancel.json(
            "select public.worker_process_due_reminders(100);",
          )
        ).sent,
      ).toBe(0);
      await afterCancel.query("commit;");
      await cancelFirst.query("commit;");
      await checked(staffApi.rpc("process_due_reminders", { p_limit: 100 }));
      expect(
        await checked(
          ownerApi
            .from("notifications")
            .select("id")
            .eq("kind", "course_reminder")
            .eq("course_enrollment_id", next.enrollment),
        ),
      ).toEqual([]);
    } finally {
      await Promise.all([cancelFirst.close(), afterCancel.close()]);
    }
    expect(await observer.json(existingSql)).toEqual(existing);
  } finally {
    await protectedJobs?.close();
    await Promise.all([
      ownerContext.close(),
      staffContext.close(),
      observer.close(),
    ]);
    if (dogs.length)
      await checked(db.from("payments").delete().in("dog_id", dogs));
    if (courses.length)
      await checked(db.from("courses").delete().in("id", courses));
    await disposeCareFixtures(db, users, dogs);
  }
});
