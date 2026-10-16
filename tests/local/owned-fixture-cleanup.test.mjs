// Mocked cleanup control flow only; no DB, API, accounts or environment files.
import assert from "node:assert/strict";
import { test } from "node:test";
import { cleanupOwnedFixture } from "../helpers/owned-fixture-cleanup.mjs";

test("owned accounts are removed only after data and primary restoration succeed", async () => {
  const calls = [];
  await cleanupOwnedFixture(
    Object.fromEntries(
      ["data", "restore", "accounts"].map((stage) => [
        stage,
        async () => calls.push(stage),
      ]),
    ),
  );
  assert.deepEqual(calls, ["data", "restore", "accounts"]);
});

for (const failedStages of [
  ["data"],
  ["restore"],
  ["data", "restore"],
  ["accounts"],
]) {
  test(`cleanup preserves ${failedStages.join(" and ")} failures and always attempts restore`, async () => {
    const calls = [];
    const causes = failedStages.map(
      (stage) => new Error(`Simulated ${stage} failure`),
    );
    const actions = Object.fromEntries(
      ["data", "restore", "accounts"].map((stage) => [
        stage,
        async () => {
          calls.push(stage);
          const index = failedStages.indexOf(stage);
          if (index >= 0) throw causes[index];
        },
      ]),
    );
    await assert.rejects(cleanupOwnedFixture(actions), (error) => {
      assert(error instanceof AggregateError);
      assert.deepEqual(error.cleanupStages, failedStages);
      assert.deepEqual(error.errors, causes);
      return true;
    });
    assert.deepEqual(
      calls,
      failedStages.includes("accounts")
        ? ["data", "restore", "accounts"]
        : ["data", "restore"],
    );
  });
}
