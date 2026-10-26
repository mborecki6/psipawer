import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  createOnboardingAnswers,
  ONBOARDING_CONFLICT,
  ONBOARDING_INVALID,
  type OnboardingRecord,
} from "../src/modules/onboarding/types";
import { OnboardingRecordSchema } from "../src/modules/onboarding/schemas";

let db: PGlite;
const legacy = "81000000-0000-4000-8000-000000000001";
const unfinishedLegacy = "81000000-0000-4000-8000-000000000002";
const owner = "81000000-0000-4000-8000-000000000003";
const other = "81000000-0000-4000-8000-000000000004";
const admin = "81000000-0000-4000-8000-000000000005";
const unknown = "81000000-0000-4000-8000-000000000006";
const dog = "82000000-0000-4000-8000-000000000001";
const completeAnswers = {
  ...createOnboardingAnswers(),
  age: "unknown" as const,
  goal: "walks" as const,
  format: "individual" as const,
};

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

async function save({
  actor = owner,
  revision = 0,
  answers = createOnboardingAnswers() as unknown,
  step = "dog" as string | null,
  paused = false as boolean | null,
  complete = false as boolean | null,
  role = "authenticated",
}: {
  actor?: string;
  revision?: number | null;
  answers?: unknown;
  step?: string | null;
  paused?: boolean | null;
  complete?: boolean | null;
  role?: string;
} = {}): Promise<OnboardingRecord> {
  return (
    await asUser(
      actor,
      () =>
        db.query<{ record: OnboardingRecord }>(
          "select to_jsonb(public.save_guardian_onboarding($1,$2::jsonb,$3,$4,$5)) record",
          [revision, JSON.stringify(answers), step, paused, complete],
        ),
      role,
    )
  ).rows[0].record;
}

async function record(actor = owner) {
  return (
    await db.query<{ record: OnboardingRecord }>(
      "select to_jsonb(o) record from public.guardian_onboarding o where guardian_id=$1",
      [actor],
    )
  ).rows[0]?.record;
}

async function domainSnapshot() {
  return (
    await db.query<{ snapshot: unknown }>(`select jsonb_build_object(
      'profiles',(select jsonb_agg(to_jsonb(p) order by p.id) from public.profiles p),
      'roles',(select jsonb_agg(to_jsonb(r) order by r.user_id) from public.user_roles r),
      'dogs',(select jsonb_agg(to_jsonb(d) order by d.id) from public.dogs d),
      'behavior',(select jsonb_agg(to_jsonb(b) order by b.dog_id) from public.dog_behavior_profiles b),
      'walks',(select jsonb_agg(to_jsonb(w) order by w.id) from public.walks w),
      'registrations',(select jsonb_agg(to_jsonb(r) order by r.id) from public.walk_registrations r),
      'audit',(select jsonb_agg(to_jsonb(a) order by a.id) from public.audit_events a)
    ) snapshot`)
  ).rows[0].snapshot;
}

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`create role anon;create role authenticated;create schema auth;
    create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    grant usage on schema public,auth to anon,authenticated;
    grant execute on function auth.uid() to anon,authenticated;`);
  await db.exec(
    readFileSync("supabase/migrations/202609050001_foundation.sql", "utf8"),
  );
  await db.query("insert into auth.users(id) values($1),($2)", [
    legacy,
    unfinishedLegacy,
  ]);
  await db.query(
    "update public.profiles set full_name='Dawny opiekun',phone='123456789',area='Wrocław' where id=$1",
    [legacy],
  );
  await db.query(
    "insert into public.dogs(id,guardian_id,name,approximate_age) values($1,$2,'Dawny pies','4 lata')",
    [dog, legacy],
  );
  await db.exec(
    readFileSync(
      "supabase/migrations/202610260001_guardian_onboarding.sql",
      "utf8",
    ),
  );
  await db.query("insert into auth.users(id) values($1),($2),($3)", [
    owner,
    other,
    admin,
  ]);
  await db.query("update public.user_roles set role='admin' where user_id=$1", [
    admin,
  ]);
});

beforeEach(async () => {
  await db.query(
    `update public.guardian_onboarding set answers=$1::jsonb,current_step='welcome',paused=false,
      completed_at=null,revision=0,updated_at=created_at`,
    [JSON.stringify(createOnboardingAnswers())],
  );
});

afterAll(async () => {
  await db?.close();
});

describe.sequential(
  "guardian onboarding cohort and transactional writes",
  () => {
    it("exempts all previous accounts, including unfinished profiles, and enrolls future profiles", async () => {
      expect(await record(legacy)).toBeUndefined();
      expect(await record(unfinishedLegacy)).toBeUndefined();
      expect(
        (
          await db.query(
            "select full_name,phone,area from public.profiles where id=$1",
            [unfinishedLegacy],
          )
        ).rows,
      ).toEqual([{ full_name: null, phone: null, area: null }]);
      for (const actor of [owner, other, admin]) {
        const enrolled = (await record(actor))!;
        expect(enrolled).toMatchObject({
          guardian_id: actor,
          answers: createOnboardingAnswers(),
          current_step: "welcome",
          paused: false,
          completed_at: null,
          revision: 0,
        });
        expect(OnboardingRecordSchema.safeParse(enrolled).success).toBe(true);
      }
      expect(
        (
          await db.query(
            "select name,approximate_age from public.dogs where id=$1",
            [dog],
          )
        ).rows,
      ).toEqual([{ name: "Dawny pies", approximate_age: "4 lata" }]);
    });

    it("allows only the owner client to read a brief, never another client or staff", async () => {
      await save({
        answers: { ...completeAnswers, note: "Prywatna sytuacja" },
      });
      for (const actor of [owner, other]) {
        expect(
          (
            await asUser(actor, () =>
              db.query("select guardian_id from public.guardian_onboarding"),
            )
          ).rows,
        ).toEqual([{ guardian_id: actor }]);
      }
      expect(
        (
          await asUser(admin, () =>
            db.query("select * from public.guardian_onboarding"),
          )
        ).rows,
      ).toEqual([]);
      expect(
        (
          await asUser(other, () =>
            db.query(
              "select * from public.guardian_onboarding where guardian_id=$1",
              [owner],
            ),
          )
        ).rows,
      ).toEqual([]);
      await expect(
        asUser(
          "",
          () => db.query("select * from public.guardian_onboarding"),
          "anon",
        ),
      ).rejects.toThrow("permission denied");
    });

    it("forbids direct DML and direct execution of the cohort trigger function", async () => {
      for (const actor of [owner, other, admin]) {
        for (const query of [
          "insert into public.guardian_onboarding(guardian_id) values(auth.uid())",
          "update public.guardian_onboarding set completed_at=now()",
          "delete from public.guardian_onboarding",
          "select public.create_guardian_onboarding()",
        ])
          await expect(asUser(actor, () => db.query(query))).rejects.toThrow(
            "permission denied",
          );
      }
      expect(
        (
          await db.query<{ enabled: boolean }>(
            "select relrowsecurity enabled from pg_class where oid='public.guardian_onboarding'::regclass",
          )
        ).rows[0].enabled,
      ).toBe(true);
    });

    it("rejects anonymous RPC calls, staff, unknown identities and missing cohort records", async () => {
      await expect(save({ actor: "", role: "anon" })).rejects.toThrow(
        "permission denied",
      );
      for (const actor of ["", admin, unknown])
        await expect(save({ actor })).rejects.toThrow("Brak uprawnień");
      for (const actor of [legacy, unfinishedLegacy]) {
        await expect(save({ actor })).rejects.toThrow(
          "nie wymaga wprowadzenia",
        );
        expect(await record(actor)).toBeUndefined();
      }
    });

    it("persists partial progress and pause, then resumes the same owned record", async () => {
      const paused = await save({
        answers: { ...createOnboardingAnswers(), dogName: " Figa " },
        step: "goal",
        paused: true,
      });
      expect(paused).toMatchObject({
        answers: { ...createOnboardingAnswers(), dogName: "Figa" },
        current_step: "goal",
        paused: true,
        completed_at: null,
        revision: 1,
      });
      const resumed = await save({
        revision: 1,
        answers: paused.answers,
        step: "goal",
        paused: false,
      });
      expect(resumed).toMatchObject({
        current_step: "goal",
        paused: false,
        revision: 2,
      });
      expect(await record()).toEqual(resumed);
      expect((await record(other))!.revision).toBe(0);
    });

    it("completes with unknown answers and keeps the first completion during later edits and pauses", async () => {
      const completed = await save({
        answers: { ...completeAnswers, goal: "unknown", format: "unknown" },
        step: "plan",
        complete: true,
      });
      expect(completed.completed_at).toBeTruthy();
      expect(completed.revision).toBe(1);
      const edited = await save({
        revision: 1,
        answers: { ...completed.answers, note: " Zmieniona sytuacja " },
        step: "goal",
        paused: true,
      });
      expect(edited).toMatchObject({
        completed_at: completed.completed_at,
        answers: { ...completed.answers, note: "Zmieniona sytuacja" },
        current_step: "goal",
        paused: true,
        revision: 2,
      });
      const finishedEdit = await save({
        revision: 2,
        answers: edited.answers,
        step: "plan",
        complete: true,
      });
      expect(finishedEdit.completed_at).toBe(completed.completed_at);
      expect(OnboardingRecordSchema.safeParse(finishedEdit).success).toBe(true);
    });

    it("rejects incomplete completion and incomplete edits of a completed record", async () => {
      for (const missing of ["age", "goal", "format"])
        await expect(
          save({
            answers: { ...completeAnswers, [missing]: null },
            step: "plan",
            complete: true,
          }),
        ).rejects.toThrow(ONBOARDING_INVALID);
      await expect(
        save({ answers: completeAnswers, step: "dog", complete: true }),
      ).rejects.toThrow(ONBOARDING_INVALID);
      await expect(
        save({
          answers: completeAnswers,
          step: "plan",
          complete: true,
          paused: true,
        }),
      ).rejects.toThrow(ONBOARDING_INVALID);
      const completed = await save({
        answers: completeAnswers,
        step: "plan",
        complete: true,
      });
      await expect(
        save({ revision: 1, answers: createOnboardingAnswers() }),
      ).rejects.toThrow(ONBOARDING_INVALID);
      expect(await record()).toEqual(completed);
    });

    it("recovers the immediately preceding committed response without another write", async () => {
      const request = {
        answers: completeAnswers,
        step: "plan",
        complete: true,
      };
      const completed = await save(request);
      expect(await save(request)).toEqual(completed);
      // Once complete, false never means reset: a semantically equivalent replay
      // may return the existing completed record, but cannot change any fields.
      expect(await save({ ...request, complete: false })).toEqual(completed);
      expect(await record()).toEqual(completed);
      const draft = await save({
        actor: other,
        answers: completeAnswers,
        step: "plan",
      });
      await expect(
        save({
          actor: other,
          answers: completeAnswers,
          step: "plan",
          complete: true,
        }),
      ).rejects.toThrow(ONBOARDING_CONFLICT);
      expect(await record(other)).toEqual(draft);
    });

    it("rejects stale and future revisions without overwriting a second browser's answers", async () => {
      const first = await save({ answers: completeAnswers, step: "goal" });
      for (const changed of [
        {
          revision: 0,
          answers: { ...completeAnswers, dogName: "Inny pies" },
          step: "goal",
        },
        { revision: 0, answers: completeAnswers, step: "style" },
        { revision: 0, answers: completeAnswers, step: "goal", paused: true },
        { revision: 2, answers: completeAnswers, step: "goal" },
      ])
        await expect(save(changed)).rejects.toThrow(ONBOARDING_CONFLICT);
      expect(await record()).toEqual(first);
      const second = await save({
        revision: 1,
        answers: { ...completeAnswers, note: "Nowsze dane" },
        step: "style",
      });
      await expect(
        save({ answers: completeAnswers, step: "goal" }),
      ).rejects.toThrow(ONBOARDING_CONFLICT);
      expect(await record()).toEqual(second);
    });

    it("does not create a dog or alter existing profiles, roles, dogs, qualification or registration", async () => {
      const before = await domainSnapshot();
      const saved = await save({
        answers: {
          ...completeAnswers,
          dogName: "Figa",
          note: "Spokojniejsze spacery",
        },
        step: "plan",
        complete: true,
      });
      await save({
        revision: saved.revision,
        answers: { ...saved.answers, dogName: "Inne imię" },
        step: "dog",
      });
      expect(await domainSnapshot()).toEqual(before);
    });

    it.each([
      null,
      [],
      "text",
      {},
      { ...completeAnswers, age: "" },
      { ...completeAnswers, age: 3 },
      { ...completeAnswers, goal: true },
      { ...completeAnswers, format: "therapy" },
      { ...completeAnswers, dogName: null },
      { ...completeAnswers, dogName: "x".repeat(41) },
      { ...completeAnswers, note: "x".repeat(241) },
      { ...completeAnswers, note: undefined },
      { ...completeAnswers, collaboration: null },
      { ...completeAnswers, rhythm: "daily" },
      { ...completeAnswers, guardian_id: other },
      { ...completeAnswers, completed_at: "2026-10-26" },
    ])(
      "rejects malformed and privileged RPC answer payloads: %j",
      async (answers) => {
        const before = await record();
        await expect(save({ answers })).rejects.toThrow(ONBOARDING_INVALID);
        expect(await record()).toEqual(before);
      },
    );

    it.each([
      { revision: null },
      { revision: -1 },
      { revision: 2147483647 },
      { step: null },
      { step: "paused" },
      { paused: null },
      { complete: null },
    ])("rejects invalid RPC transition parameters: %j", async (change) => {
      await expect(save(change)).rejects.toThrow(ONBOARDING_INVALID);
      expect((await record())!.revision).toBe(0);
    });

    it("enforces strict persisted payloads even for privileged direct writes", async () => {
      const before = await record();
      for (const answers of [
        {},
        { ...completeAnswers, age: "" },
        { ...completeAnswers, goal: false },
        { ...completeAnswers, note: null },
        { ...completeAnswers, format: undefined },
        { ...completeAnswers, dogName: "x".repeat(41) },
        { ...completeAnswers, guardian_id: owner },
      ])
        await expect(
          db.query(
            "update public.guardian_onboarding set answers=$1::jsonb where guardian_id=$2",
            [JSON.stringify(answers), owner],
          ),
        ).rejects.toThrow("guardian_onboarding_answers_check");
      await expect(
        db.query(
          "update public.guardian_onboarding set completed_at=now() where guardian_id=$1",
          [owner],
        ),
      ).rejects.toThrow("guardian_onboarding_completion_check");
      expect(await record()).toEqual(before);
    });

    it("removes only the owned onboarding state when its account is deleted", async () => {
      const transient = "81000000-0000-4000-8000-000000000007";
      await db.query("insert into auth.users(id) values($1)", [transient]);
      expect(await record(transient)).toBeTruthy();
      await db.query("delete from auth.users where id=$1", [transient]);
      expect(await record(transient)).toBeUndefined();
      expect(await record(owner)).toBeTruthy();
      expect(await record(legacy)).toBeUndefined();
    });
  },
);
