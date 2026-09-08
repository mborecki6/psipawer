import { describe, it, expect } from "vitest";
import {
  validateRegistration,
  mayAccept,
  canReadLocation,
  canAssignRole,
  kpiUrl,
  mayTransition,
  warsawDate,
} from "../src/lib/domain";
import { warsawLocalToISO } from "../src/lib/time";
import {
  dogSchema,
  profileSchema,
  walkSchema,
} from "../src/lib/validation/schemas";
const valid = {
  guardianId: "owner",
  userId: "owner",
  walkStatus: "open",
  mode: "approval",
  duplicate: false,
};
describe("Critical business rules", () => {
  it("rejects another guardian’s dog", () =>
    expect(() =>
      validateRegistration({ ...valid, userId: "stranger" }),
    ).toThrow());
  it("rejects duplicate registration", () =>
    expect(() =>
      validateRegistration({ ...valid, duplicate: true }),
    ).toThrow());
  it("rejects self-registration for invite walks", () =>
    expect(() => validateRegistration({ ...valid, mode: "invite" })).toThrow());
  it("rejects closed walks", () =>
    expect(() =>
      validateRegistration({ ...valid, walkStatus: "closed" }),
    ).toThrow());
  it("accepts valid approval request", () =>
    expect(() => validateRegistration(valid)).not.toThrow());
  it("capacity counts accepted dogs", () => {
    expect(mayAccept(3, 4)).toBe(true);
    expect(mayAccept(4, 4)).toBe(false);
  });
  it("hides exact location until accepted", () => {
    expect(canReadLocation("client", false)).toBe(false);
    expect(canReadLocation("client", true)).toBe(true);
    expect(canReadLocation("admin", false)).toBe(true);
  });
  it("does not allow public role escalation", () => {
    expect(canAssignRole("client")).toBe(false);
    expect(canAssignRole("admin")).toBe(false);
  });
  it("KPI links carry active filters", () => {
    expect(kpiUrl("pending")).toBe("/admin/walks?filter=pending");
    expect(kpiUrl("today")).toBe("/admin/walks?filter=today");
    expect(kpiUrl("next-six")).toBe("/admin/walks?filter=next-six");
    expect(kpiUrl("due-payments")).toBe("/admin/finance?filter=due");
  });
  it("allows only valid transitions", () => {
    expect(mayTransition("pending", "accepted")).toBe(true);
    expect(mayTransition("withdrawn", "accepted")).toBe(false);
    expect(mayTransition("accepted", "pending")).toBe(false);
    expect(mayTransition("accepted", "cancelled_late")).toBe(true);
  });
  it("uses the Warsaw business day across UTC midnight", () =>
    expect(warsawDate("2026-09-04T22:30:00Z")).toBe("2026-09-05"));
  it("converts summer and winter local times", () => {
    expect(warsawLocalToISO("2026-09-15T10:00")).toBe(
      "2026-09-15T08:00:00.000Z",
    );
    expect(warsawLocalToISO("2026-12-15T10:00")).toBe(
      "2026-12-15T09:00:00.000Z",
    );
  });
  it("rejects DST gap and impossible dates", () => {
    expect(() => warsawLocalToISO("2026-03-29T02:30")).toThrow();
    expect(() => warsawLocalToISO("2026-02-30T10:00")).toThrow();
  });
  it("validates phone and dog weight", () => {
    expect(
      profileSchema.safeParse({ full_name: "Test", phone: "abc", area: "Test" })
        .success,
    ).toBe(false);
    expect(
      dogSchema.safeParse({
        name: "Kluska",
        breed: "",
        approximate_age: "",
        sex: "female",
        weight_kg: -1,
        color: "",
      }).success,
    ).toBe(false);
  });
  it("rejects invalid walk payload", () =>
    expect(walkSchema.safeParse({ capacity: 0, price_cents: -1 }).success).toBe(
      false,
    ));
});
