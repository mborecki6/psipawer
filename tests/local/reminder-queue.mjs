// Actual local Auth, API and worker rehearsal for 50 fictional guardians.
// Existing jobs are protected; generated fixture IDs are the only deletions.
import assert from "node:assert/strict";
import { fork } from "node:child_process";
import { randomUUID } from "node:crypto";
import { chmodSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { parseEnv } from "node:util";
import { createClient } from "@supabase/supabase-js";
import { localBackupConfiguration } from "../../scripts/lib/backup-guards.mjs";
import { disposeBackupFitness } from "../helpers/backup-fitness-fixtures.mjs";
import { LocalPostgres, literal as q } from "../helpers/local-postgres.mjs";

const config = localBackupConfiguration(
  parseEnv(readFileSync(".env.test.local", "utf8")),
);
const options = {
  auth: { persistSession: false, autoRefreshToken: false },
  global: {
    fetch: (input, init) =>
      fetch(input, {
        ...init,
        redirect: "error",
        signal: AbortSignal.timeout(20000),
      }),
  },
};
const db = createClient("http://127.0.0.1:54321", config.secret, options);
const staff = createClient("http://127.0.0.1:54321", config.key, options);
const run = randomUUID();
const users = [],
  owners = [],
  courses = [],
  children = [];
const fixture = { dogs: [], packages: [] };
const observer = new LocalPostgres();
const faultName = `psi_queue_fault_${run.replaceAll("-", "")}`;
const lockKey = Number.parseInt(run.slice(0, 7), 16);
let guard, holder, before, migrations, originalAccounts, unrelatedBefore;
let installedFault = false,
  phase = "baseline",
  failed = false;
const report = {
  run,
  started_at: new Date().toISOString(),
  status: "running",
  checks: {},
};
const checked = (r) => {
  assert(!r.error, "Lokalna operacja próbna musi się powieść.");
  return r.data;
};
function stage(name) {
  phase = name;
}
async function snapshot() {
  // Actual workers intentionally update their last-run marker.
  return observer.json(`begin;
    create temporary table queue_original_state(name text,rows bigint,digest text) on commit drop;
    do $$ declare t record; n bigint; h text; begin
      for t in select c.relname from pg_class c join pg_namespace s on s.oid=c.relnamespace
        where s.nspname='public' and c.relkind='r' and c.relname<>'reminder_worker_state' order by c.relname loop
        execute format('select count(*),md5(coalesce(string_agg(md5(to_jsonb(r)::text),%L order by md5(to_jsonb(r)::text)),%L)) from public.%I r','','',t.relname) into n,h;
        insert into queue_original_state values(t.relname,n,h);
      end loop;
    end $$;
    select jsonb_agg(s order by name) from queue_original_state s;
    commit;`);
}
async function until(read, accepted, message, timeout = 8000) {
  const deadline = Date.now() + timeout;
  do {
    const value = await read();
    if (accepted(value)) return value;
    await delay(50);
  } while (Date.now() < deadline);
  throw new Error(message);
}
function launch() {
  const child = fork(resolve("scripts/reminders.mjs"), ["--once"], {
    cwd: process.cwd(),
    env: { PATH: process.env.PATH, NODE_ENV: "test" },
    execArgv: [],
    silent: true,
  });
  const task = { child, output: "", errors: "", terminal: false, error: null };
  task.done = new Promise((done) => {
    child.once("error", (error) => {
      task.error = error;
    });
    child.once("close", (code, signal) => {
      task.terminal = true;
      task.code = code;
      task.signal = signal;
      done();
    });
  });
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (s) => {
    task.output += s;
    if (task.output.length > 8192) child.kill("SIGKILL");
  });
  child.stderr.on("data", (s) => {
    task.errors += s;
    if (task.errors.length > 8192) child.kill("SIGKILL");
  });
  children.push(task);
  assert(Number.isSafeInteger(child.pid));
  return task;
}
async function terminal(task, timeout = 30000) {
  let timer;
  try {
    await Promise.race([
      task.done,
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("Proces próbny nie zakończył się w czasie.")),
          timeout,
        );
      }),
    ]);
    assert(!task.error);
  } finally {
    clearTimeout(timer);
  }
}
function counts(task) {
  assert.equal(task.errors, "");
  const result = task.output.match(
    /^Przypomnienia lokalne: w skrzynkach (\d+), błędy (\d+), wycofane (\d+), odłożone (\d+)\.\n$/,
  );
  assert(result, "CLI wypisuje wyłącznie liczniki.");
  return {
    sent: Number(result[1]),
    failed: Number(result[2]),
    cancelled: Number(result[3]),
    skipped: Number(result[4]),
  };
}
async function once() {
  const task = launch();
  await terminal(task);
  assert.equal(task.code, 0);
  assert.equal(task.signal, null);
  return counts(task);
}
const originalJobs = () =>
  observer.json(
    `select coalesce(json_agg(to_jsonb(j) order by id),'[]') from public.reminder_jobs j where dog_id not in (${fixture.dogs.map(q)});`,
  );
const state = (job) =>
  observer.json(`select json_build_object(
  'job',(select to_jsonb(j) from public.reminder_jobs j where id=${q(job)}),
  'attempts',(select coalesce(json_agg(to_jsonb(a) order by attempt),'[]') from public.reminder_attempts a where job_id=${q(job)}),
  'notices',(select coalesce(json_agg(to_jsonb(n) order by recipient_id),'[]') from public.notifications n where source_key=${q(`reminder:${job}`)}));`);
const courseState = (course) =>
  observer.json(`select json_build_object(
  'jobs',(select coalesce(json_agg(to_jsonb(j) order by id),'[]') from public.reminder_jobs j where entity_id=${q(course)}),
  'attempts',(select coalesce(json_agg(to_jsonb(a) order by job_id,attempt),'[]') from public.reminder_attempts a join public.reminder_jobs j on j.id=a.job_id where j.entity_id=${q(course)}),
  'notices',(select coalesce(json_agg(to_jsonb(n) order by id),'[]') from public.notifications n where entity_id=${q(course)} and kind='course_reminder'));
`);
async function removeFault() {
  if (!installedFault) return;
  await observer.query(`drop trigger if exists ${faultName} on public.notifications;
    drop function if exists public.${faultName}();`);
  installedFault = false;
}

try {
  await observer.ready();
  before = await snapshot();
  migrations = await observer.json(
    "select json_agg(version order by version) from supabase_migrations.schema_migrations;",
  );
  assert.equal(migrations.at(-1), "202610030012");
  originalAccounts = await observer.json(
    "select json_agg(id order by id) from auth.users;",
  );
  const settings = await observer.json(
    "select row_to_json(s) from public.calendar_settings s;",
  );
  assert.equal(settings.hours_enabled, false);
  assert.equal(settings.before_minutes, 0);
  assert.equal(settings.after_minutes, 0);

  stage("fictional-accounts");
  for (let i = 0; i < 52; i++) {
    const user = {
      email: `psi-reminder-queue-${run}-${i}@example.test`,
      password: `Psi-queue!${randomUUID()}`,
      role: i < 2 ? "admin" : "client",
    };
    users.push(user);
    user.id = checked(
      await db.auth.admin.createUser({
        email: user.email,
        password: user.password,
        email_confirm: true,
      }),
    ).user.id;
    if (i < 2)
      checked(
        await db
          .from("user_roles")
          .update({ role: "admin" })
          .eq("user_id", user.id),
      );
    const client =
      i === 0
        ? staff
        : i >= 2
          ? createClient("http://127.0.0.1:54321", config.key, options)
          : null;
    if (client)
      checked(
        await client.auth.signInWithPassword({
          email: user.email,
          password: user.password,
        }),
      );
    if (i >= 2) {
      const dog = randomUUID();
      fixture.dogs.push(dog);
      checked(
        await db.from("dogs").insert({
          id: dog,
          guardian_id: user.id,
          name: `Fikcyjny uczestnik kolejki ${i - 1}`,
          status: "approved",
        }),
      );
      owners.push({ client, id: user.id, dog });
    }
  }
  stage("course-and-250-due-jobs");
  const service = "60000000-0000-4000-8000-000000000001";
  const catalog = checked(
    await staff
      .from("services")
      .select("version,duration_minutes,sessions_count,course_format")
      .eq("id", service)
      .single(),
  );
  assert.equal(catalog.sessions_count, 5);
  assert.equal(catalog.course_format, "group");
  const start = await observer.json(`select to_json(min(t)) from (
    select now()+make_interval(hours=>n) t from generate_series(2,8) n
  ) candidates where not exists(select 1 from public.calendar_slots slot,generate_series(0,4) step
    where slot.occupied && tstzrange(t+make_interval(hours=>step*3),t+make_interval(hours=>step*3,mins=>${catalog.duration_minutes}),'[)'));`);
  assert.equal(typeof start, "string");
  const course = randomUUID();
  courses.push(course);
  checked(
    await staff.rpc("create_course", {
      p_id: course,
      p_service: service,
      p_expected_service_version: catalog.version,
      p_title: "Fikcyjny kurs kolejki 50 osób",
      p_capacity: 50,
      p_public_location: "Próbna okolica",
      p_exact_location: "FIKCYJNA ZBIÓRKA KOLEJKI",
      p_starts: Array.from({ length: 5 }, (_, n) =>
        new Date(Date.parse(start) + n * 3 * 3600000).toISOString(),
      ),
    }),
  );
  checked(
    await staff.rpc("change_course", {
      p_id: course,
      p_expected_version: 1,
      p_action: "publish",
      p_note: "",
    }),
  );
  const meetings = checked(
    await staff.from("course_sessions").select("id").eq("course_id", course),
  );
  assert.equal(meetings.length, 5);
  for (const owner of owners) {
    const enrollment = randomUUID();
    checked(
      await owner.client.rpc("request_course_enrollment", {
        p_id: enrollment,
        p_course: course,
        p_dog: owner.dog,
        p_expected_course_version: 2,
      }),
    );
    checked(
      await staff.rpc("change_course_enrollment", {
        p_id: enrollment,
        p_expected_version: 1,
        p_action: "accept",
        p_note: "",
      }),
    );
  }
  const jobs = checked(
    await staff
      .from("reminder_jobs")
      .select("id,status,target_at,next_attempt_at,attempts")
      .eq("entity_id", course),
  );
  assert.equal(jobs.length, 250);
  assert(jobs.every((j) => j.status === "pending" && j.attempts === 0));
  assert.equal(
    await observer.json(`select to_json(count(*)) from public.reminder_jobs
    where entity_id=${q(course)} and next_attempt_at<=clock_timestamp();`),
    250,
  );
  // Reorder only already-due fixture work, so protected original work cannot
  // consume the worker's fixed batch limit. Eligibility itself is unchanged.
  checked(
    await db
      .from("reminder_jobs")
      .update({ next_attempt_at: "2000-01-01T00:00:00.000Z" })
      .eq("entity_id", course)
      .eq("status", "pending"),
  );
  unrelatedBefore = await originalJobs();
  assert(unrelatedBefore.length < 45);
  stage("protect-existing-queue");
  guard = await new LocalPostgres().ready();
  await guard.query(`set idle_in_transaction_session_timeout='120s';begin;
    select id from public.reminder_jobs where dog_id not in (${fixture.dogs.map(q)}) order by id for update;`);

  stage("five-real-worker-batches");
  const batches = [];
  for (let i = 1; i <= 5; i++) {
    const result = await once();
    assert.deepEqual(result, { sent: 50, failed: 0, cancelled: 0, skipped: 0 });
    batches.push(result);
    const delivered = await courseState(course);
    assert.equal(delivered.jobs.length, 250);
    assert.equal(
      delivered.jobs.filter((j) => j.status === "sent" && j.attempts === 1)
        .length,
      50 * i,
    );
    assert.equal(
      delivered.jobs.filter((j) => j.status === "pending" && j.attempts === 0)
        .length,
      250 - 50 * i,
    );
    assert.equal(delivered.attempts.length, 50 * i);
    assert(delivered.attempts.every((a) => a.outcome === "sent"));
    assert.equal(delivered.notices.length, 50 * i);
  }
  const deliveredCourse = await courseState(course);
  assert.equal((await once()).sent, 0);
  assert.deepEqual(await courseState(course), deliveredCourse);

  stage("fifty-real-private-inboxes");
  for (let i = 0; i < owners.length; i++) {
    const owner = owners[i];
    const inbox = checked(
      await owner.client
        .from("notifications")
        .select("recipient_id,course_session_id,kind")
        .eq("entity_id", course)
        .eq("kind", "course_reminder"),
    );
    assert.equal(inbox.length, 5);
    assert(inbox.every((n) => n.recipient_id === owner.id));
    assert.deepEqual(
      inbox.map((n) => n.course_session_id).sort(),
      meetings.map((m) => m.id).sort(),
    );
    assert.deepEqual(
      checked(
        await owner.client
          .from("notifications")
          .select("id")
          .eq("recipient_id", owners[(i + 1) % 50].id)
          .eq("entity_id", course),
      ),
      [],
    );
  }
  assert.deepEqual(
    checked(
      await staff
        .from("notifications")
        .select("id")
        .eq("entity_id", course)
        .eq("kind", "course_reminder"),
    ),
    [],
  );
  report.checks.queue = {
    guardians: 50,
    meetings: 5,
    jobs: 250,
    batches: batches.length,
    notifications: 250,
    real_auth_inboxes: 50,
    cross_guardian_denied: true,
    retry_without_duplicate: true,
  };

  stage("follow-up-fanout-fixture");
  const today = await observer.json(
    "select to_json((now() at time zone 'Europe/Warsaw')::date);",
  );
  checked(
    await staff.rpc("save_care_plan", {
      p_dog: owners[0].dog,
      p_expected_version: 0,
      p_title: "Fikcyjny kontakt kolejki",
      p_body: "Fikcyjna treść próby bez zaleceń specjalistycznych.",
      p_follow_up_on: today,
      p_publish: true,
      p_consultation: null,
      p_course_enrollment: null,
      p_course_session: null,
      p_fitness_package: null,
      p_fitness_session: null,
    }),
  );
  const job = checked(
    await staff
      .from("reminder_jobs")
      .select("id,status,next_attempt_at")
      .eq("dog_id", owners[0].dog)
      .eq("kind", "follow_up")
      .eq("status", "pending")
      .single(),
  );
  assert.equal(
    await observer.json(
      `select to_json(next_attempt_at<=clock_timestamp()) from public.reminder_jobs where id=${q(job.id)};`,
    ),
    true,
  );
  const recipients = await observer.json(
    "select json_agg(user_id order by user_id) from public.user_roles where role='admin';",
  );
  assert(recipients.length >= 3);
  const source = `reminder:${job.id}`;
  holder = await new LocalPostgres().ready();
  await holder.query(`begin;select pg_advisory_xact_lock(67123,${lockKey});`);
  // At the second recipient, prove the first insertion exists inside the real
  // uncommitted transaction. An observed server lock is the evidence barrier.
  installedFault = true;
  await observer.query(`create function public.${faultName}() returns trigger language plpgsql set search_path='' as $$
    begin
      if new.source_key=${q(source)} and new.recipient_id=${q(recipients[1])} then
        if (select count(*) from public.notifications where source_key=${q(source)})<>1 then
          raise exception 'Owned fixture did not reach the second recipient';
        end if;
        perform pg_advisory_xact_lock(67123,${lockKey});
        raise exception 'Owned intentional recipient failure';
      end if;
      return new;
    end $$;
    create trigger ${faultName} before insert on public.notifications for each row execute function public.${faultName}();`);
  stage("actual-second-recipient-failure");
  const attempt = launch();
  await until(
    () =>
      observer.json(`select to_json(exists(select 1 from pg_stat_activity
    where pid<>${observer.pid} and state='active' and wait_event_type='Lock'
    and ${holder.pid}=any(pg_blocking_pids(pid)) and query like '%worker_process_due_reminders%'));`),
    Boolean,
    "Nie potwierdzono drugiego odbiorcy w rzeczywistej transakcji.",
  );
  assert.equal(attempt.terminal, false);
  const invisible = await state(job.id);
  assert.equal(invisible.job.status, "pending");
  assert.equal(invisible.notices.length, 0);
  await holder.query("commit;");
  await holder.close();
  holder = null;
  await terminal(attempt);
  assert.equal(attempt.code, 0);
  const faultResult = counts(attempt);
  assert.equal(faultResult.sent, 0);
  assert.equal(faultResult.failed, 1);
  assert.equal(faultResult.cancelled, 0);
  const retriable = await state(job.id);
  assert.equal(retriable.job.status, "retry");
  assert.equal(retriable.job.attempts, 1);
  assert.equal(retriable.job.last_error_code, "delivery_failed");
  assert.equal(retriable.notices.length, 0);
  assert.equal(retriable.attempts.length, 1);
  assert.equal(retriable.attempts[0].outcome, "failed");
  assert.equal(retriable.attempts[0].error_code, "delivery_failed");

  stage("fanout-successful-retry");
  await removeFault();
  await observer.query(
    `update public.reminder_jobs set next_attempt_at=clock_timestamp()-interval '1 second' where id=${q(job.id)} and status='retry';`,
  );
  const retryResult = await once();
  assert.equal(retryResult.sent, 1);
  assert.equal(retryResult.failed, 0);
  const delivered = await state(job.id);
  assert.equal(delivered.job.status, "sent");
  assert.equal(delivered.job.attempts, 2);
  assert.equal(delivered.job.last_error_code, null);
  assert.deepEqual(
    delivered.attempts.map((a) => a.outcome),
    ["failed", "sent"],
  );
  assert.deepEqual(
    delivered.notices.map((n) => n.recipient_id),
    recipients,
  );
  assert(
    delivered.notices.every(
      (n) => n.kind === "follow_up_reminder" && n.read_at === null,
    ),
  );
  assert.equal((await once()).sent, 0);
  assert.deepEqual(await state(job.id), delivered);
  assert.deepEqual(await courseState(course), deliveredCourse);
  assert.deepEqual(await originalJobs(), unrelatedBefore);
  report.checks.fanout = {
    recipients: recipients.length,
    second_recipient_observed: true,
    partial_delivery_rolled_back: true,
    safe_error: true,
    retries: 1,
    each_recipient_once: true,
    repeated_worker_no_duplicate: true,
  };
  report.checks.original_jobs_preserved = true;
  report.status = "ready";
} catch (error) {
  failed = true;
  report.status = "failed";
  report.failed_phase = phase;
  report.failure = {
    assertion: error?.code === "ERR_ASSERTION",
    own_lines: [
      ...String(error?.stack ?? "").matchAll(/reminder-queue\.mjs:(\d+):\d+/g),
    ].map((m) => Number(m[1])),
  };
  console.error(
    `Próba kolejki nie przeszła na etapie ${phase}; treści i poświadczenia pominięto.`,
  );
} finally {
  try {
    stage("cleanup");
    for (const task of children)
      if (!task.terminal) {
        task.child.kill("SIGKILL");
        await terminal(task, 5000);
      }
    await holder?.close();
    await guard?.close();
    await removeFault();
    if (courses.length)
      checked(await db.from("courses").delete().in("id", courses));
    await disposeBackupFitness(db, fixture);
    for (const client of [staff, ...owners.map((o) => o.client)])
      checked(await client.auth.signOut());
    for (const user of users) {
      if (!user.id)
        user.id = checked(
          await db.auth.admin.listUsers({ page: 1, perPage: 1000 }),
        ).users.find((u) => u.email === user.email)?.id;
      if (user.id) {
        checked(await db.from("audit_events").delete().eq("actor_id", user.id));
        checked(await db.auth.admin.deleteUser(user.id));
      }
    }
    if (before) assert.deepEqual(await snapshot(), before);
    if (originalAccounts)
      assert.deepEqual(
        await observer.json("select json_agg(id order by id) from auth.users;"),
        originalAccounts,
      );
    if (migrations)
      assert.deepEqual(
        await observer.json(
          "select json_agg(version order by version) from supabase_migrations.schema_migrations;",
        ),
        migrations,
      );
    assert.equal(
      await observer.json(
        `select to_json(not exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname=${q(faultName)}));`,
      ),
      true,
    );
    report.cleanup = true;
    console.log(
      "Próba kolejki: własne dane usunięte; wcześniejsze konta i publiczne tabele zachowane poza rzeczywistym znacznikiem procesu.",
    );
  } catch {
    failed = true;
    report.status = "failed";
    report.cleanup = false;
    console.error(
      "Sprzątanie kolejki niepotwierdzone; nie resetuj lokalnej bazy.",
    );
  } finally {
    await observer.close();
  }
  report.finished_at = new Date().toISOString();
  const file = ".local/reminder-queue-report.json";
  writeFileSync(file, JSON.stringify(report, null, 2) + "\n", { mode: 0o600 });
  chmodSync(file, 0o600);
}
if (!failed) console.log(JSON.stringify(report));
process.exitCode = failed ? 1 : 0;
