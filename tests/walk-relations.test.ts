import { expect, it } from "vitest";
import { getWalkRelationWarnings } from "../src/lib/walk-relations";
import type { RegistrationStatus } from "../src/lib/domain";

const relation = {
  id: "ab",
  dog_a: "a",
  dog_b: "b",
  level: "block",
  note: "Nie łączyć",
};
const warnings = (status: RegistrationStatus) =>
  getWalkRelationWarnings(
    [relation],
    [
      { dog_id: "a", status: "accepted" },
      { dog_id: "b", status },
    ],
  );

it.each(["pending", "accepted", "waitlisted"] as const)(
  "warns about an accepted dog and a %s candidate",
  (status) => {
    expect(warnings(status)).toEqual([relation]);
  },
);
it.each([
  "rejected",
  "withdrawn",
  "cancelled_on_time",
  "cancelled_late",
] as const)(
  "removes obsolete warnings after the other registration becomes %s",
  (status) => {
    expect(warnings(status)).toEqual([]);
    expect(warnings("pending")).toEqual([relation]);
  },
);
it("does not warn about absent dogs, harmless relations or two unaccepted candidates", () => {
  expect(
    getWalkRelationWarnings([relation], [{ dog_id: "a", status: "accepted" }]),
  ).toEqual([]);
  expect(
    getWalkRelationWarnings(
      [{ ...relation, level: "good" }],
      [
        { dog_id: "a", status: "accepted" },
        { dog_id: "b", status: "accepted" },
      ],
    ),
  ).toEqual([]);
  expect(
    getWalkRelationWarnings(
      [relation],
      [
        { dog_id: "a", status: "pending" },
        { dog_id: "b", status: "waitlisted" },
      ],
    ),
  ).toEqual([]);
});
