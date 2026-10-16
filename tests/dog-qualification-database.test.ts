import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

let db: PGlite;
let legacyCounts: { notes: number; audits: number };
const owner = "81000000-0000-4000-8000-000000000001";
const admin = "81000000-0000-4000-8000-000000000002";
const otherAdmin = "81000000-0000-4000-8000-000000000003";
const dog = "82000000-0000-4000-8000-000000000001";
const otherDog = "82000000-0000-4000-8000-000000000002";
const note = "Spokojne reakcje psa.";
async function asUser<T>(
  actor: string,
  run: () => Promise<T>,
  role = "authenticated",
) {
  await db.exec(`begin;set local role ${role};`);
  await db.query("select set_config('request.jwt.claim.sub',$1,true)", [actor]);
  try {
    const result = await run();
    await db.exec("commit");
    return result;
  } catch (error) {
    await db.exec("rollback");
    throw error;
  }
}
type Decision = {
  request: string | null;
  dog: string | null;
  expectedStatus: string | null;
  expectedVersion: number | null;
  status: string | null;
  note: string | null;
};
async function qualify(overrides: Partial<Decision> = {}, actor = admin) {
  const decision = {
    request: randomUUID(),
    dog,
    expectedStatus: "new",
    expectedVersion: 0,
    status: "approved",
    note,
    ...overrides,
  };
  return (
    await asUser(actor, () =>
      db.query<{ version: number }>(
        "select public.qualify_dog($1,$2,$3,$4,$5,$6) version",
        [
          decision.request,
          decision.dog,
          decision.expectedStatus,
          decision.expectedVersion,
          decision.status,
          decision.note,
        ],
      ),
    )
  ).rows[0].version;
}
async function counts() {
  return (
    await db.query<{ notes: number; audits: number }>(
      "select (select count(*)::int from public.dog_notes) notes,(select count(*)::int from public.audit_events where event='dog_status_changed') audits",
    )
  ).rows[0];
}
async function state() {
  return (
    await db.query<{ status: string; qualification_version: number }>(
      "select status,qualification_version from public.dogs where id=$1",
      [dog],
    )
  ).rows[0];
}
beforeAll(async () => {
  db = new PGlite();
  await db.exec(`create role anon;create role authenticated;create schema auth;
    create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    grant usage on schema public,auth to anon,authenticated;
    grant execute on function auth.uid() to anon,authenticated;`);
  for (const file of [
    "202609050001_foundation.sql",
    "202609050002_operations.sql",
  ])
    await db.exec(readFileSync(`supabase/migrations/${file}`, "utf8"));
  await db.query("insert into auth.users(id) values($1),($2),($3)", [
    owner,
    admin,
    otherAdmin,
  ]);
  await db.query(
    "update public.user_roles set role='admin' where user_id in ($1,$2)",
    [admin, otherAdmin],
  );
  await db.query(
    "insert into public.dogs(id,guardian_id,name) values($1,$3,'Figa'),($2,$3,'Inny pies')",
    [dog, otherDog, owner],
  );
  // Reproduce the confirmed defect against the old RPC before applying the fix.
  for (let attempt = 0; attempt < 2; attempt++)
    await asUser(admin, () =>
      db.query("select public.set_dog_status($1,'approved',$2)", [dog, note]),
    );
  legacyCounts = await counts();
  await db.exec("truncate public.dog_notes,public.audit_events;");
  await db.exec("update public.dogs set status='new';");
  await db.exec(
    readFileSync(
      "supabase/migrations/202610160002_dog_qualification_recovery.sql",
      "utf8",
    ),
  );
});
beforeEach(async () => {
  await db.exec(
    "truncate public.dog_qualification_receipts,public.dog_notes,public.audit_events;",
  );
  await db.query(
    "update public.user_roles set role='admin' where user_id in ($1,$2)",
    [admin, otherAdmin],
  );
  await db.query(
    "insert into public.dogs(id,guardian_id,name) values($1,$2,'Figa') on conflict(id) do nothing",
    [dog, owner],
  );
  await db.exec(
    "update public.dogs set status='new';update public.dogs set qualification_version=0;",
  );
});
afterAll(async () => {
  await db?.close();
});

describe.sequential("recoverable dog qualification decisions", () => {
  it("reproduces the old duplicated note and audit and initializes a protected version", async () => {
    expect(legacyCounts).toEqual({ notes: 2, audits: 2 });
    expect(await state()).toEqual({ status: "new", qualification_version: 0 });
  });
  it("acknowledges identical retries with one status change, private note and audit", async () => {
    const request = randomUUID();
    expect(await qualify({ request })).toBe(1);
    expect(await qualify({ request, note: ` ${note} ` })).toBe(1);
    expect(await state()).toEqual({
      status: "approved",
      qualification_version: 1,
    });
    expect(await counts()).toEqual({ notes: 1, audits: 1 });
    expect(
      (await db.query("select body,visibility,author_id from public.dog_notes"))
        .rows,
    ).toEqual([{ body: note, visibility: "admin_only", author_id: admin }]);
  });
  it.each([
    { status: "suspended" },
    { note: "Inna decyzja o kwalifikacji." },
    { expectedStatus: "approved" },
    { expectedVersion: 1 },
    { dog: otherDog },
  ])("rejects any changed immutable payload: %j", async (change) => {
    const request = randomUUID();
    await qualify({ request });
    await expect(qualify({ request, ...change })).rejects.toThrow(
      "innej decyzji",
    );
    expect(await counts()).toEqual({ notes: 1, audits: 1 });
    expect((await state()).qualification_version).toBe(1);
  });
  it("rejects another administrator using the same key", async () => {
    const request = randomUUID();
    await qualify({ request });
    await expect(qualify({ request }, otherAdmin)).rejects.toThrow(
      "innej decyzji",
    );
    expect(await counts()).toEqual({ notes: 1, audits: 1 });
  });
  it.each([owner, ""])(
    "rejects a non-admin actor before any mutation: %s",
    async (actor) => {
      await expect(qualify({}, actor)).rejects.toThrow("Brak uprawnień");
      expect(await counts()).toEqual({ notes: 0, audits: 0 });
    },
  );
  it("rechecks the administrator's current role on replay", async () => {
    const request = randomUUID();
    await qualify({ request });
    await db.query(
      "update public.user_roles set role='client' where user_id=$1",
      [admin],
    );
    await expect(qualify({ request })).rejects.toThrow("Brak uprawnień");
    expect(await counts()).toEqual({ notes: 1, audits: 1 });
  });
  it("rejects a different decision from the same outdated initial state", async () => {
    await qualify();
    await expect(qualify({ status: "suspended" }, otherAdmin)).rejects.toThrow(
      "zmieniła się",
    );
    expect(await state()).toEqual({
      status: "approved",
      qualification_version: 1,
    });
    expect(await counts()).toEqual({ notes: 1, audits: 1 });
  });
  it("detects a same-status decision and an ABA status cycle", async () => {
    await qualify({ status: "new" });
    await expect(qualify()).rejects.toThrow("zmieniła się");
    await qualify({ expectedVersion: 1 });
    await qualify({
      expectedVersion: 2,
      expectedStatus: "approved",
      status: "new",
    });
    expect((await state()).status).toBe("new");
    await expect(qualify()).rejects.toThrow("zmieniła się");
    expect(await counts()).toEqual({ notes: 3, audits: 3 });
  });
  it("only acknowledges an older retry after a later decision, without restoring the older status", async () => {
    const request = randomUUID();
    await qualify({ request });
    await qualify({
      expectedVersion: 1,
      expectedStatus: "approved",
      status: "suspended",
    });
    expect(await qualify({ request })).toBe(1);
    expect(await state()).toEqual({
      status: "suspended",
      qualification_version: 2,
    });
    expect(await counts()).toEqual({ notes: 2, audits: 2 });
  });
  it("invalidates an old decision when the behavioral questionnaire changes status", async () => {
    await asUser(owner, () =>
      db.query(
        "insert into public.dog_behavior_profiles(dog_id,reactions) values($1,'Nowa reakcja')",
        [dog],
      ),
    );
    expect(await state()).toEqual({
      status: "needs_review",
      qualification_version: 1,
    });
    await expect(qualify()).rejects.toThrow("zmieniła się");
  });
  it("retains a used request key when its dog is deleted", async () => {
    const request = randomUUID();
    await qualify({ request });
    await db.query("delete from public.dogs where id=$1", [dog]);
    await expect(qualify({ request })).rejects.toThrow("Nie znaleziono psa");
    expect(
      (await db.query("select * from public.dog_qualification_receipts")).rows,
    ).toHaveLength(1);
  });
  it.each([
    { request: null },
    { dog: null },
    { expectedStatus: null },
    { expectedVersion: null },
    { expectedVersion: -1 },
    { expectedVersion: 2147483647 },
    { status: null },
    { note: null },
    { note: "  " },
    { note: "ab" },
    { note: "x".repeat(8001) },
  ])("rejects missing or invalid parameters atomically: %j", async (change) => {
    await expect(qualify(change)).rejects.toThrow("Wybierz status");
    expect(await state()).toEqual({ status: "new", qualification_version: 0 });
    expect(await counts()).toEqual({ notes: 0, audits: 0 });
    expect(
      (await db.query("select * from public.dog_qualification_receipts")).rows,
    ).toEqual([]);
  });
  it("denies receipt access, protected version changes, anonymous calls and the old precondition bypass", async () => {
    for (const actor of [admin, owner]) {
      for (const query of [
        "select * from public.dog_qualification_receipts",
        "update public.dog_qualification_receipts set payload='{}'",
        "delete from public.dog_qualification_receipts",
        "insert into public.dog_qualification_receipts values(gen_random_uuid(),gen_random_uuid(),auth.uid(),'{}',1)",
        `update public.dogs set qualification_version=0 where id='${dog}'`,
        `select public.set_dog_status('${dog}','approved','Legacy bypass')`,
      ])
        await expect(asUser(actor, () => db.query(query))).rejects.toThrow(
          "permission denied",
        );
    }
    await expect(
      asUser(
        "",
        () =>
          db.query("select public.qualify_dog($1,$2,'new',0,'approved',$3)", [
            randomUUID(),
            dog,
            note,
          ]),
        "anon",
      ),
    ).rejects.toThrow("permission denied");
    expect(
      (
        await db.query<{ enabled: boolean }>(
          "select relrowsecurity enabled from pg_class where oid='public.dog_qualification_receipts'::regclass",
        )
      ).rows[0].enabled,
    ).toBe(true);
    expect(await counts()).toEqual({ notes: 0, audits: 0 });
  });
});
