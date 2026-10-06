// Explicit local-only pilot measurement. Never run as part of the normal suite.
// Real Auth sessions and HTTP responses from the compiled application; no mail.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
  readFileSync,
  mkdirSync,
  writeFileSync,
  chmodSync,
  renameSync,
} from "node:fs";
import { resolve } from "node:path";
import { parseEnv } from "node:util";
import { performance } from "node:perf_hooks";
import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import { chromium } from "@playwright/test";
import { LocalPostgres, literal as q } from "../helpers/local-postgres.mjs";
import {
  pilotConfiguration,
  pooled,
  measurements,
} from "../helpers/pilot-load.mjs";

const root = process.cwd();
const runId = randomUUID();
const report = {
  version: 1,
  run_id: runId,
  started_at: new Date().toISOString(),
  target_p95_ms: 2000,
  environment: { database_vm_cpu: 2, database_vm_memory_gb: 4 },
  samples: [],
  cleanup: false,
};
const entries = [];
let sql;
let config;
let db;
let phase = "preflight";
let failed = false;
let originalTables, originalAccounts, originalMigrations;
const practice = "00000000-0000-4000-8000-000000000001";
const service = "60000000-0000-4000-8000-000000000010";

function writeReport(status = "running") {
  const directory = resolve(root, ".local/pilot-load");
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const file = resolve(directory, `${runId}.json`);
  const temporary = `${file}.tmp`;
  report.status = status;
  report.phase = phase;
  report.accounts_tracked = entries.length;
  writeFileSync(temporary, JSON.stringify(report, null, 2) + "\n", {
    mode: 0o600,
  });
  chmodSync(temporary, 0o600);
  renameSync(temporary, file);
}

function unwrap(result, label) {
  if (result.error) throw new Error(`${label} failed`);
  return result.data;
}
function log(message) {
  console.log(`Pilot local: ${message}`);
}
const uuids = (ids) => ids.map(q).join(",");
const timestamp = (ms) => q(new Date(ms).toISOString());

async function publicSnapshot() {
  return sql.json(`begin;
    create temporary table pilot_original_state(name text,rows bigint,digest text) on commit drop;
    do $$ declare t record; n bigint; h text; begin
      for t in select c.relname from pg_class c join pg_namespace s on s.oid=c.relnamespace
        where s.nspname='public' and c.relkind='r' order by c.relname loop
        execute format('select count(*),md5(coalesce(string_agg(md5(to_jsonb(r)::text),%L order by md5(to_jsonb(r)::text)),%L)) from public.%I r','','',t.relname) into n,h;
        insert into pilot_original_state values(t.relname,n,h);
      end loop;
    end $$;
    select jsonb_agg(s order by name) from pilot_original_state s;
    commit;`);
}

async function authenticate(entry) {
  const cookies = new Map();
  const client = createServerClient(config.api, config.key, {
    global: {
      fetch: (input, init) =>
        fetch(input, {
          ...init,
          redirect: "error",
          signal: AbortSignal.timeout(20000),
        }),
    },
    cookies: {
      getAll: () => [...cookies].map(([name, value]) => ({ name, value })),
      setAll: (values) => {
        for (const { name, value } of values) cookies.set(name, value);
      },
    },
  });
  const { user } = unwrap(
    await client.auth.signInWithPassword({
      email: entry.email,
      password: entry.password,
    }),
    "Local login",
  );
  assert.equal(user.id, entry.id, "Session must belong to its fixture account");
  assert(cookies.size > 0, "Authenticated SSR cookies are required");
  entry.client = client;
  entry.cookie = [...cookies]
    .map(([name, value]) => `${name}=${value}`)
    .join("; ");
}

async function createAccounts() {
  await pooled(
    Array.from({ length: 51 }, (_, i) => i),
    2,
    async (index) => {
      const entry = {
        email: `psi-load-${runId}-${index}@example.test`,
        password: `Psi-load!${randomUUID()}`,
        index,
        dog: index < 50 ? randomUUID() : null,
        marker: `PilotDog${runId.replaceAll("-", "").slice(0, 8)}N${index}End`,
      };
      // Retain the unique email before the request. Cleanup can find an accepted
      // creation even if its HTTP response is lost; credentials stay in memory.
      entries.push(entry);
      const { user } = unwrap(
        await db.auth.admin.createUser({
          email: entry.email,
          password: entry.password,
          email_confirm: true,
        }),
        "Local account creation",
      );
      assert(user?.id, "Account creation must return a user");
      entry.id = user.id;
    },
  );
  entries.sort((a, b) => a.index - b.index);
  await sql.query(`begin;
    update public.profiles set full_name='Opiekun — próba 50',phone='000 000 000',area='Okolica testowa'
      where id in (${uuids(entries.map((e) => e.id))});
    update public.profiles set full_name='Prowadząca — próba 50' where id=${q(entries[50].id)};
    update public.user_roles set role='admin' where user_id=${q(entries[50].id)};
    commit;`);
  await pooled(entries, 2, authenticate);
  assert.equal(new Set(entries.map((e) => e.id)).size, 51);
  assert.equal(new Set(entries.map((e) => e.cookie)).size, 51);
}

async function seedHistory() {
  const staff = entries[50];
  const guardians = entries.slice(0, 50);
  const future = new Date(
    await sql.json(`select to_json(greatest(now()+interval '2 days',
      coalesce(max(upper(occupied)),now()))+interval '1 day') from public.calendar_slots;`),
  ).getTime();
  const seedTime = Date.now();
  const past = seedTime - 270 * 86400000;
  const walks = Array.from({ length: 260 }, (_, i) => ({
    id: randomUUID(),
    start: i < 250 ? past + i * 86400000 : future + (i - 250) * 3 * 3600000,
    completed: i < 250,
  }));
  const registrations = [];
  // Twenty completed walks and one future walk per guardian. Historical
  // groups have four dogs; future groups have five. No oversized groups.
  for (let i = 0; i < 1000; i++)
    registrations.push({
      id: randomUUID(),
      walk: walks[Math.floor(i / 4)],
      owner: guardians[i % 50],
      paid: i % 3 !== 0,
    });
  for (let i = 0; i < 50; i++)
    registrations.push({
      id: randomUUID(),
      walk: walks[250 + Math.floor(i / 5)],
      owner: guardians[i],
      paid: false,
    });
  const consultations = guardians.flatMap((owner) =>
    Array.from({ length: 4 }, (_, i) => ({
      id: randomUUID(),
      owner,
      start: past + (i * 50 + owner.index) * 86400000 + 2 * 3600000,
    })),
  );
  const plans = guardians.flatMap((owner) =>
    Array.from({ length: 4 }, (_, i) => ({
      id: randomUUID(),
      owner,
      revision: i + 1,
      published: seedTime - (4 - i) * 14 * 86400000,
    })),
  );
  const progress = plans.flatMap((plan) =>
    Array.from({ length: 2 }, () => ({ id: randomUUID(), plan })),
  );
  const packages = guardians.map((owner) => ({ id: randomUUID(), owner }));
  report.fixtures = {
    guardians: 50,
    staff: 1,
    dogs: guardians.length,
    walks: walks.length,
    registrations: registrations.length,
    consultations: consultations.length,
    plans: plans.length,
    progress: progress.length,
    packages: packages.length,
    payments: registrations.filter((r) => r.paid).length,
  };
  await sql.query(`begin;
    select set_config('request.jwt.claim.sub',${q(staff.id)},true);
    insert into public.dogs(id,guardian_id,name,status,breed) values
      ${guardians.map((e) => `(${q(e.dog)},${q(e.id)},${q(e.marker)},'approved','Pies testowy')`).join(",")};
    insert into public.dog_notes(dog_id,author_id,body,visibility)
      select id,${q(staff.id)},'Prywatna notatka testowa','admin_only' from public.dogs where id in (${uuids(guardians.map((e) => e.dog))});
    insert into public.walks(id,starts_at,public_location,type,price_cents,capacity,leader_id,status)
      values ${walks.map((w) => `(${q(w.id)},${timestamp(w.start)},'Park — próba 50','Spacer testowy',10000,${w.completed ? 4 : 5},${q(staff.id)},${q(w.completed ? "completed" : "open")})`).join(",")};
    insert into public.walk_registrations(id,walk_id,dog_id,status,payment_status,attendance,created_at,decided_at)
      values ${registrations.map((r) => `(${q(r.id)},${q(r.walk.id)},${q(r.owner.dog)},'accepted',${q(r.paid ? "paid" : "due")},${q(r.walk.completed ? "present" : "pending")},${timestamp(r.walk.start - 7 * 86400000)},${timestamp(r.walk.start - 6 * 86400000)})`).join(",")};
    insert into public.payments(guardian_id,dog_id,registration_id,amount_cents,method,status,paid_at,author_id,request_id)
      values ${registrations
        .filter((r) => r.paid)
        .map(
          (r) =>
            `(${q(r.owner.id)},${q(r.owner.dog)},${q(r.id)},10000,'transfer','paid',${timestamp(r.walk.start)},${q(staff.id)},${q(randomUUID())})`,
        )
        .join(",")};
    insert into public.packages(id,dog_id,name,price_cents)
      values ${packages.map((p) => `(${q(p.id)},${q(p.owner.dog)},'Pakiet — próba 50',10000)`).join(",")};
    insert into public.package_transactions(package_id,available_delta,reason,author_id)
      values ${packages.map((p) => `(${q(p.id)},4,'Przyznanie testowe',${q(staff.id)})`).join(",")};
    insert into public.consultations(id,practice_id,dog_id,requested_by,topic,status,starts_at,duration_minutes,meeting_mode,location,service_id,service_version,service_name,agreed_price_cents,service_duration_minutes,service_meeting_mode,is_test_price)
      values ${consultations.map((c) => `(${q(c.id)},${q(practice)},${q(c.owner.dog)},${q(c.owner.id)},'Konsultacja testowa','completed',${timestamp(c.start)},90,'in_person','Lokalizacja testowa',${q(service)},1,'Konsultacja — próba 50',10000,90,'in_person',true)`).join(",")};
    insert into public.care_plan_versions(id,practice_id,dog_id,revision,source_version,title,body,follow_up_on,published_by,published_at)
      values ${plans.map((p) => `(${q(p.id)},${q(practice)},${q(p.owner.dog)},${p.revision},${p.revision - 1},'Plan testowy ${p.revision}',${q(`${p.owner.marker}: fikcyjna treść do pomiaru aplikacji. `.repeat(12))},current_date+7,${q(staff.id)},${timestamp(p.published)})`).join(",")};
    insert into public.care_progress(id,practice_id,dog_id,plan_id,author_id,attempted,went_well,difficult,created_at)
      values ${progress.map((p) => `(${q(p.id)},${q(practice)},${q(p.plan.owner.dog)},${q(p.plan.id)},${q(p.plan.owner.id)},'Fikcyjna odpowiedź do pomiaru','Postęp testowy','Trudność testowa',${timestamp(p.plan.published + 2 * 86400000)})`).join(",")};
    commit;`);
  const actual = await sql.json(`select json_build_object(
    'dogs',(select count(*) from public.dogs where guardian_id in (${uuids(guardians.map((e) => e.id))})),
    'registrations',(select count(*) from public.walk_registrations where dog_id in (${uuids(guardians.map((e) => e.dog))})),
    'plans',(select count(*) from public.care_plan_versions where dog_id in (${uuids(guardians.map((e) => e.dog))})),
    'progress',(select count(*) from public.care_progress where dog_id in (${uuids(guardians.map((e) => e.dog))})));`);
  assert.deepEqual(actual, {
    dogs: 50,
    registrations: 1050,
    plans: 200,
    progress: 400,
  });
  return { guardians, staff, future };
}

async function checkIsolation(guardians) {
  await pooled(guardians, 5, async (entry, index) => {
    const rows = unwrap(
      await entry.client.from("dogs").select("id"),
      "Dog isolation",
    );
    assert.deepEqual(
      rows,
      [{ id: entry.dog }],
      "Guardian must see only their own dog",
    );
    const other = guardians[(index + 1) % guardians.length];
    const plans = unwrap(
      await entry.client
        .from("care_plan_versions")
        .select("id")
        .eq("dog_id", other.dog),
      "Plan isolation",
    );
    assert.deepEqual(plans, [], "A foreign plan must remain unreadable");
    const notes = unwrap(
      await entry.client.from("dog_notes").select("id"),
      "Private-note isolation",
    );
    assert.deepEqual(notes, [], "Private staff notes must remain unreadable");
  });
  report.isolation_accounts_verified = guardians.length;
}

async function measureDatabase(entry) {
  report.database_queries = [];
  await sql.asUser(entry.id);
  for (const [label, query] of [
    ["walks", "select * from public.walks order by starts_at,id"],
    [
      "registrations",
      "select * from public.walk_registrations order by created_at,id",
    ],
    [
      "consultation-balances",
      "select * from public.consultation_balances order by id",
    ],
  ]) {
    const [plan] = JSON.parse(
      (await sql.query(`explain (analyze,format json) ${query};`)).join("\n"),
    );
    // Store timings and row counts only, never the plan's filters or payload.
    report.database_queries.push({
      label,
      execution_ms: plan["Execution Time"],
      rows: plan.Plan["Actual Rows"],
    });
  }
  await sql.query("commit;");
}

const routes = [
  { label: "dashboard", path: () => "/app", expected: "Twoje zgłoszenia" },
  {
    label: "dog-care",
    path: (e) => `/app/dogs/${e.dog}/care`,
    expected: "Plan testowy 4",
  },
  { label: "finance", path: () => "/app/finance", expected: "Pakiety" },
];
async function readPage(entry, route, foreignMarker) {
  const start = performance.now();
  let ok = false;
  let bytes = 0;
  let failure = null;
  try {
    const response = await fetch(`${config.app}${route.path(entry)}`, {
      redirect: "manual",
      headers: { cookie: entry.cookie },
      signal: AbortSignal.timeout(30000),
    });
    const body = await response.text();
    bytes = Buffer.byteLength(body);
    const headingPresent = body.includes(route.expected);
    const ownerPresent =
      route.requireMarker === false ||
      body.includes(route.marker || entry.marker);
    const foreignPresent = Boolean(
      foreignMarker && body.includes(foreignMarker),
    );
    ok =
      response.status === 200 &&
      headingPresent &&
      ownerPresent &&
      !foreignPresent;
    if (!ok)
      failure =
        response.status !== 200
          ? `http_${response.status}`
          : foreignPresent
            ? "foreign_fixture_visible"
            : !headingPresent
              ? "page_content_missing"
              : "owner_fixture_missing";
  } catch {
    // The result reports counts only, never cookie headers or response bodies.
    failure = "request_failed";
  }
  return { ms: performance.now() - start, ok, bytes, failure };
}
async function measureReads(guardians, staff) {
  const overview = unwrap(
    await staff.client.rpc("care_plan_summaries", { p_offset: 0 }),
    "Staff care page fixture",
  );
  const visibleCareDog = overview
    .slice(0, 20)
    .map((item) => guardians.find((entry) => entry.dog === item.dog_id))
    .find(Boolean);
  assert(
    visibleCareDog,
    "Staff's first care page must contain a pilot fixture",
  );
  report.staff_care_fixture_verified = true;
  // Prime routes outside the timed sample; the cold pass is reported separately.
  for (const route of routes) {
    const cold = await readPage(guardians[0], route, guardians[1].marker);
    assert(
      cold.ok,
      `Compiled ${route.label} must show the authenticated fixture`,
    );
    report.samples.push({
      phase: "cold",
      route: route.label,
      concurrency: 1,
      ...measurements([cold]),
    });
  }
  for (const concurrency of [1, 5, 50]) {
    log(`HTTP reads, ${concurrency} concurrent sessions`);
    for (const route of routes) {
      const tasks = Array.from(
        { length: concurrency === 1 ? 1 : 3 },
        () => guardians,
      ).flat();
      const staffRoute =
        route.label === "dashboard"
          ? {
              path: () => "/admin",
              expected: "Plan spacerów i zgłoszenia w jednym miejscu",
              requireMarker: false,
            }
          : route.label === "dog-care"
            ? {
                path: () => "/admin/care",
                expected: "Aktualne plany",
                marker: visibleCareDog.marker,
              }
            : {
                path: () => "/admin/finance",
                expected: "Pakiety",
                marker: guardians[0].marker,
              };
      const [samples, staffSamples] = await Promise.all([
        pooled(tasks, concurrency, (entry) =>
          readPage(entry, route, guardians[(entry.index + 1) % 50].marker),
        ),
        (async () => {
          const samples = [];
          for (let i = 0; i < 3; i++)
            samples.push(await readPage(staff, staffRoute));
          return samples;
        })(),
      ]);
      const staffMetric = {
        phase: "warm",
        route: `staff-${route.label}`,
        concurrency,
        requests_overlap: "one staff session alongside guardians",
        ...measurements(staffSamples),
        failures: staffSamples
          .filter((s) => s.failure)
          .reduce(
            (totals, s) => ({
              ...totals,
              [s.failure]: (totals[s.failure] || 0) + 1,
            }),
            {},
          ),
      };
      report.samples.push(staffMetric);
      if (staffMetric.errors) {
        failed = true;
        report.failed_phase = "reads";
      }
      const metric = {
        phase: "warm",
        route: route.label,
        concurrency,
        ...measurements(samples),
        failures: samples
          .filter((s) => s.failure)
          .reduce(
            (totals, s) => ({
              ...totals,
              [s.failure]: (totals[s.failure] || 0) + 1,
            }),
            {},
          ),
      };
      report.samples.push(metric);
      log(
        `${route.label}: p95 ${metric.p95_ms} ms, ${metric.errors}/${metric.requests} errors`,
      );
      if (metric.errors) {
        failed = true;
        report.failed_phase = "reads";
      }
    }
  }
}

async function measureBrowser(guardians, staff) {
  // Reuse the same 50 real Auth sessions. Limit active tabs to five so this
  // acceptance exercise does not need 50 renderer processes on the laptop.
  const browser = await chromium.launch({ channel: "chrome" });
  const samples = [];
  let staffChecks = 0;
  const visit = async (entry, index, isStaff = false) => {
    const width = [320, 390, 1440][index % 3];
    const context = await browser.newContext({
      viewport: { width, height: 900 },
    });
    try {
      await context.addCookies(
        entry.cookie.split("; ").map((pair) => {
          const separator = pair.indexOf("=");
          assert(separator > 0);
          return {
            name: pair.slice(0, separator),
            value: pair.slice(separator + 1),
            url: config.app,
          };
        }),
      );
      const page = await context.newPage();
      let pageErrors = 0;
      page.on("pageerror", () => {
        pageErrors++;
      });
      const checks = isStaff
        ? ["/admin", "/admin/work", "/admin/finance"]
        : ["/app", `/app/dogs/${entry.dog}/care`, "/app/finance"];
      for (const path of checks) {
        const start = performance.now();
        const response = await page.goto(`${config.app}${path}`, {
          waitUntil: "domcontentloaded",
          timeout: 30000,
        });
        assert.equal(
          response?.status(),
          200,
          "Compiled browser route must return HTTP 200",
        );
        assert.equal(
          new URL(page.url()).pathname,
          path,
          "Real browser must remain in its authorized panel",
        );
        await page.locator("main").waitFor({ state: "visible" });
        if (path.includes("/care")) {
          const reply = page.getByLabel("Co udało się zrobić?", {
            exact: true,
          });
          await reply.waitFor({ state: "visible" });
          await page.waitForFunction(
            () => !document.querySelector("#odpowiedz textarea")?.disabled,
          );
        }
        const text = await page.locator("main").innerText();
        if (!isStaff) {
          assert(
            text.includes(entry.marker),
            "Rendered page must show its guardian's dog",
          );
          assert(
            !text.includes(guardians[(entry.index + 1) % 50].marker),
            "Rendered page must hide another guardian's dog",
          );
        }
        assert(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
          "Rendered page must fit its viewport",
        );
        assert.equal(pageErrors, 0, "Browser hydration must not throw");
        samples.push({
          ms: performance.now() - start,
          ok: true,
          route: path.startsWith("/admin")
            ? "staff"
            : path.includes("/care")
              ? "dog-care"
              : path.endsWith("finance")
                ? "finance"
                : "dashboard",
          width,
        });
        if (isStaff) staffChecks++;
      }
    } finally {
      await context.close();
    }
  };
  try {
    await pooled(guardians, 5, visit);
    await visit(staff, 1, true);
  } finally {
    await browser.close();
  }
  report.browser = {
    guardians: guardians.length,
    concurrent_tabs: 5,
    guardian_routes: 150,
    staff_routes: staffChecks,
    widths: [320, 390, 1440],
    own_data_verified: true,
    foreign_data_hidden: true,
    page_errors: 0,
    horizontal_overflow: 0,
    ...measurements(samples),
  };
  log(
    `Rendered browser pages: ${samples.length}, p95 ${report.browser.p95_ms} ms, no errors or horizontal overflow`,
  );
}

async function measureWrites({ guardians, staff, future }) {
  const walk = randomUUID();
  await sql.query(`insert into public.walks(id,starts_at,public_location,type,price_cents,capacity,booking_mode,leader_id)
    values(${q(walk)},${timestamp(future + 40 * 3600000)},'Równoczesna próba 50','Zapis testowy',10000,4,'automatic',${q(staff.id)});`);
  const registrations = await pooled(guardians, 50, async (entry) => {
    const start = performance.now();
    const result = await entry.client.rpc("register_dog", {
      p_walk: walk,
      p_dog: entry.dog,
    });
    return {
      ms: performance.now() - start,
      ok: !result.error || result.error.message === "Brak wolnych miejsc.",
      id: result.error ? null : result.data,
    };
  });
  const accepted = registrations.filter((r) => r.id);
  assert.equal(accepted.length, 4, "Fifty bookings must accept only four dogs");
  assert(
    registrations.every((r) => r.ok),
    "All other registrations must be explicit capacity refusals",
  );
  const capacity =
    await sql.json(`select json_build_object('accepted',count(*),'amount',sum(w.price_cents))
    from public.walk_registrations r join public.walks w on w.id=r.walk_id where r.walk_id=${q(walk)} and r.status='accepted';`);
  assert.deepEqual(capacity, { accepted: 4, amount: 40000 });
  report.capacity = {
    sessions: 50,
    accepted: 4,
    capacity: 4,
    expected_refusals: 46,
    ...measurements(registrations),
  };
  const request = randomUUID();
  const receipts = await pooled(Array.from({ length: 50 }), 50, async () => {
    const start = performance.now();
    const result = await staff.client.rpc("record_payment", {
      p_registration: accepted[0].id,
      p_package: null,
      p_consultation: null,
      p_amount_cents: 10000,
      p_method: "transfer",
      p_note: "Próba powtórzenia 50",
      p_request_id: request,
    });
    return {
      ms: performance.now() - start,
      ok: !result.error,
      id: result.data,
    };
  });
  assert(
    receipts.every((r) => r.ok),
    "Repeated receipt requests must succeed",
  );
  assert.equal(
    new Set(receipts.map((r) => r.id)).size,
    1,
    "Repeated receipt requests must return one receipt",
  );
  const payment =
    await sql.json(`select json_build_object('receipts',count(*),'amount',sum(amount_cents))
    from public.payments where request_id=${q(request)};`);
  assert.deepEqual(payment, { receipts: 1, amount: 10000 });
  report.payment_retry = {
    calls: 50,
    receipts: 1,
    amount_cents: 10000,
    ...measurements(receipts),
  };
  log(
    "50 concurrent bookings: capacity 4 respected; 50 receipt retries: one payment",
  );
}

async function cleanup() {
  if (!sql || !entries.length) return;
  if (sql.ended) sql = await new LocalPostgres().ready();
  await sql.query("rollback;");
  const ids =
    await sql.json(`select coalesce(json_agg(id),'[]'::json) from auth.users
    where email in (${uuids(entries.map((e) => e.email))});`);
  if (ids.length) {
    const users = uuids(ids);
    await sql.query(`begin;
      delete from public.payments where guardian_id in (${users}) or author_id in (${users});
      delete from public.package_transactions where author_id in (${users});
      delete from public.packages where dog_id in (select id from public.dogs where guardian_id in (${users}));
      delete from public.walks where leader_id in (${users});
      delete from public.care_follow_up_history where author_id in (${users});
      delete from public.care_follow_ups where updated_by in (${users});
      delete from public.care_progress where author_id in (${users});
      delete from public.care_events where dog_id in (select id from public.dogs where guardian_id in (${users}));
      delete from public.care_drafts where updated_by in (${users});
      delete from public.care_plan_versions where published_by in (${users});
      delete from public.consultation_events where history_id in (select id from public.consultation_history where author_id in (${users}));
      delete from public.consultation_history where author_id in (${users});
      delete from public.consultations where requested_by in (${users});
      delete from public.audit_events where actor_id in (${users});
      delete from public.dogs where guardian_id in (${users});
      commit;`);
    for (const id of ids)
      unwrap(await db.auth.admin.deleteUser(id), "Fixture cleanup");
  }
  const remaining = await sql.json(`select json_build_object(
    'users',(select count(*) from auth.users where email in (${uuids(entries.map((e) => e.email))})),
    'dogs',(select count(*) from public.dogs where id in (${uuids(entries.filter((e) => e.dog).map((e) => e.dog))}))
  );`);
  assert.deepEqual(
    remaining,
    { users: 0, dogs: 0 },
    "Every pilot fixture must be removed",
  );
  report.cleanup = true;
}

try {
  assert.equal(
    JSON.parse(readFileSync(resolve(root, "package.json"), "utf8")).name,
    "psi-pawer",
  );
  config = pilotConfiguration(
    parseEnv(readFileSync(resolve(root, ".env.test.local"), "utf8")),
    JSON.parse(
      readFileSync(resolve(root, ".local/preview-build.json"), "utf8"),
    ),
    readFileSync(resolve(root, ".next-local/BUILD_ID"), "utf8"),
  );
  const listeners = execFileSync(
    "/usr/sbin/lsof",
    ["-t", "-iTCP:3000", "-sTCP:LISTEN"],
    { encoding: "utf8" },
  )
    .trim()
    .split("\n");
  assert.equal(
    listeners.length,
    1,
    "A single compiled local preview must be running",
  );
  const parent = execFileSync("/bin/ps", ["-p", listeners[0], "-o", "ppid="], {
    encoding: "utf8",
  }).trim();
  const command = execFileSync("/bin/ps", ["-p", parent, "-o", "command="], {
    encoding: "utf8",
  }).trim();
  assert.equal(
    command,
    `${process.execPath} scripts/local-app.mjs preview`,
    "Use the compiled local preview, not development mode",
  );
  report.environment.build_id_hash = createHash("sha256")
    .update(readFileSync(resolve(root, ".next-local/BUILD_ID")))
    .digest("hex");
  db = createClient(config.api, config.secret, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      fetch: (input, init) =>
        fetch(input, {
          ...init,
          redirect: "error",
          signal: AbortSignal.timeout(20000),
        }),
    },
  });
  sql = await new LocalPostgres().ready();
  originalTables = await publicSnapshot();
  originalAccounts = await sql.json(
    "select json_agg(id order by id) from auth.users;",
  );
  originalMigrations = await sql.json(
    "select json_agg(version order by version) from supabase_migrations.schema_migrations;",
  );
  report.environment.migrations = originalMigrations.length;
  phase = "accounts";
  // Persist the unique fixture prefix before Auth accepts the first account.
  // An interrupted run remains identifiable without storing credentials.
  writeReport();
  log(`run ${runId}; private progress report prepared`);
  log("creating 50 guardians and one staff account, all @example.test");
  await createAccounts();
  phase = "history";
  writeReport();
  const fixtures = await seedHistory();
  log(
    "1050 registrations, 200 consultations, 200 plans and 400 progress records ready",
  );
  phase = "isolation";
  writeReport();
  await checkIsolation(fixtures.guardians);
  phase = "database-queries";
  writeReport();
  await measureDatabase(fixtures.guardians[0]);
  phase = "reads";
  writeReport();
  await measureReads(fixtures.guardians, fixtures.staff);
  phase = "browser-render";
  writeReport();
  await measureBrowser(fixtures.guardians, fixtures.staff);
  phase = "writes";
  writeReport();
  await measureWrites(fixtures);
  report.target_met =
    report.samples
      .filter((s) => s.phase === "warm")
      .every((s) => s.errors === 0 && s.p95_ms < report.target_p95_ms) &&
    report.capacity.p95_ms < report.target_p95_ms &&
    report.payment_retry.p95_ms < report.target_p95_ms;
} catch (error) {
  failed = true;
  report.failed_phase = phase;
  // Keep only a schema error's first line, without SQL, detail or context.
  const databaseError = error.message?.match(/^ERROR:\s*([^\r\n]+)/m);
  if (databaseError && phase === "history") {
    report.failure = databaseError[1];
    log(`fixture schema problem: ${report.failure}`);
  } else if (error.name === "AssertionError") {
    report.failure = error.message.split("\n")[0];
    log(report.failure);
  }
  log(
    `verification failed during ${phase}; raw responses and credentials are omitted`,
  );
} finally {
  phase = "cleanup";
  try {
    writeReport();
  } catch {
    failed = true;
    log("progress report could not be updated; fixture cleanup still runs");
  }
  try {
    await cleanup();
    if (originalTables)
      assert.deepEqual(await publicSnapshot(), originalTables);
    if (originalAccounts)
      assert.deepEqual(
        await sql.json("select json_agg(id order by id) from auth.users;"),
        originalAccounts,
      );
    if (originalMigrations)
      assert.deepEqual(
        await sql.json(
          "select json_agg(version order by version) from supabase_migrations.schema_migrations;",
        ),
        originalMigrations,
      );
    report.source_preserved = true;
  } catch {
    failed = true;
    report.cleanup = false;
    log("cleanup failed; the report identifies this run for local repair");
  }
  await sql?.close();
  report.finished_at = new Date().toISOString();
  report.checks_passed = !failed;
  writeReport("finished");
  log(`safe report: .local/pilot-load/${runId}.json`);
  log(
    `cleanup ${report.cleanup ? "confirmed" : "unconfirmed"}; p95 target ${report.target_met ? "met" : "not met"}`,
  );
  process.exitCode = failed ? 1 : report.target_met ? 0 : 2;
}
