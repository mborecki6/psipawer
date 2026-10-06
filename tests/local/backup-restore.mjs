// Explicit integration rehearsal. Only fictional source fixtures are created;
// the existing local environment is never replaced by the restored database.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { parseEnv } from "node:util";
import { createClient } from "@supabase/supabase-js";
import sharp from "sharp";
import {
  localBackupConfiguration,
  checksum,
} from "../../scripts/lib/backup-guards.mjs";
import {
  createLocalBackup,
  verifyLocalBackup,
} from "../../scripts/lib/local-backup.mjs";
import {
  prepareBackupCourses,
  verifyBackupCourses,
  disposeBackupCourses,
} from "../helpers/backup-course-fixtures.mjs";
import { LocalPostgres } from "../helpers/local-postgres.mjs";
import {
  prepareBackupFitness,
  verifyBackupFitness,
  disposeBackupFitness,
} from "../helpers/backup-fitness-fixtures.mjs";
import {
  prepareBackupGifts,
  verifyBackupGifts,
  disposeBackupGifts,
} from "../helpers/backup-gift-fixtures.mjs";

const credentials = localBackupConfiguration(
  parseEnv(readFileSync(".env.test.local", "utf8")),
);
const options = {
  auth: { persistSession: false, autoRefreshToken: false },
  global: {
    fetch: (input, init) =>
      fetch(input, {
        ...init,
        redirect: "error",
        signal: AbortSignal.timeout(20000),
      }),
  },
};
const db = createClient("http://127.0.0.1:54321", credentials.secret, options);
const run = randomUUID(),
  users = [],
  dogs = [],
  files = [],
  leases = [],
  courses = [],
  fitness = { dogs: [], packages: [] },
  gifts = { cards: [], packages: [] },
  clients = [];
let failed = false,
  phase = "source-baseline",
  sourceBefore;
const onStage = (value) => {
  phase = value;
};
async function publicSnapshot() {
  const sql = await new LocalPostgres().ready();
  try {
    return await sql.json(`begin;
      create temporary table backup_public_snapshot(name text,rows bigint,digest text) on commit drop;
      do $$ declare t record; n bigint; h text; begin
        for t in select c.relname from pg_class c join pg_namespace s on s.oid=c.relnamespace
          where s.nspname='public' and c.relkind='r' order by c.relname loop
          execute format('select count(*),md5(coalesce(string_agg(md5(to_jsonb(r)::text),%L order by md5(to_jsonb(r)::text)),%L)) from public.%I r','','',t.relname) into n,h;
          insert into backup_public_snapshot values(t.relname,n,h);
        end loop;
      end $$;
      select jsonb_agg(s order by name) from backup_public_snapshot s;
      commit;`);
  } finally {
    await sql.close();
  }
}
function checked(result) {
  assert(!result.error, "Rzeczywiste lokalne API odrzuciło operację próbną.");
  return result.data;
}
try {
  sourceBefore = await publicSnapshot();
  onStage("source-accounts");
  for (const [index, role] of ["client", "client", "admin"].entries()) {
    const fixture = {
      email: `psi-backup-${run}-${index}@example.test`,
      password: `Psi-backup!${randomUUID()}`,
      role,
    };
    users.push(fixture);
    const { user } = checked(
      await db.auth.admin.createUser({
        email: fixture.email,
        password: fixture.password,
        email_confirm: true,
      }),
    );
    assert(user?.id);
    fixture.id = user.id;
    checked(
      await db
        .from("profiles")
        .update({
          full_name: "Próba odtworzenia",
          phone: "000 000 000",
          area: "Okolica testowa",
        })
        .eq("id", user.id),
    );
    checked(
      await db.from("user_roles").update({ role }).eq("user_id", user.id),
    );
    const client = createClient(
      "http://127.0.0.1:54321",
      credentials.key,
      options,
    );
    clients.push(client);
    checked(
      await client.auth.signInWithPassword({
        email: fixture.email,
        password: fixture.password,
      }),
    );
  }
  const owner = users[0],
    stranger = users[1],
    staff = users[2];
  const dog = { id: randomUUID() };
  dogs.push(dog.id);
  onStage("source-dog");
  checked(
    await db
      .from("dogs")
      .insert({
        id: dog.id,
        guardian_id: owner.id,
        name: "Pies do próby kopii",
      })
      .select("id")
      .single(),
  );
  checked(
    await db.from("dog_notes").insert({
      dog_id: dog.id,
      author_id: staff.id,
      body: "Prywatna notatka próbna",
      visibility: "admin_only",
    }),
  );
  for (const [bucket, color] of [
    ["dog-avatars", "#bd816e"],
    ["community-avatars", "#4f8178"],
  ]) {
    const bytes = await sharp({
      create: { width: 32, height: 24, channels: 3, background: color },
    })
      .webp()
      .toBuffer();
    const path = `${owner.id}/${dog.id}/${randomUUID()}.webp`;
    files.push({ bucket, path, sha256: checksum(bytes), bytes: bytes.length });
    onStage("source-photo-reservation");
    checked(
      await clients[0].rpc("reserve_avatar_upload", {
        p_dog: dog.id,
        p_bucket: bucket,
        p_path: path,
      }),
    );
    onStage("source-photo-upload");
    checked(
      await db.storage
        .from(bucket)
        .upload(path, bytes, { contentType: "image/webp" }),
    );
    if (bucket === "dog-avatars")
      checked(
        await db.from("dogs").update({ avatar_path: path }).eq("id", dog.id),
      );
    else {
      checked(
        await db.from("psiutki_profiles").insert({
          dog_id: dog.id,
          display_name: "Wizytówka próbna",
          headline: "Fikcyjny opis",
          avatar_path: path,
          moderation_status: "pending",
          published: false,
        }),
      );
      checked(
        await db.from("psiutki_profile_reviews").insert({
          dog_id: dog.id,
          consented_at: new Date().toISOString(),
          consented_by: owner.id,
        }),
      );
    }
  }
  const fixture = await prepareBackupCourses({
    db,
    owner: clients[0],
    staff: clients[2],
    dog: dog.id,
    courses,
    onStage,
  });
  const fitnessFixture = await prepareBackupFitness({
    db,
    owner: clients[0],
    staff: clients[2],
    guardianId: owner.id,
    fitness,
    onStage,
  });
  const giftFixture = await prepareBackupGifts({
    owner: clients[0],
    staff: clients[2],
    dog: dog.id,
    guardianId: owner.id,
    gifts,
    onStage,
  });
  const pending = {
    bucket: "dog-avatars",
    path: `${owner.id}/${dog.id}/${randomUUID()}.webp`,
  };
  leases.push(pending);
  onStage("source-pending-photo");
  pending.expires = checked(
    await clients[0].rpc("reserve_avatar_upload", {
      p_dog: dog.id,
      p_bucket: pending.bucket,
      p_path: pending.path,
    }),
  );
  const calendarPolicy = checked(
    await clients[2].from("calendar_settings").select("*").single(),
  );
  const calendarWeek = checked(
    await clients[2].from("calendar_weekly_hours").select("*").order("weekday"),
  );
  onStage("backup-create");
  const backup = await createLocalBackup();
  onStage("backup-restore");
  const report = await verifyLocalBackup(
    backup.id,
    async ({ http, sql, report }) => {
      const restoreStage = (value) => {
        onStage(value);
        report.fixture_phase = value;
      };
      restoreStage("restore-auth");
      const tokens = new Map();
      const json = (response) => JSON.parse(response.bytes.toString("utf8"));
      for (const user of users) {
        const response = http("auth", "/token?grant_type=password", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: { email: user.email, password: user.password },
        });
        assert.equal(
          response.status,
          200,
          "Zachowane hasło musi działać w odtworzonym Auth.",
        );
        const data = json(response);
        assert.equal(data.user.id, user.id);
        assert(data.access_token);
        tokens.set(user.id, data.access_token);
        const verified = http("auth", "/user", {
          headers: { Authorization: `Bearer ${data.access_token}` },
        });
        assert.equal(verified.status, 200);
        assert.equal(json(verified).id, user.id);
      }
      report.auth_logins_verified = users.length;
      const headers = (user) => ({
        Authorization: `Bearer ${tokens.get(user.id)}`,
      });
      const ownDog = http(
        "rest",
        `/dogs?select=id,avatar_path&id=eq.${dog.id}`,
        { headers: headers(owner) },
      );
      assert.equal(ownDog.status, 200);
      assert.equal(json(ownDog)[0].id, dog.id);
      const foreignDog = http("rest", `/dogs?select=id&id=eq.${dog.id}`, {
        headers: headers(stranger),
      });
      assert.equal(foreignDog.status, 200);
      assert.deepEqual(json(foreignDog), []);
      const notes = http("rest", `/dog_notes?select=id&dog_id=eq.${dog.id}`, {
        headers: headers(owner),
      });
      assert.equal(notes.status, 200);
      assert.deepEqual(json(notes), []);
      const staffNotes = http(
        "rest",
        `/dog_notes?select=id&dog_id=eq.${dog.id}`,
        { headers: headers(staff) },
      );
      assert.equal(staffNotes.status, 200);
      assert.equal(json(staffNotes).length, 1);
      for (const user of users) {
        const roles = http(
          "rest",
          `/user_roles?select=role&user_id=eq.${user.id}`,
          { headers: headers(user) },
        );
        assert.equal(roles.status, 200);
        assert.equal(json(roles)[0].role, user.role);
      }
      report.api_isolation_verified = true;
      for (const file of files) {
        const path = `/object/authenticated/${file.bucket}/${file.path}`;
        for (const user of [owner, staff]) {
          const restored = http("storage", path, { headers: headers(user) });
          assert.equal(restored.status, 200);
          assert.equal(checksum(restored.bytes), file.sha256);
          assert.equal(restored.bytes.length, file.bytes);
        }
        const refused = http("storage", path, { headers: headers(stranger) });
        assert(
          refused.status >= 400,
          "Obca sesja nie może pobrać prywatnego zdjęcia po odtworzeniu.",
        );
        const anonymous = http("storage", path);
        assert(anonymous.status >= 400);
      }
      report.storage_downloads_verified = files.length;
      restoreStage("restore-course-data");
      await verifyBackupCourses({
        http,
        json,
        headers,
        owner,
        stranger,
        staff,
        dog: dog.id,
        fixture,
        source: clients[0],
        report,
        onStage: restoreStage,
      });
      await verifyBackupFitness({
        http,
        json,
        headers,
        owner,
        stranger,
        staff,
        fixture: fitnessFixture,
        sourceOwner: clients[0],
        sourceStaff: clients[2],
        report,
        onStage: restoreStage,
      });
      await verifyBackupGifts({
        http,
        json,
        headers,
        owner,
        stranger,
        staff,
        fixture: giftFixture,
        sourceOwner: clients[0],
        sourceStaff: clients[2],
        report,
        onStage: restoreStage,
      });
      restoreStage("restore-pending-photo");
      const pendingPath = `/avatar_uploads?select=bucket_id,object_path,dog_id,guardian_id,expires_at&bucket_id=eq.${pending.bucket}&object_path=eq.${pending.path}`;
      const sourceLease = checked(
        await clients[0]
          .from("avatar_uploads")
          .select("bucket_id,object_path,dog_id,guardian_id,expires_at")
          .eq("bucket_id", pending.bucket)
          .eq("object_path", pending.path),
      );
      assert.equal(sourceLease.length, 1);
      assert.equal(
        Date.parse(sourceLease[0].expires_at),
        Date.parse(pending.expires),
      );
      for (const user of [owner, staff, stranger]) {
        const response = http("rest", pendingPath, { headers: headers(user) });
        assert.equal(response.status, 200);
        assert.deepEqual(json(response), user === stranger ? [] : sourceLease);
      }
      const retried = http("rest", "/rpc/reserve_avatar_upload", {
        method: "POST",
        headers: { ...headers(owner), "Content-Type": "application/json" },
        body: { p_dog: dog.id, p_bucket: pending.bucket, p_path: pending.path },
      });
      assert.equal(retried.status, 200);
      assert.equal(Date.parse(json(retried)), Date.parse(pending.expires));
      const absent = http(
        "storage",
        `/object/authenticated/${pending.bucket}/${pending.path}`,
        { headers: headers(owner) },
      );
      assert(absent.status >= 400, "Sama rezerwacja nie może tworzyć zdjęcia.");
      report.avatar_reservation_verified = true;
      restoreStage("restore-calendar-settings");
      const calendarRead = (table, user) => {
        const response = http(
          "rest",
          `/${table}?select=*${table === "calendar_weekly_hours" ? "&order=weekday" : ""}`,
          { headers: headers(user) },
        );
        assert.equal(response.status, 200);
        return json(response);
      };
      assert.deepEqual(calendarRead("calendar_settings", staff), [
        calendarPolicy,
      ]);
      assert.deepEqual(
        calendarRead("calendar_weekly_hours", staff),
        calendarWeek,
      );
      for (const user of [owner, stranger])
        for (const table of ["calendar_settings", "calendar_weekly_hours"])
          assert.deepEqual(calendarRead(table, user), []);
      const calendarWrite = {
        p_expected_version: calendarPolicy.version,
        p_hours_enabled: false,
        p_before_minutes: 10,
        p_after_minutes: 20,
        p_week: calendarWeek.map(
          ({ weekday, enabled, start_minute, end_minute }) => ({
            weekday,
            enabled,
            start_minute,
            end_minute,
          }),
        ),
      };
      const updateCalendar = () => {
        const response = http("rest", "/rpc/save_calendar_settings", {
          method: "POST",
          headers: { ...headers(staff), "Content-Type": "application/json" },
          body: calendarWrite,
        });
        assert.equal(
          response.status,
          200,
          "Nowe ustawienia muszą działać przez odtworzone API.",
        );
        assert.equal(json(response), calendarPolicy.version + 1);
      };
      updateCalendar();
      updateCalendar();
      const restoredPolicy = calendarRead("calendar_settings", staff)[0];
      assert.equal(restoredPolicy.before_minutes, 10);
      assert.equal(restoredPolicy.after_minutes, 20);
      const policyAudits = http(
        "rest",
        `/audit_events?select=id&actor_id=eq.${staff.id}&event=eq.calendar_settings_saved`,
        { headers: headers(staff) },
      );
      assert.equal(policyAudits.status, 200);
      assert.equal(json(policyAudits).length, 1);
      assert.deepEqual(
        checked(
          await clients[2].from("calendar_settings").select("*").single(),
        ),
        calendarPolicy,
      );
      assert.deepEqual(
        checked(
          await clients[2]
            .from("calendar_weekly_hours")
            .select("*")
            .order("weekday"),
        ),
        calendarWeek,
      );
      report.calendar_restore_verified = {
        settings: true,
        weekdays: 7,
        private: true,
        new_write: true,
        retry_without_duplicate: true,
        source_unchanged: true,
      };
      restoreStage("restore-migrations");
      const expected = readdirSync("supabase/migrations")
        .filter((name) => /^\d{12}_.+\.sql$/.test(name))
        .map((name) => name.slice(0, 12))
        .sort();
      const restored = JSON.parse(
        sql(
          "select json_agg(version order by version) from supabase_migrations.schema_migrations;",
        ),
      );
      assert.deepEqual(restored, expected);
      report.migrations_verified = expected.length;
    },
  );
  assert(report.checks_passed && report.cleanup);
  console.log(
    "Próba kopii: dane i schemat zachowane; trzy logowania, zdjęcia, rezerwacja przesłania, kursy, fitness, karty podarunkowe, rozliczenia, plany, obecność, przypomnienia i ponowienia sprawdzone przez odtworzone API.",
  );
  console.log(
    JSON.stringify({
      backup_id: backup.id,
      run_id: report.run_id,
      database_tables: report.database_tables,
      database_rows: report.database_rows,
      migrations_verified: report.migrations_verified,
      course_restore_verified: report.course_restore_verified,
      fitness_restore_verified: report.fitness_restore_verified,
      gift_restore_verified: report.gift_restore_verified,
      calendar_restore_verified: report.calendar_restore_verified,
      avatar_reservation_verified: report.avatar_reservation_verified,
    }),
  );
} catch {
  failed = true;
  console.error(
    `Próba odtworzenia nie przeszła na etapie ${phase}. Treści oraz poświadczenia pominięto.`,
  );
} finally {
  try {
    onStage("source-cleanup");
    for (const file of files)
      checked(await db.storage.from(file.bucket).remove([file.path]));
    await disposeBackupGifts(db, gifts);
    await disposeBackupFitness(db, fitness);
    await disposeBackupCourses(db, dogs[0], courses);
    if (dogs.length) {
      checked(await db.from("dog_notes").delete().in("dog_id", dogs));
      checked(await db.from("dogs").delete().in("id", dogs));
    }
    for (const file of [...files, ...leases]) {
      checked(
        await db
          .from("avatar_uploads")
          .delete()
          .eq("bucket_id", file.bucket)
          .eq("object_path", file.path),
      );
      // Bytes were removed through Storage and the own dog is gone. Finish
      // only this run's exact keys; never claim another user's queued jobs.
      checked(
        await db.rpc("worker_finish_avatar_cleanup", {
          p_bucket: file.bucket,
          p_path: file.path,
          p_failed: false,
        }),
      );
      checked(
        await db
          .from("avatar_cleanup")
          .delete()
          .eq("bucket_id", file.bucket)
          .eq("object_path", file.path)
          .not("completed_at", "is", null),
      );
    }
    for (const client of clients) checked(await client.auth.signOut());
    for (const user of users) {
      if (!user.id) {
        // An accepted creation with a lost response is found only by the exact
        // unique address, never by a shared prefix or a real user's email.
        const listed = checked(
          await db.auth.admin.listUsers({ page: 1, perPage: 1000 }),
        );
        user.id = listed.users.find((u) => u.email === user.email)?.id;
      }
      if (user.id) {
        checked(await db.from("audit_events").delete().eq("actor_id", user.id));
        checked(await db.auth.admin.deleteUser(user.id));
      }
    }
    onStage("source-baseline-compare");
    if (sourceBefore)
      assert.deepEqual(
        await publicSnapshot(),
        sourceBefore,
        "Cała wcześniejsza zawartość tabel publicznych musi zostać zachowana.",
      );
    console.log(
      "Próba kopii: własne dane i pliki usunięte; skróty wszystkich wcześniejszych tabel publicznych zgodne.",
    );
  } catch {
    failed = true;
    console.error(
      "Sprzątanie próby niepotwierdzone; nie resetuj lokalnej bazy.",
    );
  }
}
process.exitCode = failed ? 1 : 0;
