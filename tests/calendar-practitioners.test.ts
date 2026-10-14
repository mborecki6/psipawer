import { afterEach, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("@/lib/data/queries", () => ({
  allRows: async (
    query: (from: number, to: number) => PromiseLike<{ data: unknown[] }>,
  ) => (await query(0, 499)).data,
}));
import { calendarPractitioners } from "../src/modules/calendar/practitioners";
import { getBookingChoices } from "../src/modules/calendar/booking-queries";

const asia = "10000000-0000-4000-8000-000000000001";
const administrator = "10000000-0000-4000-8000-000000000002";
const members = [
  { user_id: administrator, full_name: "Administrator" },
  { user_id: asia, full_name: "Asia" },
];
afterEach(() => vi.unstubAllEnvs());

it("selects the configured practitioner and retains a separate administrator directory", () => {
  expect(calendarPractitioners(members, ` ${asia.toUpperCase()} `)).toEqual({
    activeMembers: [members[1]],
    defaultStaffId: asia,
  });
  expect(members).toHaveLength(2);
});

it.each(["", "not-a-uuid", "10000000-0000-4000-8000-000000000099"])(
  "does not infer a practitioner from an administrator when configuration is unavailable: %s",
  (configured) => {
    expect(calendarPractitioners(members, configured)).toEqual({
      activeMembers: [],
      defaultStaffId: null,
    });
  },
);

it("gives the same default to appointments created by the practitioner and by an administrator", async () => {
  let primary: string | null = asia;
  const rpc = vi.fn(async (name: string) => ({
    data: name === "calendar_primary_practitioner" ? primary : members,
    error: null,
  }));
  const from = vi.fn(() => {
    const query = {
      select: vi.fn(() => query),
      order: vi.fn(() => query),
      range: vi.fn().mockResolvedValue({ data: [], error: null }),
    };
    return query;
  });
  const db = { rpc, from } as unknown as Parameters<
    typeof getBookingChoices
  >[0];
  for (const actor of [asia, administrator]) {
    expect(await getBookingChoices(db, actor)).toMatchObject({
      defaultStaffId: asia,
      staff: members,
    });
  }
  expect(rpc).toHaveBeenCalledWith("calendar_team_members", {}, { get: true });
  expect(rpc).toHaveBeenCalledWith(
    "calendar_primary_practitioner",
    {},
    { get: true },
  );
  primary = null;
  expect(await getBookingChoices(db, administrator)).toMatchObject({
    defaultStaffId: null,
    staff: members,
  });
});
