// The caller supplies this project's local-only PostgreSQL adapter. Never load
// environment files or infer a practitioner from the administrator doing work.
import assert from "node:assert/strict";

const practice = "00000000-0000-4000-8000-000000000001";
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const value = (id) => (id === null ? "null" : `'${id}'`);

/**
 * Select one explicitly owned fixture, or null for a fail-closed scenario.
 * Delete this run's appointments before restore, and restore before its users.
 * @param {{ query(sql: string): Promise<unknown>, json(sql: string): Promise<any> }} database
 * @param {string | null} practitionerId
 */
export async function selectLocalPractitioner(database, practitionerId) {
  assert(
    practitionerId === null || uuid.test(practitionerId),
    "Invalid local fixture practitioner",
  );
  const read = () =>
    database.json(
      `select coalesce(to_json(primary_practitioner_id),'null'::json) from public.calendar_settings where practice_id='${practice}';`,
    );
  const previous = await read();
  assert(
    previous === null || uuid.test(previous),
    "Missing local practice settings",
  );
  if (practitionerId !== null) {
    const owned = await database.json(`select to_json(exists(
      select 1 from auth.users u join public.user_roles r on r.user_id=u.id
      where u.id=${value(practitionerId)} and r.role='admin'
      and u.email like '%@example.test'));`);
    assert.equal(
      owned,
      true,
      "Select an existing local fixture administrator explicitly",
    );
  }
  await database.query(
    `update public.calendar_settings set primary_practitioner_id=${value(practitionerId)} where practice_id='${practice}' and primary_practitioner_id is not distinct from ${value(previous)};`,
  );
  assert.equal(await read(), practitionerId);
  return {
    async restore() {
      const current = await read();
      assert(
        current === practitionerId || current === previous,
        "Another test changed primary; do not overwrite its configuration",
      );
      if (current === previous) return;
      await database.query(
        `update public.calendar_settings set primary_practitioner_id=${value(previous)} where practice_id='${practice}' and primary_practitioner_id is not distinct from ${value(current)};`,
      );
      assert.equal(await read(), previous, "Local primary was not restored");
    },
  };
}
