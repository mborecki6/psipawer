import { describe, expect, it } from "vitest";
import { getQualificationWarnings } from "../src/lib/qualification";
import type { RegistrationStatus } from "../src/lib/domain";

const now = new Date("2026-09-08T10:00:00Z");
const fixture = () => ({
  dogs: [{ id: "dog", name: "Kluska", status: "approved" }],
  walks: [
    {
      id: "walk",
      status: "open",
      starts_at: "2026-09-09T10:00:00Z",
      public_location: "Park",
    },
  ],
  registrations: [
    {
      id: "registration",
      dog_id: "dog",
      walk_id: "walk",
      status: "accepted" as RegistrationStatus,
      payment_status: "paid",
      package_id: "package",
      decision_note: "Prywatny kontekst, niepotrzebny do ostrzeżenia",
    },
  ],
});

describe("qualification warnings for confirmed walks", () => {
  it("warns after a qualification change and clears after renewed approval", () => {
    const snapshot = fixture();
    expect(getQualificationWarnings(snapshot, now)).toEqual([]);
    for (const status of [
      "needs_review",
      "suspended",
      "not_eligible",
      "consultation_required",
      "new",
    ]) {
      snapshot.dogs[0].status = status;
      expect(getQualificationWarnings(snapshot, now)).toMatchObject([
        { registrationId: "registration", dogStatus: status },
      ]);
    }
    for (const status of ["approved", "approved_conditional"]) {
      snapshot.dogs[0].status = status;
      expect(getQualificationWarnings(snapshot, now)).toEqual([]);
    }
  });

  it("includes upcoming confirmed bookings even when signups are full or closed", () => {
    const snapshot = fixture();
    snapshot.dogs[0].status = "needs_review";
    for (const status of ["open", "full", "closed"]) {
      snapshot.walks[0].status = status;
      expect(getQualificationWarnings(snapshot, now)).toHaveLength(1);
    }
    for (const status of ["cancelled", "completed", "draft"]) {
      snapshot.walks[0].status = status;
      expect(getQualificationWarnings(snapshot, now)).toEqual([]);
    }
  });

  it("does not warn for withdrawn, cancelled or unconfirmed registrations", () => {
    const snapshot = fixture();
    snapshot.dogs[0].status = "suspended";
    const statuses: RegistrationStatus[] = [
      "pending",
      "waitlisted",
      "rejected",
      "withdrawn",
      "cancelled_on_time",
      "cancelled_late",
    ];
    for (const status of statuses) {
      snapshot.registrations[0].status = status;
      expect(getQualificationWarnings(snapshot, now)).toEqual([]);
    }
  });

  it("stops warnings at the start time and ignores invalid or past dates", () => {
    const snapshot = fixture();
    snapshot.dogs[0].status = "needs_review";
    for (const start of [
      "2026-09-08T09:59:59Z",
      "2026-09-08T12:00:00+02:00",
      "invalid date",
    ]) {
      snapshot.walks[0].starts_at = start;
      expect(getQualificationWarnings(snapshot, now)).toEqual([]);
    }
    snapshot.walks[0].starts_at = "2026-09-08T12:00:01+02:00";
    expect(getQualificationWarnings(snapshot, now)).toHaveLength(1);
  });

  it("uses only visible related dogs and walks and orders actionable dates first", () => {
    const snapshot = fixture();
    snapshot.dogs[0].status = "needs_review";
    snapshot.walks.push({
      ...snapshot.walks[0],
      id: "earlier-walk",
      starts_at: "2026-09-08T11:00:00Z",
    });
    snapshot.registrations.push(
      {
        ...snapshot.registrations[0],
        id: "earlier-registration",
        walk_id: "earlier-walk",
      },
      { ...snapshot.registrations[0], id: "other-dog", dog_id: "unseen" },
      { ...snapshot.registrations[0], id: "other-walk", walk_id: "unseen" },
    );
    expect(
      getQualificationWarnings(snapshot, now).map(
        (warning) => warning.registrationId,
      ),
    ).toEqual(["earlier-registration", "registration"]);
  });

  it("does not alter the booking or finances and exposes only alert display fields", () => {
    const snapshot = fixture();
    snapshot.dogs[0].status = "needs_review";
    const before = structuredClone(snapshot);
    expect(getQualificationWarnings(snapshot, now)).toEqual([
      {
        registrationId: "registration",
        dogId: "dog",
        dogName: "Kluska",
        dogStatus: "needs_review",
        walkId: "walk",
        startsAt: "2026-09-09T10:00:00Z",
        publicLocation: "Park",
      },
    ]);
    expect(snapshot).toEqual(before);
  });
});
