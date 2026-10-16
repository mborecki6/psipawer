// Small mocked checks only: importing or running this file never opens a DB.
import assert from "node:assert/strict";
import { test } from "node:test";
import { disposeBackupCourses } from "../helpers/backup-course-fixtures.mjs";
import { disposeBackupFitness } from "../helpers/backup-fitness-fixtures.mjs";
import { disposeBackupGifts } from "../helpers/backup-gift-fixtures.mjs";

function database(failEntitlements = false) {
  const calls = [];
  return {
    calls,
    from(table) {
      const filter = (operation, key, ids) => {
        calls.push({ table, operation, key, ids });
        return Promise.resolve({
          data: operation === "select" ? [] : null,
          error:
            failEntitlements && table === "care_reporting_entitlements"
              ? { message: "Simulated cleanup failure" }
              : null,
        });
      };
      const operation = (name) => ({
        in: (key, ids) => filter(name, key, ids),
        eq: (key, id) => filter(name, key, [id]),
      });
      return {
        select: () => operation("select"),
        delete: () => operation("delete"),
      };
    },
  };
}

for (const [name, dispose, key, ids] of [
  [
    "course",
    (db) => disposeBackupCourses(db, "own-dog", ["own-course"]),
    "dog_id",
    ["own-dog"],
  ],
  [
    "fitness",
    (db) =>
      disposeBackupFitness(db, {
        dogs: ["own-dog"],
        packages: ["own-package"],
      }),
    "dog_id",
    ["own-dog"],
  ],
  [
    "gift",
    (db) =>
      disposeBackupGifts(db, {
        cards: ["own-card"],
        packages: ["own-package"],
      }),
    "fitness_package_id",
    ["own-package"],
  ],
]) {
  test(`${name} cleanup removes only owned reporting access before its FK parent`, async () => {
    const db = database();
    await dispose(db);
    assert.deepEqual(db.calls[0], {
      table: "care_reporting_entitlements",
      operation: "delete",
      key,
      ids,
    });
    assert(db.calls.length > 1, "Continue with the remaining fixture cleanup");
    for (const call of db.calls)
      assert(call.ids.every((id) => id.startsWith("own-")));
  });

  test(`${name} cleanup propagates a failed reporting-access deletion`, async () => {
    const db = database(true);
    await assert.rejects(dispose(db), { code: "ERR_ASSERTION" });
    assert.equal(
      db.calls.length,
      1,
      "Do not report success or delete a referenced parent after failure",
    );
  });
}
