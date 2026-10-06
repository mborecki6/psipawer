import { test, expect } from "@playwright/test";
import { execFile } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { promisify } from "node:util";
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

const execute = promisify(execFile);
test.use({ trace: "off" });

test("reminders → local worker → concurrent delivery → failure and phone retry", async ({
  browser,
  baseURL,
}) => {
  test.setTimeout(180000);
  const { db, client } = localClients(baseURL);
  const users: string[] = [],
    dogs: string[] = [];
  const staffDb = client(),
    guardianDb = client(),
    outsiderDb = client();
  const staffContext = await browser.newContext({
    baseURL,
    viewport: { width: 390, height: 844 },
  });
  const guardianContext = await browser.newContext({
    baseURL,
    viewport: { width: 390, height: 844 },
  });
  const staff = await staffContext.newPage();
  const guardian = await guardianContext.newPage();
  const observer = new LocalPostgres();
  let staffId: string | undefined;

  // Existing local jobs stay locked, not rewritten or processed by the test.
  // Each bounded worker invocation releases these locks in its finally block.
  async function isolatedQueue<T>(action: () => Promise<T>) {
    const guard = new LocalPostgres();
    try {
      await guard.ready();
      // Outlast the worker's 25 s HTTP deadline / 30 s child-process deadline.
      await guard.query(`set idle_in_transaction_session_timeout='60s';
        begin; select id from public.reminder_jobs
        where dog_id not in (${dogs.map(q)}) order by id for update;`);
      const existingSql = `select coalesce(json_agg(to_jsonb(j) order by id),'[]')
        from public.reminder_jobs j where dog_id not in (${dogs.map(q)});`;
      const before = await observer.json(existingSql);
      // A test should not hide the fixture behind a full batch of unrelated jobs.
      expect(before.length).toBeLessThan(45);
      const result = await action();
      expect(await observer.json(existingSql)).toEqual(before);
      return result;
    } finally {
      await guard.close();
    }
  }

  async function runWorker() {
    return isolatedQueue(async () => {
      // Exercise the shipped CLI, its own local-only config and real PostgREST.
      const result = await execute(
        process.execPath,
        ["scripts/reminders.mjs", "--once"],
        {
          cwd: process.cwd(),
          env: { PATH: process.env.PATH, NODE_ENV: "test" },
          encoding: "utf8",
          timeout: 30000,
          maxBuffer: 4096,
        },
      );
      expect(result.stderr).toBe("");
      const counts = result.stdout.match(
        /w skrzynkach (\d+), błędy (\d+), wycofane (\d+), odłożone (\d+)\./,
      );
      expect(counts).not.toBeNull();
      return {
        sent: Number(counts![1]),
        failed: Number(counts![2]),
        cancelled: Number(counts![3]),
        skipped: Number(counts![4]),
      };
    });
  }

  async function freeTime(days = 0): Promise<string> {
    const value = await observer.json(`select to_json(min(t)) from (
      select now()+make_interval(days=>${days},hours=>n) t from generate_series(2,20,2) n
    ) candidates where not exists(select 1 from public.calendar_slots
      where occupied && tstzrange(t,t+interval '90 minutes','[)'));`);
    expect(typeof value).toBe("string");
    return value;
  }

  async function latestJob(kind: string, source: string) {
    const jobs = await checked(
      db
        .from("reminder_jobs")
        .select("*")
        .eq("kind", kind)
        .eq("source_id", source)
        .order("generation", { ascending: false })
        .limit(1),
    );
    expect(jobs).toHaveLength(1);
    return jobs![0];
  }

  async function reminderMessages(job: string) {
    return checked(
      db
        .from("notifications")
        .select("id,recipient_id,kind,entity_id")
        .eq("source_key", `reminder:${job}`),
    );
  }

  async function newWalk() {
    const id = await checked(
      staffDb.rpc("create_walk", {
        payload: {
          starts_at: await freeTime(),
          duration_minutes: 60,
          public_location: "Lokalna próba przypomnień",
          exact_location: "Fikcyjne miejsce",
          type: "Próba przypomnienia",
          price_cents: 10000,
          capacity: 2,
          booking_mode: "approval",
          cancellation_deadline_hours: 24,
        },
      }),
    );
    const registration = await checked(
      guardianDb.rpc("register_dog", { p_walk: id, p_dog: dogs[0] }),
    );
    await checked(
      staffDb.rpc("decide_registration", {
        p_registration: registration,
        p_status: "accepted",
        p_note: "Próba lokalna",
      }),
    );
    return { id, registration, job: await latestJob("walk", registration) };
  }

  try {
    await observer.ready();
    const leader = await account(db, users, "admin");
    staffId = leader.id;
    const owner = await account(db, users, "client");
    const other = await account(db, users, "client");
    for (const [session, user] of [
      [staffDb, leader],
      [guardianDb, owner],
      [outsiderDb, other],
    ] as const)
      await checked(
        session.auth.signInWithPassword({
          email: user.email,
          password: user.password,
        }),
      );
    const dog = await checked(
      guardianDb
        .from("dogs")
        .insert({
          guardian_id: owner.id,
          name: `Przypomnienia ${crypto.randomUUID().slice(0, 6)}`,
        })
        .select("id,name")
        .single(),
    );
    dogs.push(dog!.id);
    await checked(
      staffDb.rpc("set_dog_status", {
        p_dog: dogs[0],
        p_status: "approved",
        p_note: "Lokalna próba",
      }),
    );
    await login(staff, leader, "admin");
    await login(guardian, owner, "client");

    const consultation = crypto.randomUUID();
    const service = await checked(
      guardianDb
        .from("services")
        .select("version")
        .eq("id", "60000000-0000-4000-8000-000000000011")
        .single(),
    );
    await checked(
      guardianDb.rpc("request_consultation", {
        p_id: consultation,
        p_dog: dogs[0],
        p_topic: "Fikcyjna próba przypomnienia",
        p_availability: "",
        p_service: "60000000-0000-4000-8000-000000000011",
        p_expected_service_version: service!.version,
      }),
    );
    const schedule = async (version: number, starts: string) =>
      checked(
        staffDb.rpc("change_consultation", {
          p_id: consultation,
          p_expected_version: version,
          p_action: "schedule",
          p_starts_at: starts,
          p_duration: 90,
          p_mode: "online",
          p_location: "Spotkanie testowe online",
          p_note: "Zmiana w próbie lokalnej",
        }),
      );
    await schedule(1, await freeTime());
    const original = await latestJob("consultation", consultation);
    expect(original.status).toBe("pending");
    await staff.goto(`/admin/reminders/${original.id}`);
    await expect(
      staff.getByRole("heading", { name: "Historia prób" }),
    ).toBeVisible();
    await expect(
      staff.getByText("Nie wykonano jeszcze próby dostarczenia.", {
        exact: false,
      }),
    ).toBeVisible();
    expect((await latestJob("consultation", consultation)).attempts).toBe(0);

    // API isolation is exercised with real Auth tokens, not mocked roles.
    for (const session of [guardianDb, outsiderDb]) {
      expect(
        await checked(
          session.from("reminder_jobs").select("id").eq("id", original.id),
        ),
      ).toEqual([]);
      expect(
        Boolean(
          (await session.rpc("worker_process_due_reminders", { p_limit: 50 }))
            .error,
        ),
      ).toBe(true);
      expect(
        Boolean(
          (await session.rpc("process_due_reminders", { p_limit: 50 })).error,
        ),
      ).toBe(true);
    }
    expect(
      Boolean(
        (await staffDb.rpc("worker_process_due_reminders", { p_limit: 50 }))
          .error,
      ),
    ).toBe(true);

    await schedule(2, await freeTime(3));
    const future = await latestJob("consultation", consultation);
    expect(future.generation).toBe(2);
    expect(
      (await checked(
        db
          .from("reminder_jobs")
          .select("status")
          .eq("id", original.id)
          .single(),
      ))!.status,
    ).toBe("cancelled");
    expect((await runWorker()).sent).toBe(0);
    expect(await reminderMessages(original.id)).toEqual([]);
    expect(await reminderMessages(future.id)).toEqual([]);

    await schedule(3, await freeTime());
    const due = await latestJob("consultation", consultation);
    expect(due.generation).toBe(3);
    expect(await runWorker()).toMatchObject({ sent: 1, failed: 0 });
    const messages = await reminderMessages(due.id);
    expect(messages).toHaveLength(1);
    expect(messages![0]).toMatchObject({
      recipient_id: owner.id,
      kind: "consultation_reminder",
      entity_id: consultation,
    });
    expect(
      await checked(
        outsiderDb.from("notifications").select("id").eq("id", messages![0].id),
      ),
    ).toEqual([]);
    expect((await runWorker()).sent).toBe(0);
    expect((await latestJob("consultation", consultation)).attempts).toBe(1);
    expect(await reminderMessages(due.id)).toHaveLength(1);

    await guardian.goto("/app/notifications");
    const notice = guardian.getByRole("listitem").filter({
      has: guardian.getByRole("heading", {
        name: "Zbliża się konsultacja",
        exact: true,
      }),
    });
    await expect(notice).toBeVisible();
    await notice
      .getByRole("button", { name: "Otwórz sprawę", exact: true })
      .click();
    await expect(guardian).toHaveURL(
      new RegExp(`/app/consultations/${consultation}$`),
    );

    // Two service-role database transactions overlap. The second skips the
    // first one's source and waits only to write the shared worker heartbeat.
    const concurrent = await newWalk();
    await isolatedQueue(async () => {
      const a = new LocalPostgres(),
        b = new LocalPostgres();
      let pending: Promise<{ value?: unknown; error?: Error }> | undefined;
      try {
        await a.ready();
        await b.ready();
        for (const connection of [a, b]) {
          await connection.query("begin; set local role service_role;");
          expect(await connection.json("select to_json(current_user);")).toBe(
            "service_role",
          );
        }
        const first = await a.json(
          "select public.worker_process_due_reminders(50);",
        );
        expect(first.sent).toBe(1);
        expect(await reminderMessages(concurrent.job.id)).toEqual([]);
        pending = b
          .json("select public.worker_process_due_reminders(50);")
          .then(
            (value) => ({ value }),
            (error: Error) => ({ error }),
          );
        await waitForLock(observer, a, b);
        await a.query("commit;");
        const second = await pending;
        expect(second.error).toBeUndefined();
        expect(second.value).toMatchObject({ sent: 0, failed: 0 });
        await b.query("commit;");
      } finally {
        await Promise.all([a.close(), b.close()]);
        if (pending) await pending;
      }
    });
    expect(await reminderMessages(concurrent.job.id)).toHaveLength(1);
    expect((await latestJob("walk", concurrent.registration)).attempts).toBe(1);

    // Missing recipient is a real dispatch failure. Only this fixture's role
    // is removed; real account roles, functions and triggers stay unchanged.
    const failing = await newWalk();
    await checked(db.from("user_roles").delete().eq("user_id", owner.id));
    try {
      for (let attempt = 1; attempt <= 5; attempt++) {
        if (attempt > 1)
          await checked(
            db
              .from("reminder_jobs")
              .update({
                next_attempt_at: new Date(Date.now() - 1000).toISOString(),
              })
              .eq("id", failing.job.id),
          );
        const result = await runWorker();
        expect(result).toMatchObject({ sent: 0, failed: 1 });
        const job = await latestJob("walk", failing.registration);
        expect(job).toMatchObject({
          attempts: attempt,
          cycle_attempts: attempt,
          last_error_code: "delivery_failed",
          status: attempt === 5 ? "failed" : "retry",
        });
        expect(await reminderMessages(job.id)).toEqual([]);
        if (attempt < 5) {
          const minutes = [1, 5, 15, 60][attempt - 1];
          const seconds =
            (new Date(job.next_attempt_at).getTime() - Date.now()) / 1000;
          expect(seconds).toBeGreaterThan(minutes * 60 - 10);
          expect(seconds).toBeLessThanOrEqual(minutes * 60 + 5);
        }
      }
    } finally {
      await checked(
        db.from("user_roles").insert({ user_id: owner.id, role: "client" }),
      );
    }
    await staff.goto(`/admin/reminders/${failing.job.id}`);
    await expect(
      staff.getByText("Dostarczenie nie powiodło się po pięciu próbach.", {
        exact: false,
      }),
    ).toBeVisible();
    await expect(
      staff.getByText(/Próba \d+ · Nie udało się dostarczyć/),
    ).toHaveCount(5);
    await mkdir("test-results/reminders-ui", { recursive: true });
    for (const width of [320, 390, 768, 1440]) {
      await staff.setViewportSize({ width, height: 844 });
      await expect
        .poll(() =>
          staff.getByRole("heading", { level: 1 }).evaluate((heading) => {
            const bounds = heading.getBoundingClientRect();
            return (
              bounds.height <=
              parseFloat(getComputedStyle(heading).lineHeight) + 1
            );
          }),
        )
        .toBe(true);
      const retry = staff.getByRole("button", {
        name: "Ponów przypomnienie",
        exact: true,
      });
      await expect
        .poll(() =>
          retry.evaluate((button) => {
            const bounds = button.getBoundingClientRect();
            const card = button.closest(".card")!.getBoundingClientRect();
            return (
              bounds.width >= 100 &&
              bounds.left >= card.left &&
              bounds.right <= Math.min(card.right, innerWidth) &&
              button.scrollWidth <= button.clientWidth + 1
            );
          }),
        )
        .toBe(true);
      await staff.screenshot({
        path: `test-results/reminders-ui/failed-${width}.png`,
        fullPage: true,
      });
    }
    await staff.setViewportSize({ width: 390, height: 844 });
    await staff.screenshot({
      path: "test-results/reminders-ui/failed-phone.png",
      fullPage: true,
    });
    // The row disappears from this filter after retry. Navigation must retain
    // visible confirmation instead of silently removing the clicked form.
    await staff.goto("/admin/reminders?filter=failed");
    await staff
      .getByRole("listitem")
      .filter({ hasText: dog!.name })
      .getByRole("button", { name: "Ponów przypomnienie", exact: true })
      .click();
    await expect(staff).toHaveURL(
      new RegExp(`/admin/reminders/${failing.job.id}$`),
    );
    await expect(staff.getByRole("status")).toContainText(
      "czeka na ponowną próbę",
    );
    expect((await latestJob("walk", failing.registration)).cycle_attempts).toBe(
      0,
    );
    expect(await runWorker()).toMatchObject({ sent: 1, failed: 0 });
    await staff.reload();
    await expect(
      staff.getByText("Próba 6 · Zapisano w skrzynce", { exact: false }),
    ).toBeVisible();
    await expect(
      staff.getByRole("button", { name: "Ponów przypomnienie", exact: true }),
    ).toHaveCount(0);
    expect(await reminderMessages(failing.job.id)).toHaveLength(1);
    expect(await latestJob("walk", failing.registration)).toMatchObject({
      attempts: 6,
      cycle_attempts: 1,
      status: "sent",
      last_error_code: null,
    });
    expect(
      await staff.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await staff.screenshot({
      path: "test-results/reminders-ui/recovered-phone.png",
      fullPage: true,
    });

    const cancelled = await newWalk();
    await checked(
      staffDb.rpc("cancel_walk", {
        p_walk: cancelled.id,
        p_reason: "Odwołanie w próbie lokalnej",
      }),
    );
    expect((await latestJob("walk", cancelled.registration)).status).toBe(
      "cancelled",
    );
    expect((await runWorker()).sent).toBe(0);
    expect(await reminderMessages(cancelled.job.id)).toEqual([]);

    // Overdue follow-ups still reach current staff; no guardian notification.
    await checked(
      staffDb.rpc("save_care_plan", {
        p_dog: dogs[0],
        p_expected_version: 0,
        p_title: "Próba kontaktu kontrolnego",
        p_body: "Treść fikcyjna do testu, bez zaleceń specjalistycznych.",
        p_follow_up_on: new Date(Date.now() - 86400000)
          .toISOString()
          .slice(0, 10),
        p_publish: true,
      }),
    );
    const task = await checked(
      db.from("care_follow_ups").select("id").eq("dog_id", dogs[0]).single(),
    );
    const contactJob = await latestJob("follow_up", task!.id);
    const recipients = await checked(
      db.from("user_roles").select("user_id").eq("role", "admin"),
    );
    expect(await runWorker()).toMatchObject({ sent: 1, failed: 0 });
    const contacts = await reminderMessages(contactJob.id);
    expect(contacts!.map((n) => n.recipient_id).sort()).toEqual(
      recipients!.map((r) => r.user_id).sort(),
    );
    expect(
      contacts!.every(
        (n) => n.kind === "follow_up_reminder" && n.entity_id === task!.id,
      ),
    ).toBe(true);
    expect(
      await checked(
        guardianDb
          .from("notifications")
          .select("id")
          .eq("source_key", `reminder:${contactJob.id}`),
      ),
    ).toEqual([]);
    expect((await runWorker()).sent).toBe(0);
  } finally {
    await Promise.all([staffContext.close(), guardianContext.close()]);
    for (const session of [staffDb, guardianDb, outsiderDb])
      await session.auth.signOut();
    try {
      if (staffId)
        await checked(db.from("walks").delete().eq("leader_id", staffId));
      await disposeCareFixtures(db, users, dogs);
    } finally {
      await observer.close();
    }
  }
});
