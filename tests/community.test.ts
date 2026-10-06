import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

let db: PGlite;
const admin = "81000000-0000-4000-8000-000000000001";
const owner = "81000000-0000-4000-8000-000000000002";
const other = "81000000-0000-4000-8000-000000000003";
const observer = "81000000-0000-4000-8000-000000000004";
const publicPayload = () => ({
  display_name: "Publiczny Psiutek",
  area: "Okolica parku",
  headline: "Zawodowo tropię patyki",
  seeking: "Spokojnego kompana do spacerów",
  traits: ["Spokojny", "Ciekawski"],
  likes: "Węszenie",
  dislikes: "Pośpiech",
  avatar_path: null as string | null,
});

async function asUser<T>(id: string, run: () => Promise<T>) {
  await db.exec("begin; set local role authenticated");
  await db.query("select set_config('request.jwt.claim.sub',$1,true)", [id]);
  try {
    const value = await run();
    await db.exec("commit");
    return value;
  } catch (error) {
    await db.exec("rollback");
    throw error;
  }
}
const asAdmin = <T>(run: () => Promise<T>) => asUser(admin, run);

async function makeDog(guardian: string) {
  return (
    await db.query<{ id: string }>(
      "insert into public.dogs(guardian_id,name) values($1,'Imię z prywatnej kartoteki') returning id",
      [guardian],
    )
  ).rows[0].id;
}
async function version(dog: string) {
  return (
    (
      await db.query<{ version: string }>(
        "select updated_at::text as version from public.psiutki_profiles where dog_id=$1",
        [dog],
      )
    ).rows[0]?.version ?? null
  );
}
async function interestVersion(id: string) {
  return (
    await db.query<{ version: string }>(
      "select updated_at::text as version from public.psiutki_interests where id=$1",
      [id],
    )
  ).rows[0].version;
}
async function save(
  dog: string,
  guardian: string,
  values: Record<string, unknown> = publicPayload(),
  expected?: string | null,
) {
  const current = expected === undefined ? await version(dog) : expected;
  return asUser(guardian, () =>
    db.query("select public.save_community_profile($1,$2,$3,true)", [
      dog,
      current,
      values,
    ]),
  );
}
async function approve(dog: string) {
  const current = await version(dog);
  return asAdmin(() =>
    db.query(
      "select public.moderate_community_profile($1,$2,'approved','Opis zatwierdzony')",
      [dog, current],
    ),
  );
}
async function publicDog(guardian: string) {
  const dog = await makeDog(guardian);
  await save(dog, guardian);
  await approve(dog);
  return dog;
}
async function express(from: string, to: string, guardian: string) {
  return (
    await asUser(guardian, () =>
      db.query<{ id: string }>(
        "select public.express_community_interest($1,$2) as id",
        [from, to],
      ),
    )
  ).rows[0].id;
}
async function review(id: string, decision = "reviewed", expected?: string) {
  const current = expected ?? (await interestVersion(id));
  return asAdmin(() =>
    db.query(
      "select public.review_community_interest($1,$2,$3,'Ocena behawiorysty')",
      [id, current, decision],
    ),
  );
}
async function interestState(id: string) {
  return (
    await db.query<{
      status: string;
      confirmed_at: Date | null;
      review_note: string;
      rejection_active: boolean;
    }>(
      "select status,confirmed_at,review_note,rejection_active from public.psiutki_interests where id=$1",
      [id],
    )
  ).rows[0];
}

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated;
    create schema auth; create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,encrypted_password text);
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
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
  await db.query("insert into auth.users(id) values($1),($2),($3),($4)", [
    admin,
    owner,
    other,
    observer,
  ]);
  await db.query("update public.user_roles set role='admin' where user_id=$1", [
    admin,
  ]);
});
afterAll(async () => {
  await db?.close();
});

describe.sequential(
  "durable reservations for interrupted avatar uploads",
  () => {
    const key = (dog: string, guardian = owner) =>
      `${guardian}/${dog}/${crypto.randomUUID()}.webp`;
    const reserve = (
      dog: string,
      bucket: string,
      path: string,
      actor = owner,
    ) =>
      asUser(actor, () =>
        db.query<{ deadline: Date }>(
          "select public.reserve_avatar_upload($1,$2,$3) as deadline",
          [dog, bucket, path],
        ),
      );
    const leases = async (path: string) =>
      (
        await db.query<{
          dog_id: string | null;
          guardian_id: string | null;
          created_at: Date;
          expires_at: Date;
        }>("select * from public.avatar_uploads where object_path=$1", [path])
      ).rows;
    const expire = (paths: string[]) =>
      db.query(
        "update public.avatar_uploads set created_at=clock_timestamp()-interval '31 minutes',expires_at=clock_timestamp()-interval '1 minute' where object_path=any($1::text[])",
        [paths],
      );
    const insert = (bucket: string, path: string) =>
      asUser(owner, () =>
        db.query("insert into storage.objects(bucket_id,name) values($1,$2)", [
          bucket,
          path,
        ]),
      );

    it("records an owner reservation before bytes, keeps its original deadline and isolates reads", async () => {
      const dog = await makeDog(owner),
        path = key(dog);
      const first = (await reserve(dog, "dog-avatars", path)).rows[0].deadline;
      const second = (await reserve(dog, "dog-avatars", path)).rows[0].deadline;
      expect(second).toEqual(first);
      const row = (await leases(path))[0];
      expect(row).toMatchObject({
        dog_id: dog,
        guardian_id: owner,
        bucket_id: "dog-avatars",
      });
      expect(
        Number(row.expires_at) - Number(row.created_at),
      ).toBeGreaterThanOrEqual(30 * 60 * 1000 - 1);
      expect(
        (
          await asUser(other, () =>
            db.query(
              "select * from public.avatar_uploads where object_path=$1",
              [path],
            ),
          )
        ).rows,
      ).toEqual([]);
      expect(
        (
          await asAdmin(() =>
            db.query(
              "select * from public.avatar_uploads where object_path=$1",
              [path],
            ),
          )
        ).rows,
      ).toHaveLength(1);
      await expect(reserve(dog, "dog-avatars", path, other)).rejects.toThrow(
        "Brak dostępu",
      );
      await asUser(owner, () =>
        db.query("select public.retire_avatar_upload('dog-avatars',$1)", [
          path,
        ]),
      );
      expect(await leases(path)).toEqual([]);
    });

    it("allows staff private uploads but requires the actual owner for public photos and denies malformed paths", async () => {
      const dog = await makeDog(owner),
        path = key(dog);
      await reserve(dog, "dog-avatars", path, admin);
      await expect(
        reserve(dog, "community-avatars", key(dog), admin),
      ).rejects.toThrow("Brak dostępu");
      for (const bad of [
        `${other}/${dog}/photo.webp`,
        `${owner}/${dog}/..`,
        `${owner}/${dog}/nested/photo.webp`,
        `${owner}/missing/photo.webp`,
        `${owner}/${dog}/`,
      ])
        await expect(reserve(dog, "dog-avatars", bad)).rejects.toThrow(
          "Brak dostępu",
        );
      await expect(reserve(dog, "unknown", key(dog))).rejects.toThrow(
        "Brak dostępu",
      );
      await asAdmin(() =>
        db.query("select public.retire_avatar_upload('dog-avatars',$1)", [
          path,
        ]),
      );
    });

    it("refuses existing Storage objects and permanently retired keys", async () => {
      const dog = await makeDog(owner),
        existing = key(dog),
        retired = key(dog);
      await insert("dog-avatars", existing);
      await expect(reserve(dog, "dog-avatars", existing)).rejects.toThrow(
        "Wybierz nowy plik",
      );
      await asUser(owner, () =>
        db.query("select public.retire_avatar_upload('dog-avatars',$1)", [
          retired,
        ]),
      );
      await expect(reserve(dog, "dog-avatars", retired)).rejects.toThrow(
        "nie jest już dostępne",
      );
      expect(await leases(existing)).toEqual([]);
      expect(await leases(retired)).toEqual([]);
    });

    it("atomically closes reservations after private and public attachment without retiring the active keys", async () => {
      const dog = await publicDog(owner),
        privatePath = key(dog),
        publicPath = key(dog);
      await reserve(dog, "dog-avatars", privatePath);
      await insert("dog-avatars", privatePath);
      await asUser(owner, () =>
        db.query("select public.set_dog_avatar($1,null,$2)", [
          dog,
          privatePath,
        ]),
      );
      await reserve(dog, "community-avatars", publicPath);
      await insert("community-avatars", publicPath);
      await asUser(owner, async () =>
        db.query("select public.set_community_avatar($1,$2,$3)", [
          dog,
          await version(dog),
          publicPath,
        ]),
      );
      expect(await leases(privatePath)).toEqual([]);
      expect(await leases(publicPath)).toEqual([]);
      await db.query("select * from public.worker_avatar_cleanup(50)");
      expect(
        (
          await db.query(
            "select * from public.avatar_cleanup where object_path=any($1::text[])",
            [[privatePath, publicPath]],
          )
        ).rows,
      ).toEqual([]);
      expect(
        (
          await db.query(
            "select name from storage.objects where name=any($1::text[])",
            [[privatePath, publicPath]],
          )
        ).rows,
      ).toHaveLength(2);
    });

    it("blocks expired late uploads and attachments, then queues abandoned files with and without bytes", async () => {
      const dog = await publicDog(owner),
        absent = key(dog),
        uploaded = key(dog);
      await reserve(dog, "dog-avatars", absent);
      await reserve(dog, "community-avatars", uploaded);
      await insert("community-avatars", uploaded);
      await expire([absent, uploaded]);
      await expect(insert("dog-avatars", absent)).rejects.toThrow(
        "row-level security",
      );
      await expect(reserve(dog, "community-avatars", uploaded)).rejects.toThrow(
        "nie jest już dostępne",
      );
      await expect(
        asUser(owner, async () =>
          db.query("select public.set_community_avatar($1,$2,$3)", [
            dog,
            await version(dog),
            uploaded,
          ]),
        ),
      ).rejects.toThrow("nie jest już dostępne");
      const jobs = (
        await db.query<{ object_path: string }>(
          "select * from public.worker_avatar_cleanup(50)",
        )
      ).rows;
      expect(jobs.map((job) => job.object_path)).toEqual(
        expect.arrayContaining([absent, uploaded]),
      );
      expect(await leases(absent)).toEqual([]);
      expect(await leases(uploaded)).toEqual([]);
      await expect(insert("dog-avatars", absent)).rejects.toThrow(
        "row-level security",
      );
      await expect(
        asUser(owner, async () =>
          db.query("select public.set_community_avatar($1,$2,$3)", [
            dog,
            await version(dog),
            uploaded,
          ]),
        ),
      ).rejects.toThrow("nie jest już dostępne");
      expect(
        (
          await db.query(
            "select * from public.avatar_cleanup where object_path=any($1::text[])",
            [[absent, uploaded]],
          )
        ).rows,
      ).toHaveLength(2);
    });

    it("bounds expiry work and does not sweep unexpired reservations", async () => {
      const dog = await makeDog(owner),
        paths = [key(dog), key(dog), key(dog)],
        live = key(dog);
      for (const path of [...paths, live])
        await reserve(dog, "dog-avatars", path);
      await expire(paths);
      expect(
        (
          await db.query<{ retired: number }>(
            "select public.worker_retire_avatar_uploads(1) as retired",
          )
        ).rows[0].retired,
      ).toBe(1);
      expect(
        (
          await db.query(
            "select object_path from public.avatar_uploads where object_path=any($1::text[])",
            [paths],
          )
        ).rows,
      ).toHaveLength(2);
      expect(
        (
          await db.query<{ retired: number }>(
            "select public.worker_retire_avatar_uploads(50) as retired",
          )
        ).rows[0].retired,
      ).toBe(2);
      expect(await leases(live)).toHaveLength(1);
      await asUser(owner, () =>
        db.query("select public.retire_avatar_upload('dog-avatars',$1)", [
          live,
        ]),
      );
    });

    it("restores the reservation when the attachment transaction fails its audit", async () => {
      const dog = await makeDog(owner),
        path = key(dog);
      await reserve(dog, "dog-avatars", path);
      await insert("dog-avatars", path);
      await db.exec(
        "create function public.fail_reserved_avatar_audit() returns trigger language plpgsql as $$begin if new.event='dog_avatar_changed' then raise exception 'fixture audit failure'; end if; return new; end$$; create trigger fail_reserved_avatar_audit before insert on public.audit_events for each row execute function public.fail_reserved_avatar_audit();",
      );
      try {
        await expect(
          asUser(owner, () =>
            db.query("select public.set_dog_avatar($1,null,$2)", [dog, path]),
          ),
        ).rejects.toThrow("fixture audit failure");
        expect(await leases(path)).toHaveLength(1);
        expect(
          (
            await db.query<{ avatar_path: string | null }>(
              "select avatar_path from public.dogs where id=$1",
              [dog],
            )
          ).rows[0].avatar_path,
        ).toBeNull();
        expect(
          (
            await db.query(
              "select * from public.avatar_cleanup where object_path=$1",
              [path],
            )
          ).rows,
        ).toEqual([]);
      } finally {
        await db.exec(
          "drop trigger fail_reserved_avatar_audit on public.audit_events; drop function public.fail_reserved_avatar_audit();",
        );
      }
      await asUser(owner, () =>
        db.query("select public.retire_avatar_upload('dog-avatars',$1)", [
          path,
        ]),
      );
    });

    it("preserves cleanup responsibility when the dog and owner are removed", async () => {
      const guardian = crypto.randomUUID();
      await db.query("insert into auth.users(id) values($1)", [guardian]);
      const dog = await makeDog(guardian),
        path = key(dog, guardian);
      await reserve(dog, "dog-avatars", path, guardian);
      await db.query("delete from public.dogs where id=$1", [dog]);
      await db.query("delete from auth.users where id=$1", [guardian]);
      expect((await leases(path))[0]).toMatchObject({
        dog_id: null,
        guardian_id: null,
      });
      await expire([path]);
      await db.query("select public.worker_retire_avatar_uploads(50)");
      expect(await leases(path)).toEqual([]);
      expect(
        (
          await db.query(
            "select guardian_id from public.avatar_cleanup where object_path=$1",
            [path],
          )
        ).rows,
      ).toEqual([{ guardian_id: null }]);
    });

    it("keeps expiry controls and reservation writes inaccessible to ordinary accounts", async () => {
      await expect(
        asUser(owner, () =>
          db.query("select public.worker_retire_avatar_uploads(20)"),
        ),
      ).rejects.toThrow("permission denied");
      await expect(
        asUser(owner, () => db.query("delete from public.avatar_uploads")),
      ).rejects.toThrow("permission denied");
      await db.exec("begin; set local role anon");
      try {
        await expect(
          db.query(
            "select public.reserve_avatar_upload(null,'dog-avatars','anything')",
          ),
        ).rejects.toThrow("permission denied");
      } finally {
        await db.exec("rollback");
      }
    });
  },
);

describe.sequential("avatar attachment and retirement lifecycle", () => {
  it("rejects malformed abandoned-upload keys before they can poison the worker queue", async () => {
    const dog = await makeDog(owner);
    for (const path of [
      `${owner}/not-a-dog/photo.webp`,
      `${owner}/${dog}/..`,
      `${owner}/${dog}/sub/photo.webp`,
    ]) {
      await expect(
        asUser(owner, () =>
          db.query("select public.retire_avatar_upload('dog-avatars',$1)", [
            path,
          ]),
        ),
      ).rejects.toThrow("Brak dostępu");
      expect(
        (
          await db.query(
            "select object_path from public.avatar_cleanup where object_path=$1",
            [path],
          )
        ).rows,
      ).toEqual([]);
    }
  });
  async function object(dog: string, bucket = "dog-avatars") {
    const path = `${owner}/${dog}/${crypto.randomUUID()}.webp`;
    await asUser(owner, () =>
      db.query("insert into storage.objects(bucket_id,name) values($1,$2)", [
        bucket,
        path,
      ]),
    );
    return path;
  }
  const attach = (
    dog: string,
    expected: string | null,
    path: string | null,
    actor = owner,
  ) =>
    asUser(actor, () =>
      db.query("select public.set_dog_avatar($1,$2,$3)", [dog, expected, path]),
    );
  async function job(path: string) {
    return (
      await db.query<{
        attempts: number;
        completed_at: Date | null;
        guardian_id: string;
        delayed: boolean;
      }>(
        "select attempts,completed_at,guardian_id,next_attempt_at>clock_timestamp() as delayed from public.avatar_cleanup where object_path=$1",
        [path],
      )
    ).rows[0];
  }
  it("protects the active private file, retires only replaced files and rejects stale tabs", async () => {
    const dog = await makeDog(owner),
      first = await object(dog),
      second = await object(dog);
    await attach(dog, null, first);
    for (const actor of [owner, admin])
      expect(
        (
          await asUser(actor, () =>
            db.query(
              "delete from storage.objects where bucket_id='dog-avatars' and name=$1 returning name",
              [first],
            ),
          )
        ).rows,
      ).toEqual([]);
    expect(await job(first)).toBeUndefined();
    await attach(dog, first, second);
    expect(await job(first)).toMatchObject({
      guardian_id: owner,
      attempts: 0,
      completed_at: null,
    });
    await expect(attach(dog, first, null)).rejects.toThrow(
      "Zdjęcie psa zmieniło się",
    );
    expect(await job(second)).toBeUndefined();
    await attach(dog, second, null);
    expect(await job(second)).toBeDefined();
    await attach(dog, second, null); // Exact retry does not add audit or queue entries.
    expect(
      (
        await db.query(
          "select id from public.audit_events where entity_id=$1 and event='dog_avatar_changed'",
          [dog],
        )
      ).rows,
    ).toHaveLength(3);
  });
  it("rejects unavailable, foreign and wrong-dog references even through direct row updates", async () => {
    const dog = await makeDog(owner),
      otherDog = await makeDog(owner),
      path = await object(otherDog);
    await expect(attach(dog, null, path)).rejects.toThrow("profilu tego psa");
    await expect(
      attach(dog, null, `${owner}/${dog}/missing.webp`),
    ).rejects.toThrow("nie jest już dostępne");
    await expect(attach(dog, null, null, other)).rejects.toThrow(
      "Brak dostępu",
    );
    await expect(
      asUser(owner, () =>
        db.query("update public.dogs set avatar_path=$1 where id=$2", [
          path,
          dog,
        ]),
      ),
    ).rejects.toThrow("profilu tego psa");
  });
  it("keeps retired keys blocked after removal and confirms cleanup only after metadata is absent", async () => {
    const dog = await makeDog(owner),
      path = await object(dog);
    await attach(dog, null, path);
    await attach(dog, path, null);
    await expect(
      asUser(owner, () =>
        db.query(
          "select public.finish_avatar_cleanup('dog-avatars',$1,false)",
          [path],
        ),
      ),
    ).rejects.toThrow("nie zostało potwierdzone");
    await asUser(owner, () =>
      db.query("select public.finish_avatar_cleanup('dog-avatars',$1,true)", [
        path,
      ]),
    );
    expect(await job(path)).toMatchObject({
      attempts: 1,
      delayed: true,
      completed_at: null,
    });
    await expect(attach(dog, null, path)).rejects.toThrow(
      "nie jest już dostępne",
    );
    await asUser(owner, () =>
      db.query(
        "delete from storage.objects where bucket_id='dog-avatars' and name=$1",
        [path],
      ),
    );
    await asUser(owner, () =>
      db.query("select public.finish_avatar_cleanup('dog-avatars',$1,false)", [
        path,
      ]),
    );
    expect(await job(path)).toMatchObject({ attempts: 2 });
    expect((await job(path)).completed_at).not.toBeNull();
    await asUser(owner, () =>
      db.query("select public.finish_avatar_cleanup('dog-avatars',$1,true)", [
        path,
      ]),
    );
    expect((await job(path)).attempts).toBe(2);
    await expect(
      asUser(owner, () =>
        db.query(
          "insert into storage.objects(bucket_id,name) values('dog-avatars',$1)",
          [path],
        ),
      ),
    ).rejects.toThrow("row-level security");
  });
  it("does not erase an attached upload after a lost successful response and isolates cleanup records", async () => {
    const dog = await makeDog(owner),
      active = await object(dog),
      abandoned = await object(dog);
    await attach(dog, null, active);
    expect(
      (
        await asUser(owner, () =>
          db.query<{ retired: boolean }>(
            "select public.retire_avatar_upload('dog-avatars',$1) as retired",
            [active],
          ),
        )
      ).rows[0].retired,
    ).toBe(false);
    expect(await job(active)).toBeUndefined();
    await asUser(owner, () =>
      db.query("select public.retire_avatar_upload('dog-avatars',$1)", [
        abandoned,
      ]),
    );
    expect(
      (
        await asUser(other, () =>
          db.query("select * from public.avatar_cleanup where object_path=$1", [
            abandoned,
          ]),
        )
      ).rows,
    ).toEqual([]);
    await expect(
      asUser(other, () =>
        db.query("select public.finish_avatar_cleanup('dog-avatars',$1,true)", [
          abandoned,
        ]),
      ),
    ).rejects.toThrow("Brak dostępu");
    await expect(
      asUser(owner, () =>
        db.query("select * from public.worker_avatar_cleanup(20)"),
      ),
    ).rejects.toThrow("permission denied");
  });
  it("preserves public text and returns the exact photo revision, with fresh moderation required", async () => {
    const dog = await publicDog(owner),
      path = await object(dog, "community-avatars"),
      expected = await version(dog);
    const saved = await asUser(owner, () =>
      db.query<{ stamp: string }>(
        "select public.set_community_avatar($1,$2,$3)::text as stamp",
        [dog, expected, path],
      ),
    );
    expect(saved.rows[0].stamp).toBe(await version(dog));
    const profile = (
      await db.query(
        "select display_name,headline,avatar_path,published,moderation_status from public.psiutki_profiles where dog_id=$1",
        [dog],
      )
    ).rows[0];
    expect(profile).toMatchObject({
      display_name: publicPayload().display_name,
      headline: publicPayload().headline,
      avatar_path: path,
      published: false,
      moderation_status: "pending",
    });
    await expect(
      asUser(other, () =>
        db.query("select public.set_community_avatar($1,$2,null)", [
          dog,
          saved.rows[0].stamp,
        ]),
      ),
    ).rejects.toThrow("własnego psa");
    await save(dog, owner);
    expect(await job(path)).toBeDefined();
    await expect(
      asUser(owner, () =>
        db.query("select public.set_community_avatar($1,$2,$3)", [
          dog,
          saved.rows[0].stamp,
          path,
        ]),
      ),
    ).rejects.toThrow("zmienił się");
  });
  it("queues photo retirement when a private dog or a community profile is deleted", async () => {
    const dog = await makeDog(owner),
      privatePath = await object(dog),
      publicPath = await object(dog, "community-avatars");
    await attach(dog, null, privatePath);
    await save(dog, owner, { ...publicPayload(), avatar_path: publicPath });
    // Simulate authorized account cleanup; owners use hiding rather than DELETE.
    await db.query("delete from public.psiutki_profiles where dog_id=$1", [
      dog,
    ]);
    await db.query("delete from public.dogs where id=$1", [dog]);
    expect(await job(privatePath)).toBeDefined();
    expect(await job(publicPath)).toBeDefined();
  });
  it("rolls back attachment and retirement if its audit cannot be saved", async () => {
    const dog = await makeDog(owner),
      first = await object(dog),
      second = await object(dog);
    await attach(dog, null, first);
    await db.exec(
      "create function public.fail_avatar_audit() returns trigger language plpgsql as $$begin if new.event='dog_avatar_changed' then raise exception 'fixture audit failure'; end if; return new; end$$; create trigger fail_avatar_audit before insert on public.audit_events for each row execute function public.fail_avatar_audit();",
    );
    try {
      await expect(attach(dog, first, second)).rejects.toThrow(
        "fixture audit failure",
      );
      expect(
        (
          await db.query<{ avatar_path: string }>(
            "select avatar_path from public.dogs where id=$1",
            [dog],
          )
        ).rows[0].avatar_path,
      ).toBe(first);
      expect(await job(first)).toBeUndefined();
    } finally {
      await db.exec(
        "drop trigger fail_avatar_audit on public.audit_events; drop function public.fail_avatar_audit();",
      );
    }
  });
});

describe.sequential("consented, moderated public community profiles", () => {
  it("keeps profile versions strictly monotonic for writes in the same transaction", async () => {
    const dog = await makeDog(owner);
    const stale = await asUser(owner, async () => {
      await db.query("select public.save_community_profile($1,null,$2,true)", [
        dog,
        publicPayload(),
      ]);
      const initialVersion = await version(dog);
      await db.query("select public.save_community_profile($1,$2,$3,true)", [
        dog,
        initialVersion,
        { ...publicPayload(), headline: "Drugi zapis w tej samej transakcji" },
      ]);
      expect(
        (
          await db.query<{ advanced: boolean }>(
            "select updated_at > $2::timestamptz as advanced from public.psiutki_profiles where dog_id=$1",
            [dog, initialVersion],
          )
        ).rows[0].advanced,
      ).toBe(true);
      return initialVersion;
    });
    await expect(save(dog, owner, publicPayload(), stale)).rejects.toThrow(
      "zmienił się w międzyczasie",
    );
  });

  it("requires the actual owner and explicit consent and keeps submissions unpublished", async () => {
    const dog = await makeDog(owner);
    await expect(
      asUser(owner, () =>
        db.query("select public.save_community_profile($1,null,$2,false)", [
          dog,
          publicPayload(),
        ]),
      ),
    ).rejects.toThrow("Potwierdź zgodę");
    for (const unauthorized of [other, admin])
      await expect(save(dog, unauthorized)).rejects.toThrow(
        "wyłącznie własnego psa",
      );
    await save(dog, owner);
    expect(
      (
        await asUser(owner, () =>
          db.query(
            "select display_name,moderation_status,published from public.psiutki_profiles where dog_id=$1",
            [dog],
          ),
        )
      ).rows,
    ).toEqual([
      {
        display_name: "Publiczny Psiutek",
        moderation_status: "pending",
        published: false,
      },
    ]);
    expect(
      (
        await asUser(other, () =>
          db.query("select * from public.psiutki_profiles where dog_id=$1", [
            dog,
          ]),
        )
      ).rows,
    ).toHaveLength(0);
    expect(
      (
        await db.query(
          "select actor_id,details->>'publication_consent' as consent from public.audit_events where entity_id=$1 and event='community_profile_submitted'",
          [dog],
        )
      ).rows,
    ).toEqual([{ actor_id: owner, consent: "true" }]);
    await expect(
      asUser(owner, () =>
        db.query(
          "update public.psiutki_profiles set published=true where dog_id=$1",
          [dog],
        ),
      ),
    ).rejects.toThrow("permission denied");
  });

  it("accepts only bounded public fields, rejects private-data payload keys, and copies no private kartoteka data", async () => {
    const dog = await makeDog(owner);
    await db.query(
      "insert into public.dog_behavior_profiles(dog_id,medications,bite_history) values($1,'PRYWATNE LEKI','PRYWATNA HISTORIA')",
      [dog],
    );
    await expect(
      save(dog, owner, { ...publicPayload(), medications: "Nigdy publicznie" }),
    ).rejects.toThrow("wyłącznie publiczne pola");
    for (const changed of [
      { headline: "" },
      { seeking: "x" },
      { display_name: "x".repeat(81) },
      { area: "x".repeat(121) },
      { traits: Array(9).fill("Cecha") },
      { traits: ["x".repeat(41)] },
      { traits: [12] },
      { likes: "x".repeat(501) },
    ])
      await expect(
        save(dog, owner, { ...publicPayload(), ...changed }),
      ).rejects.toThrow("Sprawdź długość");
    await save(dog, owner);
    await approve(dog);
    const publicRows = (
      await asUser(observer, () =>
        db.query("select * from public.psiutki_profiles where dog_id=$1", [
          dog,
        ]),
      )
    ).rows;
    expect(publicRows).toHaveLength(1);
    expect(JSON.stringify(publicRows)).not.toContain("PRYWATNE");
    expect(JSON.stringify(publicRows)).not.toContain(
      "Imię z prywatnej kartoteki",
    );
    expect(Object.keys(publicRows[0] as object)).not.toContain("guardian_id");
  });

  it("keeps moderator notes and consent details readable only by the owner and admin", async () => {
    const dog = await publicDog(owner);
    expect(
      (
        await asUser(owner, () =>
          db.query(
            "select moderation_note,consented_by from public.psiutki_profile_reviews where dog_id=$1",
            [dog],
          ),
        )
      ).rows,
    ).toEqual([{ moderation_note: "Opis zatwierdzony", consented_by: owner }]);
    expect(
      (
        await asUser(observer, () =>
          db.query(
            "select * from public.psiutki_profile_reviews where dog_id=$1",
            [dog],
          ),
        )
      ).rows,
    ).toHaveLength(0);
    const current = await version(dog);
    await expect(
      asUser(owner, () =>
        db.query(
          "select public.moderate_community_profile($1,$2,'approved','Moja decyzja')",
          [dog, current],
        ),
      ),
    ).rejects.toThrow("Brak uprawnień");
    await expect(
      asUser(owner, () =>
        db.query("select public.invalidate_community_interests($1,true)", [
          dog,
        ]),
      ),
    ).rejects.toThrow("permission denied");
  });

  it("detects stale owner edits and stale moderation and hides every edited profile until reapproval", async () => {
    const dog = await publicDog(owner);
    const stale = await version(dog);
    await save(dog, owner, {
      ...publicPayload(),
      headline: "Nowa publiczna wersja",
    });
    await expect(save(dog, owner, publicPayload(), stale)).rejects.toThrow(
      "zmienił się w międzyczasie",
    );
    await expect(
      asAdmin(() =>
        db.query(
          "select public.moderate_community_profile($1,$2,'approved','Stara karta')",
          [dog, stale],
        ),
      ),
    ).rejects.toThrow("zmienił się w międzyczasie");
    expect(
      (
        await asUser(observer, () =>
          db.query(
            "select dog_id from public.psiutki_profiles where dog_id=$1",
            [dog],
          ),
        )
      ).rows,
    ).toHaveLength(0);
    await approve(dog);
    expect(
      (
        await asUser(observer, () =>
          db.query(
            "select headline from public.psiutki_profiles where dog_id=$1",
            [dog],
          ),
        )
      ).rows,
    ).toEqual([{ headline: "Nowa publiczna wersja" }]);
  });

  it("owner hiding withdraws consent immediately and cannot be reversed by stale or fresh moderation alone", async () => {
    const dog = await publicDog(owner);
    const stale = await version(dog);
    await expect(
      asUser(other, () =>
        db.query("select public.hide_community_profile($1)", [dog]),
      ),
    ).rejects.toThrow("Brak dostępu");
    await asUser(owner, () =>
      db.query("select public.hide_community_profile($1)", [dog]),
    );
    await asUser(owner, () =>
      db.query("select public.hide_community_profile($1)", [dog]),
    );
    expect(
      (
        await asUser(observer, () =>
          db.query(
            "select dog_id from public.psiutki_profiles where dog_id=$1",
            [dog],
          ),
        )
      ).rows,
    ).toHaveLength(0);
    await expect(
      asAdmin(() =>
        db.query(
          "select public.moderate_community_profile($1,$2,'approved','Przywróć')",
          [dog, stale],
        ),
      ),
    ).rejects.toThrow("zmienił się");
    await expect(approve(dog)).rejects.toThrow("ponownie wyrazić zgodę");
    expect(
      (
        await db.query(
          "select id from public.audit_events where event='community_profile_hidden' and entity_id=$1",
          [dog],
        )
      ).rows,
    ).toHaveLength(1);
    await save(dog, owner);
    await approve(dog);
    expect(
      (
        await asUser(observer, () =>
          db.query(
            "select dog_id from public.psiutki_profiles where dog_id=$1",
            [dog],
          ),
        )
      ).rows,
    ).toHaveLength(1);
  });
});

describe.sequential("mutual interest and safe moderation", () => {
  it("keeps both interest versions strictly monotonic for corrections in the same transaction", async () => {
    const a = await publicDog(owner),
      b = await publicDog(other);
    const ab = await express(a, b, owner),
      ba = await express(b, a, other);
    const stale = await asAdmin(async () => {
      await db.query(
        "select public.review_community_interest($1,$2,'reviewed','Pierwsza ocena')",
        [ab, await interestVersion(ab)],
      );
      const before = await interestVersion(ab);
      const reverseBefore = await interestVersion(ba);
      await db.query(
        "select public.review_community_interest($1,$2,'rejected','Korekta w tej samej transakcji')",
        [ab, before],
      );
      expect(
        (
          await db.query<{ advanced: boolean }>(
            "select updated_at > (case when id=$1 then $3::timestamptz else $4::timestamptz end) as advanced from public.psiutki_interests where id in ($1,$2)",
            [ab, ba, before, reverseBefore],
          )
        ).rows,
      ).toEqual([{ advanced: true }, { advanced: true }]);
      return before;
    });
    await expect(review(ab, "reviewed", stale)).rejects.toThrow(
      "zmieniło się w międzyczasie",
    );
  });

  it("requires two published profiles from different guardians and cannot impersonate another owner", async () => {
    const a = await publicDog(owner),
      b = await publicDog(other),
      ownOther = await publicDog(owner);
    await expect(express(a, b, other)).rejects.toThrow("Wybierz własnego psa");
    await expect(express(a, a, owner)).rejects.toThrow("dwa różne");
    await expect(express(a, ownOther, owner)).rejects.toThrow(
      "innego opiekuna",
    );
    await asUser(other, () =>
      db.query("select public.hide_community_profile($1)", [b]),
    );
    await expect(express(a, b, owner)).rejects.toThrow(
      "Oba profile muszą być opublikowane",
    );
  });

  it("deduplicates interest, matches reciprocal expressions, and exposes only one's own outgoing row", async () => {
    const a = await publicDog(owner),
      b = await publicDog(other);
    const ab = await express(a, b, owner);
    expect(await express(a, b, owner)).toBe(ab);
    expect((await interestState(ab)).status).toBe("open");
    await expect(review(ab)).rejects.toThrow("zainteresowanie obu opiekunów");
    const ba = await express(b, a, other);
    expect((await interestState(ab)).status).toBe("matched");
    expect((await interestState(ba)).status).toBe("matched");
    expect(
      (
        await asUser(owner, () =>
          db.query(
            "select id from public.psiutki_interests where id in ($1,$2)",
            [ab, ba],
          ),
        )
      ).rows,
    ).toEqual([{ id: ab }]);
    expect(
      (
        await asUser(observer, () =>
          db.query(
            "select id from public.psiutki_interests where id in ($1,$2)",
            [ab, ba],
          ),
        )
      ).rows,
    ).toHaveLength(0);
    expect(
      (
        await db.query(
          "select id from public.audit_events where event='community_interest_expressed' and entity_id=$1",
          [ab],
        )
      ).rows,
    ).toHaveLength(1);
  });

  it("reviews both sides symmetrically, rejects stale corrections, and keeps correction authority with the admin", async () => {
    const a = await publicDog(owner),
      b = await publicDog(other);
    const ab = await express(a, b, owner),
      ba = await express(b, a, other);
    const stale = await interestVersion(ab);
    await expect(
      asUser(owner, () =>
        db.query(
          "select public.review_community_interest($1,$2,'reviewed','Moja ocena')",
          [ab, stale],
        ),
      ),
    ).rejects.toThrow("Brak uprawnień");
    await review(ab);
    for (const id of [ab, ba])
      expect(await interestState(id)).toMatchObject({
        status: "reviewed",
        review_note: "Ocena behawiorysty",
        rejection_active: false,
      });
    await expect(review(ab, "rejected", stale)).rejects.toThrow(
      "zmieniło się w międzyczasie",
    );
    await review(ba, "rejected");
    for (const id of [ab, ba])
      expect(await interestState(id)).toMatchObject({
        status: "rejected",
        rejection_active: true,
      });
    await review(ab, "reviewed");
    for (const id of [ab, ba])
      expect(await interestState(id)).toMatchObject({
        status: "reviewed",
        rejection_active: false,
      });
  });

  it("withdraws interest without deleting history and requires a fresh mutual review after reactivation", async () => {
    const a = await publicDog(owner),
      b = await publicDog(other);
    const ab = await express(a, b, owner),
      ba = await express(b, a, other);
    await review(ab);
    await expect(
      asUser(other, () =>
        db.query("select public.withdraw_community_interest($1)", [ab]),
      ),
    ).rejects.toThrow("Brak dostępu");
    await asUser(owner, () =>
      db.query("select public.withdraw_community_interest($1)", [ab]),
    );
    await asUser(owner, () =>
      db.query("select public.withdraw_community_interest($1)", [ab]),
    );
    expect(await interestState(ab)).toMatchObject({
      status: "withdrawn",
      confirmed_at: null,
      review_note: "",
    });
    expect(await interestState(ba)).toMatchObject({
      status: "open",
      review_note: "",
    });
    await expect(review(ba)).rejects.toThrow("zainteresowanie obu opiekunów");
    expect(await express(a, b, owner)).toBe(ab);
    for (const id of [ab, ba])
      expect((await interestState(id)).status).toBe("matched");
    expect(
      (
        await db.query(
          "select id from public.audit_events where event='community_interest_withdrawn' and entity_id=$1",
          [ab],
        )
      ).rows,
    ).toHaveLength(1);
  });

  it("cannot bypass a rejected pair by withdrawing and expressing again", async () => {
    const a = await publicDog(owner),
      b = await publicDog(other);
    const ab = await express(a, b, owner),
      ba = await express(b, a, other);
    await review(ab, "rejected");
    expect(await express(a, b, owner)).toBe(ab);
    expect((await interestState(ab)).status).toBe("rejected");
    await asUser(owner, () =>
      db.query("select public.withdraw_community_interest($1)", [ab]),
    );
    await asUser(other, () =>
      db.query("select public.withdraw_community_interest($1)", [ba]),
    );
    await expect(express(a, b, owner)).rejects.toThrow("wymaga zmiany profilu");
    await save(a, owner, {
      ...publicPayload(),
      headline: "Zaktualizowany profil do nowej oceny",
    });
    await approve(a);
    expect(await express(a, b, owner)).toBe(ab);
    expect((await interestState(ab)).status).toBe("open");
    expect(await express(b, a, other)).toBe(ba);
    expect((await interestState(ab)).status).toBe("matched");
  });

  it("invalidates prior review after content edits and requires both owners to reconfirm the new public content", async () => {
    const a = await publicDog(owner),
      b = await publicDog(other);
    const ab = await express(a, b, owner),
      ba = await express(b, a, other);
    await review(ab);
    const stale = await interestVersion(ab);
    await save(a, owner, {
      ...publicPayload(),
      headline: "Zmieniony publiczny profil",
    });
    for (const id of [ab, ba])
      expect(await interestState(id)).toMatchObject({
        status: "open",
        confirmed_at: null,
        review_note: "",
      });
    await expect(review(ab, "reviewed", stale)).rejects.toThrow("zmieniło się");
    await expect(express(b, a, other)).rejects.toThrow(
      "Oba profile muszą być opublikowane",
    );
    await approve(a);
    await express(b, a, other);
    expect((await interestState(ba)).status).toBe("open");
    await expect(review(ba)).rejects.toThrow("zainteresowanie obu opiekunów");
    await express(a, b, owner);
    for (const id of [ab, ba])
      expect((await interestState(id)).status).toBe("matched");
    await review(ab);
  });

  it("hides profiles immediately and invalidates a previous review without exposing private fallback data", async () => {
    const a = await publicDog(owner),
      b = await publicDog(other);
    const ab = await express(a, b, owner),
      ba = await express(b, a, other);
    await review(ab);
    await asAdmin(() =>
      db.query("select public.hide_community_profile($1)", [b]),
    );
    for (const id of [ab, ba])
      expect(await interestState(id)).toMatchObject({
        status: "open",
        confirmed_at: null,
        review_note: "",
      });
    expect(
      (
        await asUser(owner, () =>
          db.query(
            "select display_name from public.psiutki_profiles where dog_id=$1",
            [b],
          ),
        )
      ).rows,
    ).toHaveLength(0);
    expect(
      (
        await asUser(owner, () =>
          db.query("select name from public.dogs where id=$1", [b]),
        )
      ).rows,
    ).toHaveLength(0);
    await expect(express(a, b, owner)).rejects.toThrow(
      "Oba profile muszą być opublikowane",
    );
  });
});

describe.sequential("separate, consented community photo storage", () => {
  it("cannot replace an approved photo without moderation by deleting and reusing its object key", async () => {
    const dog = await makeDog(owner);
    const photo = `${owner}/${dog}/approved.jpg`;
    await asUser(owner, () =>
      db.query(
        "insert into storage.objects(bucket_id,name) values('community-avatars',$1)",
        [photo],
      ),
    );
    await save(dog, owner, { ...publicPayload(), avatar_path: photo });
    await approve(dog);
    const removal = await asUser(owner, () =>
      db.query(
        "delete from storage.objects where bucket_id='community-avatars' and name=$1 returning name",
        [photo],
      ),
    );
    expect(removal.rows).toEqual([]);
    await expect(
      asUser(owner, () =>
        db.query(
          "insert into storage.objects(bucket_id,name) values('community-avatars',$1)",
          [photo],
        ),
      ),
    ).rejects.toThrow("row-level security");
    const replacement = `${owner}/${dog}/new.jpg`;
    await asUser(owner, () =>
      db.query(
        "insert into storage.objects(bucket_id,name) values('community-avatars',$1)",
        [replacement],
      ),
    );
    await save(dog, owner, { ...publicPayload(), avatar_path: replacement });
    expect(
      (
        await asUser(observer, () =>
          db.query("select name from storage.objects where name=$1", [
            replacement,
          ]),
        )
      ).rows,
    ).toHaveLength(0);
  });

  it("publishes only the exact approved community photo and never exposes private or abandoned uploads", async () => {
    const dog = await makeDog(owner);
    const photo = `${owner}/${dog}/public.jpg`,
      abandoned = `${owner}/${dog}/unused.jpg`;
    for (const name of [photo, abandoned])
      await asUser(owner, () =>
        db.query(
          "insert into storage.objects(bucket_id,name) values('community-avatars',$1)",
          [name],
        ),
      );
    await asUser(owner, () =>
      db.query(
        "insert into storage.objects(bucket_id,name) values('dog-avatars',$1)",
        [`${owner}/${dog}/private.jpg`],
      ),
    );
    await save(dog, owner, { ...publicPayload(), avatar_path: photo });
    expect(
      (
        await asUser(observer, () =>
          db.query("select name from storage.objects where name in ($1,$2)", [
            photo,
            abandoned,
          ]),
        )
      ).rows,
    ).toHaveLength(0);
    await approve(dog);
    expect(
      (
        await asUser(observer, () =>
          db.query(
            "select bucket_id,name from storage.objects where name like $1",
            [`${owner}/${dog}/%`],
          ),
        )
      ).rows,
    ).toEqual([{ bucket_id: "community-avatars", name: photo }]);
    await save(dog, owner, { ...publicPayload(), avatar_path: abandoned });
    expect(
      (
        await asUser(observer, () =>
          db.query("select name from storage.objects where name in ($1,$2)", [
            photo,
            abandoned,
          ]),
        )
      ).rows,
    ).toHaveLength(0);
    await approve(dog);
    expect(
      (
        await asUser(observer, () =>
          db.query("select name from storage.objects where name in ($1,$2)", [
            photo,
            abandoned,
          ]),
        )
      ).rows,
    ).toEqual([{ name: abandoned }]);
    await asUser(owner, () =>
      db.query("select public.hide_community_profile($1)", [dog]),
    );
    expect(
      (
        await asUser(observer, () =>
          db.query("select name from storage.objects where name in ($1,$2)", [
            photo,
            abandoned,
          ]),
        )
      ).rows,
    ).toHaveLength(0);
  });

  it("rejects forged, absent or private-only photo paths and does not let admins copy another guardian's upload path", async () => {
    const dog = await makeDog(owner),
      foreignDog = await makeDog(other);
    const privatePath = `${owner}/${dog}/private.jpg`;
    const foreignPath = `${other}/${foreignDog}/foreign.jpg`;
    await asUser(owner, () =>
      db.query(
        "insert into storage.objects(bucket_id,name) values('dog-avatars',$1)",
        [privatePath],
      ),
    );
    await asUser(other, () =>
      db.query(
        "insert into storage.objects(bucket_id,name) values('community-avatars',$1)",
        [foreignPath],
      ),
    );
    for (const avatar_path of [
      privatePath,
      foreignPath,
      `${owner}/${dog}/missing.jpg`,
      `${owner}/${dog}/../photo.jpg`,
    ]) {
      await expect(
        save(dog, owner, { ...publicPayload(), avatar_path }),
      ).rejects.toThrow("zdjęcie przesłane");
    }
    await expect(
      asAdmin(() =>
        db.query(
          "insert into storage.objects(bucket_id,name) values('community-avatars',$1)",
          [`${owner}/${dog}/admin-copy.jpg`],
        ),
      ),
    ).rejects.toThrow("row-level security");
    await expect(
      asUser(owner, () =>
        db.query(
          "delete from storage.objects where bucket_id='community-avatars' and name=$1 returning name",
          [foreignPath],
        ),
      ),
    ).resolves.toMatchObject({ rows: [] });
    expect(
      (
        await db.query(
          "select name from storage.objects where bucket_id='community-avatars' and name=$1",
          [foreignPath],
        )
      ).rows,
    ).toEqual([{ name: foreignPath }]);
    expect(
      (
        await db.query(
          "select public,file_size_limit from storage.buckets where id='community-avatars'",
        )
      ).rows,
    ).toEqual([{ public: false, file_size_limit: 1500000 }]);
  });
});
