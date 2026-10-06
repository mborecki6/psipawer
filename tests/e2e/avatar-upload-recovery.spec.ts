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
test("interrupted registered uploads → expiry recovery without erasing committed photos", async ({
  baseURL,
}) => {
  const { db, client } = localClients(baseURL),
    own = client();
  const users: string[] = [],
    dogs: string[] = [];
  const objects: { bucket: string; path: string }[] = [];
  const observer = await new LocalPostgres().ready();
  const values = {
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL!,
    SUPABASE_SECRET_KEY: process.env.SUPABASE_SECRET_KEY!,
  };
  try {
    const owner = await account(db, users, "client");
    await checked(
      own.auth.signInWithPassword({
        email: owner.email,
        password: owner.password,
      }),
    );
    for (let i = 0; i < 2; i++) {
      const row = await checked(
        own
          .from("dogs")
          .insert({
            guardian_id: owner.id,
            name: `Odzyskanie przesłania ${crypto.randomUUID().slice(0, 8)}`,
          })
          .select("id")
          .single(),
      );
      dogs.push(row!.id);
    }
    const bytes = await sharp({
      create: { width: 24, height: 24, channels: 3, background: "#ac7f67" },
    })
      .webp()
      .toBuffer();
    const reserve = async (
      dog: string,
      bucket = "dog-avatars",
      upload = true,
    ) => {
      const path = `${owner.id}/${dog}/${crypto.randomUUID()}.webp`;
      objects.push({ bucket, path });
      await checked(
        own.rpc("reserve_avatar_upload", {
          p_dog: dog,
          p_bucket: bucket,
          p_path: path,
        }),
      );
      if (upload)
        await checked(
          own.storage
            .from(bucket)
            .upload(path, bytes, { contentType: "image/webp" }),
        );
      return path;
    };
    const absent = await reserve(dogs[0], "dog-avatars", false);
    const privateAbandoned = await reserve(dogs[0]);
    const communityAbandoned = await reserve(dogs[0], "community-avatars");
    const active = await reserve(dogs[0]);
    await checked(
      own.rpc("set_dog_avatar", {
        p_dog: dogs[0],
        p_expected_path: null,
        p_path: active,
      }),
    );
    expect(
      await checked(
        own.rpc("retire_avatar_upload", {
          p_bucket: "dog-avatars",
          p_path: active,
        }),
      ),
    ).toBe(false);
    expect(
      await checked(
        db
          .from("avatar_uploads")
          .select("object_path")
          .eq("object_path", active),
      ),
    ).toEqual([]);

    // Simulate a stopped application before bytes, after bytes, and before
    // acknowledging attachment. Move only this test's own reservation clocks.
    await observer.query(
      `update public.avatar_uploads set created_at=clock_timestamp()-interval '31 minutes',expires_at=clock_timestamp()-interval '1 minute' where object_path in (${[absent, privateAbandoned, communityAbandoned].map(q).join(",")});`,
    );
    expect(
      (
        await own.storage
          .from("dog-avatars")
          .upload(absent, bytes, { contentType: "image/webp" })
      ).error,
    ).not.toBeNull();

    let locks = 0;
    const attaching = await reserve(dogs[1]);
    // Start attachment while the lease is live; a waiting expiry worker sees
    // the old lease until COMMIT, then must re-read and preserve the saved file.
    const a = await new LocalPostgres().ready(),
      b = await new LocalPostgres().ready();
    let pending: Promise<{ value?: string[]; error?: Error }> | undefined;
    try {
      await observer.query(
        `update public.avatar_uploads set created_at=clock_timestamp()-interval '1 minute',expires_at=clock_timestamp()+interval '2 seconds' where object_path=${q(attaching)};`,
      );
      await a.asUser(owner.id);
      await a.query(
        `select public.set_dog_avatar(${q(dogs[1])},null,${q(attaching)});`,
      );
      await b.query("begin;");
      const deadline = Date.now() + 6000;
      while (
        !(await observer.json(
          `select to_json(expires_at<=clock_timestamp()) from public.avatar_uploads where object_path=${q(attaching)};`,
        ))
      ) {
        if (Date.now() > deadline)
          throw new Error("Fixture expiry was not observed");
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      pending = b.query("select public.worker_retire_avatar_uploads(20);").then(
        (value) => ({ value }),
        (error) => ({ error }),
      );
      await waitForLock(observer, a, b);
      locks++;
      await a.query("commit;");
      const result = await pending;
      expect(result.error).toBeUndefined();
      expect(result.value).toEqual(["3"]);
      await b.query("commit;");
    } finally {
      await Promise.all([a.close(), b.close()]);
      if (pending) await pending;
    }
    expect(
      await checked(
        db
          .from("avatar_uploads")
          .select("object_path")
          .eq("object_path", attaching),
      ),
    ).toEqual([]);
    expect(
      await checked(
        db
          .from("avatar_cleanup")
          .select("object_path")
          .eq("object_path", attaching),
      ),
    ).toEqual([]);
    expect(
      (await own.storage.from("dog-avatars").download(attaching)).error,
    ).toBeNull();

    // In the opposite order, expiry holds the key. A later attachment waits
    // and then refuses the retired key without replacing the active photo.
    const retired = await reserve(dogs[1]);
    await observer.query(
      `update public.avatar_uploads set created_at=clock_timestamp()-interval '31 minutes',expires_at=clock_timestamp()-interval '1 minute' where object_path=${q(retired)};`,
    );
    const sweep = await new LocalPostgres().ready(),
      attach = await new LocalPostgres().ready();
    let late: Promise<{ value?: string[]; error?: Error }> | undefined;
    try {
      await sweep.query("begin;");
      expect(
        await sweep.query("select public.worker_retire_avatar_uploads(20);"),
      ).toEqual(["1"]);
      await attach.asUser(owner.id);
      late = attach
        .query(
          `select public.set_dog_avatar(${q(dogs[1])},${q(attaching)},${q(retired)});`,
        )
        .then(
          (value) => ({ value }),
          (error) => ({ error }),
        );
      await waitForLock(observer, sweep, attach);
      locks++;
      await sweep.query("commit;");
      expect((await late).error?.message).toMatch(/nie jest już dostępne/);
    } finally {
      await Promise.all([sweep.close(), attach.close()]);
      if (late) await late;
    }

    // Two expiry transactions choose the same still-visible reservation. The
    // second rechecks after the key lock, so there is one retirement record.
    const competing = await reserve(dogs[1], "dog-avatars", false);
    await observer.query(
      `update public.avatar_uploads set created_at=clock_timestamp()-interval '31 minutes',expires_at=clock_timestamp()-interval '1 minute' where object_path=${q(competing)};`,
    );
    const first = await new LocalPostgres().ready(),
      second = await new LocalPostgres().ready();
    let competingSweep:
      Promise<{ value?: string[]; error?: Error }> | undefined;
    try {
      await first.query("begin;");
      await second.query("begin;");
      expect(
        await first.query("select public.worker_retire_avatar_uploads(20);"),
      ).toEqual(["1"]);
      competingSweep = second
        .query("select public.worker_retire_avatar_uploads(20);")
        .then(
          (value) => ({ value }),
          (error) => ({ error }),
        );
      await waitForLock(observer, first, second);
      locks++;
      await first.query("commit;");
      const result = await competingSweep;
      expect(result.error).toBeUndefined();
      expect(result.value).toEqual(["0"]);
      await second.query("commit;");
    } finally {
      await Promise.all([first.close(), second.close()]);
      if (competingSweep) await competingSweep;
    }
    expect(locks).toBe(3);

    const scoped = async (input: RequestInfo | URL, options?: RequestInit) => {
      const response = await fetch(input, options);
      if (String(input).endsWith("/worker_avatar_cleanup") && response.ok) {
        const jobs = await response.json();
        return Response.json(
          jobs.filter((job: { object_path: string }) =>
            objects.some((object) => object.path === job.object_path),
          ),
        );
      }
      return response;
    };
    expect(await processLocalAvatarCleanup(values, scoped)).toEqual({
      completed: 5,
      failed: 0,
    });
    for (const object of objects) {
      const download = await own.storage
        .from(object.bucket)
        .download(object.path);
      if ([active, attaching].includes(object.path))
        expect(download.error).toBeNull();
      else {
        expect(download.error).not.toBeNull();
        expect(
          (
            await own.storage
              .from(object.bucket)
              .upload(object.path, bytes, { contentType: "image/webp" })
          ).error,
        ).not.toBeNull();
      }
    }
    const queued = await checked(
      db
        .from("avatar_cleanup")
        .select("object_path,completed_at,attempts")
        .in(
          "object_path",
          objects.map((object) => object.path),
        ),
    );
    expect(queued).toHaveLength(5);
    expect(
      queued!.every((job) => job.completed_at !== null && job.attempts === 1),
    ).toBe(true);
    expect(
      await checked(
        db
          .from("avatar_uploads")
          .select("object_path")
          .in("guardian_id", users),
      ),
    ).toEqual([]);
    expect(await processLocalAvatarCleanup(values, scoped)).toEqual({
      completed: 0,
      failed: 0,
    });
    expect(
      (await checked(
        own.from("dogs").select("avatar_path").eq("id", dogs[0]).single(),
      ))!.avatar_path,
    ).toBe(active);
    expect(
      (await checked(
        own.from("dogs").select("avatar_path").eq("id", dogs[1]).single(),
      ))!.avatar_path,
    ).toBe(attaching);
  } finally {
    await observer.close();
    if (dogs.length)
      await checked(
        db.from("dogs").update({ avatar_path: null }).in("id", dogs),
      );
    for (const bucket of ["dog-avatars", "community-avatars"])
      for (const dog of dogs) {
        const folder = `${users[0]}/${dog}`;
        const files = await checked(db.storage.from(bucket).list(folder));
        if (files?.length)
          await checked(
            db.storage
              .from(bucket)
              .remove(files.map((file) => `${folder}/${file.name}`)),
          );
      }
    if (users.length) {
      await checked(
        db.from("avatar_uploads").delete().in("guardian_id", users),
      );
      await checked(
        db.from("avatar_cleanup").delete().in("guardian_id", users),
      );
    }
    await own.auth.signOut();
    await disposeCareFixtures(db, users, dogs);
  }
});
