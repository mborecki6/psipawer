import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

let db: PGlite;
const owner = "81000000-0000-4000-8000-000000000001";
const other = "81000000-0000-4000-8000-000000000002";
const admin = "81000000-0000-4000-8000-000000000003";
const unknown = "81000000-0000-4000-8000-000000000004";
const existing = "82000000-0000-4000-8000-000000000001";
const payload = {
  name: "Figa",
  breed: "Mieszaniec",
  approximate_age: "3 lata",
  sex: "female",
  weight_kg: 12.5,
  color: "Ruda",
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
async function create(
  request: string | null,
  data: unknown = payload,
  actor = owner,
) {
  return (
    await asUser(actor, () =>
      db.query<{ id: string }>(
        "select public.create_dog_profile($1,$2::jsonb) id",
        [request, JSON.stringify(data)],
      ),
    )
  ).rows[0].id;
}
async function createdDogs() {
  return (
    await db.query<{
      id: string;
      guardian_id: string;
      name: string;
      status: string;
    }>("select id,guardian_id,name,status from public.dogs where id<>$1", [
      existing,
    ])
  ).rows;
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
  await db.query("insert into auth.users(id) values($1),($2),($3)", [
    owner,
    other,
    admin,
  ]);
  await db.query("update public.user_roles set role='admin' where user_id=$1", [
    admin,
  ]);
  await db.query(
    "insert into public.dogs(id,guardian_id,name) values($1,$2,'Dawny profil')",
    [existing, owner],
  );
  await db.exec(
    readFileSync(
      "supabase/migrations/202610160001_dog_creation_recovery.sql",
      "utf8",
    ),
  );
});
beforeEach(async () => {
  await db.exec("truncate public.dog_creation_receipts;");
  await db.query("delete from public.dogs where id<>$1", [existing]);
});
afterAll(async () => {
  await db?.close();
});

describe.sequential(
  "atomic dog creation and immutable acknowledgements",
  () => {
    it("keeps existing profiles and recovers a committed response as one owned new dog", async () => {
      const request = randomUUID();
      const first = await create(request);
      expect(await create(request)).toBe(first);
      expect(await createdDogs()).toEqual([
        { id: first, guardian_id: owner, name: "Figa", status: "new" },
      ]);
      expect(
        (await db.query("select name from public.dogs where id=$1", [existing]))
          .rows,
      ).toEqual([{ name: "Dawny profil" }]);
      expect(
        (await asUser(other, () => db.query("select id from public.dogs")))
          .rows,
      ).toEqual([]);
      expect(
        (await db.query("select * from public.dog_creation_receipts")).rows,
      ).toHaveLength(1);
    });
    it("allows two intentional forms with the same details without deduplicating by dog name", async () => {
      expect(await create(randomUUID())).not.toBe(await create(randomUUID()));
      expect(await createdDogs()).toHaveLength(2);
    });
    it("returns the original result after later profile edits without overwriting those edits", async () => {
      const request = randomUUID();
      const id = await create(request);
      await asUser(owner, () =>
        db.query("update public.dogs set name='Nowe imię' where id=$1", [id]),
      );
      expect(await create(request)).toBe(id);
      expect((await createdDogs())[0].name).toBe("Nowe imię");
    });
    it("rejects a changed payload explicitly without creating or modifying a dog", async () => {
      const request = randomUUID();
      await create(request);
      await expect(
        create(request, { ...payload, color: "Czarna" }),
      ).rejects.toThrow("z innymi danymi");
      expect(await createdDogs()).toHaveLength(1);
      expect(
        (
          await db.query("select color from public.dogs where id<>$1", [
            existing,
          ])
        ).rows,
      ).toEqual([{ color: "Ruda" }]);
    });
    it.each([other, admin])(
      "rejects another author replaying the same request: %s",
      async (actor) => {
        const request = randomUUID();
        await create(request);
        await expect(create(request, payload, actor)).rejects.toThrow(
          "swój dostęp",
        );
        expect(await createdDogs()).toHaveLength(1);
      },
    );
    it("checks present ownership even when the original author is an administrator", async () => {
      const request = randomUUID();
      const id = await create(request, payload, admin);
      await db.query("update public.dogs set guardian_id=$1 where id=$2", [
        other,
        id,
      ]);
      await expect(create(request, payload, admin)).rejects.toThrow(
        "swój dostęp",
      );
      expect((await createdDogs())[0].guardian_id).toBe(other);
    });
    it("keeps the request used after its dog is deleted", async () => {
      const request = randomUUID();
      const id = await create(request);
      await db.query("delete from public.dogs where id=$1", [id]);
      await expect(create(request)).rejects.toThrow("swój dostęp");
      expect(await createdDogs()).toEqual([]);
      expect(
        (await db.query("select * from public.dog_creation_receipts")).rows,
      ).toHaveLength(1);
    });
    it("accepts an explicit empty weight and canonicalizes surrounding spaces", async () => {
      const request = randomUUID();
      const id = await create(request, {
        ...payload,
        name: " Figa ",
        weight_kg: null,
      });
      expect(await create(request, { ...payload, weight_kg: null })).toBe(id);
      expect(
        (await db.query("select weight_kg from public.dogs where id=$1", [id]))
          .rows,
      ).toEqual([{ weight_kg: null }]);
    });
    it.each([
      null,
      [],
      {},
      { ...payload, name: "" },
      { ...payload, name: "x".repeat(81) },
      { ...payload, name: null },
      { ...payload, breed: null },
      { ...payload, breed: "x".repeat(121) },
      { ...payload, approximate_age: "x".repeat(81) },
      { ...payload, approximate_age: false },
      { ...payload, sex: "other" },
      { ...payload, color: null },
      { ...payload, color: "x".repeat(121) },
      { ...payload, weight_kg: "12.5" },
      { ...payload, weight_kg: 0 },
      { ...payload, weight_kg: -1 },
      { ...payload, weight_kg: 151 },
      { ...payload, weight_kg: undefined },
      { ...payload, color: undefined },
      { ...payload, guardian_id: other },
      { ...payload, status: "approved" },
    ])(
      "rejects incomplete, malformed or privileged payloads: %j",
      async (data) => {
        await expect(create(randomUUID(), data)).rejects.toThrow(
          "Sprawdź dane psa",
        );
        expect(await createdDogs()).toEqual([]);
        expect(
          (await db.query("select * from public.dog_creation_receipts")).rows,
        ).toEqual([]);
      },
    );
    it.each(["", unknown])(
      "requires an authenticated actor with an existing application role: %s",
      async (actor) => {
        await expect(create(randomUUID(), payload, actor)).rejects.toThrow(
          "Brak uprawnień",
        );
        expect(await createdDogs()).toEqual([]);
      },
    );
    it("requires a request UUID", async () => {
      await expect(create(null)).rejects.toThrow("Sprawdź dane psa");
      expect(await createdDogs()).toEqual([]);
    });
    it("keeps receipts private and immutable to both application roles", async () => {
      await create(randomUUID());
      for (const actor of [owner, admin]) {
        for (const query of [
          "select * from public.dog_creation_receipts",
          "delete from public.dog_creation_receipts",
          "update public.dog_creation_receipts set payload='{}'",
          "insert into public.dog_creation_receipts(request_id,result_id,guardian_id,payload) values(gen_random_uuid(),gen_random_uuid(),auth.uid(),'{}')",
        ])
          await expect(asUser(actor, () => db.query(query))).rejects.toThrow(
            "permission denied",
          );
      }
      expect(
        (
          await db.query<{ enabled: boolean }>(
            "select relrowsecurity enabled from pg_class where oid='public.dog_creation_receipts'::regclass",
          )
        ).rows[0].enabled,
      ).toBe(true);
    });
    it("does not expand dog INSERT privileges or allow anonymous RPC calls", async () => {
      await expect(
        asUser(owner, () =>
          db.query(
            "insert into public.dogs(id,guardian_id,name) values(gen_random_uuid(),auth.uid(),'Cudzy identyfikator')",
          ),
        ),
      ).rejects.toThrow("permission denied");
      await expect(
        asUser(
          "",
          () =>
            db.query("select public.create_dog_profile($1,$2::jsonb)", [
              randomUUID(),
              JSON.stringify(payload),
            ]),
          "anon",
        ),
      ).rejects.toThrow("permission denied");
      expect(await createdDogs()).toEqual([]);
    });
  },
);
