import { describe, expect, it } from "vitest";
import {
  serviceCategory,
  serviceFilter,
} from "../src/modules/services/catalogue";

describe("service catalogue forms", () => {
  it("uses a course's actual form rather than classifying all courses as group activities", () => {
    expect(
      serviceCategory({
        kind: "course",
        course_format: "individual",
        booking_flow: "catalogue",
      }),
    ).toBe("individual");
    expect(
      serviceCategory({
        kind: "course",
        course_format: "group",
        booking_flow: "catalogue",
      }),
    ).toBe("group");
    expect(
      serviceCategory({
        kind: "course",
        course_format: null,
        booking_flow: "catalogue",
      }),
    ).toBe("other");
  });

  it("separates gift cards and only assigns a package to a known booking form", () => {
    expect(
      serviceCategory({ kind: "voucher", booking_flow: "catalogue" }),
    ).toBe("voucher");
    expect(serviceCategory({ kind: "package", booking_flow: "fitness" })).toBe(
      "individual",
    );
    expect(serviceCategory({ kind: "package", booking_flow: "walk" })).toBe(
      "group",
    );
    expect(
      serviceCategory({ kind: "package", booking_flow: "catalogue" }),
    ).toBe("other");
    expect(
      serviceCategory({ kind: "individual", booking_flow: "consultation" }),
    ).toBe("individual");
    expect(serviceCategory({ kind: "group", booking_flow: "catalogue" })).toBe(
      "group",
    );
  });

  it("treats unknown, missing and repeated URL filters as the full catalogue", () => {
    expect(serviceFilter()).toBe("all");
    expect(serviceFilter("toString")).toBe("all");
    expect(serviceFilter("future-form")).toBe("all");
    expect(serviceFilter(["individual", "group"])).toBe("all");
    expect(serviceFilter("individual")).toBe("individual");
    expect(serviceFilter("group")).toBe("group");
    expect(serviceFilter("voucher")).toBe("voucher");
    expect(serviceFilter("other")).toBe("other");
  });
});
