import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

let db: PGlite;
const admin = "71000000-0000-4000-8000-000000000001";
const owner = "71000000-0000-4000-8000-000000000002";
const stranger = "71000000-0000-4000-8000-000000000003";

async function asUser<T>(id: string, run: () => Promise<T>) {
  await db.exec("begin; set local role authenticated");
  await db.query("select set_config('request.jwt.claim.sub',$1,true)", [id]);
  try {
    const result = await run();
    await db.exec("commit");
    return result;
  } catch (error) {
    await db.exec("rollback");
    throw error;
  }
}
const asAdmin = <T>(run: () => Promise<T>) => asUser(admin, run);

async function pair() {
  const ids = [randomUUID(), randomUUID()].sort();
  await db.query(
    "insert into public.dogs(id,guardian_id,name) values($1,$3,'Kluska'),($2,$3,'Figo')",
    [...ids, owner],
  );
  return ids;
}

async function save(
  dogA: string | null,
  dogB: string | null,
  level: string | null = "caution",
  note: string | null = "Potrzebują większego dystansu.",
  lastMet: string | null = null,
  expected: string | null = null,
  actor = admin,
) {
  const { rows } = await asUser(actor, () =>
    db.query<{ id: string }>(
      "select public.save_dog_relation($1,$2,$3,$4,$5::timestamptz,$6::timestamptz) as id",
      [dogA, dogB, level, note, lastMet, expected],
    ),
  );
  return rows[0].id;
}

async function relation(id: string) {
  const { rows } = await db.query<{
    id: string;
    dog_a: string;
    dog_b: string;
    level: string;
    note: string;
    last_met_at: string | null;
    author_id: string;
    updated_at: string;
  }>(
    "select id,dog_a,dog_b,level,note,last_met_at::text,author_id,updated_at::text from public.dog_relations where id=$1",
    [id],
  );
  return rows[0];
}

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated;
    create schema auth; create table auth.users(id uuid primary key,email text);
    create function auth.uid() returns uuid language sql stable as
      $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    grant usage on schema public,auth to anon,authenticated;
    grant execute on function auth.uid() to anon,authenticated;
    create schema storage;
    create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
    create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text);
    alter table storage.objects enable row level security;
    create function storage.foldername(name text) returns text[] language sql as $$select string_to_array(name,'/')$$;
    grant usage on schema storage to authenticated;
    grant select,insert,delete on storage.objects to authenticated;
  `);
  for (const migration of readdirSync("supabase/migrations")
    .filter((file) => file.endsWith(".sql"))
    .sort()) {
    await db.exec(readFileSync(`supabase/migrations/${migration}`, "utf8"));
  }
  await db.query("insert into auth.users(id) values($1),($2),($3)", [
    admin,
    owner,
    stranger,
  ]);
  await db.query("update public.user_roles set role='admin' where user_id=$1", [
    admin,
  ]);
});
afterAll(async () => {
  await db?.close();
});

describe.sequential("private audited dog relations", () => {
  it("canonicalizes a reversed pair and records the author and complete initial assessment", async () => {
    const [dogA, dogB] = await pair();
    const id = await save(
      dogB,
      dogA,
      "caution",
      "  Potrzebują dystansu.  ",
      "2026-01-02T10:00:00Z",
    );
    expect(await relation(id)).toMatchObject({
      dog_a: dogA,
      dog_b: dogB,
      level: "caution",
      note: "Potrzebują dystansu.",
      author_id: admin,
    });
    const { rows } = await asAdmin(() =>
      db.query<{
        actor_id: string;
        details: {
          from: null;
          to: { note: string; level: string; last_met_at: string };
          dog_a: string;
          dog_b: string;
        };
      }>(
        "select actor_id,details from public.audit_events where event='dog_relation_saved' and entity_id=$1",
        [id],
      ),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      actor_id: admin,
      details: {
        from: null,
        dog_a: dogA,
        dog_b: dogB,
        to: {
          note: "Potrzebują dystansu.",
          level: "caution",
        },
      },
    });
    expect(Date.parse(rows[0].details.to.last_met_at)).toBe(
      Date.parse("2026-01-02T10:00:00Z"),
    );
  });

  it("will not overwrite an existing pair from a new form with dogs in either order", async () => {
    const [dogA, dogB] = await pair();
    const id = await save(dogA, dogB);
    const before = await relation(id);
    for (const [first, second] of [
      [dogA, dogB],
      [dogB, dogA],
    ]) {
      await expect(save(first, second, "good", "Nowa ocena")).rejects.toThrow(
        "Ocena relacji już istnieje lub zmieniła się.",
      );
    }
    expect(await relation(id)).toEqual(before);
    const { rows } = await db.query(
      "select id from public.dog_relations where dog_a=$1 and dog_b=$2",
      [dogA, dogB],
    );
    expect(rows).toHaveLength(1);
  });

  it("updates with the current version, preserves the previous assessment in audit, and rejects a stale edit", async () => {
    const [dogA, dogB] = await pair();
    const id = await save(
      dogA,
      dogB,
      "block",
      "Nie łączyć bez ponownej oceny.",
      "2026-01-02T10:00:00Z",
    );
    const before = await relation(id);
    expect(
      await save(
        dogB,
        dogA,
        "possible_duet",
        "Udane spotkanie po konsultacji.",
        null,
        before.updated_at,
      ),
    ).toBe(id);
    const after = await relation(id);
    expect(after).toMatchObject({
      level: "possible_duet",
      last_met_at: null,
      author_id: admin,
    });
    expect(after.updated_at).not.toBe(before.updated_at);
    await expect(
      save(dogA, dogB, "good", "Stary formularz", null, before.updated_at),
    ).rejects.toThrow("Ocena relacji już istnieje lub zmieniła się.");
    expect(await relation(id)).toEqual(after);
    const { rows } = await db.query<{
      details: {
        from: { level: string; note: string };
        to: { level: string; note: string };
      };
    }>(
      "select details from public.audit_events where event='dog_relation_saved' and entity_id=$1 order by created_at,id",
      [id],
    );
    expect(rows).toHaveLength(2);
    expect(rows[1].details).toMatchObject({
      from: { level: "block", note: "Nie łączyć bez ponownej oceny." },
      to: { level: "possible_duet", note: "Udane spotkanie po konsultacji." },
    });
  });

  it("requires real distinct dogs and does not create a missing pair from an edit form", async () => {
    const [dogA, dogB] = await pair();
    await expect(save(dogA, dogA)).rejects.toThrow("Wybierz dwa różne psy.");
    await expect(save(null, dogB)).rejects.toThrow("Wybierz dwa różne psy.");
    await expect(save(dogA, randomUUID())).rejects.toThrow(
      "Nie znaleziono wybranych psów.",
    );
    await expect(
      save(
        dogA,
        dogB,
        "good",
        "Poprawna notatka",
        null,
        "2026-01-01T10:00:00Z",
      ),
    ).rejects.toThrow("Ocena relacji już istnieje lub zmieniła się.");
    expect(
      (
        await db.query("select id from public.dog_relations where dog_a=$1", [
          dogA,
        ])
      ).rows,
    ).toHaveLength(0);
  });

  it("validates every explicit assessment, its note, and the last meeting date", async () => {
    const [dogA, dogB] = await pair();
    for (const level of [null, "invalid"])
      await expect(save(dogA, dogB, level)).rejects.toThrow(
        "Wybierz poprawną ocenę relacji.",
      );
    for (const note of [null, "  ", "ab", "x".repeat(2001)])
      await expect(save(dogA, dogB, "unknown", note)).rejects.toThrow(
        "Podaj prywatną notatkę",
      );
    for (const date of ["2099-01-01T00:00:00Z", "infinity", "-infinity"])
      await expect(save(dogA, dogB, "good", "Notatka", date)).rejects.toThrow(
        "Ostatnie spotkanie nie może być w przyszłości.",
      );
    let expected: string | null = null;
    for (const level of [
      "unknown",
      "good",
      "neutral",
      "caution",
      "block",
      "possible_duet",
    ]) {
      const id = await save(
        dogA,
        dogB,
        level,
        "Kolejna świadoma ocena.",
        null,
        expected,
      );
      const saved = await relation(id);
      expect(saved.level).toBe(level);
      expected = saved.updated_at;
    }
  });

  it("keeps relation rows and private audit out of owner and stranger access", async () => {
    const [dogA, dogB] = await pair();
    const id = await save(dogA, dogB, "block", "WYŁĄCZNIE DLA BEHAWIORYSTY");
    for (const actor of [owner, stranger]) {
      expect(
        (
          await asUser(actor, () =>
            db.query("select * from public.dog_relations where id=$1", [id]),
          )
        ).rows,
      ).toEqual([]);
      expect(
        (
          await asUser(actor, () =>
            db.query("select * from public.audit_events where entity_id=$1", [
              id,
            ]),
          )
        ).rows,
      ).toEqual([]);
      await expect(
        save(dogA, dogB, "good", "Próba klienta", null, null, actor),
      ).rejects.toThrow("Brak uprawnień.");
      await expect(
        asUser(actor, () =>
          db.query(
            "update public.dog_relations set note='Zmiana klienta' where id=$1",
            [id],
          ),
        ),
      ).rejects.toThrow(/permission denied/i);
      await expect(
        asUser(actor, () =>
          db.query(
            "insert into public.dog_relations(dog_a,dog_b,level,note,author_id) values($1,$2,'good','Próba klienta',$3)",
            [dogA, dogB, actor],
          ),
        ),
      ).rejects.toThrow(/permission denied/i);
    }
    expect(
      (
        await asAdmin(() =>
          db.query("select id from public.dog_relations where id=$1", [id]),
        )
      ).rows,
    ).toHaveLength(1);
  });

  it("does not grant anonymous users relation reads or the mutation RPC", async () => {
    const { rows } = await db.query<{ can_read: boolean; can_write: boolean }>(
      "select has_table_privilege('anon','public.dog_relations','select') as can_read,has_function_privilege('anon','public.save_dog_relation(uuid,uuid,text,text,timestamptz,timestamptz)','execute') as can_write",
    );
    expect(rows[0]).toEqual({ can_read: false, can_write: false });
  });
});
