import type { PGlite } from "@electric-sql/pglite";
// Old financial fixtures all used the same hour. Give independent bookings
// real non-overlapping times while preserving past / future / late-cancel intent.
export async function freeFixtureTime(
  db: PGlite,
  hours: number,
  duration = 60,
) {
  let candidate = new Date(Date.now() + hours * 3600000).toISOString();
  for (let attempt = 0; attempt < 100; attempt++) {
    const end = new Date(
      Date.parse(candidate) + duration * 60000,
    ).toISOString();
    const { rows } = await db.query<{ start: string; end: string }>(
      "select lower(occupied)::text as start,upper(occupied)::text as end from public.calendar_slots where occupied && tstzrange($1,$2,'[)')",
      [candidate, end],
    );
    if (!rows.length) return candidate;
    const next =
      hours < 0
        ? Math.min(...rows.map((r) => Date.parse(r.start))) - duration * 60000
        : Math.max(...rows.map((r) => Date.parse(r.end)));
    candidate = new Date(next).toISOString();
  }
  throw new Error("Fixture calendar exhausted");
}
