import "server-only";
import type { requireSession } from "@/lib/auth/session";
import { allRows } from "@/lib/data/queries";
import { calendarPractitioners } from "./practitioners";
import type { CalendarTeamMember } from "./types";

type Database = Awaited<ReturnType<typeof requireSession>>["db"];
export type BookingAssignment = {
  appointment_id: string;
  assigned_staff_id: string | null;
  resource_id: string | null;
  version: number;
  legacy_unassigned?: boolean;
  booked_interval?: string | null;
};
export type BookingChoices = {
  defaultStaffId: string | null;
  staff: CalendarTeamMember[];
  resources: {
    id: string;
    name: string;
    exclusive: boolean;
    active: boolean;
  }[];
  assignments: BookingAssignment[];
};

/** Called only after the source page has verified an admin session. */
export async function getBookingChoices(
  db: Database,
  _actorId: string,
  source?: {
    kind: "walk" | "consultation" | "course" | "fitness";
    ids: string[];
  },
): Promise<BookingChoices> {
  // Preserve the existing call signature; the author does not select a practitioner.
  void _actorId;
  const [team, primary, resources, assignments] = await Promise.all([
    db.rpc("calendar_team_members", {}, { get: true }),
    db.rpc("calendar_primary_practitioner", {}, { get: true }),
    allRows<BookingChoices["resources"][number]>((from, to) =>
      db
        .from("calendar_resources")
        .select("id,name,exclusive,active")
        .order("name")
        .order("id")
        .range(from, to),
    ),
    source?.ids.length
      ? allRows<BookingAssignment>((from, to) =>
          db
            .from("calendar_assignments")
            .select(
              "appointment_id,assigned_staff_id,resource_id,version,legacy_unassigned,booked_interval",
            )
            .eq("kind", source.kind)
            .in("appointment_id", source.ids)
            .order("appointment_id")
            .range(from, to),
        )
      : Promise.resolve([]),
  ]);
  if (team.error || primary.error || !Array.isArray(team.data))
    throw new Error("Nie udało się pobrać prowadzących i miejsc zajęć.");
  const staff = team.data as CalendarTeamMember[];
  return {
    defaultStaffId: calendarPractitioners(staff, primary.data).defaultStaffId,
    staff,
    resources,
    assignments,
  };
}
