import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { beforeAll, beforeEach, afterAll, describe, expect, it } from "vitest";

let db: PGlite;
let imported: { plan_id: string; due_on: string; status: string }[];
let latestBeforeMigration: string;
let importedHistoryCount: number;
const admin = "10000000-0000-4000-8000-000000000001";
const owner = "10000000-0000-4000-8000-000000000002";
const stranger = "10000000-0000-4000-8000-000000000003";
const dog = "20000000-0000-4000-8000-000000000001";
const otherDog = "20000000-0000-4000-8000-000000000002";

async function asUser<T>(id: string, fn: () => Promise<T>) {
  await db.exec("begin; set local role authenticated;");
  await db.query("select set_config('request.jwt.claim.sub',$1,true)", [id]);
  try {
    const result = await fn();
    await db.exec("commit");
    return result;
  } catch (error) {
    await db.exec("rollback");
    throw error;
  }
}
async function plan(
  version = 0,
  publish = true,
  text = "Zalecenia testowe, bez porad specjalistycznych.",
  dogId = dog,
  date: string | null = "2026-10-01",
) {
  const result = await asUser(admin, () =>
    db.query<{ result: { version: number; published_id: string | null } }>(
      "select public.save_care_plan($1,$2,'Plan testowy',$3,$4,$5) result",
      [dogId, version, text, date, publish],
    ),
  );
  return result.rows[0].result;
}
async function response(
  planId: string,
  id = randomUUID(),
  user = owner,
  text = "Wpis testowy opiekuna.",
) {
  await asUser(user, () =>
    db.query(
      "select public.submit_care_progress($1,$2,$3,'Dobra obserwacja','Pytanie do prowadzącej')",
      [id, planId, text],
    ),
  );
  return id;
}
beforeAll(async () => {
  db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create schema auth;
    create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,encrypted_password text);
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    grant usage on schema public,auth to anon,authenticated;
    grant execute on function auth.uid() to anon,authenticated;
    create schema storage; create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
    create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text);
    alter table storage.objects enable row level security;
    create function storage.foldername(name text) returns text[] language sql as $$select string_to_array(name,'/')$$;
    grant usage on schema storage to authenticated; grant select,insert,delete on storage.objects to authenticated;`);
  for (const name of readdirSync("supabase/migrations")
    .filter((name) => name.endsWith(".sql"))
    .sort()) {
    if (name === "202609190002_work_queue_followups.sql") {
      await db.query("insert into auth.users(id) values($1),($2),($3)", [
        admin,
        owner,
        stranger,
      ]);
      await db.query(
        "update public.user_roles set role='admin' where user_id=$1",
        [admin],
      );
      await db.query(
        "insert into public.dogs(id,guardian_id,name) values($1,$2,'Kluska'),($3,$4,'Borys')",
        [dog, owner, otherDog, stranger],
      );
      await plan(0, true, "Wcześniejszy plan", dog, await date(-10));
      latestBeforeMigration = (
        await plan(1, true, "Aktualny plan", dog, await date(2))
      ).published_id!;
      await plan(
        0,
        true,
        "Wcześniejszy plan drugiego psa",
        otherDog,
        await date(-5),
      );
      await plan(1, true, "Aktualny plan bez kontaktu", otherDog, null);
    }
    await db.exec(readFileSync(`supabase/migrations/${name}`, "utf8"));
  }
  imported = (
    await db.query<{ plan_id: string; due_on: string; status: string }>(
      "select plan_id,due_on::text,status from public.care_follow_ups",
    )
  ).rows;
  importedHistoryCount = (
    await db.query("select * from public.care_follow_up_history")
  ).rows.length;
});
beforeEach(async () => {
  await db.exec(
    "truncate public.calendar_slots,public.consultation_events,public.consultation_history,public.consultations,public.walk_registrations,public.walk_private_details,public.walks,public.care_follow_up_history,public.care_follow_ups,public.care_events,public.care_progress,public.care_plan_versions,public.care_drafts,public.care_templates cascade; update public.dogs set status='approved';",
  );
});
afterAll(async () => {
  await db?.close();
});

async function date(days = 0) {
  return (
    await db.query<{ result_date: string }>(
      "select ((now() at time zone 'Europe/Warsaw')::date+$1::int)::text as result_date",
      [days],
    )
  ).rows[0].result_date;
}
async function task(planId: string) {
  return (
    await db.query<{
      id: string;
      due_on: string;
      version: number;
      status: string;
    }>(
      "select id,due_on::text,version,status from public.care_follow_ups where plan_id=$1",
      [planId],
    )
  ).rows[0];
}
async function change(
  id: string,
  version = 1,
  action = "completed",
  due: string | null = null,
  note = "Kontakt testowy zakończony",
  user = admin,
) {
  return asUser(user, () =>
    db.query<{ version: number }>(
      "select public.change_care_follow_up($1,$2,$3,$4,$5) version",
      [id, version, action, due, note],
    ),
  );
}
async function queue(filter = "all", offset = 0, user = admin) {
  return (
    await asUser(user, () =>
      db.query<{
        kind: string;
        id: string;
        dog_id: string;
        priority: number;
        due_on: string;
      }>("select * from public.staff_work_queue($1,$2)", [filter, offset]),
    )
  ).rows;
}
async function counts(user = admin) {
  return (
    await asUser(user, () =>
      db.query<{ kind: string; total: number; overdue: number }>(
        "select * from public.staff_work_counts()",
      ),
    )
  ).rows;
}
describe.sequential("follow-up tasks and unified staff queue", () => {
  it("migrates existing plans using only the latest publication, without resurrecting an old contact", async () => {
    expect(imported).toEqual([
      { plan_id: latestBeforeMigration, due_on: await date(2), status: "open" },
    ]);
    expect(importedHistoryCount).toBe(1);
  });
  it("creates a task only from publication, ignores drafts and deduplicates publication retries", async () => {
    await plan(0, false, "Szkic", dog, await date(7));
    expect(
      (await db.query("select * from public.care_follow_ups")).rows,
    ).toHaveLength(0);
    const p = await plan(1, true, "Publikacja", dog, await date(7));
    await plan(1, true, "Publikacja", dog, await date(7));
    expect(
      (await db.query("select * from public.care_follow_ups")).rows,
    ).toHaveLength(1);
    const f = await task(p.published_id!);
    expect(f).toMatchObject({ version: 1, status: "open" });
    expect(
      (await db.query("select * from public.care_follow_up_history")).rows,
    ).toHaveLength(1);
    await plan(2, false, "Nowy prywatny szkic", dog, await date(14));
    expect((await task(p.published_id!)).due_on).toBe(await date(7));
  });
  it("new publications supersede the prior open task, including publication without another follow-up date", async () => {
    const first = await plan(0, true, "Pierwszy plan", dog, await date(1));
    const second = await plan(1, true, "Drugi plan", dog, await date(2));
    expect((await task(first.published_id!)).status).toBe("superseded");
    expect((await task(second.published_id!)).status).toBe("open");
    await plan(2, true, "Plan bez kolejnego kontaktu", dog, null);
    expect((await task(second.published_id!)).status).toBe("superseded");
    expect(await queue("followups")).toHaveLength(0);
  });
  it("finishes a contact, removes it from the queue and keeps private notes from both guardians", async () => {
    const p = await plan(0, true, "Plan", dog, await date()),
      f = await task(p.published_id!);
    await change(f.id);
    expect((await task(p.published_id!)).status).toBe("done");
    expect(await queue("followups")).toHaveLength(0);
    const own = await asUser(owner, () =>
      db.query("select * from public.care_follow_ups"),
    );
    expect(own.rows).toHaveLength(1);
    expect(JSON.stringify(own.rows)).not.toContain(
      "Kontakt testowy zakończony",
    );
    for (const user of [owner, stranger])
      expect(
        (
          await asUser(user, () =>
            db.query("select * from public.care_follow_up_history"),
          )
        ).rows,
      ).toEqual([]);
    expect(
      (
        await asUser(stranger, () =>
          db.query("select * from public.care_follow_ups"),
        )
      ).rows,
    ).toEqual([]);
  });
  it("reschedules the live contact while preserving the original published date and exposing the current date in plan summaries", async () => {
    const before = await date(1),
      after = await date(4),
      p = await plan(0, true, "Plan", dog, before),
      f = await task(p.published_id!);
    await change(f.id, 1, "rescheduled", after, "Uzgodniona zmiana daty");
    expect((await task(p.published_id!)).due_on).toBe(after);
    const original = (
      await db.query<{ follow_up_on: string }>(
        "select follow_up_on::text from public.care_plan_versions where id=$1",
        [p.published_id],
      )
    ).rows[0];
    expect(original.follow_up_on).toBe(before);
    expect(
      (
        await asUser(owner, () =>
          db.query<{ follow_up_on: string }>(
            "select follow_up_on::text from public.care_plan_summaries(0)",
          ),
        )
      ).rows[0].follow_up_on,
    ).toBe(after);
  });
  it("retries safely, rejects stale edits, and reopens a finished current contact", async () => {
    const p = await plan(),
      f = await task(p.published_id!);
    await change(f.id);
    expect((await change(f.id)).rows[0].version).toBe(2);
    await expect(
      change(f.id, 1, "cancelled", null, "Inny formularz"),
    ).rejects.toThrow("Kontakt zmienił się");
    await change(
      f.id,
      2,
      "reopened",
      await date(3),
      "Potrzebny kolejny kontakt",
    );
    expect((await task(p.published_id!)).status).toBe("open");
    expect(
      (
        await db.query(
          "select * from public.care_follow_up_history where follow_up_id=$1",
          [f.id],
        )
      ).rows,
    ).toHaveLength(3);
  });
  it("cannot reopen an old completed contact after publishing a new plan", async () => {
    const p = await plan(),
      f = await task(p.published_id!);
    await change(f.id);
    await plan(1, true, "Nowszy plan", dog, await date(7));
    await expect(
      change(f.id, 2, "reopened", await date(5), "Dalszy kontakt"),
    ).rejects.toThrow("wcześniejszego planu");
    expect((await task(p.published_id!)).status).toBe("done");
    expect(await queue("followups")).toHaveLength(1);
  });
  it("cancels once, clears the guardian's next contact date, and allows deliberate reopening", async () => {
    const p = await plan(),
      f = await task(p.published_id!);
    await change(f.id, 1, "cancelled", null, "Uzgodnione odwołanie");
    expect(
      (await change(f.id, 1, "cancelled", null, "Uzgodnione odwołanie")).rows[0]
        .version,
    ).toBe(2);
    expect(await queue("followups")).toHaveLength(0);
    expect(
      (
        await asUser(owner, () =>
          db.query<{ follow_up_on: string | null }>(
            "select follow_up_on::text from public.care_plan_summaries(0)",
          ),
        )
      ).rows[0].follow_up_on,
    ).toBeNull();
    await expect(
      change(f.id, 2, "completed", null, "Nieaktualny formularz"),
    ).rejects.toThrow("aktualnym stanie");
    await change(
      f.id,
      2,
      "reopened",
      await date(2),
      "Uzgodniony powrót do kontaktu",
    );
    expect(await task(p.published_id!)).toMatchObject({
      status: "open",
      version: 3,
    });
    expect(await queue("followups")).toHaveLength(1);
  });
  it("rolls back a contact change and its audit if writing private history fails", async () => {
    const p = await plan(),
      f = await task(p.published_id!);
    const audits = (
      await db.query("select * from public.audit_events where entity_id=$1", [
        f.id,
      ])
    ).rows.length;
    await db.exec(
      "create function public.fail_contact_change() returns trigger language plpgsql as $$begin raise exception 'test failure'; end$$; create trigger fail_contact_change before insert on public.care_follow_up_history for each row execute function public.fail_contact_change();",
    );
    try {
      await expect(change(f.id)).rejects.toThrow("test failure");
      expect(await task(p.published_id!)).toMatchObject({
        status: "open",
        version: 1,
      });
      expect(
        (
          await db.query(
            "select * from public.care_follow_up_history where follow_up_id=$1",
            [f.id],
          )
        ).rows,
      ).toHaveLength(1);
      expect(
        (
          await db.query(
            "select * from public.audit_events where entity_id=$1",
            [f.id],
          )
        ).rows,
      ).toHaveLength(audits);
      expect(await queue("followups")).toHaveLength(1);
    } finally {
      await db.exec(
        "drop trigger fail_contact_change on public.care_follow_up_history; drop function public.fail_contact_change();",
      );
    }
  });
  it("denies all staff queue reads and follow-up changes to clients and anonymous callers", async () => {
    const p = await plan(),
      f = await task(p.published_id!);
    for (const user of [owner, stranger]) {
      await expect(queue("all", 0, user)).rejects.toThrow("Brak uprawnień");
      await expect(counts(user)).rejects.toThrow("Brak uprawnień");
      await expect(
        change(f.id, 1, "completed", null, "Obca operacja", user),
      ).rejects.toThrow("Brak uprawnień");
    }
    for (const table of ["care_follow_ups", "care_follow_up_history"])
      await expect(
        asUser(admin, () => db.query(`delete from public.${table}`)),
      ).rejects.toThrow("permission denied");
    expect(
      (
        await db.query<{ allowed: boolean }>(
          "select has_function_privilege('anon','public.staff_work_queue(text,integer)','execute') allowed",
        )
      ).rows[0].allowed,
    ).toBe(false);
  });
  it("unifies five work types, excludes future inactive walks, and removes a reviewed response immediately", async () => {
    const p = await plan(0, true, "Plan", dog, await date(-1));
    const progress = await response(p.published_id!);
    await db.query("update public.dogs set status='needs_review' where id=$1", [
      otherDog,
    ]);
    await asUser(owner, () =>
      db.query(
        "select public.request_consultation($1,$2,'Zgłoszenie testowe','','60000000-0000-4000-8000-000000000011',1)",
        [randomUUID(), dog],
      ),
    );
    const walkId = (
      await db.query<{ id: string }>(
        "insert into public.walks(starts_at,public_location,type,price_cents,capacity) values(now()+interval '4 days','Park','Spacer',10000,4) returning id",
      )
    ).rows[0].id;
    await db.query(
      "insert into public.walk_registrations(walk_id,dog_id,status) values($1,$2,'pending')",
      [walkId, dog],
    );
    const q = await queue();
    expect(new Set(q.map((i) => i.kind))).toEqual(
      new Set(["followups", "consultations", "progress", "profiles", "walks"]),
    );
    expect(q[0].kind).toBe("followups");
    expect(q[0].priority).toBe(0);
    expect((await counts()).find((c) => c.kind === "followups")?.overdue).toBe(
      1,
    );
    await asUser(admin, () =>
      db.query("select public.review_care_progress($1)", [progress]),
    );
    expect(await queue("progress")).toHaveLength(0);
    await db.query("update public.walks set status='cancelled' where id=$1", [
      walkId,
    ]);
    expect(await queue("walks")).toHaveLength(0);
  });
  it("keeps whole-queue counts correct beyond an API page limit and paginates without duplicates", async () => {
    const p = await plan();
    await db.query(
      "insert into public.care_progress(id,practice_id,dog_id,plan_id,author_id,attempted) select gen_random_uuid(),'00000000-0000-4000-8000-000000000001',$1,$2,$3,'Fikcyjny wpis do testu stronicowania' from generate_series(1,1005)",
      [dog, p.published_id, owner],
    );
    expect((await counts()).find((c) => c.kind === "progress")?.total).toBe(
      1005,
    );
    const first = await queue("progress"),
      second = await queue("progress", 20);
    expect(first).toHaveLength(21);
    expect(second).toHaveLength(21);
    expect(
      new Set([...first.slice(0, 20), ...second.slice(0, 20)].map((i) => i.id))
        .size,
    ).toBe(40);
    expect(await queue("progress", 1000)).toHaveLength(5);
  });
  it("atomically rolls back publication, replacement and draft changes if a follow-up history write fails", async () => {
    const p = await plan(),
      f = await task(p.published_id!);
    await db.exec(
      "create function public.fail_follow_up() returns trigger language plpgsql as $$begin raise exception 'test failure'; end$$; create trigger fail_follow_up before insert on public.care_follow_up_history for each row execute function public.fail_follow_up();",
    );
    try {
      await expect(
        plan(1, true, "Nowy plan", dog, await date(4)),
      ).rejects.toThrow("test failure");
      expect(await task(p.published_id!)).toMatchObject({
        status: "open",
        version: 1,
        id: f.id,
      });
      expect(
        (await db.query("select * from public.care_plan_versions")).rows,
      ).toHaveLength(1);
      expect(
        (
          await db.query<{ version: number }>(
            "select version from public.care_drafts",
          )
        ).rows[0].version,
      ).toBe(1);
    } finally {
      await db.exec(
        "drop trigger fail_follow_up on public.care_follow_up_history; drop function public.fail_follow_up();",
      );
    }
  });
  it("requires useful reasons and a current or future date for manual rescheduling", async () => {
    const p = await plan(0, true, "Plan", dog, await date(2)),
      f = await task(p.published_id!);
    await expect(change(f.id, 1, "completed", null, " ")).rejects.toThrow(
      "krótką notatkę",
    );
    await expect(
      change(f.id, 1, "rescheduled", await date(-1), "Zmiana terminu"),
    ).rejects.toThrow("dzisiejszą lub przyszłą");
    await expect(
      change(f.id, 1, "rescheduled", await date(2), "Zmiana terminu"),
    ).rejects.toThrow("inną datę");
    await expect(
      change(f.id, 1, "rescheduled", "infinity", "Zmiana terminu"),
    ).rejects.toThrow("datę kontaktu");
    await expect(queue("invalid")).rejects.toThrow("Nieprawidłowy filtr");
  });
});
