import "server-only";
import { requireSession } from "@/lib/auth/session";
import { allRows } from "@/lib/data/queries";
import { weekRange } from "./dates";
import type { Appointment, CalendarSettings, WorkingDay } from "./types";
import { reportDataReadError } from "@/lib/observability/server-errors";
export async function getCalendar(staff: boolean, date?: string) {
  const { db } = await requireSession(staff ? "admin" : "client");
  const range = weekRange(date);
  const appointments = await allRows<Appointment>((from, to) =>
    db
      .rpc(
        "calendar_appointments",
        { p_from: range.from, p_to: range.to },
        { get: true },
      )
      .order("starts_at")
      .order("kind")
      .order("id")
      .range(from, to),
  );
  let settings: CalendarSettings | null = null;
  if (staff) {
    const [policy, hours] = await Promise.all([
      db
        .from("calendar_settings")
        .select("version,hours_enabled,before_minutes,after_minutes")
        .single(),
      db
        .from("calendar_weekly_hours")
        .select("weekday,enabled,start_minute,end_minute")
        .order("weekday"),
    ]);
    for (const result of [policy, hours])
      if (result.error) {
        reportDataReadError("calendar.settings", result.error, result.status);
        throw new Error("Nie udało się pobrać ustawień kalendarza.");
      }
    if (!policy.data || hours.data?.length !== 7)
      throw new Error("Nie udało się pobrać ustawień kalendarza.");
    settings = { ...policy.data, week: hours.data as WorkingDay[] };
  }
  return { appointments, range, settings };
}

export async function getNextAppointment() {
  const { db } = await requireSession();
  const from = new Date();
  const to = new Date(from.getTime() + 31 * 86400000);
  // This stable, read-only RPC uses GET. The SDK can safely retry a transient
  // connection failure; mutation RPCs keep their existing POST semantics.
  const { data, error, status } = await db
    .rpc(
      "calendar_appointments",
      {
        p_from: from.toISOString(),
        p_to: to.toISOString(),
      },
      { get: true },
    )
    .neq("kind", "block")
    .neq("status", "completed")
    .order("starts_at")
    .order("kind")
    .order("id")
    .limit(1);
  if (error) {
    reportDataReadError("calendar.next", error, status);
    throw new Error("Nie udało się pobrać najbliższego spotkania.");
  }
  return (data?.[0] as Appointment | undefined) || null;
}
