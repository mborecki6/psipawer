import { expect } from "@playwright/test";
import { careFixture, careDay } from "./care-journey";
import { test, checked } from "./local-fixtures";

test("another service publication preserves the first follow-up and its real API links", async ({
  browser,
  baseURL,
}) => {
  const f = await careFixture(browser, baseURL);
  try {
    const consultation = crypto.randomUUID();
    await checked(
      f.db.from("consultations").insert({
        id: consultation,
        practice_id: "00000000-0000-4000-8000-000000000001",
        dog_id: f.dog,
        requested_by: f.owner.id,
        topic: "Fikcyjna konsultacja do kontroli niezależnych planów",
        status: "completed",
        starts_at: new Date(Date.now() - 2 * 86400000).toISOString(),
        duration_minutes: 60,
        meeting_mode: "in_person",
        location: "Lokalna sala testowa",
      }),
    );
    const save = async (context: string | null, title: string) =>
      checked(
        f.staffDb.rpc("save_care_plan", {
          p_dog: f.dog,
          p_expected_version: 0,
          p_title: title,
          p_body: `Treść testowa: ${title}`,
          p_follow_up_on: careDay(9),
          p_publish: true,
          p_consultation: context,
        }),
      );
    const earlier = await save(
      consultation,
      "Plan konsultacji przed inną usługą",
    );
    await save(null, "Nowszy ogólny plan niezależny");
    // Exercise the exact formerly ambiguous PostgREST relation, not a mock.
    const tasks = await checked(
      f.staffDb
        .from("care_follow_ups")
        .select(
          "id,plan_id,status,context_key,care_plan_versions(title,revision)",
        )
        .eq("dog_id", f.dog),
    );
    expect(tasks).toHaveLength(2);
    expect(tasks?.every((task) => task.status === "open")).toBe(true);
    const original = tasks!.find(
      (task) => task.plan_id === earlier.published_id,
    )!;
    expect(original).toBeTruthy();
    await f.staff.goto(`/admin/work/follow-ups/${original.id}`);
    await expect(f.staff.getByLabel("Co chcesz zrobić?")).toBeEnabled();
    const link = f.staff.getByRole("link", {
      name: "Plan i odpowiedzi opiekuna →",
    });
    await expect(link).toHaveAttribute(
      "href",
      `/admin/dogs/${f.dog}/care?plan=${earlier.published_id}`,
    );
    await link.click();
    await expect(f.staff.locator("main")).toContainText(
      "Treść testowa: Plan konsultacji przed inną usługą",
    );
    await f.staff.goto(`/admin/work/follow-ups?dog=${f.dog}`);
    await expect(
      f.staff.locator(`a[href="/admin/work/follow-ups/${original.id}"]`),
    ).toBeVisible();
    await expect(f.staff.locator("main")).not.toContainText("Nie udało się");
    expect(
      await checked(
        f.outsiderDb
          .from("care_plan_versions")
          .select("id")
          .eq("dog_id", f.dog),
      ),
    ).toEqual([]);
  } finally {
    await f.dispose();
  }
});
