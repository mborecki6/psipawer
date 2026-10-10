import "server-only";
import type { requireSession } from "@/lib/auth/session";
import { allRows } from "@/lib/data/queries";

type Database = Awaited<ReturnType<typeof requireSession>>["db"];
export type BookingAssignment = {
  appointment_id: string;
  assigned_staff_id: string | null;
  resource_id: string | null;
  version: number;
};
export type BookingChoices = {
  defaultStaffId: string;
  staff: { user_id: string; full_name: string }[];
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
  staffId: string,
  source?: {
    kind: "walk" | "consultation" | "course" | "fitness";
    ids: string[];
  },
): Promise<BookingChoices> {
  const [team, resources, assignments] = await Promise.all([
    db.rpc("calendar_team_members", {}, { get: true }),
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
            .select("appointment_id,assigned_staff_id,resource_id,version")
            .eq("kind", source.kind)
            .in("appointment_id", source.ids)
            .order("appointment_id")
            .range(from, to),
        )
      : Promise.resolve([]),
  ]);
  if (team.error || !Array.isArray(team.data))
    throw new Error("Nie udało się pobrać prowadzących i miejsc zajęć.");
  return { defaultStaffId: staffId, staff: team.data, resources, assignments };
}
