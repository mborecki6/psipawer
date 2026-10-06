import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { beforeAll, beforeEach, afterAll, describe, expect, it } from "vitest";

let db: PGlite;
const admin = "10000000-0000-4000-8000-000000000001";
const colleague = "10000000-0000-4000-8000-000000000004";
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
async function material(
  id: string,
  version = 0,
  title = "Materiał testowy",
  body = "Fikcyjna treść prywatnej biblioteki.",
  user = admin,
) {
  await asUser(user, () =>
    db.query("select public.save_care_template($1,$2,$3,$4)", [
      id,
      version,
      title,
      body,
    ]),
  );
}
async function materialState(id: string) {
  return (
    await db.query(
      `select t.*, (select count(*)::integer from public.audit_events a
      where a.entity_id=t.id and a.event='care_template_saved') audits
      from public.care_templates t where t.id=$1`,
      [id],
    )
  ).rows;
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
    await db.exec(readFileSync(`supabase/migrations/${name}`, "utf8"));
  }
  await db.query("insert into auth.users(id) values($1),($2),($3),($4)", [
    admin,
    owner,
    stranger,
    colleague,
  ]);
  await db.query(
    "update public.user_roles set role='admin' where user_id in ($1,$2)",
    [admin, colleague],
  );
  await db.query(
    "insert into public.dogs(id,guardian_id,name) values($1,$2,'Kluska'),($3,$4,'Borys')",
    [dog, owner, otherDog, stranger],
  );
});
beforeEach(async () => {
  await db.exec(
    "truncate public.care_follow_up_history,public.care_follow_ups,public.care_events,public.care_progress,public.care_plan_versions,public.care_drafts,public.care_templates;",
  );
});
afterAll(async () => {
  await db?.close();
});

describe.sequential(
  "care module: actual PostgreSQL authorization and publication lifecycle",
  () => {
    it("keeps drafts and templates private even for the dog's owner", async () => {
      await plan(0, false, "Prywatny szkic do dopracowania.");
      await asUser(admin, () =>
        db.query(
          "select public.save_care_template($1,0,'Materiał','Treść prywatnej biblioteki')",
          [randomUUID()],
        ),
      );
      for (const table of [
        "care_drafts",
        "care_templates",
        "care_plan_versions",
        "care_practices",
      ]) {
        expect(
          (await asUser(owner, () => db.query(`select * from public.${table}`)))
            .rows,
        ).toEqual([]);
      }
      expect(
        (
          await asUser(admin, () =>
            db.query("select * from public.care_drafts"),
          )
        ).rows,
      ).toHaveLength(1);
    });
    it("blocks clients from staff write operations", async () => {
      await expect(
        asUser(owner, () =>
          db.query(
            "select public.save_care_plan($1,0,'Tytuł','Treść',null,true)",
            [dog],
          ),
        ),
      ).rejects.toThrow("Brak uprawnień");
      await expect(
        asUser(owner, () =>
          db.query("select public.save_care_template($1,0,'Tytuł','Treść')", [
            randomUUID(),
          ]),
        ),
      ).rejects.toThrow("Brak uprawnień");
      await expect(
        asUser(owner, () =>
          db.query("select public.review_care_progress($1)", [randomUUID()]),
        ),
      ).rejects.toThrow("Brak uprawnień");
    });
    it("denies direct mutation even to an authenticated staff session", async () => {
      await plan();
      for (const table of [
        "care_practices",
        "care_templates",
        "care_drafts",
        "care_plan_versions",
        "care_progress",
      ]) {
        await expect(
          asUser(admin, () => db.query(`delete from public.${table}`)),
        ).rejects.toThrow(/permission denied/);
      }
      await expect(
        asUser(admin, () =>
          db.query("update public.care_plan_versions set body='Nadpisanie'"),
        ),
      ).rejects.toThrow(/permission denied/);
      await expect(
        asUser(owner, () =>
          db.query("update public.care_drafts set body='Nadpisanie'"),
        ),
      ).rejects.toThrow(/permission denied/);
    });
    it("gives anonymous users neither table nor RPC access", async () => {
      const grants = await db.query<{ read: boolean; execute: boolean }>(
        "select has_table_privilege('anon','public.care_plan_versions','select') as read, has_function_privilege('anon','public.save_care_plan(uuid,integer,text,text,date,boolean,uuid,uuid,uuid,uuid,uuid)','execute') as execute",
      );
      expect(grants.rows[0]).toEqual({ read: false, execute: false });
    });
    it("publishes the submitted text, retaining a separate editable draft", async () => {
      await plan(0, false, "Wcześniejszy szkic.");
      const result = await plan(
        1,
        true,
        "Treść z aktualnie wysłanego formularza.",
      );
      expect(result.version).toBe(2);
      const rows = await asUser(owner, () =>
        db.query<{ body: string; revision: number }>(
          "select body,revision from public.care_plan_versions",
        ),
      );
      expect(rows.rows).toEqual([
        { body: "Treść z aktualnie wysłanego formularza.", revision: 1 },
      ]);
      await plan(2, false, "Kolejny prywatny szkic.");
      expect(
        (
          await asUser(owner, () =>
            db.query<{ body: string }>(
              "select body from public.care_plan_versions",
            ),
          )
        ).rows[0].body,
      ).toBe("Treść z aktualnie wysłanego formularza.");
    });
    it("preserves published content when the source library changes", async () => {
      const id = randomUUID();
      await asUser(admin, () =>
        db.query(
          "select public.save_care_template($1,0,'Materiał','Pierwsza treść')",
          [id],
        ),
      );
      await plan(0, true, "Pierwsza treść");
      await asUser(admin, () =>
        db.query(
          "select public.save_care_template($1,1,'Materiał','Zmieniony materiał')",
          [id],
        ),
      );
      expect(
        (
          await asUser(owner, () =>
            db.query<{ body: string }>(
              "select body from public.care_plan_versions",
            ),
          )
        ).rows[0].body,
      ).toBe("Pierwsza treść");
    });
    it("rejects stale draft edits and concurrent first creation", async () => {
      await plan(0, false);
      await expect(plan(0, false, "Drugi otwarty formularz.")).rejects.toThrow(
        "Plan zmienił się",
      );
      await plan(1, false, "Nowy szkic.");
      await expect(
        plan(1, true, "Publikacja z nieaktualnego formularza."),
      ).rejects.toThrow("Plan zmienił się");
      expect(
        (await db.query("select * from public.care_plan_versions")).rows,
      ).toHaveLength(0);
    });
    it("does not duplicate a retried publication or outbox event", async () => {
      const first = await plan();
      const retry = await plan();
      expect(retry).toEqual(first);
      expect(
        (await db.query("select * from public.care_plan_versions")).rows,
      ).toHaveLength(1);
      expect(
        (await db.query("select * from public.care_events")).rows,
      ).toHaveLength(1);
      await expect(
        plan(0, true, "Inna treść przy tej samej wersji."),
      ).rejects.toThrow("Plan zmienił się");
    });
    it("checks the follow-up date when recognizing a retry", async () => {
      await plan();
      await expect(plan(0, true, undefined, dog, "2026-10-02")).rejects.toThrow(
        "Plan zmienił się",
      );
    });
    it("rejects empty, overlong and invalid versions before mutation", async () => {
      await expect(plan(0, true, " ")).rejects.toThrow("Podaj tytuł i treść");
      await expect(plan(0, true, "a".repeat(20001))).rejects.toThrow(
        "Podaj tytuł i treść",
      );
      await expect(plan(-1)).rejects.toThrow("Nieprawidłowa wersja");
      await expect(
        asUser(admin, () =>
          db.query(
            "select public.save_care_plan($1,null,'Tytuł','Treść',null,true)",
            [dog],
          ),
        ),
      ).rejects.toThrow("Nieprawidłowa wersja");
      expect(
        (await db.query("select * from public.care_events")).rows,
      ).toHaveLength(0);
    });
    it("keeps publications and latest-plan summaries scoped to the owner", async () => {
      await plan();
      await plan(0, true, "Plan obcego psa.", otherDog);
      await plan(1, true, "Kolejna wersja mojego psa.");
      const own = await asUser(owner, () =>
        db.query<{ dog_id: string }>(
          "select dog_id from public.care_plan_versions",
        ),
      );
      expect(own.rows).toHaveLength(2);
      expect(own.rows.every((row) => row.dog_id === dog)).toBe(true);
      const summary = await asUser(owner, () =>
        db.query<{ dog_id: string; revision: number }>(
          "select * from public.care_plan_summaries(0)",
        ),
      );
      expect(summary.rows).toHaveLength(1);
      expect(summary.rows[0].revision).toBe(2);
      expect(summary.rows[0].dog_id).toBe(dog);
    });
    it("accepts a response only for a published plan owned by that guardian", async () => {
      const p = await plan();
      await expect(
        response(p.published_id!, randomUUID(), stranger),
      ).rejects.toThrow("Nie znaleziono planu");
      await expect(response(randomUUID())).rejects.toThrow(
        "Nie znaleziono planu",
      );
      await expect(
        response(p.published_id!, randomUUID(), admin),
      ).rejects.toThrow("Nie znaleziono planu");
      const id = await response(p.published_id!);
      const own = await asUser(owner, () =>
        db.query<{ dog_id: string; author_id: string; plan_id: string }>(
          "select dog_id,author_id,plan_id from public.care_progress where id=$1",
          [id],
        ),
      );
      expect(own.rows[0]).toEqual({
        dog_id: dog,
        author_id: owner,
        plan_id: p.published_id,
      });
      expect(
        (
          await asUser(stranger, () =>
            db.query("select * from public.care_progress"),
          )
        ).rows,
      ).toEqual([]);
    });
    it("retains the version a response was written against after a new publication", async () => {
      const first = await plan();
      await plan(1, true, "Druga wersja.");
      await response(first.published_id!);
      const rows = await db.query<{ revision: number }>(
        "select v.revision from public.care_progress r join public.care_plan_versions v on v.id=r.plan_id",
      );
      expect(rows.rows[0].revision).toBe(1);
    });
    it("deduplicates a retried response and rejects changing its content", async () => {
      const p = await plan(),
        id = randomUUID();
      await response(p.published_id!, id);
      await response(p.published_id!, id);
      expect(
        (await db.query("select * from public.care_progress")).rows,
      ).toHaveLength(1);
      expect(
        (
          await db.query(
            "select * from public.care_events where kind='progress_submitted'",
          )
        ).rows,
      ).toHaveLength(1);
      await expect(
        response(p.published_id!, id, owner, "Inna odpowiedź."),
      ).rejects.toThrow("już zapisana");
    });
    it("does not let another owner reuse a response identifier", async () => {
      const first = await plan(),
        second = await plan(0, true, "Plan obcego psa.", otherDog),
        id = randomUUID();
      await response(first.published_id!, id);
      await expect(
        response(second.published_id!, id, stranger),
      ).rejects.toThrow("już zapisana");
    });
    it("leaves responses unread on fetch and supports idempotent explicit review", async () => {
      const p = await plan(),
        id = await response(p.published_id!);
      const unread = await asUser(admin, () =>
        db.query<{ reviewed_at: string | null }>(
          "select reviewed_at from public.care_progress",
        ),
      );
      expect(unread.rows[0].reviewed_at).toBeNull();
      await asUser(admin, () =>
        db.query("select public.review_care_progress($1)", [id]),
      );
      const reviewed = await db.query<{
        reviewed_at: string;
        reviewed_by: string;
      }>("select reviewed_at,reviewed_by from public.care_progress");
      await asUser(admin, () =>
        db.query("select public.review_care_progress($1)", [id]),
      );
      expect(
        (
          await db.query(
            "select reviewed_at,reviewed_by from public.care_progress",
          )
        ).rows,
      ).toEqual(reviewed.rows);
      expect(reviewed.rows[0].reviewed_by).toBe(admin);
      expect(
        (
          await asUser(admin, () =>
            db.query<{ unread_count: number }>(
              "select unread_count from public.care_plan_summaries(0)",
            ),
          )
        ).rows[0].unread_count,
      ).toBe(0);
    });
    it("blocks stale library updates", async () => {
      const id = randomUUID();
      await asUser(admin, () =>
        db.query("select public.save_care_template($1,0,'Tytuł','Treść')", [
          id,
        ]),
      );
      await asUser(admin, () =>
        db.query(
          "select public.save_care_template($1,1,'Nowy tytuł','Nowa treść')",
          [id],
        ),
      );
      await expect(
        asUser(admin, () =>
          db.query(
            "select public.save_care_template($1,1,'Stary widok','Stara treść')",
            [id],
          ),
        ),
      ).rejects.toThrow("Materiał zmienił się");
    });
    it("acknowledges an exact normalized creation retry without changing its timestamp or audit", async () => {
      const id = randomUUID();
      await material(id);
      const first = await materialState(id);
      await material(
        id,
        0,
        "  Materiał testowy  ",
        "  Fikcyjna treść prywatnej biblioteki.  ",
      );
      expect(await materialState(id)).toEqual(first);
      expect(first[0]).toMatchObject({
        version: 1,
        updated_by: admin,
        audits: 1,
      });
    });
    it("acknowledges a committed edit retry without another version or audit", async () => {
      const id = randomUUID();
      await material(id);
      await material(id, 1, "Poprawiony materiał", "Nowa fikcyjna treść.");
      const edited = await materialState(id);
      await material(id, 1, " Poprawiony materiał ", " Nowa fikcyjna treść. ");
      expect(await materialState(id)).toEqual(edited);
      expect(edited[0]).toMatchObject({
        title: "Poprawiony materiał",
        body: "Nowa fikcyjna treść.",
        version: 2,
        audits: 2,
      });
    });
    it("rejects changed retries and a creation retry after another edit", async () => {
      const id = randomUUID();
      await material(id);
      await expect(material(id, 0, "Inny materiał")).rejects.toThrow(
        "Materiał zmienił się",
      );
      await expect(
        material(id, 0, undefined, "Inna fikcyjna treść."),
      ).rejects.toThrow("Materiał zmienił się");
      await material(id, 1, "Poprawiony materiał", "Nowa fikcyjna treść.");
      const edited = await materialState(id);
      await expect(material(id)).rejects.toThrow("Materiał zmienił się");
      await expect(
        material(id, 1, "Inny tytuł", "Nowa fikcyjna treść."),
      ).rejects.toThrow("Materiał zmienił się");
      await expect(
        material(id, 1, "Poprawiony materiał", "Treść ze starej karty."),
      ).rejects.toThrow("Materiał zmienił się");
      expect(await materialState(id)).toEqual(edited);
    });
    it("requires the original author for exact retries, while allowing a colleague to edit the current version", async () => {
      const id = randomUUID();
      await material(id);
      await expect(
        material(id, 0, undefined, undefined, colleague),
      ).rejects.toThrow("Materiał zmienił się");
      await material(
        id,
        1,
        "Materiał zespołu",
        "Fikcyjna poprawka koleżanki.",
        colleague,
      );
      const edited = await materialState(id);
      await expect(
        material(id, 1, "Materiał zespołu", "Fikcyjna poprawka koleżanki."),
      ).rejects.toThrow("Materiał zmienił się");
      await material(
        id,
        1,
        "Materiał zespołu",
        "Fikcyjna poprawka koleżanki.",
        colleague,
      );
      expect(await materialState(id)).toEqual(edited);
      expect(edited[0]).toMatchObject({
        updated_by: colleague,
        version: 2,
        audits: 2,
      });
    });
    it("rejects impossible versions before creation or edits", async () => {
      const id = randomUUID();
      for (const version of [-1, 2147483647]) {
        await expect(material(id, version)).rejects.toThrow(
          "Nieprawidłowa wersja materiału",
        );
      }
      expect(await materialState(id)).toEqual([]);
      await material(id);
      const first = await materialState(id);
      await expect(material(id, 2147483647)).rejects.toThrow(
        "Nieprawidłowa wersja materiału",
      );
      expect(await materialState(id)).toEqual(first);
    });
    it("rolls back material creation and edits if the audit cannot be saved", async () => {
      const existing = randomUUID(),
        created = randomUUID();
      await material(existing);
      const first = await materialState(existing);
      await db.exec(
        "alter table public.audit_events add constraint test_material_audit_failure check(event <> 'care_template_saved') not valid",
      );
      try {
        await expect(material(created)).rejects.toThrow(
          "test_material_audit_failure",
        );
        await expect(
          material(existing, 1, "Poprawiony materiał", "Nowa treść."),
        ).rejects.toThrow("test_material_audit_failure");
        expect(await materialState(created)).toEqual([]);
        expect(await materialState(existing)).toEqual(first);
      } finally {
        await db.exec(
          "alter table public.audit_events drop constraint test_material_audit_failure",
        );
      }
      await material(existing, 1, "Poprawiony materiał", "Nowa treść.");
      expect((await materialState(existing))[0]).toMatchObject({
        version: 2,
        audits: 2,
      });
    });
    it("keeps outbox identifiers inaccessible through the public user API", async () => {
      await plan();
      for (const user of [admin, owner, stranger]) {
        await expect(
          asUser(user, () => db.query("select * from public.care_events")),
        ).rejects.toThrow(/permission denied/);
      }
    });
    it("rolls back a publication if recording its event fails", async () => {
      await db.exec(
        "alter table public.care_events add constraint test_event_failure check(false) not valid",
      );
      try {
        await expect(plan()).rejects.toThrow(/test_event_failure/);
        expect(
          (await db.query("select * from public.care_drafts")).rows,
        ).toHaveLength(0);
        expect(
          (await db.query("select * from public.care_plan_versions")).rows,
        ).toHaveLength(0);
      } finally {
        await db.exec(
          "alter table public.care_events drop constraint test_event_failure",
        );
      }
    });
    it("explicitly prevents a second practice until tenant isolation is implemented", async () => {
      await expect(
        db.query(
          "insert into public.care_practices(id,name) values($1,'Druga praktyka')",
          [randomUUID()],
        ),
      ).rejects.toThrow(/unique constraint/);
    });
  },
);
