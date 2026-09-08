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
    create schema auth; create table auth.users(id uuid primary key,email text);
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
    await asUser(owner, () =>
      db.query(
        "delete from storage.objects where bucket_id='community-avatars' and name=$1",
        [photo],
      ),
    );
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
