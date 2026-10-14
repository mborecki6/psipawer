/** Explicit configuration for an already seeded, disposable database account. */
export async function configureCalendarPrimary(database, staffId) {
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      staffId,
    )
  )
    throw new Error("Invalid calendar fixture practitioner");
  await database.query(
    `update public.calendar_settings set primary_practitioner_id='${staffId}' where practice_id='00000000-0000-4000-8000-000000000001';`,
  );
}
