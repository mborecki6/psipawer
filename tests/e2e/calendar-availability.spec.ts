import { expect, test } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { LocalPostgres, literal as q } from "../helpers/local-postgres.mjs";
import { account, checked, localClients, login } from "./local-fixtures";
import { dateInput, mobileEvidence } from "./walk-journey";

test("working rhythm: version conflicts, atomic buffers, weekly hours and private mobile panels", async ({
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
  const ownerDb = client();
  const original = await sql.json(
    "select json_build_object('settings',(select to_jsonb(s) from public.calendar_settings s),'week',(select jsonb_agg(to_jsonb(h) order by weekday) from public.calendar_weekly_hours h),'slots',(select coalesce(jsonb_agg(to_jsonb(s) order by occupied),'[]') from public.calendar_slots s));",
  );
  let phase = "accounts";
  const rhythm = (page = staff) => page.locator("#calendar-settings");
  const open = async (page = staff) => {
    await page.goto("/admin/calendar");
    await rhythm(page).locator("summary").click();
    await expect(
      rhythm(page).getByRole("button", { name: "Zapisz rytm pracy" }),
    ).toBeEnabled();
  };
  const save = async () => {
    await rhythm().getByRole("button", { name: "Zapisz rytm pracy" }).click();
  };
  try {
    const admin = await account(db, users, "admin"),
      guardian = await account(db, users, "client");
    await checked(ownerDb.auth.signInWithPassword(guardian));
    await login(staff, admin, "admin");
    await login(owner, guardian, "client");
    await open();
    await open(otherEditor);
    phase = "first-policy-and-stale-editor";
    await rhythm().getByLabel("Przerwa przed spotkaniem (min)").fill("15");
    await save();
    await expect(rhythm().getByRole("status")).toContainText(
      "Ustawienia zapisane",
    );
    await rhythm(otherEditor)
      .getByLabel("Przerwa przed spotkaniem (min)")
      .fill("30");
    await rhythm(otherEditor)
      .getByRole("button", { name: "Zapisz rytm pracy" })
      .click();
    await expect(rhythm(otherEditor).getByRole("alert")).toContainText(
      "zmieniły się",
    );
    await expect(
      rhythm(otherEditor).getByLabel("Przerwa przed spotkaniem (min)"),
    ).toHaveValue("30");
    const start = await sql.json(`select to_json(min(t)) from (
      select ((now() at time zone 'Europe/Warsaw')::date+interval '3 years'+make_interval(days=>n)+interval '10 hours') at time zone 'Europe/Warsaw' t from generate_series(1,30) n
      ) candidates where not exists(select 1 from public.calendar_slots s where upper(s.base_occupied)>now()
        and (extract(isodow from lower(s.base_occupied) at time zone 'Europe/Warsaw')=extract(isodow from t at time zone 'Europe/Warsaw')
          or extract(isodow from upper(s.base_occupied) at time zone 'Europe/Warsaw')=extract(isodow from t at time zone 'Europe/Warsaw')));`);
    expect(typeof start).toBe("string");
    const day = dateInput(start).slice(0, 10);
    async function walkAt(at: string, location: string) {
      await staff.goto("/admin/walks/new");
      await staff.getByLabel("Termin (czas polski)").fill(dateInput(at));
      await staff.getByLabel("Czas trwania w minutach").fill("60");
      await staff.getByLabel("Ogólna lokalizacja").fill(location);
      await staff
        .getByLabel("Dokładne miejsce zbiórki")
        .fill("FIKCYJNA ZBIÓRKA");
      await staff
        .getByRole("button", { name: "Utwórz spacer", exact: true })
        .click();
      await expect(staff).toHaveURL(/\/admin\/walks\/[a-f0-9-]+\?saved=1$/);
      return new URL(staff.url()).pathname.split("/").at(-1)!;
    }
    phase = "buffer-recalculation";
    const first = await walkAt(start, "Fikcyjny rytm pierwszy");
    await walkAt(
      new Date(Date.parse(start) + 75 * 60000).toISOString(),
      "Fikcyjny rytm drugi",
    );
    await open();
    await rhythm().getByLabel("Przerwa przed spotkaniem (min)").fill("0");
    await rhythm().getByLabel("Przerwa po spotkaniu (min)").fill("15");
    await save();
    await expect(rhythm().getByRole("status")).toContainText(
      "Ustawienia zapisane",
    );
    const slots = await sql.json(
      "select jsonb_agg(to_jsonb(s) order by occupied) from public.calendar_slots s;",
    );
    await rhythm().getByLabel("Przerwa po spotkaniu (min)").fill("30");
    await save();
    await expect(rhythm().getByRole("alert")).toContainText(
      "kolizję istniejących terminów",
    );
    await expect(rhythm().getByLabel("Przerwa po spotkaniu (min)")).toHaveValue(
      "30",
    );
    expect(
      await sql.json(
        "select jsonb_agg(to_jsonb(s) order by occupied) from public.calendar_slots s;",
      ),
    ).toEqual(slots);
    expect(
      await sql.json(
        "select to_json(after_minutes) from public.calendar_settings;",
      ),
    ).toBe(15);
    phase = "weekly-hours";
    await rhythm().getByLabel("Przerwa po spotkaniu (min)").fill("15");
    await rhythm().getByLabel("Pilnuj godzin pracy").check();
    const weekday = await sql.json(
      `select to_json(extract(isodow from ${q(start)}::timestamptz at time zone 'Europe/Warsaw')::integer);`,
    );
    const names = [
      "Poniedziałek",
      "Wtorek",
      "Środa",
      "Czwartek",
      "Piątek",
      "Sobota",
      "Niedziela",
    ];
    for (const [i, name] of names.entries()) {
      await rhythm().getByLabel(name, { exact: true }).check();
      await rhythm()
        .getByLabel(new RegExp(`^Od.*${name}`))
        .selectOption(String(i + 1 === weekday ? 540 : 0));
      await rhythm()
        .getByLabel(new RegExp(`^Do.*${name}`))
        .selectOption(String(i + 1 === weekday ? 1020 : 1440));
    }
    await save();
    await expect(rhythm().getByRole("status")).toContainText(
      "Ustawienia zapisane",
    );
    await expect(rhythm().locator("form")).toHaveAttribute(
      "aria-busy",
      "false",
    );
    await expect(rhythm().getByLabel("Pilnuj godzin pracy")).toBeChecked();
    for (const [i, name] of names.entries()) {
      await expect(rhythm().getByLabel(name, { exact: true })).toBeChecked();
      await expect(rhythm().getByLabel(new RegExp(`^Od.*${name}`))).toHaveValue(
        String(i + 1 === weekday ? 540 : 0),
      );
      await expect(rhythm().getByLabel(new RegExp(`^Do.*${name}`))).toHaveValue(
        String(i + 1 === weekday ? 1020 : 1440),
      );
    }
    expect(
      await sql.json(
        `select to_json(starts_at=${q(start)}::timestamptz) from public.walks where id=${q(first)};`,
      ),
    ).toBe(true);
    mkdirSync("output/calendar", { recursive: true });
    for (const width of [320, 390]) {
      await staff.setViewportSize({ width, height: 900 });
      await mobileEvidence(staff, `output/calendar/rytm-pracy-${width}.png`);
    }
    phase = "outside-hours-form-and-privacy";
    await staff.goto("/admin/walks/new");
    await staff.getByLabel("Termin (czas polski)").fill(`${day}T08:00`);
    await staff.getByLabel("Czas trwania w minutach").fill("60");
    await staff
      .getByLabel("Ogólna lokalizacja")
      .fill("Fikcyjny rytm poza godzinami");
    await staff
      .getByLabel("Dokładne miejsce zbiórki")
      .fill("FIKCYJNA ZBIÓRKA PO GODZINACH");
    await staff
      .getByRole("button", { name: "Utwórz spacer", exact: true })
      .click();
    await expect(staff.locator("form").getByRole("alert")).toContainText(
      "wykracza poza godziny pracy",
    );
    await expect(staff.getByLabel("Termin (czas polski)")).toHaveValue(
      `${day}T08:00`,
    );
    await expect(staff.getByLabel("Dokładne miejsce zbiórki")).toHaveValue(
      "FIKCYJNA ZBIÓRKA PO GODZINACH",
    );
    await staff.getByLabel("Termin (czas polski)").fill(`${day}T13:00`);
    await staff
      .getByRole("button", { name: "Utwórz spacer", exact: true })
      .click();
    await expect(staff).toHaveURL(/\/admin\/walks\/[a-f0-9-]+\?saved=1$/);
    await owner.goto("/app/calendar");
    await expect(owner.locator("#calendar-settings")).toHaveCount(0);
    expect(
      await checked(ownerDb.from("calendar_settings").select("version")),
    ).toEqual([]);
    expect(
      await checked(ownerDb.from("calendar_weekly_hours").select("weekday")),
    ).toEqual([]);
    expect(
      (
        await ownerDb.rpc("save_calendar_settings", {
          p_expected_version: 4,
          p_hours_enabled: false,
          p_before_minutes: 0,
          p_after_minutes: 0,
          p_week: original.week,
        })
      ).error?.message,
    ).toContain("Brak uprawnień");
    phase = "completed-meeting-buffer";
    await open();
    await rhythm().getByLabel("Pilnuj godzin pracy").uncheck();
    await save();
    await expect(rhythm().getByRole("status")).toContainText(
      "Ustawienia zapisane",
    );
    // Advance only this run's walk to five minutes after its nominal end.
    // Fifteen minutes of configured travel time must still block ten minutes.
    await checked(
      db
        .from("walks")
        .update({
          starts_at: new Date(Date.now() - 65 * 60000).toISOString(),
          status: "completed",
        })
        .eq("id", first),
    );
    expect(
      await sql.json(
        `select to_json(upper(occupied)>now() and upper(occupied)-upper(base_occupied)=interval '15 minutes') from public.calendar_slots where walk_id=${q(first)};`,
      ),
    ).toBe(true);
    const near = dateInput(new Date(Date.now() + 2 * 60000).toISOString());
    await staff.goto("/admin/walks/new");
    await staff.getByLabel("Termin (czas polski)").fill(near);
    await staff.getByLabel("Czas trwania w minutach").fill("60");
    await staff
      .getByLabel("Ogólna lokalizacja")
      .fill("Fikcyjna pozostała przerwa");
    await staff
      .getByLabel("Dokładne miejsce zbiórki")
      .fill("FIKCYJNA ZBIÓRKA PO PRZERWIE");
    await staff
      .getByRole("button", { name: "Utwórz spacer", exact: true })
      .click();
    await expect(staff.locator("form").getByRole("alert")).toContainText(
      "Ten czas jest już zajęty",
    );
    await expect(staff.getByLabel("Termin (czas polski)")).toHaveValue(near);
    await checked(
      db
        .from("walks")
        .update({ starts_at: new Date(Date.now() - 80 * 60000).toISOString() })
        .eq("id", first),
    );
    await staff
      .getByRole("button", { name: "Utwórz spacer", exact: true })
      .click();
    await expect(staff).toHaveURL(/\/admin\/walks\/[a-f0-9-]+\?saved=1$/);
  } catch (error) {
    const lines = [
      ...String(error instanceof Error ? error.stack : "").matchAll(
        /calendar-availability\.spec\.ts:(\d+):\d+/g,
      ),
    ].map((m) => Number(m[1]));
    console.error(JSON.stringify({ phase, ownLines: lines }));
    throw new Error(
      `Lokalny rytm kalendarza nie przeszedł etapu ${phase}; treści i poświadczenia pominięto.`,
    );
  } finally {
    await staffContext.close();
    await ownerContext.close();
    // Only this test's walks and audit rows are removed. Restore the complete
    // original settings row before deleting its temporary author account.
    if (users.length)
      await checked(db.from("walks").delete().in("leader_id", users));
    const s = original.settings;
    await sql.query(`begin;lock table public.calendar_slots in share row exclusive mode;
      update public.calendar_settings set version=${s.version},hours_enabled=${s.hours_enabled},before_minutes=${s.before_minutes},after_minutes=${s.after_minutes},updated_by=${s.updated_by ? q(s.updated_by) : "null"},updated_at=${q(s.updated_at)};
      update public.calendar_weekly_hours h set enabled=x.enabled,start_minute=x.start_minute,end_minute=x.end_minute from jsonb_to_recordset(${q(JSON.stringify(original.week))}::jsonb) x(weekday integer,enabled boolean,start_minute integer,end_minute integer) where h.weekday=x.weekday;
      set constraints public.calendar_no_overlap deferred;update public.calendar_slots set occupied=base_occupied;set constraints public.calendar_no_overlap immediate;commit;`);
    expect(
      await sql.json(
        "select json_build_object('settings',(select to_jsonb(s) from public.calendar_settings s),'week',(select jsonb_agg(to_jsonb(h) order by weekday) from public.calendar_weekly_hours h),'slots',(select coalesce(jsonb_agg(to_jsonb(s) order by occupied),'[]') from public.calendar_slots s));",
      ),
    ).toEqual(original);
    await ownerDb.auth.signOut();
    for (const id of users) {
      await checked(db.from("audit_events").delete().eq("actor_id", id));
      await checked(db.auth.admin.deleteUser(id));
    }
    await sql.close();
  }
});
