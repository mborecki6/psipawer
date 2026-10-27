import { expect, type Locator } from "@playwright/test";
import { checked, test } from "./local-fixtures";
import { careScreenshot } from "./care-journey";
import { walkJourney } from "./walk-journey";
import {
  prepareWalkAttendance,
  submitWalkAttendance,
  submitWalkDecision,
} from "./walk-roster-ui";
import { loseCommittedReply } from "./transport-journey";

test.use({ trace: "off" });

async function touchTargets(card: Locator, width: number) {
  for (const button of await card
    .getByRole("button", {
      name: /^(Był|Nie był · płatne|Przyjmij|Nie przyjmuj):/,
    })
    .all()) {
    const box = await button.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.width).toBeGreaterThanOrEqual(44);
    expect(box!.height).toBeGreaterThanOrEqual(44);
    expect(box!.x).toBeGreaterThanOrEqual(-1);
    expect(box!.x + box!.width).toBeLessThanOrEqual(width + 1);
  }
}

test("walk roster: direct decisions, visible complete roster, one-tap attendance and retained lost reply", async ({
  browser,
  baseURL,
}) => {
  const j = await walkJourney(browser, baseURL);
  try {
    const walk = await j.createWalk("Lista drużyny", { capacity: 2 });
    const first = await j.submit(walk);
    const dogName = (await checked(
      j.db.from("dogs").select("name").eq("id", j.dogs[0]).single(),
    ))!.name;
    const secondDog = crypto.randomUUID();
    j.dogs.push(secondDog);
    const secondName = `Runa skład ${j.suffix}`;
    await checked(
      j.db.from("dogs").insert({
        id: secondDog,
        guardian_id: j.other.id,
        name: secondName,
      }),
    );
    const qualification = (await checked(
      j.db
        .from("dogs")
        .select("status,qualification_version")
        .eq("id", secondDog)
        .single(),
    ))!;
    await checked(
      j.staffDb.rpc("qualify_dog", {
        p_request_id: crypto.randomUUID(),
        p_dog: secondDog,
        p_expected_status: qualification.status,
        p_expected_version: qualification.qualification_version,
        p_status: "approved",
        p_note:
          "Fikcyjna kwalifikacja drugiego psa lokalnego scenariusza składu.",
      }),
    );
    await checked(
      j.otherDb.rpc("register_dog", { p_walk: walk, p_dog: secondDog }),
    );
    const second = (await checked(
      j.db
        .from("walk_registrations")
        .select("id")
        .eq("walk_id", walk)
        .eq("dog_id", secondDog)
        .single(),
    ))!.id;
    await j.staff.goto(`/admin/walks/${walk}`);
    const firstRow = j.staff.locator(`#registration-${first}`);
    const secondRow = j.staff.locator(`#registration-${second}`);
    for (const row of [firstRow, secondRow]) {
      await expect(
        row.getByRole("button", { name: /^Przyjmij:/ }),
      ).toBeVisible();
      await expect(
        row.getByRole("button", { name: /^Nie przyjmuj:/ }),
      ).toBeVisible();
      await expect(row.getByRole("combobox")).toHaveCount(0);
    }
    for (const width of [320, 390, 768, 1440]) {
      await careScreenshot(
        j.staff,
        test.info().outputPath(`walk-decisions-${width}.png`),
        width,
      );
      await touchTargets(firstRow, width);
      await touchTargets(secondRow, width);
    }
    // Empty refusal remains allowed for walks; course refusals have a different rule.
    await submitWalkDecision(secondRow, "rejected");
    await expect(secondRow.getByRole("status")).toContainText(
      "Decyzja zapisana",
    );
    expect(
      await checked(
        j.db
          .from("walk_registrations")
          .select("status,decision_note")
          .eq("id", second)
          .single(),
      ),
    ).toMatchObject({ status: "rejected", decision_note: "" });
    await submitWalkDecision(secondRow, "pending");
    await expect(
      secondRow.getByRole("button", { name: /^Przyjmij:/ }),
    ).toBeVisible();
    await submitWalkDecision(firstRow, "accepted");
    await expect(firstRow.getByRole("status")).toContainText(
      "Decyzja zapisana",
    );
    await submitWalkDecision(secondRow, "accepted");
    await expect(secondRow.getByRole("status")).toContainText(
      "Decyzja zapisana",
    );
    for (const row of [firstRow, secondRow]) {
      await expect(row.getByText("W składzie", { exact: true })).toBeVisible();
      await expect(
        row.getByText("Nieoznaczono", { exact: true }),
      ).toBeVisible();
      await expect(
        row.getByText("Obecność oznaczysz po rozpoczęciu spaceru.", {
          exact: true,
        }),
      ).toBeVisible();
    }
    await j.guardian.goto(`/app/walks/${walk}`);
    await expect(j.guardian.locator(".registration-card")).toHaveCount(1);
    await expect(
      j.guardian.getByText(secondName, { exact: false }),
    ).toHaveCount(0);
    await expect(
      j.guardian.getByRole("button", {
        name: /^(Był|Nie był|Przyjmij|Nie przyjmuj|Usprawiedliw):/,
      }),
    ).toHaveCount(0);
    await j.isolated(first);

    await j.setPhase(walk, "past");
    await j.staff.goto(`/admin/walks/${walk}`);
    const paymentsBefore = await j.payments("registration", first);
    const button = firstRow.getByRole("button", {
      name: `Był: ${dogName}`,
      exact: true,
    });
    const form = firstRow.getByRole("form", {
      name: `Obecność: ${dogName}`,
      exact: true,
    });
    await button.focus();
    expect(
      await button.evaluate(
        (element) => getComputedStyle(element).outlineStyle,
      ),
    ).not.toBe("none");
    await loseCommittedReply(
      j.staff,
      form,
      first,
      async () => {
        expect(await j.registration(first)).toMatchObject({
          attendance: "present",
        });
      },
      button,
      firstRow,
    );
    await expect(firstRow.getByRole("alert")).toBeFocused();
    await expect(firstRow).toContainText("Niepotwierdzona operacja: Był");
    await submitWalkAttendance(secondRow, "no_show");
    await expect(secondRow.getByRole("status")).toContainText(
      "Obecność zapisana",
    );
    await expect(firstRow.getByRole("alert")).toBeVisible();
    await expect(firstRow).toContainText("Niepotwierdzona operacja: Był");
    const audit = () =>
      checked(
        j.staffDb
          .from("audit_events")
          .select("id,details")
          .eq("entity_id", first)
          .eq("event", "attendance_changed"),
      );
    const committedAudit = await audit();
    expect(committedAudit).toHaveLength(1);
    await firstRow
      .getByRole("button", {
        name: `Ponów ten sam zapis: ${dogName}`,
        exact: true,
      })
      .click();
    await expect(firstRow.getByRole("status")).toContainText(
      "Obecność zapisana",
    );
    expect(await audit()).toEqual(committedAudit);
    expect(await j.payments("registration", first)).toEqual(paymentsBefore);
    expect(await j.registration(first)).toMatchObject({
      attendance: "present",
      payment_status: "due",
    });
    expect(
      await checked(
        j.db
          .from("walk_registrations")
          .select("attendance,payment_status")
          .eq("id", second)
          .single(),
      ),
    ).toMatchObject({ attendance: "no_show", payment_status: "due" });
    for (const width of [320, 390, 768, 1440]) {
      await careScreenshot(
        j.staff,
        test.info().outputPath(`walk-attendance-${width}.png`),
        width,
      );
      await touchTargets(firstRow, width);
      await touchTargets(secondRow, width);
    }
    const excuse = await prepareWalkAttendance(firstRow, "absent");
    await expect(
      firstRow.getByRole("form", { name: /^Korekta obecności:/ }),
    ).toContainText("zwalnia z opłaty");
    await excuse.click();
    await expect(firstRow.getByRole("status")).toContainText(
      "Obecność zapisana",
    );
    expect(await j.registration(first)).toMatchObject({
      attendance: "absent",
      payment_status: "none",
    });
    expect(await j.payments("registration", first)).toEqual(paymentsBefore);
  } finally {
    await j.dispose();
  }
});
