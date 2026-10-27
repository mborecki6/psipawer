import { expect, it } from "vitest";
import { workHref, workReturnTo, type WorkItem } from "../src/modules/work/types";

it("retains the work filter and page and permits the dashboard", () => {
  expect(workReturnTo("/admin")).toBe("/admin");
  expect(workReturnTo("/admin/work?page=3&filter=profiles")).toBe("/admin/work?filter=profiles&page=3");
  expect(workReturnTo("/admin/work?filter=bad&page=0")).toBe("/admin/work?filter=all&page=1");
});
it.each([undefined, null, 3, ["/admin", "/admin/work"], {}, "https://example.com/admin/work", "//example.com/admin/work", "/admin/work-other", "/admin/work/../settings", "/admin/work?next=https://example.com", "/app/work"])(
  "rejects an untrusted return destination %j without throwing",
  (value) => expect(workReturnTo(value)).toBeNull(),
);
it("adds an internal return destination without losing the selected registration", () => {
  const item = { kind: "walks", id: "registration", source_id: "walk" } as WorkItem;
  expect(workHref(item, "/admin/work?filter=walks&page=2")).toBe("/admin/walks/walk?returnTo=%2Fadmin%2Fwork%3Ffilter%3Dwalks%26page%3D2#registration-registration");
  expect(workHref(item, "https://example.com")).toBe("/admin/walks/walk#registration-registration");
});
