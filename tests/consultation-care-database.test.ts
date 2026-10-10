import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { beforeAll, beforeEach, afterAll, describe, expect, it } from "vitest";

let db: PGlite;
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
  await db.query("insert into auth.users(id) values($1),($2),($3)", [
    admin,
    owner,
    stranger,
  ]);
  await db.query("update public.user_roles set role='admin' where user_id=$1", [
    admin,
  ]);
  await db.query(
    "insert into public.dogs(id,guardian_id,name) values($1,$2,'Kluska'),($3,$4,'Borys')",
    [dog, owner, otherDog, stranger],
  );
});

beforeEach(async () => {
  await db.exec(
    "truncate public.consultations,public.care_drafts,public.care_plan_versions,public.care_events,public.care_progress,public.care_follow_ups,public.care_follow_up_history cascade; delete from public.notifications; delete from public.audit_events;",
  );
});
afterAll(async () => {
  await db?.close();
});
const meeting = "80000000-0000-4000-8000-000000000001";
const another = "80000000-0000-4000-8000-000000000002";
async function consultation(
  status = "completed",
  id = meeting,
  dogId = dog,
  hoursAgo = 48,
) {
  await db.query(
    `insert into public.consultations(id,practice_id,dog_id,requested_by,topic,status,starts_at,duration_minutes,meeting_mode,location)
    values($1,'00000000-0000-4000-8000-000000000001',$2,$3,'Spotkanie testowe',$4,now()-$5::integer*interval '1 hour',60,'in_person','Miejsce testowe')`,
    [id, dogId, owner, status, hoursAgo],
  );
}
async function save(
  version = 0,
  publish = true,
  association: string | null = meeting,
  dogId = dog,
  user = admin,
) {
  const result = await asUser(user, () =>
    db.query<{ result: { version: number; published_id: string } }>(
      "select public.save_care_plan($1,$2,'Plan po spotkaniu','Treść fikcyjnego planu',null,$3,$4) result",
      [dogId, version, publish, association],
    ),
  );
  return result.rows[0].result;
}

describe("consultation → private draft → publication", () => {
  it("requires completion before publishing, while allowing advance drafting", async () => {
    await consultation("scheduled");
    await save(0, false);
    expect(
      (await db.query("select consultation_id,version from public.care_drafts"))
        .rows,
    ).toEqual([{ consultation_id: meeting, version: 1 }]);
    await expect(save(1)).rejects.toThrow(
      "Najpierw oznacz konsultację jako zakończoną",
    );
    expect(
      (await db.query("select * from public.care_plan_versions")).rows,
    ).toHaveLength(0);
    await asUser(admin, () =>
      db.query(
        "select public.change_consultation($1,1,'complete',null,null,null,null,'')",
        [meeting],
      ),
    );
    expect(
      (await db.query("select * from public.care_plan_versions")).rows,
    ).toHaveLength(0);
    const published = await save(1);
    expect(
      (
        await db.query(
          "select consultation_id from public.care_plan_versions where id=$1",
          [published.published_id],
        )
      ).rows,
    ).toEqual([{ consultation_id: meeting }]);
    expect(
      (
        await db.query(
          "select * from public.care_events where kind='plan_published'",
        )
      ).rows,
    ).toHaveLength(1);
  });
  it("keeps a linked draft invisible to the guardian until explicit publication", async () => {
    await consultation();
    await save(0, false);
    expect(
      (await asUser(owner, () => db.query("select * from public.care_drafts")))
        .rows,
    ).toHaveLength(0);
    expect(
      (
        await asUser(owner, () =>
          db.query("select * from public.care_plan_versions"),
        )
      ).rows,
    ).toHaveLength(0);
    await save(1);
    expect(
      (
        await asUser(owner, () =>
          db.query("select consultation_id from public.care_plan_versions"),
        )
      ).rows,
    ).toEqual([{ consultation_id: meeting }]);
    expect(
      (
        await asUser(stranger, () =>
          db.query("select * from public.care_plan_versions"),
        )
      ).rows,
    ).toHaveLength(0);
  });
  it.each(["requested", "cancelled"])(
    "rejects association with %s consultations without changing the draft",
    async (status) => {
      await consultation(status);
      await expect(save(0, false)).rejects.toThrow(
        "Wybierz umówioną lub zakończoną",
      );
      await expect(save()).rejects.toThrow("Wybierz umówioną lub zakończoną");
      expect(
        (await db.query("select * from public.care_drafts")).rows,
      ).toHaveLength(0);
    },
  );
  it("cannot attach another dog's meeting or invent an association", async () => {
    await consultation();
    await expect(save(0, true, meeting, otherDog)).rejects.toThrow(
      "Wybierz konsultację tego psa",
    );
    await expect(save(0, true, randomUUID())).rejects.toThrow(
      "Wybierz konsultację tego psa",
    );
    await expect(save(0, true, meeting, dog, owner)).rejects.toThrow(
      "Brak uprawnień",
    );
    await expect(
      db.query(
        `insert into public.care_drafts(dog_id,practice_id,title,body,version,updated_by,consultation_id)
      values($1,'00000000-0000-4000-8000-000000000001','Plan','Treść',1,$2,$3)`,
        [otherDog, admin, meeting],
      ),
    ).rejects.toThrow(/foreign key/);
  });
  it("retains every published association when the draft moves to a subsequent meeting", async () => {
    await consultation();
    await consultation("completed", another, dog, 24);
    await save();
    await save(1, true, another);
    await save(2, true, null);
    expect(
      (
        await db.query(
          "select consultation_id from public.care_plan_versions order by revision",
        )
      ).rows,
    ).toEqual([
      { consultation_id: meeting },
      { consultation_id: another },
      { consultation_id: null },
    ]);
    await expect(
      asUser(admin, () =>
        db.query("update public.care_plan_versions set consultation_id=null"),
      ),
    ).rejects.toThrow(/permission denied/);
  });
  it("recognizes a retry only when text AND the consultation match", async () => {
    await consultation();
    await consultation("completed", another, dog, 24);
    const first = await save();
    expect(await save()).toEqual(first);
    await expect(save(0, true, another)).rejects.toThrow("Plan zmienił się");
    await expect(save(0, true, null)).rejects.toThrow("Plan zmienił się");
    expect(
      (
        await db.query(
          "select * from public.care_events where kind='plan_published'",
        )
      ).rows,
    ).toHaveLength(1);
  });
  it("allows unlinking a cancelled meeting while preserving the private draft's content", async () => {
    await consultation("scheduled");
    await save(0, false);
    await asUser(admin, () =>
      db.query(
        "select public.change_consultation($1,1,'cancel',null,null,null,null,'Odwołane testowo')",
        [meeting],
      ),
    );
    await expect(save(1)).rejects.toThrow("Wybierz umówioną lub zakończoną");
    await save(1, true, null);
    expect(
      (
        await db.query(
          "select consultation_id,body from public.care_plan_versions",
        )
      ).rows,
    ).toEqual([{ consultation_id: null, body: "Treść fikcyjnego planu" }]);
  });
  it("removes the former guardian's access to the meeting and publication after ownership changes", async () => {
    await consultation();
    await save();
    await db.query("update public.dogs set guardian_id=$1 where id=$2", [
      stranger,
      dog,
    ]);
    try {
      expect(
        (
          await asUser(owner, () =>
            db.query("select * from public.care_plan_versions"),
          )
        ).rows,
      ).toHaveLength(0);
      expect(
        (
          await asUser(owner, () =>
            db.query("select * from public.consultations"),
          )
        ).rows,
      ).toHaveLength(0);
      expect(
        (
          await asUser(stranger, () =>
            db.query("select * from public.care_plan_versions"),
          )
        ).rows,
      ).toHaveLength(1);
    } finally {
      await db.query("update public.dogs set guardian_id=$1 where id=$2", [
        owner,
        dog,
      ]);
    }
  });
  it("rolls the association and publication back together if event insertion fails", async () => {
    await consultation();
    await db.exec(`create function public.fail_linked_plan_event() returns trigger language plpgsql as $$begin raise exception 'forced test failure'; end$$;
      create trigger fail_linked_event before insert on public.care_events for each row execute function public.fail_linked_plan_event();`);
    try {
      await expect(save()).rejects.toThrow("forced test failure");
      expect(
        (await db.query("select * from public.care_drafts")).rows,
      ).toHaveLength(0);
      expect(
        (await db.query("select * from public.care_plan_versions")).rows,
      ).toHaveLength(0);
    } finally {
      await db.exec(
        "drop trigger fail_linked_event on public.care_events; drop function public.fail_linked_plan_event();",
      );
    }
  });
});
