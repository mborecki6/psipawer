import "server-only";
import type { CalendarTeamMember } from "./types";

/** App administrators and people conducting appointments are separate choices. */
export function calendarPractitioners(
  members: CalendarTeamMember[],
  configuredId: string | null | undefined,
) {
  const id = configuredId?.trim().toLowerCase();
  const valid =
    id &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id);
  const primary = valid
    ? members.find((member) => member.user_id.toLowerCase() === id)
    : undefined;
  return {
    activeMembers: primary ? [primary] : [],
    defaultStaffId: primary?.user_id || null,
  };
}
