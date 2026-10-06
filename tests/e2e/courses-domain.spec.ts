import { test, expect } from "@playwright/test";
import {
  LocalPostgres,
  literal as q,
  waitForLock,
} from "../helpers/local-postgres.mjs";
import {
  account,
  checked,
  disposeCareFixtures,
  localClients,
} from "./local-fixtures";

test.use({ trace: "off" });
test("course API: frozen cycle price and privacy → concurrent last seat, closure and calendar", async ({
  baseURL,
}) => {
  const { db, client } = localClients(baseURL),
    own = client(),
    stranger = client(),
    staff = client();
  const users: string[] = [],
    dogs: string[] = [],
    courses: string[] = [],
    blocks: string[] = [];
  const observer = await new LocalPostgres().ready();
  try {
    const admin = await account(db, users, "admin"),
      owner = await account(db, users, "client"),
      other = await account(db, users, "client");
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
    for (const guardian of [owner.id, other.id, owner.id]) {
      const row = await checked(
        db
          .from("dogs")
          .insert({
            guardian_id: guardian,
            name: `Kurs API ${crypto.randomUUID().slice(0, 8)}`,
          })
          .select("id")
          .single(),
      );
      dogs.push(row!.id);
    }
    const service = await checked(
      staff
        .from("services")
        .select("id,version,price_cents")
        .eq("id", "60000000-0000-4000-8000-000000000001")
        .single(),
    );
    expect(service!.price_cents).toBe(10000);
    const dates = (index: number) =>
      Array.from({ length: 5 }, (_, n) =>
        new Date(
          Date.UTC(new Date().getUTCFullYear() + 2, index * 2, 15 + n * 7, 12),
        ).toISOString(),
      );
    const create = async (index: number) => {
      const id = crypto.randomUUID();
      courses.push(id);
      await checked(
        staff.rpc("create_course", {
          p_id: id,
          p_service: service!.id,
          p_expected_service_version: service!.version,
          p_title: `Kurs próby ${index}`,
          p_capacity: 1,
          p_public_location: "Publiczna okolica",
          p_exact_location: "PRYWATNY PUNKT KURSU",
          p_starts: dates(index),
        }),
      );
      return id;
    };
    const course = await create(0);
    expect(
      await checked(own.from("courses").select("id").eq("id", course)),
    ).toEqual([]);
    expect(
      await checked(
        own
          .from("course_creation_receipts")
          .select("course_id")
          .eq("course_id", course),
      ),
    ).toEqual([]);
    await checked(
      staff.rpc("change_course", {
        p_id: course,
        p_expected_version: 1,
        p_action: "publish",
        p_note: "",
      }),
    );
    const enrollments = [crypto.randomUUID(), crypto.randomUUID()];
    for (const [index, api] of [
      [0, own],
      [1, stranger],
    ] as const)
      await checked(
        api.rpc("request_course_enrollment", {
          p_id: enrollments[index],
          p_course: course,
          p_dog: dogs[index],
          p_expected_course_version: 2,
        }),
      );
    expect(
      await checked(
        stranger
          .from("course_enrollments")
          .select("id")
          .eq("id", enrollments[0]),
      ),
    ).toEqual([]);
    expect(
      await checked(
        own
          .from("course_private_details")
          .select("exact_location")
          .eq("course_id", course),
      ),
    ).toEqual([]);
    expect(
      (
        await own.rpc("change_course_enrollment", {
          p_id: enrollments[0],
          p_expected_version: 1,
          p_action: "accept",
          p_note: "",
        })
      ).error,
    ).not.toBeNull();
    let locks = 0;
    const race = async (
      first: string,
      second: string,
      pattern: RegExp,
      secondActor = admin.id,
    ) => {
      const a = await new LocalPostgres().ready(),
        b = await new LocalPostgres().ready();
      let pending: Promise<{ value?: string[]; error?: Error }> | undefined;
      try {
        await a.asUser(admin.id);
        await b.asUser(secondActor);
        await a.query(first);
        pending = b.query(second).then(
          (value) => ({ value }),
          (error) => ({ error }),
        );
        await waitForLock(observer, a, b);
        locks++;
        await a.query("commit;");
        expect((await pending).error?.message).toMatch(pattern);
      } finally {
        await Promise.all([a.close(), b.close()]);
        if (pending) await pending;
      }
    };
    const decide = (id: string) =>
      `select public.change_course_enrollment(${q(id)},1,'accept','');`;
    await race(
      decide(enrollments[0]),
      decide(enrollments[1]),
      /Brak wolnych miejsc/,
    );
    const roster = await checked(
      staff
        .from("course_enrollments")
        .select("id,status,charge_cents,agreed_price_cents")
        .eq("course_id", course),
    );
    expect(roster!.filter((row) => row.status === "accepted")).toHaveLength(1);
    expect(roster!.find((row) => row.id === enrollments[0])).toMatchObject({
      charge_cents: 10000,
      agreed_price_cents: 10000,
    });
    expect(
      await checked(
        own
          .from("course_private_details")
          .select("exact_location")
          .eq("course_id", course),
      ),
    ).toEqual([{ exact_location: "PRYWATNY PUNKT KURSU" }]);
    expect(
      await checked(
        stranger
          .from("course_private_details")
          .select("exact_location")
          .eq("course_id", course),
      ),
    ).toEqual([]);
    const sessions = await checked(
      own.from("course_sessions").select("id").eq("course_id", course),
    );
    expect(sessions).toHaveLength(5);
    expect(
      await checked(
        own
          .from("course_session_private_details")
          .select("session_id")
          .in(
            "session_id",
            sessions!.map((session) => session.id),
          ),
      ),
    ).toHaveLength(5);
    expect(
      await checked(
        stranger
          .from("course_session_private_details")
          .select("session_id")
          .in(
            "session_id",
            sessions!.map((session) => session.id),
          ),
      ),
    ).toEqual([]);

    const late = crypto.randomUUID();
    await race(
      `select public.change_course(${q(course)},2,'close','');`,
      `select public.request_course_enrollment(${q(late)},${q(course)},${q(dogs[2])},2);`,
      /Kurs zmienił się/,
      owner.id,
    );
    expect(
      await checked(
        staff.from("course_enrollments").select("id").eq("id", late),
      ),
    ).toEqual([]);
    await checked(
      staff.rpc("change_course", {
        p_id: course,
        p_expected_version: 3,
        p_action: "reopen",
        p_note: "",
      }),
    );
    await race(
      `select public.change_course(${q(course)},4,'cancel','Odwołany cykl');`,
      decide(enrollments[1]),
      /Zgłoszenie zmieniło się/,
    );
    const cancelled = await checked(
      staff
        .from("course_enrollments")
        .select("status,charge_cents")
        .eq("course_id", course),
    );
    expect(cancelled!.every((row) => row.status === "cancelled")).toBe(true);
    expect(cancelled!.reduce((sum, row) => sum + row.charge_cents, 0)).toBe(
      10000,
    );
    expect(
      await checked(
        own
          .from("course_private_details")
          .select("exact_location")
          .eq("course_id", course),
      ),
    ).toEqual([]);

    const secondCourse = await create(1),
      thirdCourse = await create(2);
    const blockA = crypto.randomUUID(),
      blockB = crypto.randomUUID();
    blocks.push(blockA, blockB);
    const block = (id: string, date: string) =>
      `select public.save_calendar_block(${q(id)},0,'Blokada próby',${q(date)},${q(new Date(Date.parse(date) + 3600000).toISOString())});`;
    const publish = (id: string) =>
      `select public.change_course(${q(id)},1,'publish','');`;
    await race(
      publish(secondCourse),
      block(blockA, dates(1)[0]),
      /czas jest już zajęty/,
    );
    await race(
      block(blockB, dates(2)[0]),
      publish(thirdCourse),
      /Termin kursu nakłada się/,
    );
    expect(locks).toBe(5);
    expect(
      await checked(
        staff
          .from("courses")
          .select("status,version")
          .eq("id", thirdCourse)
          .single(),
      ),
    ).toEqual({ status: "draft", version: 1 });
    expect(
      await checked(
        staff.from("course_history").select("id").eq("course_id", thirdCourse),
      ),
    ).toHaveLength(1);
    expect(
      await checked(
        own.rpc("request_course_enrollment", {
          p_id: enrollments[0],
          p_course: course,
          p_dog: dogs[0],
          p_expected_course_version: 2,
        }),
      ),
    ).toBe(enrollments[0]);
    expect(
      (await checked(
        staff.from("courses").select("price_cents").eq("id", course).single(),
      ))!.price_cents,
    ).toBe(10000);
  } finally {
    await observer.close();
    if (courses.length)
      await checked(db.from("courses").delete().in("id", courses));
    if (blocks.length)
      await checked(db.from("calendar_blocks").delete().in("id", blocks));
    await Promise.all([
      own.auth.signOut(),
      stranger.auth.signOut(),
      staff.auth.signOut(),
    ]);
    await disposeCareFixtures(db, users, dogs);
  }
});
