import { describe, expect, it } from "vitest";
import { filterWalks } from "../src/lib/walk-filters";
import type { Walk } from "../src/lib/data/types";
const now = new Date("2026-09-08T10:00:00Z");
const fixture = (id: string, status: string, starts_at: string) =>
  ({ id, status, starts_at }) as Walk;
const walks = [
  fixture("future-cancelled", "cancelled", "2026-09-09T10:00:00Z"),
  fixture("past-cancelled", "cancelled", "2026-09-07T10:00:00Z"),
  fixture("past-draft", "draft", "2026-09-07T10:00:00Z"),
  fixture("past", "open", "2026-09-07T10:00:00Z"),
  fixture("future", "open", "2026-09-09T10:00:00Z"),
];
describe("walk history", () => {
  it("keeps all cancelled terms discoverable without treating them as completed", () => {
    expect(filterWalks(walks, [], "cancelled", now).map((w) => w.id)).toEqual([
      "future-cancelled",
      "past-cancelled",
    ]);
    expect(filterWalks(walks, [], "completed", now).map((w) => w.id)).toEqual([
      "past",
    ]);
    expect(filterWalks(walks, [], "upcoming", now).map((w) => w.id)).toEqual([
      "future",
    ]);
  });
});
