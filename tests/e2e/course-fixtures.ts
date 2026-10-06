import type { SupabaseClient } from "@supabase/supabase-js";
import { LocalPostgres } from "../helpers/local-postgres.mjs";
import { checked } from "./local-fixtures";

const service = "60000000-0000-4000-8000-000000000001";
export async function courseFixture(
  db: SupabaseClient,
  staff: SupabaseClient,
  owner: SupabaseClient,
  dog: string,
  courses: string[],
  sql: LocalPostgres,
) {
  const catalog = await checked(
    staff.from("services").select("version").eq("id", service).single(),
  );
  const starts = await sql.json(`select to_json(min(t)) from (
    select now()+interval '3 years'+make_interval(days=>n) t from generate_series(1,100) n
  ) candidates where not exists(select 1 from public.calendar_slots slot,generate_series(0,4) week
    where slot.occupied && tstzrange(t+make_interval(days=>week*7),t+make_interval(days=>week*7)+interval '120 minutes','[)'));`);
  if (typeof starts !== "string" || !catalog)
    throw new Error("Missing local course fixture slot");
  const id = crypto.randomUUID(),
    enrollment = crypto.randomUUID();
  courses.push(id);
  await checked(
    staff.rpc("create_course", {
      p_id: id,
      p_service: service,
      p_expected_service_version: catalog.version,
      p_title: "Kurs zaleceń — próba lokalna",
      p_capacity: 2,
      p_public_location: "Próbny park",
      p_exact_location: "FIKCYJNA ZBIÓRKA",
      p_starts: Array.from({ length: 5 }, (_, n) =>
        new Date(Date.parse(starts) + n * 7 * 86400000).toISOString(),
      ),
    }),
  );
  await checked(
    staff.rpc("change_course", {
      p_id: id,
      p_expected_version: 1,
      p_action: "publish",
      p_note: "",
    }),
  );
  await checked(
    owner.rpc("request_course_enrollment", {
      p_id: enrollment,
      p_course: id,
      p_dog: dog,
      p_expected_course_version: 2,
    }),
  );
  await checked(
    staff.rpc("change_course_enrollment", {
      p_id: enrollment,
      p_expected_version: 1,
      p_action: "accept",
      p_note: "",
    }),
  );
  const sessions = await checked(
    db
      .from("course_sessions")
      .select("id,ordinal")
      .eq("course_id", id)
      .order("ordinal"),
  );
  if (!sessions?.length)
    throw new Error("Missing local course fixture sessions");
  return { id, enrollment, sessions };
}
export async function removeCourseCare(
  db: SupabaseClient,
  dogs: string[],
  courses: string[],
) {
  if (dogs.length) {
    const followups = await checked(
      db.from("care_follow_ups").select("id").in("dog_id", dogs),
    );
    if (followups?.length)
      await checked(
        db
          .from("care_follow_up_history")
          .delete()
          .in(
            "follow_up_id",
            followups.map((f) => f.id),
          ),
      );
    for (const table of [
      "care_follow_ups",
      "care_progress",
      "care_events",
      "care_drafts",
      "care_plan_versions",
    ])
      await checked(db.from(table).delete().in("dog_id", dogs));
  }
  if (courses.length)
    await checked(db.from("courses").delete().in("id", courses));
}
