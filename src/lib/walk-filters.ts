import { warsawDate } from "./domain";
import type { Walk, Registration } from "./data/types";

export function filterWalks(
  walks: Walk[],
  registrations: Registration[],
  filter: string,
  now = new Date(),
) {
  const upcoming = walks.filter(
    (w) =>
      new Date(w.starts_at) > now &&
      ["open", "full", "closed"].includes(w.status),
  );
  switch (filter) {
    case "cancelled":
      return walks.filter((w) => w.status === "cancelled");
    case "completed":
      return walks.filter(
        (w) =>
          !["cancelled", "draft"].includes(w.status) &&
          (w.status === "completed" || new Date(w.starts_at) <= now),
      );
    case "today":
      return walks.filter(
        (w) =>
          warsawDate(w.starts_at) === warsawDate(now) &&
          !["cancelled", "draft"].includes(w.status),
      );
    case "pending":
      return upcoming.filter((w) =>
        registrations.some((r) => r.walk_id === w.id && r.status === "pending"),
      );
    case "next-six":
      return upcoming.slice(0, 6);
    default:
      return upcoming;
  }
}
