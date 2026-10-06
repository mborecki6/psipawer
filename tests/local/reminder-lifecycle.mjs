// Full local Auth/API/CLI rehearsal. Only generated fictional records are
// removed. Existing jobs are locked and compared; production is unreachable.
import assert from "node:assert/strict";
import { fork } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
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
const owner = createClient("http://127.0.0.1:54321", config.key, options);
const staff = createClient("http://127.0.0.1:54321", config.key, options);
const run = randomUUID(),
  users = [],
  fitness = { dogs: [], packages: [] },
  children = [];
const observer = new LocalPostgres();
let guard,
  holder,
  before,
  unrelatedBefore,
  phase = "baseline",
  failed = false;
const report = { run, status: "running", checks: {} };
const checked = (r) => {
  assert(!r.error, "Lokalna operacja próbna musi się powieść.");
  return r.data;
};
const stage = (name) => {
  phase = name;
};

async function snapshot() {
  // The real last-run marker intentionally records these real CLI executions.
  // All other public tables must return to their exact previous contents.
  return observer.json(`begin;
    create temporary table reminder_original_state(name text,rows bigint,digest text) on commit drop;
    do $$ declare t record; n bigint; h text; begin
      for t in select c.relname from pg_class c join pg_namespace s on s.oid=c.relnamespace
        where s.nspname='public' and c.relkind='r' and c.relname<>'reminder_worker_state' order by c.relname loop
        execute format('select count(*),md5(coalesce(string_agg(md5(to_jsonb(r)::text),%L order by md5(to_jsonb(r)::text)),%L)) from public.%I r','','',t.relname) into n,h;
        insert into reminder_original_state values(t.relname,n,h);
      end loop;
    end $$;
    select jsonb_agg(s order by name) from reminder_original_state s;
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
function launch({ watch = false, boundary = false } = {}) {
  const child = fork(
    resolve("scripts/reminders.mjs"),
    [watch ? "--watch" : "--once"],
    {
      cwd: process.cwd(),
      env: { PATH: process.env.PATH, NODE_ENV: "test" },
      execArgv: boundary
        ? ["--import", resolve("tests/helpers/reminder-response-boundary.mjs")]
        : [],
      silent: true,
    },
  );
  const task = {
    child,
    output: "",
    errors: "",
    messages: [],
    terminal: false,
    error: null,
  };
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
  child.on("message", (m) => {
    task.messages.push(m);
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
  const found = task.output.match(
    /^Przypomnienia lokalne: w skrzynkach (\d+), błędy (\d+), wycofane (\d+), odłożone (\d+)\.\n$/,
  );
  assert(found, "CLI wypisuje wyłącznie liczniki.");
  return {
    sent: Number(found[1]),
    failed: Number(found[2]),
    cancelled: Number(found[3]),
    skipped: Number(found[4]),
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
    `select coalesce(json_agg(to_jsonb(j) order by id),'[]') from public.reminder_jobs j where dog_id not in (${fitness.dogs.map(q)});`,
  );
const state = (job) =>
  observer.json(`select json_build_object(
  'job',(select to_jsonb(j) from public.reminder_jobs j where id=${q(job)}),
  'attempts',(select coalesce(json_agg(to_jsonb(a) order by attempt),'[]') from public.reminder_attempts a where job_id=${q(job)}),
  'notices',(select coalesce(json_agg(to_jsonb(n) order by id),'[]') from public.notifications n where source_key=${q(`reminder:${job}`)}));`);
async function delivered(job, meeting, guardian) {
  const result = await state(job);
  assert.equal(result.job.status, "sent");
  assert.equal(result.job.attempts, 1);
  assert.equal(result.job.cycle_attempts, 1);
  assert.equal(result.attempts.length, 1);
  assert.equal(result.attempts[0].outcome, "sent");
  assert.equal(result.notices.length, 1);
  assert.equal(result.notices[0].recipient_id, guardian);
  assert.equal(result.notices[0].kind, "fitness_reminder");
  assert.equal(result.notices[0].fitness_session_id, meeting);
  assert.equal(result.notices[0].read_at, null);
  return result;
}

try {
  await observer.ready();
  before = await snapshot();
  report.originalAccounts = await observer.json(
    "select json_agg(id order by id) from auth.users;",
  );
  stage("fictional-accounts");
  for (const [index, role] of ["client", "admin"].entries()) {
    const user = {
      email: `psi-reminder-lifecycle-${run}-${index}@example.test`,
      password: `Psi-lifecycle!${randomUUID()}`,
      role,
    };
    users.push(user);
    const data = checked(
      await db.auth.admin.createUser({
        email: user.email,
        password: user.password,
        email_confirm: true,
      }),
    );
    user.id = data.user.id;
    checked(
      await db.from("user_roles").update({ role }).eq("user_id", user.id),
    );
    checked(
      await (index === 0 ? owner : staff).auth.signInWithPassword({
        email: user.email,
        password: user.password,
      }),
    );
  }
  stage("fitness-package");
  const dog = randomUUID(),
    pack = randomUUID(),
    service = "60000000-0000-4000-8000-000000000006";
  fitness.dogs.push(dog);
  fitness.packages.push(pack);
  checked(
    await db.from("dogs").insert({
      id: dog,
      guardian_id: users[0].id,
      name: "Fikcyjny restart przypomnień",
    }),
  );
  const terms = checked(
    await staff.from("services").select("version").eq("id", service).single(),
  );
  checked(
    await owner.rpc("request_fitness_package", {
      p_id: pack,
      p_dog: dog,
      p_service: service,
      p_expected_service_version: terms.version,
      p_topic: "Próba restartu procesu",
      p_availability: "Popołudnia",
    }),
  );
  checked(
    await staff.rpc("change_fitness_package", {
      p_id: pack,
      p_expected_version: 1,
      p_action: "accept",
      p_note: "Fikcyjna próba",
      p_request_id: randomUUID(),
    }),
  );
  const meetings = checked(
    await staff
      .from("fitness_sessions")
      .select("id,version")
      .eq("package_id", pack)
      .order("ordinal"),
  );
  assert.equal(meetings.length, 4);
  const jobs = [];
  const schedule = async (meeting) => {
    const start = await observer.json(`select to_json(min(t)) from (
      select now()+make_interval(hours=>n) t from generate_series(3,20) n
    ) candidates where not exists(select 1 from public.calendar_slots where occupied && tstzrange(t,t+interval '45 minutes','[)'));`);
    assert.equal(typeof start, "string");
    checked(
      await staff.rpc("save_fitness_session", {
        p_id: meeting.id,
        p_expected_version: meeting.version,
        p_starts_at: start,
        p_location: "FIKCYJNA ZBIÓRKA RESTARTU",
        p_note: "Fikcyjny termin",
        p_request_id: randomUUID(),
      }),
    );
    const job = checked(
      await staff
        .from("reminder_jobs")
        .select("id,status,attempts")
        .eq("fitness_session_id", meeting.id)
        .eq("status", "pending")
        .single(),
    );
    assert.equal(job.attempts, 0);
    jobs.push(job.id);
    return job.id;
  };

  stage("protect-existing-queue");
  unrelatedBefore = await originalJobs();
  assert(unrelatedBefore.length < 45);
  guard = await new LocalPostgres().ready();
  await guard.query(`set idle_in_transaction_session_timeout='60s';begin;
    select id from public.reminder_jobs where dog_id not in (${fitness.dogs.map(q)}) order by id for update;`);

  stage("interrupt-real-uncommitted-request");
  const firstJob = await schedule(meetings[0]);
  holder = await new LocalPostgres().ready();
  await holder.query(
    "begin;lock table public.reminder_worker_state in exclusive mode;",
  );
  const pending = launch();
  const workerPid = await until(
    () =>
      observer.json(`select coalesce(to_json(min(pid)),'null'::json) from pg_stat_activity
      where pid<>${observer.pid} and state='active' and wait_event_type='Lock'
      and ${holder.pid}=any(pg_blocking_pids(pid)) and query like '%worker_process_due_reminders%';`),
    (pid) => Number.isSafeInteger(pid),
    "Rzeczywisty proces musi czekać na zatwierdzenie transakcji.",
  );
  assert.equal(pending.terminal, false);
  assert.equal(pending.output, "");
  assert.equal(pending.errors, "");
  const uncommitted = await state(firstJob);
  assert.equal(uncommitted.job.status, "pending");
  assert.equal(uncommitted.job.attempts, 0);
  assert.equal(uncommitted.attempts.length, 0);
  assert.equal(uncommitted.notices.length, 0);
  assert(pending.child.kill("SIGKILL"));
  await terminal(pending, 5000);
  assert.equal(pending.signal, "SIGKILL");
  assert.equal(pending.code, null);
  await holder.query("commit;");
  await holder.close();
  holder = null;
  await until(
    () =>
      observer.json(`select to_json(not exists(select 1 from pg_stat_activity
      where pid=${workerPid} and state='active' and query like '%worker_process_due_reminders%'));`),
    (done) => done,
    "Pierwsze żądanie musi zostać rozstrzygnięte przed restartem.",
  );
  const settled = await state(firstJob);
  assert(["pending", "sent"].includes(settled.job.status));
  assert.equal(settled.notices.length, settled.job.status === "sent" ? 1 : 0);
  const restarted = await once();
  assert.equal(restarted.failed, 0);
  assert.equal(restarted.sent, settled.job.status === "sent" ? 0 : 1);
  await delivered(firstJob, meetings[0].id, users[0].id);
  report.checks.before_commit_kill = {
    observed_lock: true,
    signal: "SIGKILL",
    server_committed_after_disconnect: settled.job.status === "sent",
    restart_without_duplicate: true,
  };

  stage("interrupt-after-real-commit-before-cli-result");
  const secondJob = await schedule(meetings[1]);
  const boundary = launch({ boundary: true });
  const response = await until(
    () =>
      Promise.resolve(
        boundary.messages.find((m) => m?.event === "reminder-response-ready"),
      ),
    Boolean,
    "Nie potwierdzono rzeczywistej odpowiedzi przed przerwaniem.",
  );
  assert.equal(response.status, 200);
  assert.equal(response.counts.sent, 1);
  assert.equal(response.counts.failed, 0);
  assert.equal(boundary.terminal, false);
  assert.equal(boundary.output, "");
  assert.equal(boundary.errors, "");
  const committed = await delivered(secondJob, meetings[1].id, users[0].id);
  assert(boundary.child.kill("SIGKILL"));
  await terminal(boundary, 5000);
  assert.equal(boundary.signal, "SIGKILL");
  assert.equal(boundary.code, null);
  assert.equal((await once()).sent, 0);
  assert.deepEqual(await state(secondJob), committed);
  report.checks.after_commit_kill = {
    real_api_response: true,
    cli_consumed_response: false,
    signal: "SIGKILL",
    restart_preserved_exact_job_notice_attempt: true,
  };

  stage("watch-graceful-stop-and-restart");
  const thirdJob = await schedule(meetings[2]);
  const watching = launch({ watch: true });
  await until(
    () => Promise.resolve(watching.output),
    Boolean,
    "Tryb watch musi zakończyć pierwszą próbę.",
  );
  assert.equal(watching.terminal, false);
  assert.equal(counts(watching).sent, 1);
  const watched = await delivered(thirdJob, meetings[2].id, users[0].id);
  const stopAt = Date.now();
  assert(watching.child.kill("SIGTERM"));
  await terminal(watching, 5000);
  const stopMs = Date.now() - stopAt;
  assert.equal(watching.code, 0);
  assert.equal(watching.signal, null);
  assert.equal(counts(watching).sent, 1);
  assert.equal((await once()).sent, 0);
  assert.deepEqual(await state(thirdJob), watched);
  report.checks.watch_stop = {
    signal: "SIGTERM",
    exit_code: 0,
    stop_ms: stopMs,
    restart_without_duplicate: true,
  };
  for (let i = 0; i < jobs.length; i++)
    await delivered(jobs[i], meetings[i].id, users[0].id);
  assert.deepEqual(await originalJobs(), unrelatedBefore);
  report.checks.preserved_original_jobs = true;
  report.checks.fitness_jobs = jobs.length;
  report.status = "ready";
} catch (error) {
  failed = true;
  report.status = "failed";
  report.failed_phase = phase;
  report.failure = {
    assertion: error?.code === "ERR_ASSERTION",
    own_lines: [
      ...String(error?.stack ?? "").matchAll(
        /reminder-lifecycle\.mjs:(\d+):\d+/g,
      ),
    ].map((match) => Number(match[1])),
  };
  console.error(
    `Próba procesu przypomnień nie przeszła na etapie ${phase}; treści i poświadczenia pominięto.`,
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
    await disposeBackupFitness(db, fitness);
    for (const client of [owner, staff])
      if (users.length) checked(await client.auth.signOut());
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
    if (report.originalAccounts)
      assert.deepEqual(
        await observer.json("select json_agg(id order by id) from auth.users;"),
        report.originalAccounts,
      );
    delete report.originalAccounts;
    report.cleanup = true;
    console.log(
      "Próba procesu przypomnień: własne dane usunięte; wcześniejsze konta i wszystkie tabele publiczne poza rzeczywistym znacznikiem uruchomienia zachowane.",
    );
  } catch {
    failed = true;
    report.status = "failed";
    report.cleanup = false;
    delete report.originalAccounts;
    console.error(
      "Sprzątanie procesu niepotwierdzone; nie resetuj lokalnej bazy.",
    );
  } finally {
    await observer.close();
  }
  report.finished_at = new Date().toISOString();
  writeFileSync(
    ".local/reminder-lifecycle-report.json",
    JSON.stringify(report, null, 2) + "\n",
    { mode: 0o600 },
  );
}
if (!failed) console.log(JSON.stringify(report));
process.exitCode = failed ? 1 : 0;
