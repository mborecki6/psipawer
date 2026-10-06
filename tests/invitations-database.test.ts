import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { beforeAll, beforeEach, afterAll, describe, it, expect } from "vitest";
let db: PGlite;
const admin = "16000000-0000-4000-8000-000000000001";
const owner = "16000000-0000-4000-8000-000000000002";
const invited = "16000000-0000-4000-8000-000000000003";
async function asRole<T>(
  role: string,
  id: string | null,
  fn: () => Promise<T>,
) {
  await db.exec(`begin; set local role ${role}`);
  if (id)
    await db.query("select set_config('request.jwt.claim.sub',$1,true)", [id]);
  try {
    const r = await fn();
    await db.exec("commit");
    return r;
  } catch (e) {
    await db.exec("rollback");
    throw e;
  }
}
const asUser = <T>(id: string, fn: () => Promise<T>) =>
  asRole("authenticated", id, fn);
beforeAll(async () => {
  db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create role service_role; create schema auth;
    create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,encrypted_password text);
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    grant usage on schema public,auth to anon,authenticated,service_role; grant execute on function auth.uid() to anon,authenticated;
    create schema storage; create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
    create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text);
    alter table storage.objects enable row level security;
    create function storage.foldername(name text) returns text[] language sql as $$select string_to_array(name,'/')$$;
    grant usage on schema storage to authenticated; grant select,insert,delete on storage.objects to authenticated;`);
  for (const name of readdirSync("supabase/migrations")
    .filter((n) => n.endsWith(".sql"))
    .sort())
    await db.exec(readFileSync(`supabase/migrations/${name}`, "utf8"));
  await db.query(
    "insert into auth.users(id,email) values($1,'staff@example.test'),($2,'owner@example.test')",
    [admin, owner],
  );
  await db.query("update public.user_roles set role='admin' where user_id=$1", [
    admin,
  ]);
});
beforeEach(async () => {
  await db.exec(
    "truncate public.client_invitations,public.invitation_attempts,public.audit_events; update auth.users set email_confirmed_at=null,encrypted_password=null;",
  );
  await db.query("delete from auth.users where id=$1", [invited]);
});
afterAll(async () => {
  await db?.close();
});
const prepare = async (
  email = "new@example.test",
  id = randomUUID(),
  name = "Nowy Opiekun",
) => {
  await asUser(admin, () =>
    db.query("select public.prepare_client_invitation($1,$2,$3)", [
      id,
      email,
      name,
    ]),
  );
  return id;
};
const claim = async (id: string, version = 1, attempt = randomUUID()) => {
  const r = await asUser(admin, () =>
    db.query<{ email: string }>(
      "select public.claim_client_invitation($1,$2,$3) email",
      [id, version, attempt],
    ),
  );
  return { attempt, email: r.rows[0].email };
};
const finish = async (
  id: string,
  attempt: string,
  outcome = "sent",
  code: string | null = null,
) =>
  (
    await asRole("service_role", null, () =>
      db.query<{ value: boolean }>(
        "select public.finish_client_invitation($1,$2,$3,$4) value",
        [id, attempt, outcome, code],
      ),
    )
  ).rows[0].value;
const feed = async (offset = 0, archived = false, search = "") =>
  (
    await asUser(admin, () =>
      db.query<{
        id: string;
        account_stage: string;
        can_send: boolean;
        delivery_status: string;
        version: number;
        archived_at: string | null;
        can_archive: boolean;
      }>("select * from public.client_invitation_feed($1,$2,$3)", [
        offset,
        archived,
        search,
      ]),
    )
  ).rows;
const archive = async (id: string, version: number, value = true) =>
  (
    await asUser(admin, () =>
      db.query<{ version: number }>(
        "select public.set_client_invitation_archived($1,$2,$3) version",
        [id, version, value],
      ),
    )
  ).rows[0].version;
const history = async (id: string, offset = 0) =>
  (
    await asUser(admin, () =>
      db.query<{
        id: string;
        outcome: string;
        error_code: string | null;
        finished_at: string | null;
        author_name: string;
      }>("select * from public.client_invitation_attempt_feed($1,$2)", [
        id,
        offset,
      ]),
    )
  ).rows;

describe.sequential("explicit client invitation lifecycle", () => {
  it("archives and restores only the draft, with versioned idempotency and no delivery or Auth changes", async () => {
    const id = await prepare();
    expect((await feed())[0]).toMatchObject({
      can_archive: true,
      archived_at: null,
    });
    expect(await archive(id, 1)).toBe(2);
    expect(await archive(id, 1)).toBe(2);
    expect(await feed()).toEqual([]);
    expect(await feed(0, true)).toMatchObject([
      { id, can_send: false, can_archive: false, version: 2 },
    ]);
    expect((await feed(0, true))[0].archived_at).toBeTruthy();
    await expect(claim(id, 2)).rejects.toThrow("w archiwum");
    await expect(prepare()).rejects.toThrow("w archiwum");
    await expect(prepare("new@example.test", id)).rejects.toThrow("w archiwum");
    expect(await archive(id, 2, false)).toBe(3);
    expect(await archive(id, 2, false)).toBe(3);
    expect(await feed()).toMatchObject([
      { id, can_send: true, can_archive: true, archived_at: null, version: 3 },
    ]);
    expect(await feed(0, true)).toEqual([]);
    await expect(archive(id, 1)).rejects.toThrow("zmieniło się");
    expect((await db.query("select id from auth.users")).rows).toHaveLength(2);
    expect(await history(id)).toEqual([]);
    expect(
      (
        await db.query(
          "select event from public.audit_events where entity_id=$1 order by created_at,id",
          [id],
        )
      ).rows
        .map((row) => (row as { event: string }).event)
        .sort(),
    ).toEqual([
      "client_invitation_archived",
      "client_invitation_prepared",
      "client_invitation_restored",
    ]);
  });
  it("refuses archival after any attempt, including failed and uncertain results", async () => {
    for (const result of ["sending", "failed", "uncertain", "sent"]) {
      const id = await prepare(`${result}@example.test`);
      const c = await claim(id);
      if (result !== "sending")
        await finish(
          id,
          c.attempt,
          result,
          result === "sent" ? null : "unknown_result",
        );
      const current = (await feed()).find((row) => row.id === id)!;
      expect(current.can_archive).toBe(false);
      await expect(archive(id, current.version)).rejects.toThrow(
        "wysyłka jeszcze się nie rozpoczęła",
      );
    }
  });
  it("keeps search literal, case-insensitive, bounded and separate for active and archived entries", async () => {
    const id = await prepare(
      "special@example.test",
      randomUUID(),
      "Anna 100%_Test",
    );
    const second = await prepare(
      "other@example.test",
      randomUUID(),
      "ANNA Druga",
    );
    expect((await feed(0, false, "anna")).map((row) => row.id).sort()).toEqual(
      [id, second].sort(),
    );
    expect((await feed(0, false, "%_")).map((row) => row.id)).toEqual([id]);
    expect(
      (await feed(0, false, " SPECIAL@EXAMPLE.TEST ")).map((row) => row.id),
    ).toEqual([id]);
    await archive(id, 1);
    expect(await feed(0, false, "%_")).toEqual([]);
    expect((await feed(0, true, "%_")).map((row) => row.id)).toEqual([id]);
    await expect(feed(0, true, "a".repeat(255))).rejects.toThrow(
      "Sprawdź stronę",
    );
  });
  it("requires staff and rolls archival back if its audit cannot be recorded", async () => {
    const id = await prepare();
    await expect(
      asUser(owner, () =>
        db.query("select public.set_client_invitation_archived($1,1,true)", [
          id,
        ]),
      ),
    ).rejects.toThrow("Brak uprawnień");
    await expect(
      asRole("anon", null, () =>
        db.query("select public.set_client_invitation_archived($1,1,true)", [
          id,
        ]),
      ),
    ).rejects.toThrow("permission denied");
    await expect(archive(id, 0)).rejects.toThrow("Odśwież");
    await db.exec(
      "alter table public.audit_events add constraint archive_test_failure check(event<>'client_invitation_archived')",
    );
    try {
      await expect(archive(id, 1)).rejects.toThrow("archive_test_failure");
      expect(await feed()).toMatchObject([
        { id, version: 1, archived_at: null, can_send: true },
      ]);
    } finally {
      await db.exec(
        "alter table public.audit_events drop constraint archive_test_failure",
      );
    }
  });
  it("normalizes email, prepares without creating Auth accounts or sending, and retries creation once", async () => {
    const id = await prepare(" NEW@Example.Test ");
    await prepare("new@example.test", id);
    expect(await feed()).toMatchObject([
      {
        id,
        account_stage: "not_activated",
        delivery_status: "draft",
        can_send: true,
      },
    ]);
    expect((await db.query("select id from auth.users")).rows).toHaveLength(2);
    expect(
      (await db.query("select id from public.invitation_attempts")).rows,
    ).toHaveLength(0);
    expect(
      (await db.query("select id from public.audit_events")).rows,
    ).toHaveLength(1);
  });
  it("rejects duplicate addresses, changed retries, malformed input and existing active/staff accounts", async () => {
    const id = await prepare();
    await expect(prepare("NEW@example.test")).rejects.toThrow(
      "jest już na liście",
    );
    await expect(prepare("different@example.test", id)).rejects.toThrow(
      "formularz został już zapisany",
    );
    await expect(prepare("invalid")).rejects.toThrow("Sprawdź nazwę");
    await expect(prepare("staff@example.test")).rejects.toThrow(
      "aktywne konto",
    );
    await db.query(
      "update auth.users set email_confirmed_at=now() where id=$1",
      [owner],
    );
    await expect(prepare("owner@example.test")).rejects.toThrow(
      "aktywne konto",
    );
  });
  it("claims only one sender/version and applies a cooldown even after a result", async () => {
    const id = await prepare();
    const c = await claim(id);
    expect(c.email).toBe("new@example.test");
    await expect(claim(id)).rejects.toThrow("Odśwież zaproszenie");
    await expect(claim(id, 2)).rejects.toThrow("dwie minuty");
    expect(await finish(id, c.attempt)).toBe(true);
    expect(await finish(id, c.attempt)).toBe(true);
    expect((await feed())[0]).toMatchObject({
      delivery_status: "sent",
      account_stage: "not_activated",
      version: 3,
      can_send: false,
    });
    await expect(claim(id, 3)).rejects.toThrow("dwie minuty");
    expect(
      (await db.query("select * from public.invitation_attempts")).rows,
    ).toHaveLength(1);
  });
  it("exposes a lost response as uncertain without mutating during a read and fences out a late result", async () => {
    const id = await prepare();
    const first = await claim(id);
    await db.query(
      "update public.client_invitations set last_attempt_at=now()-interval '3 minutes' where id=$1",
      [id],
    );
    expect((await feed())[0]).toMatchObject({
      delivery_status: "uncertain",
      can_send: true,
    });
    expect(
      (
        await db.query<{ outcome: string }>(
          "select outcome from public.invitation_attempts",
        )
      ).rows[0].outcome,
    ).toBe("sending");
    const second = await claim(id, 2);
    expect(await finish(id, first.attempt)).toBe(false);
    expect(await finish(id, second.attempt, "failed", "rate_limited")).toBe(
      true,
    );
    expect(
      (
        await db.query<{ outcome: string }>(
          "select outcome from public.invitation_attempts order by started_at",
        )
      ).rows.map((r) => r.outcome),
    ).toEqual(["uncertain", "failed"]);
  });
  it("tracks confirmation, password and profile separately, never exposing hashes", async () => {
    const id = await prepare();
    await db.query(
      "insert into auth.users(id,email) values($1,'new@example.test')",
      [invited],
    );
    expect(
      (
        await db.query<{ full_name: string }>(
          "select full_name from public.profiles where id=$1",
          [invited],
        )
      ).rows[0].full_name,
    ).toBe("Nowy Opiekun");
    expect((await feed())[0].account_stage).toBe("not_activated");
    await db.query(
      "update auth.users set email_confirmed_at=now() where id=$1",
      [invited],
    );
    expect((await feed())[0]).toMatchObject({
      account_stage: "password_required",
      can_send: false,
    });
    await expect(claim(id)).rejects.toThrow("już aktywowane");
    await db.query(
      "update auth.users set encrypted_password='PRIVATE_HASH' where id=$1",
      [invited],
    );
    expect((await feed())[0].account_stage).toBe("profile_required");
    await db.query(
      "update public.profiles set full_name='Opiekun',phone='000 000 000',area='Test' where id=$1",
      [invited],
    );
    expect((await feed())[0].account_stage).toBe("ready");
    expect(JSON.stringify(await feed())).not.toContain("PRIVATE_HASH");
    expect(
      (
        await db.query<{ role: string }>(
          "select role from public.user_roles where user_id=$1",
          [invited],
        )
      ).rows[0].role,
    ).toBe("client");
  });
  it("does not mistake Auth's temporary invite password for a password chosen by the guardian", async () => {
    await prepare();
    await db.query(
      "insert into auth.users(id,email) values($1,'new@example.test')",
      [invited],
    );
    // Auth creates its temporary password before its separate confirmation update.
    await db.query(
      "update auth.users set encrypted_password='TEMPORARY_PRIVATE_HASH' where id=$1",
      [invited],
    );
    await db.query(
      "update auth.users set email_confirmed_at=now() where id=$1",
      [invited],
    );
    expect((await feed())[0].account_stage).toBe("password_required");
    await db.query(
      "update public.profiles set full_name='Test',phone='000',area='Test' where id=$1",
      [invited],
    );
    expect((await feed())[0].account_stage).toBe("password_required");
    await db.query(
      "update auth.users set encrypted_password='PERSONAL_PRIVATE_HASH' where id=$1",
      [invited],
    );
    expect((await feed())[0].account_stage).toBe("ready");
    expect(JSON.stringify(await feed())).not.toContain("PRIVATE_HASH");
    for (const user of [admin, owner])
      await expect(
        asUser(user, () =>
          db.exec("update public.client_invitations set password_set_at=now()"),
        ),
      ).rejects.toThrow("permission denied");
  });
  it("does not invent password evidence for legacy accounts and recognizes their next password change", async () => {
    const id = await prepare();
    await db.query(
      "insert into auth.users(id,email,email_confirmed_at,encrypted_password) values($1,'new@example.test',now(),'EXISTING_HASH')",
      [invited],
    );
    await db.query(
      "update public.client_invitations set password_setup_tracked=false where id=$1",
      [id],
    );
    expect((await feed())[0].account_stage).toBe("password_unverified");
    await db.query(
      "update auth.users set encrypted_password='NEW_HASH' where id=$1",
      [invited],
    );
    expect((await feed())[0].account_stage).toBe("profile_required");
  });
  it("requires staff at read/write boundaries and a service identity for provider acknowledgments", async () => {
    const id = await prepare();
    const c = await claim(id);
    expect(
      (
        await asUser(owner, () =>
          db.query("select * from public.client_invitations"),
        )
      ).rows,
    ).toHaveLength(0);
    expect(
      (
        await asUser(owner, () =>
          db.query("select * from public.invitation_attempts"),
        )
      ).rows,
    ).toHaveLength(0);
    for (const sql of [
      "select * from public.client_invitation_feed()",
      `select public.prepare_client_invitation('${randomUUID()}','x@example.test','Test')`,
      `select public.claim_client_invitation('${id}',2,'${randomUUID()}')`,
    ])
      await expect(asUser(owner, () => db.exec(sql))).rejects.toThrow(
        "Brak uprawnień",
      );
    for (const who of [admin, owner])
      for (const sql of [
        "select * from public.client_invitation_rows()",
        "update public.client_invitations set delivery_status='sent'",
        `select public.finish_client_invitation('${id}','${c.attempt}','sent',null)`,
      ])
        await expect(asUser(who, () => db.exec(sql))).rejects.toThrow(
          "permission denied",
        );
    await expect(
      asRole("anon", null, () =>
        db.exec("select * from public.client_invitation_feed()"),
      ),
    ).rejects.toThrow("permission denied");
  });
  it("validates safe result codes, cannot overwrite a finished outcome and records uncertain errors without raw text", async () => {
    const id = await prepare();
    const c = await claim(id);
    await expect(
      finish(id, c.attempt, "failed", "PRIVATE SMTP PASSWORD"),
    ).rejects.toThrow("Nieprawidłowy wynik");
    expect(await finish(id, c.attempt, "uncertain", "unknown_result")).toBe(
      true,
    );
    expect(await finish(id, c.attempt, "sent")).toBe(false);
    expect((await feed())[0].delivery_status).toBe("uncertain");
  });
  it("pages at most 21 safe rows from a larger list", async () => {
    await db.query(
      "insert into public.client_invitations(id,email,display_name,created_by) select gen_random_uuid(),'local-'||n||'@example.test','Opiekun '||n,$1 from generate_series(1,1005) n",
      [admin],
    );
    const first = await feed();
    const second = await feed(20);
    expect(first).toHaveLength(21);
    expect(second).toHaveLength(21);
    expect(first[20].id).toBe(second[0].id);
    expect(await feed(1000)).toHaveLength(5);
    await expect(feed(-1)).rejects.toThrow("Sprawdź stronę");
  });
  it("bounds and isolates history, including tied timestamps, with no account secrets", async () => {
    const id = await prepare();
    const other = await prepare("other@example.test");
    await claim(other);
    await db.query(
      `insert into public.invitation_attempts(id,invitation_id,author_id,started_at,outcome,finished_at)
      select gen_random_uuid(),$1,$2,now(),'sent',now() from generate_series(1,45)`,
      [id, admin],
    );
    const first = await history(id);
    const second = await history(id, 20);
    expect(first).toHaveLength(21);
    expect(first[20].id).toBe(second[0].id);
    expect(
      new Set(
        [
          ...first.slice(0, 20),
          ...second.slice(0, 20),
          ...(await history(id, 40)),
        ].map((a) => a.id),
      ).size,
    ).toBe(45);
    expect(await history(other)).toHaveLength(1);
    expect(Object.keys(first[0]).sort()).toEqual(
      [
        "id",
        "started_at",
        "finished_at",
        "outcome",
        "error_code",
        "author_name",
      ].sort(),
    );
    expect(first[0].author_name).toBeTruthy();
    await expect(history(id, -1)).rejects.toThrow("Sprawdź stronę historii");
    expect(await history(randomUUID())).toEqual([]);
  });
  it("projects stale attempts as uncertain without changing stored history and preserves late acknowledgments", async () => {
    const id = await prepare();
    const c = await claim(id);
    await db.query(
      "update public.invitation_attempts set started_at=now()-interval '3 minutes' where id=$1",
      [c.attempt],
    );
    expect(await history(id)).toMatchObject([
      { outcome: "uncertain", error_code: "unknown_result", finished_at: null },
    ]);
    expect(
      (
        await db.query(
          "select outcome from public.invitation_attempts where id=$1",
          [c.attempt],
        )
      ).rows,
    ).toEqual([{ outcome: "sending" }]);
    expect(await finish(id, c.attempt)).toBe(true);
    expect(await history(id)).toMatchObject([
      { outcome: "sent", error_code: null },
    ]);
  });
  it("authorizes detail and history independently, returning only the safe account projection", async () => {
    const id = await prepare();
    await db.query(
      "insert into auth.users(id,email,encrypted_password) values($1,'new@example.test','PRIVATE_HASH')",
      [invited],
    );
    const sql = [
      "select * from public.client_invitation_detail($1)",
      "select * from public.client_invitation_attempt_feed($1)",
    ];
    for (const query of sql) {
      await expect(asUser(owner, () => db.query(query, [id]))).rejects.toThrow(
        "Brak uprawnień",
      );
      await expect(
        asRole("anon", null, () => db.query(query, [id])),
      ).rejects.toThrow("permission denied");
    }
    const detail = (
      await asUser(admin, () => db.query<Record<string, unknown>>(sql[0], [id]))
    ).rows;
    expect(detail).toMatchObject([
      { id, account_stage: "not_activated", email: "new@example.test" },
    ]);
    expect(JSON.stringify(detail)).not.toContain("PRIVATE_HASH");
    expect(Object.keys(detail[0]).sort()).toEqual(
      Object.keys((await feed())[0]).sort(),
    );
    expect(
      (await asUser(admin, () => db.query(sql[0], [randomUUID()]))).rows,
    ).toEqual([]);
  });
});
