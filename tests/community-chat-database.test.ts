import { configureCalendarPrimary } from "./helpers/calendar-primary.mjs";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { beforeAll, afterAll, describe, expect, it } from "vitest";
let db: PGlite;
const a = "86000000-0000-4000-8000-000000000001",
  b = "86000000-0000-4000-8000-000000000002",
  outsider = "86000000-0000-4000-8000-000000000003",
  admin = "86000000-0000-4000-8000-000000000004";
async function asUser<T>(id: string, run: () => Promise<T>) {
  await db.exec("begin; set local role authenticated");
  await db.query(
    "select set_config('request.jwt.claim.sub',$1,true),set_config('request.jwt.claims',$2,true)",
    [id, JSON.stringify({ session_id: id })],
  );
  try {
    const result = await run();
    await db.exec("commit");
    return result;
  } catch (error) {
    await db.exec("rollback");
    throw error;
  }
}
async function state(id: string, user = a) {
  return (
    await asUser(user, () =>
      db.query<{ value: { state: string; canStart: boolean } }>(
        "select public.community_chat_state($1) value",
        [id],
      ),
    )
  ).rows[0].value;
}
async function pair() {
  const dogA = randomUUID(),
    dogB = randomUUID();
  await db.query(
    "insert into public.dogs(id,guardian_id,name) values($1,$2,'Pies A'),($3,$4,'Pies B')",
    [dogA, a, dogB, b],
  );
  await db.query(
    "insert into public.psiutki_profiles(dog_id,display_name,published,moderation_status) values($1,'Psiutek A',true,'approved'),($2,'Psiutek B',true,'approved')",
    [dogA, dogB],
  );
  await db.query(
    "insert into public.psiutki_profile_reviews(dog_id,consented_at,consented_by) values($1,clock_timestamp(),$2),($3,clock_timestamp(),$4)",
    [dogA, a, dogB, b],
  );
  await asUser(a, () =>
    db.query("select public.express_community_interest($1,$2)", [dogA, dogB]),
  );
  await asUser(b, () =>
    db.query("select public.express_community_interest($1,$2)", [dogB, dogA]),
  );
  const join = async (user = a) =>
    (
      await asUser(user, () =>
        db.query<{ id: string }>(
          "select public.join_community_chat($1,$2,true) id",
          user === a ? [dogA, dogB] : [dogB, dogA],
        ),
      )
    ).rows[0].id;
  return { dogA, dogB, join };
}
async function send(
  id: string,
  user = a,
  body = "Fikcyjna prywatna wiadomość",
  request = randomUUID(),
) {
  return (
    await asUser(user, () =>
      db.query<{ id: string }>(
        "select public.send_community_chat_message($1,$2,$3) id",
        [id, request, body],
      ),
    )
  ).rows[0].id;
}
async function page(id: string, user = a, before: string | null = null) {
  return (
    await asUser(user, () =>
      db.query<{ id: string; body: string; own: boolean }>(
        "select * from public.community_chat_messages_page($1,$2)",
        [id, before],
      ),
    )
  ).rows;
}
beforeAll(async () => {
  db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create role service_role; create schema auth;
    create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,encrypted_password text);
    create table auth.sessions(id uuid primary key,user_id uuid,not_after timestamptz);
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    grant usage on schema public,auth to anon,authenticated,service_role; grant execute on function auth.uid() to anon,authenticated;
    create schema storage; create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
    create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text);
    alter table storage.objects enable row level security;
    create function storage.foldername(name text) returns text[] language sql as $$select string_to_array(name,'/')$$;
    grant usage on schema storage to authenticated; grant select,insert,delete on storage.objects to authenticated;`);
  for (const file of readdirSync("supabase/migrations")
    .filter((file) => file.endsWith(".sql"))
    .sort())
    await db.exec(readFileSync(`supabase/migrations/${file}`, "utf8"));
  await db.query("insert into auth.users(id) values($1),($2),($3),($4)", [
    a,
    b,
    outsider,
    admin,
  ]);
  await db.query("update public.user_roles set role='admin' where user_id=$1", [
    admin,
  ]);
  await configureCalendarPrimary(db, admin);
  await db.query(
    "insert into auth.sessions(id,user_id) values($1,$1),($2,$2)",
    [a, b],
  );
});
afterAll(async () => {
  await db?.close();
});
describe.sequential("private opt-in community chat", () => {
  it("does not activate historic matches and requires both explicit consents", async () => {
    const f = await pair();
    expect(
      (
        await db.query(
          "select id from public.community_chats where dog_a in($1,$2)",
          [f.dogA, f.dogB],
        )
      ).rows,
    ).toHaveLength(0);
    const id = await f.join();
    expect((await state(id)).state).toBe("waiting_other");
    expect((await state(id, b)).state).toBe("waiting_me");
    await expect(send(id)).rejects.toThrow(/Zgoda|dostęp/);
    await expect(page(id)).rejects.toThrow("niedostępna");
    expect(await f.join(b)).toBe(id);
    expect(await f.join()).toBe(id);
    expect((await state(id)).state).toBe("active");
  });
  it("isolates messages from a third guardian and all nonparticipant staff", async () => {
    const f = await pair();
    const id = await f.join();
    await f.join(b);
    await send(id);
    for (const user of [outsider, admin]) {
      expect((await state(id, user)).state).toBe("unavailable");
      expect(
        (
          await asUser(user, () =>
            db.query(
              "select id from public.community_chat_messages where chat_id=$1",
              [id],
            ),
          )
        ).rows,
      ).toEqual([]);
      await expect(page(id, user)).rejects.toThrow("niedostępna");
      await expect(send(id, user)).rejects.toThrow("niedostępna");
    }
    expect((await page(id, b))[0]).toMatchObject({
      body: "Fikcyjna prywatna wiadomość",
      own: false,
    });
  });
  it("idempotently sends a submitted message and coalesces unread notices", async () => {
    const f = await pair();
    const id = await f.join();
    await f.join(b);
    const request = randomUUID();
    const message = await send(id, a, "Pierwsza treść", request);
    expect(await send(id, a, "Pierwsza treść", request)).toBe(message);
    await expect(send(id, a, "Zmieniona treść", request)).rejects.toThrow(
      "inną treść",
    );
    await send(id, a, "Druga wiadomość");
    const notices = async () =>
      (
        await db.query<{ chat_id: string; recipient_id: string }>(
          "select chat_id,recipient_id from public.notifications where entity_id=$1",
          [id],
        )
      ).rows;
    expect(await notices()).toEqual([{ chat_id: id, recipient_id: b }]);
    expect(await page(id, b)).toHaveLength(2);
    await send(id, a, "Po przeczytaniu");
    expect(await notices()).toHaveLength(2);
    await expect(send(id, a, " ")).rejects.toThrow("2000");
    await expect(send(id, a, "x".repeat(2001))).rejects.toThrow("2000");
  });
  it("paginates by a stable cursor and cannot use another conversation's cursor", async () => {
    const f = await pair();
    const id = await f.join();
    await f.join(b);
    await db.query(
      "insert into public.community_chat_messages(chat_id,sender_id,request_id,body,created_at) select $1,$2,gen_random_uuid(),'Wiadomość '||n,clock_timestamp()-interval '2 minutes'-make_interval(secs=>n) from generate_series(1,36) n",
      [id, a],
    );
    const first = await page(id, b);
    expect(first).toHaveLength(31);
    const next = await page(id, b, first[29].id);
    expect(next).toHaveLength(6);
    expect(
      new Set([...first.slice(0, 30), ...next].map((m) => m.id)).size,
    ).toBe(36);
    const otherPair = await pair();
    const otherChat = await otherPair.join();
    await otherPair.join(b);
    const foreign = await send(otherChat);
    await expect(page(id, b, foreign)).rejects.toThrow("najnowszych");
  });
  it("withdrawal removes both history and sending, and requires a new conversation and new consents", async () => {
    const f = await pair();
    const id = await f.join();
    await f.join(b);
    const message = await send(id);
    await asUser(a, () =>
      db.query("select public.change_community_chat($1,'withdraw')", [id]),
    );
    for (const user of [a, b]) {
      await expect(page(id, user, message)).rejects.toThrow("niedostępna");
      await expect(send(id, user)).rejects.toThrow(/Zgoda|dostęp/);
    }
    const next = await f.join();
    expect(next).not.toBe(id);
    expect((await state(next)).state).toBe("waiting_other");
    await f.join(b);
    expect(await page(next)).toEqual([]);
  });
  it("hiding then republishing a profile never revives the previous chat consent", async () => {
    const f = await pair();
    const id = await f.join();
    await f.join(b);
    await send(id);
    await asUser(a, () =>
      db.query("select public.hide_community_profile($1)", [f.dogA]),
    );
    expect((await state(id)).state).toBe("access_lost");
    await db.query(
      "update public.psiutki_profiles set published=true,moderation_status='approved' where dog_id=$1",
      [f.dogA],
    );
    await db.query(
      "update public.psiutki_profile_reviews set consented_at=clock_timestamp(),consented_by=$1 where dog_id=$2",
      [a, f.dogA],
    );
    await asUser(a, () =>
      db.query("select public.express_community_interest($1,$2)", [
        f.dogA,
        f.dogB,
      ]),
    );
    await asUser(b, () =>
      db.query("select public.express_community_interest($1,$2)", [
        f.dogB,
        f.dogA,
      ]),
    );
    expect((await state(id)).state).toBe("access_lost");
    await expect(page(id)).rejects.toThrow("niedostępna");
    expect(await f.join()).not.toBe(id);
  });
  it("withdrawing interest closes history and queued push despite continued dog ownership", async () => {
    const f = await pair();
    const id = await f.join();
    await f.join(b);
    await asUser(b, () =>
      db.query("select public.save_push_subscription($1,$2,$3)", [
        `https://fcm.googleapis.com/fcm/send/${randomUUID()}`,
        "B".repeat(87),
        "a".repeat(22),
      ]),
    );
    await send(id);
    const notice = (
      await db.query<{ id: string }>(
        "select id from public.notifications where chat_id=$1",
        [id],
      )
    ).rows[0].id;
    const claimed = (
      await db.query<{
        id: string;
        claim_token: string;
        notification_id: string;
      }>("select * from public.worker_claim_push_deliveries(20)")
    ).rows.find((job) => job.notification_id === notice)!;
    expect(claimed).toBeTruthy();
    await db.query(
      "select public.worker_finish_push_delivery($1,$2,'retry',503)",
      [claimed.id, claimed.claim_token],
    );
    await asUser(a, () =>
      db.query(
        "select public.withdraw_community_interest((select id from public.psiutki_interests where from_dog_id=$1 and to_dog_id=$2))",
        [f.dogA, f.dogB],
      ),
    );
    expect((await state(id)).state).toBe("access_lost");
    await expect(send(id)).rejects.toThrow(/Zgoda|dostęp/);
    expect(
      (
        await asUser(b, () =>
          db.query("select id from public.notifications where id=$1", [notice]),
        )
      ).rows,
    ).toEqual([]);
    await expect(
      asUser(b, () =>
        db.query("select public.read_notifications(array[$1::uuid])", [notice]),
      ),
    ).rejects.toThrow("Nie znaleziono");
    await db.query("select * from public.worker_claim_push_deliveries(20)");
    expect(
      (
        await db.query<{ status: string }>(
          "select status from public.push_deliveries where id=$1",
          [claimed.id],
        )
      ).rows[0].status,
    ).toBe("cancelled");
  });
  it("never transfers old history to a new guardian", async () => {
    const f = await pair();
    const id = await f.join();
    await f.join(b);
    await send(id);
    await db.query("update public.dogs set guardian_id=$1 where id=$2", [
      outsider,
      f.dogA,
    ]);
    for (const user of [a, b, outsider])
      await expect(page(id, user)).rejects.toThrow("niedostępna");
    expect((await state(id, outsider)).state).toBe("unavailable");
  });
  it("blocks restarting a pair until the blocking participant unblocks, then starts empty", async () => {
    const f = await pair();
    const id = await f.join();
    await f.join(b);
    await send(id);
    await asUser(a, () =>
      db.query("select public.change_community_chat($1,'block')", [id]),
    );
    await expect(f.join(b)).rejects.toThrow("zablokowana");
    await expect(
      asUser(b, () =>
        db.query("select public.change_community_chat($1,'unblock')", [id]),
      ),
    ).rejects.toThrow("własną");
    await asUser(a, () =>
      db.query("select public.change_community_chat($1,'unblock')", [id]),
    );
    const next = await f.join();
    await f.join(b);
    expect(next).not.toBe(id);
    expect(await page(next)).toEqual([]);
  });
});
