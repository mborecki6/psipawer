import { expect, test } from "@playwright/test";
import { mkdirSync } from "node:fs";
import assert from "node:assert/strict";
import { LocalPostgres } from "../helpers/local-postgres.mjs";
import { account, checked, localClients, login } from "./local-fixtures";
import { dateInput, mobileEvidence } from "./walk-journey";

// Real Auth/API/UI, isolated fixture users and events. Preferred breaks may be
// confirmed; actual staff/room collisions remain impossible. No cloud access.
test("team calendar: parallel staff, exclusive rooms, confirmed short breaks, individual hours and all-day leave", async ({
  browser,
  baseURL,
}) => {
  const { db, client } = localClients(baseURL),
    users: string[] = [];
  const sql = await new LocalPostgres().ready();
  const staffContext = await browser.newContext({
    baseURL,
    viewport: { width: 390, height: 900 },
  });
  const ownerContext = await browser.newContext({
    baseURL,
    viewport: { width: 320, height: 900 },
  });
  const staff = await staffContext.newPage(),
    otherEditor = await staffContext.newPage(),
    owner = await ownerContext.newPage();
  const ownerDb = client(),
    staffDb = client();
  const snapshot = `select json_build_object(
    'profiles',(select jsonb_agg(to_jsonb(p) order by id) from public.profiles p),
    'dogs',(select jsonb_agg(to_jsonb(d) order by id) from public.dogs d),
    'settings',(select to_jsonb(s) from public.calendar_settings s),
    'week',(select jsonb_agg(to_jsonb(h) order by weekday) from public.calendar_weekly_hours h),
    'slots',(select coalesce(jsonb_agg(to_jsonb(s) order by occupied,walk_id,consultation_id,block_id,course_session_id,fitness_session_id),'[]') from public.calendar_slots s),
    'assignments',(select coalesce(jsonb_agg(to_jsonb(a) order by kind,appointment_id),'[]') from public.calendar_assignments a));`;
  const original = await sql.json(snapshot);
  let phase = "accounts";
  const suffix = crypto.randomUUID().slice(0, 8);
  const roomName = `Sala testowa ${suffix}`;
  const rhythm = (page = staff) => page.locator("#calendar-settings");
  const open = async (id: string, page = staff) => {
    await page.goto(`/admin/settings/calendar?staff=${id}`);
    await expect(
      rhythm(page).getByRole("button", { name: "Zapisz rytm pracy" }),
    ).toBeEnabled();
  };
  try {
    const anna = await account(db, users, "admin"),
      jan = await account(db, users, "admin"),
      guardian = await account(db, users, "client");
    await checked(
      db
        .from("profiles")
        .update({ full_name: `Anna ${suffix}` })
        .eq("id", anna.id),
    );
    await checked(
      db
        .from("profiles")
        .update({ full_name: `Jan ${suffix}` })
        .eq("id", jan.id),
    );
    await checked(ownerDb.auth.signInWithPassword(guardian));
    await checked(staffDb.auth.signInWithPassword(anna));
    await login(staff, anna, "admin");
    await login(owner, guardian, "client");

    phase = "room-creation";
    await staff.goto("/admin/settings/calendar");
    await staff.getByText("Miejsca i wspólne sale", { exact: true }).click();
    const addSummary = staff
      .locator("summary")
      .filter({ hasText: /^Dodaj miejsce$/ });
    await addSummary.click();
    const addPlace = addSummary.locator("..");
    await addPlace.getByLabel("Nazwa miejsca").fill(roomName);
    await addPlace
      .getByRole("button", { name: "Dodaj miejsce", exact: true })
      .click();
    await expect(addPlace.getByRole("status")).toContainText(
      "Miejsce zapisane",
    );
    const room = await checked(
      db
        .from("calendar_resources")
        .select("id,exclusive")
        .eq("name", roomName)
        .single(),
    );
    assert(room);
    expect(room.exclusive).toBe(true);

    phase = "individual-rhythm-and-stale-editor";
    await open(anna.id);
    await open(anna.id, otherEditor);
    await rhythm().getByLabel("Korzystaj z domyślnego rytmu zespołu").uncheck();
    await rhythm().getByLabel("Pilnuj godzin pracy").uncheck();
    await rhythm().getByLabel("Przerwa przed spotkaniem (min)").fill("0");
    await rhythm().getByLabel("Przerwa po spotkaniu (min)").fill("30");
    await rhythm().getByRole("button", { name: "Zapisz rytm pracy" }).click();
    await expect(rhythm().getByRole("status")).toContainText(
      "Rytm pracy prowadzącego zapisany",
    );
    await rhythm(otherEditor)
      .getByLabel("Korzystaj z domyślnego rytmu zespołu")
      .uncheck();
    await rhythm(otherEditor)
      .getByLabel("Przerwa po spotkaniu (min)")
      .fill("45");
    await rhythm(otherEditor)
      .getByRole("button", { name: "Zapisz rytm pracy" })
      .click();
    await expect(rhythm(otherEditor).getByRole("alert")).toContainText(
      "zmieniły się",
    );
    await expect(
      rhythm(otherEditor).getByLabel("Przerwa po spotkaniu (min)"),
    ).toHaveValue("45");

    const start = await sql.json(`select to_json(min(t)) from (
      select ((now() at time zone 'Europe/Warsaw')::date+interval '3 years'+make_interval(days=>n)+interval '10 hours') at time zone 'Europe/Warsaw' t from generate_series(1,90) n
      ) candidates where extract(isodow from t at time zone 'Europe/Warsaw')=1
      and not exists(select 1 from public.calendar_slots s where s.base_occupied && tstzrange(t,t+interval '2 days','[)'));`);
    expect(typeof start).toBe("string");
    const day = dateInput(start).slice(0, 10);
    const later = (minutes: number) =>
      new Date(Date.parse(start) + minutes * 60000).toISOString();
    async function prepareWalk(
      at: string,
      location: string,
      lead: string,
      place = "",
    ) {
      await staff.goto("/admin/walks/new");
      await staff.getByLabel("Termin (czas polski)").fill(dateInput(at));
      await staff.getByLabel("Czas trwania w minutach").fill("60");
      await staff.getByLabel("Ogólna lokalizacja").fill(location);
      await staff
        .getByLabel("Dokładne miejsce zbiórki")
        .fill(`FIKCYJNA ZBIÓRKA ${suffix}`);
      await staff.getByLabel("Prowadzący", { exact: true }).selectOption(lead);
      await staff
        .getByLabel("Sala do rezerwacji (opcjonalnie)")
        .selectOption(place);
    }
    async function submitWalk() {
      await staff
        .getByRole("button", { name: "Utwórz spacer", exact: true })
        .click();
    }
    async function savedWalk() {
      await expect(staff).toHaveURL(/\/admin\/walks\/[a-f0-9-]+\?saved=1$/);
      return new URL(staff.url()).pathname.split("/").at(-1)!;
    }

    phase = "short-break-confirmation";
    await prepareWalk(start, `Pierwszy ${suffix}`, anna.id, room.id);
    await submitWalk();
    const first = await savedWalk();
    await prepareWalk(later(75), `Krótka przerwa ${suffix}`, anna.id, room.id);
    await submitWalk();
    const warning = staff.locator("form").getByRole("alert");
    await expect(warning).toContainText("krótszą przerwę");
    await expect(warning).toContainText("15 min");
    await expect(staff.getByLabel("Termin (czas polski)")).toHaveValue(
      dateInput(later(75)),
    );
    await expect(staff.getByLabel("Prowadzący", { exact: true })).toHaveValue(
      anna.id,
    );
    await expect(
      staff.getByLabel("Sala do rezerwacji (opcjonalnie)"),
    ).toHaveValue(room.id);
    expect(
      await checked(
        db
          .from("walks")
          .select("id")
          .eq("public_location", `Krótka przerwa ${suffix}`),
      ),
    ).toEqual([]);
    await staff
      .getByLabel("Sprawdziłem przerwę i chcę zapisać ten termin.")
      .check();
    await submitWalk();
    await savedWalk();

    phase = "exclusive-room-and-parallel-staff";
    await prepareWalk(start, `Równoległy ${suffix}`, jan.id, room.id);
    await submitWalk();
    await expect(staff.locator("form").getByRole("alert")).toContainText(
      "już zajęty",
    );
    await expect(
      staff.getByLabel("Sprawdziłem przerwę i chcę zapisać ten termin."),
    ).toHaveCount(0);
    await staff.getByLabel("Sala do rezerwacji (opcjonalnie)").selectOption("");
    await submitWalk();
    const parallel = await savedWalk();
    const assignments = await checked(
      db
        .from("calendar_assignments")
        .select("appointment_id,assigned_staff_id,resource_id,created_by")
        .in("appointment_id", [first, parallel]),
    );
    assert(assignments);
    expect(assignments.find((a) => a.appointment_id === first)).toMatchObject({
      assigned_staff_id: anna.id,
      resource_id: room.id,
      created_by: anna.id,
    });
    expect(
      assignments.find((a) => a.appointment_id === parallel),
    ).toMatchObject({
      assigned_staff_id: jan.id,
      resource_id: null,
      created_by: anna.id,
    });

    phase = "calendar-reassignment-conflict";
    await staff.goto(`/admin/calendar?date=${day}`);
    const firstCard = staff.locator(
      `article[id^="appointment-walk-${first}-"]`,
    );
    await firstCard.getByText("Prowadzący i miejsce", { exact: true }).click();
    await firstCard
      .getByLabel("Prowadzący", { exact: true })
      .selectOption(jan.id);
    await firstCard.getByRole("button", { name: "Zapisz przypisanie" }).click();
    await expect(firstCard.getByRole("alert")).toContainText("już zajęty");
    await expect(
      firstCard.getByLabel("Prowadzący", { exact: true }),
    ).toHaveValue(jan.id);
    const unchangedAssignment = await checked(
      db
        .from("calendar_assignments")
        .select("assigned_staff_id")
        .eq("kind", "walk")
        .eq("appointment_id", first)
        .single(),
    );
    assert(unchangedAssignment);
    expect(unchangedAssignment.assigned_staff_id).toBe(anna.id);

    phase = "individual-hours-and-all-day-leave";
    await open(jan.id);
    await rhythm().getByLabel("Korzystaj z domyślnego rytmu zespołu").uncheck();
    await rhythm().getByLabel("Pilnuj godzin pracy").check();
    await rhythm().getByLabel("Przerwa przed spotkaniem (min)").fill("0");
    await rhythm().getByLabel("Przerwa po spotkaniu (min)").fill("0");
    await rhythm().getByRole("button", { name: "Zapisz rytm pracy" }).click();
    await expect(rhythm().getByRole("status")).toContainText(
      "Rytm pracy prowadzącego zapisany",
    );
    await prepareWalk(later(-120), `Poza godzinami ${suffix}`, jan.id);
    await submitWalk();
    await expect(staff.locator("form").getByRole("alert")).toContainText(
      "wykracza poza godziny pracy",
    );
    await expect(staff.getByLabel("Termin (czas polski)")).toHaveValue(
      dateInput(later(-120)),
    );
    const tuesday = dateInput(later(24 * 60)).slice(0, 10);
    await staff.goto(`/admin/calendar?date=${tuesday}`);
    await staff.getByText("Zarezerwuj czas", { exact: true }).click();
    const block = staff.locator("#calendar-block-editor");
    await block.getByLabel("Nazwa blokady").fill(`Urlop Jana ${suffix}`);
    await block.getByLabel("Cały dzień", { exact: true }).check();
    await block.getByLabel("Od dnia", { exact: true }).fill(tuesday);
    await expect(block.getByLabel("Do dnia (włącznie)")).toHaveValue(tuesday);
    await block.getByLabel("Prowadzący", { exact: true }).selectOption(jan.id);
    await block
      .getByRole("button", { name: "Zablokuj czas", exact: true })
      .click();
    await expect(block.getByRole("status")).toContainText("Czas zablokowany");
    const leave = await checked(
      db
        .from("calendar_blocks")
        .select("starts_at,ends_at")
        .eq("title", `Urlop Jana ${suffix}`)
        .single(),
    );
    assert(leave);
    expect(dateInput(leave.starts_at)).toBe(`${tuesday}T00:00`);
    expect(Date.parse(leave.ends_at) - Date.parse(leave.starts_at)).toBe(
      86400000,
    );
    await prepareWalk(later(24 * 60), `W urlop ${suffix}`, jan.id);
    await submitWalk();
    await expect(staff.locator("form").getByRole("alert")).toContainText(
      "już zajęty",
    );
    await staff.getByLabel("Prowadzący", { exact: true }).selectOption(anna.id);
    await submitWalk();
    await savedWalk();

    phase = "month-privacy-and-mobile";
    await staff.goto(`/admin/calendar?date=${day}&view=month`);
    await expect(
      staff.getByText(
        "Wybierz dzień, żeby zobaczyć godziny i szczegóły w widoku tygodnia.",
      ),
    ).toBeVisible();
    mkdirSync("output/calendar", { recursive: true });
    await mobileEvidence(staff, "output/calendar/team-month-390.png");
    await staff.goto(`/admin/settings/calendar?staff=${jan.id}`);
    await staff.setViewportSize({ width: 320, height: 900 });
    await mobileEvidence(staff, "output/calendar/team-hours-320.png");
    await owner.goto("/app/calendar?date=2028-10-10&view=month");
    await expect(owner.getByLabel("Kalendarz: październik 2028")).toBeVisible();
    await expect(
      owner.getByRole("link", { name: /zaplanowanych|bez spotkań/ }),
    ).toHaveCount(42);
    await expect(owner.getByLabel("Kalendarz prowadzącego")).toHaveCount(0);
    await expect(owner.getByText(roomName, { exact: false })).toHaveCount(0);
    await expect(
      owner.getByText(`Urlop Jana ${suffix}`, { exact: true }),
    ).toHaveCount(0);
    for (const table of [
      "calendar_resources",
      "calendar_assignments",
      "calendar_staff_settings",
      "calendar_staff_weekly_hours",
    ])
      expect(await checked(ownerDb.from(table).select("*"))).toEqual([]);
    expect(
      (
        await ownerDb.rpc(
          "calendar_team_appointments",
          { p_from: start, p_to: later(24 * 60) },
          { get: true },
        )
      ).error?.message,
    ).toContain("Brak uprawnień");
    expect(
      (
        await ownerDb.rpc(
          "calendar_staff_preferences",
          { p_staff_id: anna.id },
          { get: true },
        )
      ).error?.message,
    ).toContain("Brak uprawnień");
    const legacy = await staffDb.rpc(
      "calendar_team_appointments",
      { p_from: start, p_to: later(24 * 60) },
      { get: true },
    );
    expect(legacy.error).toBeNull();
  } catch (error) {
    const lines = [
      ...String(error instanceof Error ? error.stack : "").matchAll(
        /calendar-availability\.spec\.ts:(\d+):\d+/g,
      ),
    ].map((m) => Number(m[1]));
    console.error(JSON.stringify({ phase, ownLines: lines }));
    throw new Error(
      `Lokalny kalendarz nie przeszedł etapu ${phase}; treści i poświadczenia pominięto.`,
    );
  } finally {
    await staffContext.close();
    await ownerContext.close();
    if (users.length) {
      await checked(db.from("walks").delete().in("leader_id", users));
      await checked(
        db.from("calendar_blocks").delete().in("updated_by", users),
      );
      await checked(
        db.from("calendar_resources").delete().in("created_by", users),
      );
      await checked(db.from("audit_events").delete().in("actor_id", users));
      await checked(
        db.from("calendar_staff_settings").delete().in("staff_id", users),
      );
      for (const id of users) await checked(db.auth.admin.deleteUser(id));
    }
    expect(await sql.json(snapshot)).toEqual(original);
    await ownerDb.auth.signOut();
    await staffDb.auth.signOut();
    await sql.close();
  }
});
