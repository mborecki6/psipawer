import { test, expect, type Page, type Locator } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { LocalPostgres, literal as q } from "../helpers/local-postgres.mjs";
import {
  account,
  checked,
  disposeCareFixtures,
  localClients,
  login,
} from "./local-fixtures";
import { warsawDateTimeInput } from "../../src/lib/time";
test.use({ trace: "off" });
const service = "60000000-0000-4000-8000-000000000006";
async function fixtures(baseURL: string | undefined) {
  const { db, client } = localClients(baseURL),
    users: string[] = [],
    dogs: string[] = [],
    packages: string[] = [];
  const sql = new LocalPostgres();
  const dispose = async () => {
    await sql.close();
    await disposeCareFixtures(db, users, dogs, async () => {
      if (packages.length) {
        await checked(
          db.from("payments").delete().in("fitness_package_id", packages),
        );
        await checked(db.from("fitness_packages").delete().in("id", packages));
      }
    });
  };
  try {
    await sql.ready();
    const admin = await account(db, users, "admin"),
      owner = await account(db, users, "client"),
      other = await account(db, users, "client");
    const staff = client(),
      own = client(),
      stranger = client();
    for (const [api, user] of [
      [staff, admin],
      [own, owner],
      [stranger, other],
    ] as const)
      await checked(
        api.auth.signInWithPassword({
          email: user.email,
          password: user.password,
        }),
      );
    const dog = await checked(
      db
        .from("dogs")
        .insert({ name: "Figa — fitness próbny", guardian_id: owner.id })
        .select("id")
        .single(),
    );
    dogs.push(dog!.id);
    const catalog = await checked(
      staff
        .from("services")
        .select("version,price_cents,sessions_count,duration_minutes")
        .eq("id", service)
        .single(),
    );
    expect(catalog).toMatchObject({
      price_cents: 10000,
      sessions_count: 4,
      duration_minutes: 45,
    });
    const free = async (past = false) => {
      const value = await sql.json(
        `select to_json(min(t)) from (select now()${past ? "-" : "+"}interval '3 years'+make_interval(days=>n) t from generate_series(1,100) n) dates where not exists(select 1 from public.calendar_slots where occupied && tstzrange(t,t+interval '45 minutes','[)'));`,
      );
      if (typeof value !== "string")
        throw new Error("No isolated fitness fixture slot");
      return value;
    };
    const request = async () => {
      const id = crypto.randomUUID();
      packages.push(id);
      await checked(
        own.rpc("request_fitness_package", {
          p_id: id,
          p_dog: dog!.id,
          p_service: service,
          p_expected_service_version: catalog!.version,
          p_topic: "Spokojna praca nad ruchem",
          p_availability: "Popołudnia",
        }),
      );
      return id;
    };
    const pack = (id: string) =>
      checked(staff.from("fitness_packages").select("*").eq("id", id).single());
    const balance = (id: string) =>
      checked(own.from("fitness_balances").select("*").eq("id", id).single());
    const sessions = (id: string) =>
      checked(
        staff
          .from("fitness_sessions")
          .select("*")
          .eq("package_id", id)
          .order("ordinal"),
      );
    return {
      db,
      staff,
      own,
      stranger,
      admin,
      owner,
      other,
      dog: dog!.id,
      packages,
      sql,
      dispose,
      free,
      request,
      pack,
      balance,
      sessions,
    };
  } catch (error) {
    await dispose();
    throw error;
  }
}
async function submitCommand(
  form: Locator,
  intent: string,
  note = "Uzgodnione podczas próby",
) {
  await form.getByRole("combobox").first().selectOption(intent);
  await form.getByRole("textbox").fill(note);
  await form.getByRole("checkbox").check();
  await form
    .getByRole("button", { name: "Zapisz działanie", exact: true })
    .click();
  await expect(form.getByRole("status")).toBeVisible();
}
const packageForm = (page: Page) =>
  page
    .locator("aside form")
    .filter({ has: page.getByLabel("Działanie dla pakietu") });
async function screen(
  page: Page,
  name: string,
  width: number,
  heading = "PSI FITNESS — pakiet 4 spotkań",
) {
  await expect(
    page.getByRole("heading", {
      name: heading,
      exact: true,
    }),
  ).toBeVisible();
  await page.setViewportSize({ width, height: 900 });
  // Filling a form scrolls and focuses a control. Capture the layout from its
  // actual top so sticky navigation and the keyboard skip link stay in place.
  await page.evaluate(async () => {
    if (document.activeElement instanceof HTMLElement)
      document.activeElement.blur();
    window.scrollTo({ top: 0, left: 0, behavior: "instant" });
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
    );
  });
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  mkdirSync("output/fitness", { recursive: true });
  await page.screenshot({
    path: `output/fitness/${name}-${width}.png`,
    fullPage: true,
  });
}
test("fitness reminders: staff delivery panel, private meeting link, reschedule and withdrawal", async ({
  browser,
  baseURL,
}) => {
  test.setTimeout(180000);
  const f = await fixtures(baseURL);
  const staffContext = await browser.newContext({
    baseURL,
    viewport: { width: 320, height: 844 },
  });
  const ownerContext = await browser.newContext({
    baseURL,
    viewport: { width: 390, height: 844 },
  });
  const staffPage = await staffContext.newPage(),
    ownerPage = await ownerContext.newPage();
  let protectedJobs: LocalPostgres | undefined;
  try {
    protectedJobs = await new LocalPostgres().ready();
    await protectedJobs.query(`set idle_in_transaction_session_timeout='180s';begin;
      select id from public.reminder_jobs where dog_id<>${q(f.dog)} order by id for update;`);
    const originalSQL = `select coalesce(json_agg(to_jsonb(j) order by id),'[]') from public.reminder_jobs j where dog_id<>${q(f.dog)};`;
    const original = await f.sql.json(originalSQL);
    expect(original.length).toBeLessThan(40);
    const id = await f.request();
    await checked(
      f.staff.rpc("change_fitness_package", {
        p_id: id,
        p_expected_version: 1,
        p_action: "accept",
        p_note: "Próba przypomnień",
        p_request_id: crypto.randomUUID(),
      }),
    );
    const meeting = (await f.sessions(id))![0];
    const starts = await f.sql.json(`select to_json(min(t)) from (
      select now()+make_interval(hours=>n) t from generate_series(3,18,3) n
    ) candidates where not exists(select 1 from public.calendar_slots slot,generate_series(0,2) step
      where slot.occupied && tstzrange(t+make_interval(hours=>step*1),t+make_interval(hours=>step*1)+interval '45 minutes','[)'));`);
    expect(typeof starts).toBe("string");
    const scheduleMeeting = (version: number, offset: number) =>
      checked(
        f.staff.rpc("save_fitness_session", {
          p_id: meeting.id,
          p_expected_version: version,
          p_starts_at: new Date(
            Date.parse(starts) + offset * 3600000,
          ).toISOString(),
          p_location: "FIKCYJNE PRYWATNE MIEJSCE FITNESS",
          p_note: "Uzgodniona zmiana do próby przypomnienia",
          p_request_id: crypto.randomUUID(),
        }),
      );
    const jobs = () =>
      checked(
        f.staff
          .from("reminder_jobs")
          .select("id,status,generation,fitness_package_id,fitness_session_id")
          .eq("fitness_package_id", id)
          .order("generation"),
      );
    const notices = () =>
      checked(
        f.own
          .from("notifications")
          .select("id,fitness_session_id,recipient_role")
          .eq("fitness_package_id", id)
          .eq("kind", "fitness_reminder"),
      );
    await scheduleMeeting(1, 0);
    const job = (await jobs())![0];
    expect(job).toMatchObject({
      status: "pending",
      fitness_session_id: meeting.id,
    });
    expect(await checked(f.own.from("reminder_jobs").select("id"))).toEqual([]);
    expect(
      (await f.own.rpc("worker_process_due_reminders", { p_limit: 50 })).error,
    ).toBeTruthy();
    expect(
      (await f.staff.rpc("worker_process_due_reminders", { p_limit: 50 }))
        .error,
    ).toBeTruthy();
    await login(staffPage, f.admin, "admin");
    await login(ownerPage, f.owner, "client");
    await staffPage.goto(`/admin/reminders/${job.id}`);
    await screen(
      staffPage,
      "reminder",
      320,
      "Przed spotkaniem PSI FITNESS · Figa — fitness próbny",
    );
    await staffPage.goto("/admin/reminders?filter=pending");
    await staffPage
      .getByRole("button", { name: "Sprawdź do 50 oczekujących" })
      .click();
    await expect(staffPage.getByRole("status")).toContainText(
      "W skrzynkach: 1.",
    );
    expect((await jobs())![0].status).toBe("sent");
    await staffPage.goto(`/admin/reminders/${job.id}`);
    await expect(
      staffPage.getByText("Próba 1 · Zapisano w skrzynce", { exact: true }),
    ).toBeVisible();
    await screen(
      staffPage,
      "reminder-delivered",
      320,
      "Przed spotkaniem PSI FITNESS · Figa — fitness próbny",
    );
    await ownerPage.goto("/app/notifications");
    await screen(ownerPage, "reminder-inbox", 390, "Co nowego u Was?");
    const card = ownerPage.getByRole("listitem").filter({
      has: ownerPage.getByRole("heading", {
        name: "Zbliża się spotkanie PSI FITNESS",
        exact: true,
      }),
    });
    await expect(card).toBeVisible();
    await expect(card).not.toContainText("FIKCYJNE PRYWATNE MIEJSCE");
    await card
      .getByRole("button", { name: "Otwórz sprawę", exact: true })
      .click();
    await expect(ownerPage).toHaveURL(
      new RegExp(`/app/fitness/${id}#spotkanie-${meeting.id}$`),
    );
    await expect(
      ownerPage.getByText("FIKCYJNE PRYWATNE MIEJSCE FITNESS", { exact: true }),
    ).toBeVisible();
    await scheduleMeeting(2, 1);
    expect((await jobs())!.map((j) => j.status)).toEqual(["sent", "pending"]);
    expect(
      await checked(f.staff.rpc("process_due_reminders", { p_limit: 50 })),
    ).toMatchObject({ sent: 1, failed: 0 });
    expect(await notices()).toHaveLength(2);
    await scheduleMeeting(3, 2);
    await checked(
      f.own.rpc("change_fitness_package", {
        p_id: id,
        p_expected_version: (await f.pack(id))!.version,
        p_action: "cancel",
        p_note: "Rezygnacja przed kolejnym przypomnieniem",
        p_request_id: crypto.randomUUID(),
      }),
    );
    expect((await jobs())!.map((j) => j.status)).toEqual([
      "sent",
      "sent",
      "cancelled",
    ]);
    expect(
      await checked(f.staff.rpc("process_due_reminders", { p_limit: 50 })),
    ).toMatchObject({ sent: 0, failed: 0 });
    expect(await notices()).toHaveLength(2);
    expect(
      await checked(
        f.stranger
          .from("notifications")
          .select("id")
          .eq("fitness_package_id", id),
      ),
    ).toEqual([]);
    expect(await f.sql.json(originalSQL)).toEqual(original);
  } finally {
    await protectedJobs?.close();
    await staffContext.close();
    await ownerContext.close();
    await f.dispose();
  }
});

test("fitness browser: catalogue request, four meetings, shared calendar, payment, cancellation, partial refund and restoration", async ({
  page,
  browser,
  baseURL,
}) => {
  const f = await fixtures(baseURL),
    staffContext = await browser.newContext(),
    staffPage = await staffContext.newPage();
  try {
    await login(page, f.owner, "client");
    await page.goto("/app/services");
    await page
      .getByRole("link", { name: "Zgłoś psa na fitness →", exact: true })
      .click();
    await expect(page).toHaveURL(
      new RegExp(`/app/fitness/new\\?service=${service}`),
    );
    await page
      .getByRole("combobox", { name: "Pies", exact: true })
      .selectOption(f.dog);
    await page
      .getByLabel("Cel spotkań")
      .fill("Praca nad ruchem — rzeczywista próba lokalna");
    await page
      .getByLabel("Dostępność (opcjonalnie)")
      .fill("Wtorki po południu");
    await page.getByRole("checkbox").check();
    await screen(page, "request", 390, "Zgłoszenie na PSI FITNESS");
    const id = await page.locator('input[name="id"]').inputValue();
    f.packages.push(id);
    await page
      .getByRole("button", { name: "Wyślij zgłoszenie fitness", exact: true })
      .click();
    await expect(page).toHaveURL(new RegExp(`/app/fitness/${id}$`));
    await expect(
      page.getByText("Czeka na decyzję", { exact: true }),
    ).toBeVisible();
    expect((await f.balance(id))!.charge_cents).toBe(0);
    await login(staffPage, f.admin, "admin");
    await staffPage.goto("/admin/notifications");
    const requestedNotice = staffPage.locator("li").filter({
      has: staffPage.getByRole("heading", {
        name: "Nowe zgłoszenie na PSI FITNESS",
        exact: true,
      }),
    });
    await requestedNotice
      .getByRole("button", { name: "Otwórz sprawę", exact: true })
      .click();
    await expect(staffPage).toHaveURL(new RegExp(`/admin/fitness/${id}$`));
    // Reading the message does not process the request or remove its task.
    await staffPage.goto("/admin/work?filter=fitness");
    await screen(staffPage, "work-queue", 320, "Sprawy do obsłużenia");
    const requestTask = staffPage.getByRole("link", {
      name: /Figa — fitness próbny · Rozpatrz zgłoszenie fitness/,
    });
    await expect(requestTask).toBeVisible();
    await requestTask.click();
    await expect(staffPage).toHaveURL(new RegExp(`/admin/fitness/${id}$`));
    await submitCommand(packageForm(staffPage), "accept", "");
    await expect(
      staffPage.getByRole("heading", { name: /^Spotkanie \d z 4$/ }),
    ).toHaveCount(4);
    const meetings = await f.sessions(id),
      first = meetings![0],
      starts = await f.free();
    await staffPage.reload();
    const article = staffPage.locator(`#spotkanie-${first.id}`);
    await expect(
      packageForm(staffPage).locator('option[value="complete"]'),
    ).toBeDisabled();
    await expect(
      packageForm(staffPage).getByLabel("Działanie dla pakietu"),
    ).toHaveValue("");
    await article
      .getByText("Ustal lub zmień termin spotkania", { exact: true })
      .click();
    await article
      .getByLabel("Termin spotkania (czas polski)")
      .fill(warsawDateTimeInput(starts));
    await article
      .getByLabel("Dokładne miejsce spotkania")
      .fill("FIKCYJNA PRYWATNA ZBIÓRKA FITNESS");
    await screen(staffPage, "schedule", 320);
    await article
      .getByRole("button", { name: "Zapisz termin fitness", exact: true })
      .click();
    await expect(article.getByRole("status")).toContainText(
      "Termin i miejsce zapisane",
    );
    await page.goto("/app/notifications");
    await screen(page, "inbox", 390, "Co nowego u Was?");
    const dateNotice = page.locator("li").filter({
      has: page.getByRole("heading", {
        name: "Ustalono termin spotkania fitness",
        exact: true,
      }),
    });
    await expect(dateNotice).toHaveCount(1);
    await expect(dateNotice).not.toContainText(
      "FIKCYJNA PRYWATNA ZBIÓRKA FITNESS",
    );
    await dateNotice
      .getByRole("button", { name: "Otwórz sprawę", exact: true })
      .click();
    await expect(page).toHaveURL(
      new RegExp(`/app/fitness/${id}#spotkanie-${first.id}$`),
    );
    await expect(page.locator(`#spotkanie-${first.id}`)).toContainText(
      "FIKCYJNA PRYWATNA ZBIÓRKA FITNESS",
    );
    const calendar = await checked(
      f.own.rpc("calendar_appointments", {
        p_from: starts,
        p_to: new Date(Date.parse(starts) + 86400000).toISOString(),
      }),
    );
    expect(calendar).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id,
          kind: "fitness",
          location: "FIKCYJNA PRYWATNA ZBIÓRKA FITNESS",
        }),
      ]),
    );
    await staffPage.goto(
      `/admin/calendar?date=${warsawDateTimeInput(starts).slice(0, 10)}`,
    );
    const appointment = staffPage.locator("article").filter({
      has: staffPage.getByRole("heading", { name: /spotkanie 1\/4/ }),
    });
    await appointment.getByRole("link", { name: "Otwórz szczegóły" }).click();
    await expect(staffPage).toHaveURL(new RegExp(`/admin/fitness/${id}$`));
    await staffPage
      .getByText("Odnotuj otrzymaną wpłatę", { exact: true })
      .click();
    let moneyForm = staffPage
      .locator("form")
      .filter({ has: staffPage.getByLabel("Otrzymana kwota (zł)") });
    await moneyForm.getByLabel("Otrzymana kwota (zł)").fill("100,00");
    await moneyForm.getByRole("checkbox").check();
    await moneyForm
      .getByRole("button", { name: "Zapisz wpłatę", exact: true })
      .click();
    await expect(moneyForm.getByRole("status")).toContainText(
      "Wpłata zapisana",
    );
    expect(await f.balance(id)).toMatchObject({
      paid_cents: 10000,
      due_cents: 0,
    });
    await staffPage.reload();
    await submitCommand(
      packageForm(staffPage),
      "cancel",
      "Uzgodniona rezygnacja z pakietu",
    );
    expect(await f.balance(id)).toMatchObject({
      needs_settlement: true,
      paid_cents: 10000,
    });
    await staffPage.reload();
    await staffPage
      .getByText("Uzgodnij kwotę po rezygnacji", { exact: true })
      .click();
    moneyForm = staffPage.locator("form").filter({
      has: staffPage.getByLabel("Uzgodniona należność za pakiet fitness (zł)"),
    });
    await moneyForm
      .getByLabel("Uzgodniona należność za pakiet fitness (zł)")
      .fill("30,00");
    await moneyForm
      .getByLabel("Powód uzgodnienia")
      .fill("Uzgodnione rozliczenie po rezygnacji");
    await moneyForm.getByRole("checkbox").check();
    await moneyForm
      .getByRole("button", { name: "Zapisz uzgodnioną kwotę", exact: true })
      .click();
    await expect(moneyForm.getByRole("status")).toContainText(
      "Uzgodniona kwota zapisana",
    );
    expect((await f.balance(id))!.refund_due_cents).toBe(7000);
    await staffPage.reload();
    await staffPage
      .getByText("Historia wpłat i zwrotów (1)", { exact: true })
      .click();
    await staffPage
      .getByText("Odnotuj zwrot tej wpłaty", { exact: true })
      .click();
    moneyForm = staffPage
      .locator("form")
      .filter({ has: staffPage.getByLabel("Zwrócona kwota (zł)") });
    await moneyForm.getByLabel("Zwrócona kwota (zł)").fill("70,00");
    await moneyForm
      .getByLabel("Powód zwrotu")
      .fill("Faktycznie zwrócono uzgodnioną część wpłaty");
    await moneyForm.getByRole("checkbox").check();
    await moneyForm
      .getByRole("button", { name: "Odnotuj zwrot", exact: true })
      .click();
    await expect(moneyForm.getByRole("status")).toContainText(
      "Zwrot odnotowany",
    );
    expect(await f.balance(id)).toMatchObject({
      paid_cents: 3000,
      refunded_cents: 7000,
      refund_due_cents: 0,
      due_cents: 0,
    });
    await staffPage.reload();
    await submitCommand(
      packageForm(staffPage),
      "restore",
      "Uzgodniony powrót do pełnego pakietu",
    );
    expect(await f.balance(id)).toMatchObject({
      status: "active",
      charge_cents: 10000,
      paid_cents: 3000,
      refunded_cents: 7000,
      due_cents: 7000,
    });
    expect(
      (await f.sessions(id))!.every(
        (s) => s.status === "pending" && s.starts_at === null,
      ),
    ).toBe(true);
    const ownMessages = await checked(
      f.own
        .from("notifications")
        .select("kind,fitness_package_id,fitness_session_id,read_at")
        .eq("fitness_package_id", id),
    );
    expect(
      ownMessages!.filter((n) => n.kind === "fitness_payment_recorded"),
    ).toHaveLength(1);
    expect(
      ownMessages!.filter((n) => n.kind === "fitness_payment_refunded"),
    ).toHaveLength(1);
    expect(
      ownMessages!.find((n) => n.kind === "fitness_session_scheduled")?.read_at,
    ).toEqual(expect.any(String));
    await page.goto("/app/notifications");
    const refundNotice = page.locator("li").filter({
      has: page.getByRole("heading", {
        name: "Zapisano zwrot wpłaty za fitness",
        exact: true,
      }),
    });
    await refundNotice
      .getByRole("button", { name: "Otwórz sprawę", exact: true })
      .click();
    await expect(page).toHaveURL(
      new RegExp(`/app/fitness/${id}#rozliczenie-${id}$`),
    );
    await staffPage.goto("/admin/work?filter=fitness");
    await expect(
      staffPage.getByRole("link", {
        name: /Figa — fitness próbny · Ustal pozostałe terminy fitness/,
      }),
    ).toBeVisible();
    await staffPage.goto(`/admin/fitness/${id}`);
    expect(
      await checked(
        f.stranger
          .from("notifications")
          .select("id")
          .eq("fitness_package_id", id),
      ),
    ).toEqual([]);
    expect(
      await checked(
        f.stranger.from("fitness_packages").select("id").eq("id", id),
      ),
    ).toEqual([]);
    expect(
      await checked(
        f.stranger.from("fitness_session_private_details").select("*"),
      ),
    ).toEqual([]);
    expect(
      await checked(f.stranger.from("fitness_receipts").select("*")),
    ).toEqual([]);
    expect(
      await checked(
        f.stranger.from("fitness_balances").select("id").eq("id", id),
      ),
    ).toEqual([]);
    await staffPage.reload();
    await screen(staffPage, "staff-package", 320);
    await screen(staffPage, "staff-package", 390);
    await page.goto(`/app/fitness/${id}`);
    await screen(page, "owner-package", 390);
    await page.goto("/app/finance");
    const charge = page.locator(`#charge-fitness-${id}`);
    await expect(charge).toContainText("70,00");
    await charge.getByRole("link").first().click();
    await expect(page).toHaveURL(new RegExp(`/app/fitness/${id}`));
  } finally {
    await staffContext.close();
    await f.dispose();
  }
});

test("fitness browser: concurrent stale scheduling preserves input, attendance correction, replacement and completion preserve unpaid debt", async ({
  page,
  browser,
  baseURL,
}) => {
  const f = await fixtures(baseURL),
    secondContext = await browser.newContext(),
    second = await secondContext.newPage();
  try {
    const id = await f.request();
    await checked(
      f.staff.rpc("change_fitness_package", {
        p_id: id,
        p_expected_version: 1,
        p_action: "accept",
        p_note: "",
        p_request_id: crypto.randomUUID(),
      }),
    );
    const meeting = (await f.sessions(id))![0],
      starts = await f.free();
    await login(page, f.admin, "admin");
    await login(second, f.admin, "admin");
    for (const tab of [page, second]) {
      await tab.goto(`/admin/fitness/${id}`);
      const a = tab.locator(`#spotkanie-${meeting.id}`);
      await a
        .getByText("Ustal lub zmień termin spotkania", { exact: true })
        .click();
      await a
        .getByLabel("Termin spotkania (czas polski)")
        .fill(warsawDateTimeInput(starts));
      await a
        .getByLabel("Dokładne miejsce spotkania")
        .fill(
          tab === page
            ? "Pierwsza fikcyjna zbiórka"
            : "Wpisane miejsce w starej karcie",
        );
    }
    await page
      .locator(`#spotkanie-${meeting.id}`)
      .getByRole("button", { name: "Zapisz termin fitness", exact: true })
      .click();
    await expect(
      page.locator(`#spotkanie-${meeting.id}`).getByRole("status"),
    ).toBeVisible();
    await second
      .locator(`#spotkanie-${meeting.id}`)
      .getByRole("button", { name: "Zapisz termin fitness", exact: true })
      .click();
    await expect(
      second.locator(`#spotkanie-${meeting.id}`).getByRole("alert"),
    ).toContainText("Spotkanie zmieniło się");
    await expect(
      second
        .locator(`#spotkanie-${meeting.id}`)
        .getByLabel("Dokładne miejsce spotkania"),
    ).toHaveValue("Wpisane miejsce w starej karcie");
    await expect(
      second
        .locator(`#spotkanie-${meeting.id}`)
        .getByLabel("Termin spotkania (czas polski)"),
    ).toHaveValue(warsawDateTimeInput(starts));
    const past = await f.free(true);
    await f.sql.query(
      `update public.fitness_sessions set starts_at=${q(past)} where id=${q(meeting.id)};`,
    );
    await page.reload();
    let a = page.locator(`#spotkanie-${meeting.id}`);
    await a
      .getByText("Obecność, odwołanie lub korekta", { exact: true })
      .click();
    let command = a
      .locator("form")
      .filter({ has: page.getByLabel("Działanie dla spotkania") });
    await command
      .getByLabel("Działanie dla spotkania")
      .selectOption("complete");
    await command.getByLabel("Obecność psa").selectOption("absent");
    await submitCommand(command, "complete", "");
    expect(await f.balance(id)).toMatchObject({
      completed_sessions: 1,
      charge_cents: 10000,
      due_cents: 10000,
    });
    await page.reload();
    a = page.locator(`#spotkanie-${meeting.id}`);
    await a
      .getByText("Obecność, odwołanie lub korekta", { exact: true })
      .click();
    command = a
      .locator("form")
      .filter({ has: page.getByLabel("Działanie dla spotkania") });
    await command.getByLabel("Działanie dla spotkania").selectOption("correct");
    await command.getByLabel("Obecność psa").selectOption("excused");
    await submitCommand(
      command,
      "correct",
      "Uzupełniono usprawiedliwienie opiekuna",
    );
    await page.reload();
    a = page.locator(`#spotkanie-${meeting.id}`);
    await a
      .getByText("Obecność, odwołanie lub korekta", { exact: true })
      .click();
    command = a
      .locator("form")
      .filter({ has: page.getByLabel("Działanie dla spotkania") });
    await submitCommand(command, "reopen", "Uzgodniono spotkanie zastępcze");
    expect(await f.balance(id)).toMatchObject({
      completed_sessions: 0,
      due_cents: 10000,
    });
    for (const s of (await f.sessions(id))!) {
      const version = await checked(
        f.staff.rpc("save_fitness_session", {
          p_id: s.id,
          p_expected_version: s.version,
          p_starts_at: await f.free(),
          p_location: "Fikcyjne miejsce zastępcze",
          p_note: "Uzgodniony termin",
          p_request_id: crypto.randomUUID(),
        }),
      );
      await f.sql.query(
        `update public.fitness_sessions set starts_at=${q(await f.free(true))} where id=${q(s.id)};`,
      );
      await checked(
        f.staff.rpc("change_fitness_session", {
          p_id: s.id,
          p_expected_version: version,
          p_action: "complete",
          p_attendance: "present",
          p_note: "Próba ukończenia",
          p_request_id: crypto.randomUUID(),
        }),
      );
    }
    await page.reload();
    await submitCommand(packageForm(page), "complete", "");
    expect(await f.balance(id)).toMatchObject({
      status: "completed",
      completed_sessions: 4,
      due_cents: 10000,
      can_pay: true,
    });
    const history = await checked(
      f.own
        .from("fitness_history")
        .select("action,details")
        .eq("package_id", id)
        .eq("session_id", meeting.id),
    );
    expect(history).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: "correct",
          details: expect.objectContaining({
            previous_attendance: "absent",
            attendance: "excused",
          }),
        }),
        expect.objectContaining({
          action: "reopen",
          details: expect.objectContaining({ previous_attendance: "excused" }),
        }),
      ]),
    );
    await page.goto("/admin/finance");
    const charge = page.locator(`#charge-fitness-${id}`);
    await expect(charge).toContainText("100,00");
    await charge.getByText("Rozlicz należność", { exact: true }).click();
    await charge
      .getByRole("link", { name: "Odnotuj wpłatę w fitnessie →", exact: true })
      .click();
    await expect(page).toHaveURL(new RegExp(`/admin/fitness/${id}`));
  } finally {
    await secondContext.close();
    await f.dispose();
  }
});

test("fitness care: private meeting draft, publication, response, explicit rebinding and retained history", async ({
  browser,
  baseURL,
}) => {
  test.setTimeout(180000);
  const f = await fixtures(baseURL);
  const staffContext = await browser.newContext({
    baseURL,
    viewport: { width: 1440, height: 1000 },
  });
  const ownerContext = await browser.newContext({
    baseURL,
    viewport: { width: 390, height: 844 },
  });
  const staffPage = await staffContext.newPage(),
    ownerPage = await ownerContext.newPage();
  try {
    const id = await f.request();
    await login(staffPage, f.admin, "admin");
    await login(ownerPage, f.owner, "client");
    await staffPage.goto(`/admin/fitness/${id}`);
    await submitCommand(packageForm(staffPage), "accept");
    const meeting = (await f.sessions(id))![0];
    const article = staffPage.locator(`#spotkanie-${meeting.id}`);
    await article
      .getByText("Ustal lub zmień termin spotkania", { exact: true })
      .click();
    await article
      .getByLabel("Termin spotkania (czas polski)")
      .fill(warsawDateTimeInput(await f.free()));
    await article
      .getByLabel("Dokładne miejsce spotkania")
      .fill("FIKCYJNE MIEJSCE PRÓBY ZALECEŃ");
    await article
      .getByRole("button", { name: "Zapisz termin fitness", exact: true })
      .click();
    await expect(article.getByRole("status")).toContainText(
      "Termin i miejsce zapisane",
    );
    const carePanel = staffPage.getByRole("region", {
      name: "Zalecenia fitness",
    });
    await carePanel
      .getByText("Przygotuj zalecenia po spotkaniu fitness", { exact: true })
      .click();
    await carePanel.getByRole("link", { name: /Spotkanie 1 ·/ }).click();
    await expect(
      staffPage.getByLabel("Pakiet fitness, którego dotyczą zalecenia"),
    ).toHaveValue(id);
    await expect(staffPage.getByLabel("Zakres zaleceń fitness")).toHaveValue(
      meeting.id,
    );
    const draft = "Prywatny szkic prowadzącej do spotkania fitness.";
    await staffPage
      .getByLabel("Tytuł planu", { exact: true })
      .fill("Plan po pierwszym spotkaniu fitness");
    await staffPage
      .getByLabel("Zalecenia dla opiekuna", { exact: true })
      .fill(draft);
    await expect(
      staffPage.getByRole("button", {
        name: "Opublikuj dla opiekuna",
        exact: true,
      }),
    ).toBeDisabled();
    await staffPage
      .getByRole("button", { name: "Zapisz szkic", exact: true })
      .click();
    await expect(staffPage.getByRole("status")).toContainText("Szkic zapisany");
    await screen(
      staffPage,
      "care-draft",
      320,
      "Figa — fitness próbny · małe kroki, wspólny plan",
    );
    await ownerPage.goto(`/app/fitness/${id}`);
    await expect(
      ownerPage.getByRole("region", { name: "Zalecenia fitness" }),
    ).not.toContainText(draft);
    expect(
      await checked(
        f.own.from("care_drafts").select("dog_id").eq("dog_id", f.dog),
      ),
    ).toEqual([]);
    expect(
      await checked(
        f.stranger.rpc("fitness_care_feed", { p_package: id, p_offset: 0 }),
      ),
    ).toEqual([]);
    await checked(
      f.db
        .from("fitness_sessions")
        .update({ starts_at: await f.free(true) })
        .eq("id", meeting.id)
        .eq("package_id", id),
    );
    await staffPage.goto(`/admin/fitness/${id}`);
    await article
      .getByText("Obecność, odwołanie lub korekta", { exact: true })
      .click();
    const command = article
      .locator("form")
      .filter({ has: staffPage.getByLabel("Działanie dla spotkania") });
    await command
      .getByLabel("Działanie dla spotkania")
      .selectOption("complete");
    await command.getByLabel("Obecność psa").selectOption("present");
    await command.getByRole("checkbox").check();
    await command
      .getByRole("button", { name: "Zapisz działanie", exact: true })
      .click();
    await expect(command.getByRole("status")).toContainText(
      "Zmiana spotkania zapisana",
    );
    await carePanel
      .getByRole("link", { name: "Otwórz szkic zaleceń fitness", exact: true })
      .click();
    await expect(
      staffPage.getByLabel("Zalecenia dla opiekuna", { exact: true }),
    ).toHaveValue(draft);
    const published =
      "Własne wskazówki prowadzącej po spotkaniu. Treść demonstracyjna, bez gotowych ćwiczeń.";
    await staffPage
      .getByLabel("Zalecenia dla opiekuna", { exact: true })
      .fill(published);
    await staffPage
      .getByRole("button", { name: "Opublikuj dla opiekuna", exact: true })
      .click();
    await expect(staffPage.getByRole("status")).toContainText(
      "Plan opublikowany",
    );
    const plans = await checked(
      f.staff
        .from("care_plan_versions")
        .select("id,fitness_package_id,fitness_session_id")
        .eq("dog_id", f.dog)
        .order("revision"),
    );
    expect(plans).toEqual([
      {
        id: expect.any(String),
        fitness_package_id: id,
        fitness_session_id: meeting.id,
      },
    ]);
    const publication = plans![0].id;
    await ownerPage.reload();
    await ownerPage
      .getByRole("link", {
        name: "Plan po pierwszym spotkaniu fitness",
        exact: true,
      })
      .click();
    await expect(ownerPage).toHaveURL(`/app/care/plans/${publication}`);
    await expect(ownerPage.getByText(published, { exact: true })).toBeVisible();
    await ownerPage
      .getByRole("link", { name: "Otwórz spotkanie fitness →", exact: true })
      .click();
    await expect(ownerPage).toHaveURL(
      `/app/fitness/${id}#spotkanie-${meeting.id}`,
    );
    await screen(ownerPage, "care-published", 390);
    await ownerPage
      .getByRole("link", { name: "Plan pracy i postępy psa →", exact: true })
      .click();
    await ownerPage
      .getByLabel("Co udało się zrobić?", { exact: true })
      .fill("Przeczytaliśmy wskazówki z pierwszego spotkania fitness.");
    await ownerPage
      .getByRole("button", {
        name: "Przekaż odpowiedź prowadzącej",
        exact: true,
      })
      .click();
    await expect(ownerPage.getByRole("status")).toContainText(
      "Odpowiedź zapisana",
    );
    // Returning to the exact current URL with its fragment is a same-document
    // navigation. Re-enter through the package to read the guardian's new reply.
    await staffPage.goto(`/admin/fitness/${id}`);
    await carePanel
      .getByRole("link", { name: "Otwórz szkic zaleceń fitness", exact: true })
      .click();
    await expect(
      staffPage.getByText(
        "Przeczytaliśmy wskazówki z pierwszego spotkania fitness.",
        { exact: true },
      ),
    ).toBeVisible();
    await expect(staffPage.getByLabel("Zakres zaleceń fitness")).toHaveValue(
      meeting.id,
    );
    await staffPage
      .getByRole("button", {
        name: "Powiąż ten szkic z wybranym pakietem fitness",
        exact: true,
      })
      .click();
    await expect(staffPage.getByLabel("Zakres zaleceń fitness")).toHaveValue(
      "",
    );
    await staffPage
      .getByLabel("Tytuł planu", { exact: true })
      .fill("Plan całego pakietu fitness");
    await staffPage
      .getByRole("button", { name: "Opublikuj dla opiekuna", exact: true })
      .click();
    await expect(staffPage.getByRole("status")).toContainText(
      "Plan opublikowany",
    );
    const retained = await checked(
      f.staff
        .from("care_plan_versions")
        .select("id,fitness_package_id,fitness_session_id")
        .eq("dog_id", f.dog)
        .order("revision"),
    );
    expect(retained).toEqual([
      plans![0],
      {
        id: expect.any(String),
        fitness_package_id: id,
        fitness_session_id: null,
      },
    ]);
    await staffPage.goto(`/admin/fitness/${id}`);
    await submitCommand(
      packageForm(staffPage),
      "cancel",
      "Odwołanie próby po publikacji zaleceń",
    );
    await ownerPage.goto(`/app/fitness/${id}`);
    await expect(
      ownerPage.getByRole("link", {
        name: "Plan całego pakietu fitness",
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      ownerPage.getByRole("link", {
        name: "Plan po pierwszym spotkaniu fitness",
        exact: true,
      }),
    ).toBeVisible();
    await ownerPage
      .getByRole("link", {
        name: "Plan po pierwszym spotkaniu fitness",
        exact: true,
      })
      .click();
    await expect(ownerPage.getByText(published, { exact: true })).toBeVisible();
    expect(
      await checked(
        f.stranger.from("care_plan_versions").select("id").eq("dog_id", f.dog),
      ),
    ).toEqual([]);
  } finally {
    await staffContext.close();
    await ownerContext.close();
    await f.dispose();
  }
});
