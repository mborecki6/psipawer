import { test, expect } from "@playwright/test";
import sharp from "sharp";
import { processLocalAvatarCleanup } from "../../scripts/lib/avatar-cleanup.mjs";
import {
  LocalPostgres,
  literal as q,
  waitForLock,
} from "../helpers/local-postgres.mjs";
import {
  account,
  checked,
  disposeCareFixtures,
  localClients,
} from "./local-fixtures";

test.use({ trace: "off" });
test("avatar transaction races → interrupted cleanup → retry and concurrent workers", async ({
  baseURL,
}) => {
  const { db, client } = localClients(baseURL);
  const own = client(),
    users: string[] = [],
    dogs: string[] = [],
    paths: string[] = [];
  const observer = await new LocalPostgres().ready();
  const bucket = "dog-avatars";
  const values = {
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL!,
    SUPABASE_SECRET_KEY: process.env.SUPABASE_SECRET_KEY!,
  };
  let folder = "";
  try {
    const owner = await account(db, users, "client");
    await checked(
      own.auth.signInWithPassword({
        email: owner.email,
        password: owner.password,
      }),
    );
    const dog = await checked(
      own
        .from("dogs")
        .insert({
          guardian_id: owner.id,
          name: `Sprzątanie zdjęć ${crypto.randomUUID().slice(0, 8)}`,
        })
        .select("id")
        .single(),
    );
    dogs.push(dog!.id);
    folder = `${owner.id}/${dog!.id}`;
    const malformed = `${owner.id}/not-a-dog/photo.webp`;
    expect(
      (
        await own.rpc("retire_avatar_upload", {
          p_bucket: bucket,
          p_path: malformed,
        })
      ).error,
    ).not.toBeNull();
    expect(
      await checked(
        db
          .from("avatar_cleanup")
          .select("object_path")
          .eq("object_path", malformed),
      ),
    ).toEqual([]);
    const bytes = await sharp({
      create: { width: 24, height: 24, channels: 3, background: "#be8174" },
    })
      .webp()
      .toBuffer();
    for (let i = 0; i < 5; i++) {
      const path = `${folder}/${crypto.randomUUID()}.webp`;
      paths.push(path);
      await checked(
        own.storage
          .from(bucket)
          .upload(path, bytes, { contentType: "image/webp" }),
      );
    }
    const set = (expected: string | null, path: string | null) =>
      `select public.set_dog_avatar(${q(dog!.id)},${expected === null ? "null" : q(expected)},${path === null ? "null" : q(path)});`;
    const retire = (path: string) =>
      `select to_json(public.retire_avatar_upload('dog-avatars',${q(path)}));`;
    let locks = 0;
    const race = async (
      first: string,
      second: string,
      expectedError?: RegExp,
    ) => {
      const a = await new LocalPostgres().ready(),
        b = await new LocalPostgres().ready();
      let pending: Promise<{ value?: string[]; error?: Error }> | undefined;
      try {
        await a.asUser(owner.id);
        await b.asUser(owner.id);
        await a.query(first);
        pending = b.query(second).then(
          (value) => ({ value }),
          (error) => ({ error }),
        );
        await waitForLock(observer, a, b);
        locks++;
        await a.query("commit;");
        const result = await pending;
        if (expectedError) {
          expect(result.error?.message).toMatch(expectedError);
        } else {
          expect(result.error).toBeUndefined();
          await b.query("commit;");
        }
        return result.value;
      } finally {
        await Promise.all([a.close(), b.close()]);
        if (pending) await pending;
      }
    };
    await race(
      set(null, paths[0]),
      set(null, paths[1]),
      /Zdjęcie psa zmieniło się/,
    );
    await checked(
      own.rpc("set_dog_avatar", {
        p_dog: dog!.id,
        p_expected_path: paths[0],
        p_path: null,
      }),
    );
    await checked(
      own.rpc("retire_avatar_upload", { p_bucket: bucket, p_path: paths[1] }),
    );
    const savedThenRetired = await race(set(null, paths[2]), retire(paths[2]));
    expect(savedThenRetired).toEqual(["false"]);
    await race(
      retire(paths[3]),
      set(paths[2], paths[3]),
      /nie jest już dostępne/,
    );
    await race(
      set(paths[2], null),
      set(paths[2], paths[4]),
      /Zdjęcie psa zmieniło się/,
    );
    await checked(
      own.rpc("retire_avatar_upload", { p_bucket: bucket, p_path: paths[4] }),
    );
    expect(locks).toBe(4);
    const beforeCleanup = await checked(
      db
        .from("avatar_cleanup")
        .select("object_path,completed_at,next_attempt_at")
        .in("object_path", paths),
    );
    expect(beforeCleanup!.map((job) => job.object_path).sort()).toEqual(
      [...paths].sort(),
    );
    expect(beforeCleanup!.every((job) => job.completed_at === null)).toBe(true);
    expect(
      (await checked(
        own.from("dogs").select("avatar_path").eq("id", dog!.id).single(),
      ))!.avatar_path,
    ).toBeNull();

    // Filter only this test's jobs after reading the actual bounded worker RPC.
    // No other local user's cleanup records or files participate in this test.
    // Set eligibility explicitly on the database clock for this fixture. The
    // worker must still honor future retry dates, tested after the interruption.
    await observer.query(`update public.avatar_cleanup set next_attempt_at=clock_timestamp()-interval '1 minute'
      where bucket_id='dog-avatars' and object_path in (${paths.map(q).join(",")}) and completed_at is null;`);
    expect(
      await observer.json(`select to_json(count(*)) from public.avatar_cleanup
      where bucket_id='dog-avatars' and object_path in (${paths.map(q).join(",")})
        and completed_at is null and next_attempt_at<=clock_timestamp();`),
    ).toBe(5);
    const scoped = async (input: RequestInfo | URL, options?: RequestInit) => {
      const response = await fetch(input, options);
      if (String(input).endsWith("/worker_avatar_cleanup") && response.ok) {
        const jobs = await response.json();
        return Response.json(
          jobs.filter((job: { object_path: string }) =>
            paths.includes(job.object_path),
          ),
        );
      }
      return response;
    };
    let interrupt = true;
    const interrupted = async (
      input: RequestInfo | URL,
      options?: RequestInit,
    ) => {
      if (interrupt && options?.method === "DELETE") {
        interrupt = false;
        throw new Error("Fixture connection interrupted");
      }
      return scoped(input, options);
    };
    expect(await processLocalAvatarCleanup(values, interrupted)).toEqual({
      completed: 4,
      failed: 1,
    });
    const queued = await checked(
      db
        .from("avatar_cleanup")
        .select("object_path,attempts,completed_at,next_attempt_at")
        .in("object_path", paths),
    );
    const pending = queued!.filter((job) => job.completed_at === null);
    expect(pending).toHaveLength(1);
    expect(pending[0].attempts).toBe(1);
    expect(new Date(pending[0].next_attempt_at).getTime()).toBeGreaterThan(
      Date.now(),
    );
    expect(await processLocalAvatarCleanup(values, scoped)).toEqual({
      completed: 0,
      failed: 0,
    });
    await observer.query(`update public.avatar_cleanup set next_attempt_at=clock_timestamp()-interval '1 second'
      where bucket_id='dog-avatars' and object_path=${q(pending[0].object_path)};`);
    let readers = 0;
    let release!: () => void;
    const barrier = new Promise<void>((resolve) => {
      release = resolve;
    });
    const concurrent = async (
      input: RequestInfo | URL,
      options?: RequestInit,
    ) => {
      const response = await scoped(input, options);
      if (String(input).endsWith("/worker_avatar_cleanup")) {
        readers++;
        if (readers === 2) release();
        await Promise.race([
          barrier,
          new Promise((_, reject) =>
            setTimeout(
              () => reject(new Error("Worker barrier timeout")),
              10000,
            ),
          ),
        ]);
      }
      return response;
    };
    const workers = await Promise.all([
      processLocalAvatarCleanup(values, concurrent),
      processLocalAvatarCleanup(values, concurrent),
    ]);
    expect(readers).toBe(2);
    expect(
      workers.reduce((sum, result) => sum + result.completed, 0),
    ).toBeGreaterThanOrEqual(1);
    const finished = await checked(
      db
        .from("avatar_cleanup")
        .select("completed_at,attempts")
        .eq("bucket_id", bucket)
        .eq("object_path", pending[0].object_path)
        .single(),
    );
    expect(finished!.completed_at).not.toBeNull();
    expect(finished!.attempts).toBe(2);
    for (const path of paths)
      expect(
        (await own.storage.from(bucket).download(path)).error,
      ).not.toBeNull();
    expect(await processLocalAvatarCleanup(values, scoped)).toEqual({
      completed: 0,
      failed: 0,
    });
  } finally {
    await observer.close();
    if (dogs.length)
      await checked(
        db.from("dogs").update({ avatar_path: null }).in("id", dogs),
      );
    if (folder) {
      const files = await checked(db.storage.from(bucket).list(folder));
      if (files?.length)
        await checked(
          db.storage
            .from(bucket)
            .remove(files.map((file) => `${folder}/${file.name}`)),
        );
    }
    if (users.length)
      await checked(
        db.from("avatar_uploads").delete().in("guardian_id", users),
      );
    if (users.length)
      await checked(
        db.from("avatar_cleanup").delete().in("guardian_id", users),
      );
    await own.auth.signOut();
    await disposeCareFixtures(db, users, dogs);
  }
});
