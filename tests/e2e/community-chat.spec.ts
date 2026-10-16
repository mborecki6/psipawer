import { expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import {
  test,
  account,
  checked,
  disposeCareFixtures,
  localClients,
  login,
} from "./local-fixtures";

// Real local Auth/PostgREST and UI; no provider, real recipients or attachments.
test.use({ trace: "off" });
test("Psiutki: both consents, private chat, safe retry, continuous history and revoked access", async ({
  browser,
  baseURL,
}, info) => {
  const { db, client } = localClients(baseURL);
  const users: string[] = [],
    dogs: string[] = [];
  const apiA = client(),
    apiB = client(),
    staff = client(),
    outsiderApi = client();
  const contextA = await browser.newContext({
    baseURL,
    viewport: { width: 390, height: 844 },
  });
  const contextB = await browser.newContext({
    baseURL,
    viewport: { width: 320, height: 800 },
  });
  const a = await contextA.newPage(),
    b = await contextB.newPage();
  try {
    const ownerA = await account(db, users, "client"),
      ownerB = await account(db, users, "client"),
      outsider = await account(db, users, "client"),
      admin = await account(db, users, "admin");
    for (const [api, user] of [
      [apiA, ownerA],
      [apiB, ownerB],
      [outsiderApi, outsider],
      [staff, admin],
    ] as const)
      await checked(
        api.auth.signInWithPassword({
          email: user.email,
          password: user.password,
        }),
      );
    const dogA = randomUUID(),
      dogB = randomUUID();
    dogs.push(dogA, dogB);
    await checked(
      db.from("dogs").insert([
        { id: dogA, guardian_id: ownerA.id, name: "Czat lokalny A" },
        { id: dogB, guardian_id: ownerB.id, name: "Czat lokalny B" },
      ]),
    );
    const publishProfile = async (api: typeof apiA, dog: string) => {
      const current = await checked(
        api
          .from("psiutki_profiles")
          .select("updated_at")
          .eq("dog_id", dog)
          .maybeSingle(),
      );
      await checked(
        api.rpc("save_community_profile", {
          p_dog: dog,
          p_expected_updated_at: current?.updated_at ?? null,
          p_consent: true,
          payload: {
            display_name: dog === dogA ? "Czat lokalny A" : "Czat lokalny B",
            area: "Okolica testowa",
            headline: "Fikcyjny pies do testu rozmowy",
            seeking: "Spokojne spacery",
            traits: ["Spokojny"],
            likes: "Spacery",
            dislikes: "",
            avatar_path: null,
          },
        }),
      );
      const saved = await checked(
        staff
          .from("psiutki_profiles")
          .select("updated_at")
          .eq("dog_id", dog)
          .single(),
      );
      await checked(
        staff.rpc("moderate_community_profile", {
          p_dog: dog,
          p_expected_updated_at: saved!.updated_at,
          p_decision: "approved",
          p_note: "Fikcyjna wizytówka do lokalnego testu",
        }),
      );
    };
    const mutual = async () => {
      await checked(
        apiA.rpc("express_community_interest", {
          p_from_dog: dogA,
          p_to_dog: dogB,
        }),
      );
      await checked(
        apiB.rpc("express_community_interest", {
          p_from_dog: dogB,
          p_to_dog: dogA,
        }),
      );
    };
    await publishProfile(apiA, dogA);
    await publishProfile(apiB, dogB);
    await mutual();
    expect(await checked(apiA.rpc("community_chat_links"))).toEqual([]);
    expect(
      await checked(
        db
          .from("notifications")
          .select("id")
          .eq("kind", "community_chat_message")
          .in("recipient_id", [ownerA.id, ownerB.id]),
      ),
    ).toEqual([]);

    await login(a, ownerA, "client");
    await login(b, ownerB, "client");
    await a.goto("/app/community?tab=interests");
    await a.getByText("Rozmowa z drugim opiekunem", { exact: true }).click();
    await a.getByRole("checkbox", { name: /Chcę rozmawiać/ }).check();
    await a.getByRole("button", { name: "Włącz rozmowę", exact: true }).click();
    await expect(a).toHaveURL(/\/app\/community\/chat\/[a-f0-9-]+$/);
    const chat = new URL(a.url()).pathname.split("/").at(-1)!;
    await expect(
      a.getByText(/Czekamy na zgodę drugiego opiekuna/),
    ).toBeVisible();
    await expect(a.getByLabel("Twoja wiadomość")).toHaveCount(0);
    expect(
      Boolean(
        (
          await apiA.rpc("send_community_chat_message", {
            p_chat: chat,
            p_request: randomUUID(),
            p_body: "Za wcześnie",
          })
        ).error,
      ),
    ).toBe(true);
    await b.goto("/app/community?tab=interests");
    await b
      .getByRole("link", { name: "Zaproszenie do rozmowy", exact: true })
      .click();
    await b.getByRole("checkbox", { name: /Chcę rozmawiać/ }).check();
    await b
      .getByRole("button", { name: "Dołącz do rozmowy", exact: true })
      .click();
    await expect(b.getByLabel("Twoja wiadomość")).toBeVisible();
    await a
      .getByRole("button", { name: "Odśwież rozmowę", exact: true })
      .click();
    await expect(a.getByLabel("Twoja wiadomość")).toBeVisible();

    // The database accepts the first send, but its response is deliberately lost.
    // Retrying must retain body + request ID and leave exactly one stored row.
    const body = `Prywatna wiadomość testowa ${randomUUID()}`;
    let dropped = false;
    await a.route(`**/app/community/chat/${chat}`, async (route) => {
      const request = route.request();
      if (
        !dropped &&
        request.method() === "POST" &&
        request.headers()["next-action"] &&
        request.postData()?.includes(body)
      ) {
        dropped = true;
        await route.fetch();
        await route.abort("failed");
      } else await route.continue();
    });
    await a.getByLabel("Twoja wiadomość").fill(body);
    await a
      .getByRole("button", { name: "Wyślij wiadomość", exact: true })
      .click();
    await expect(
      a.getByRole("button", { name: "Ponów tę samą wiadomość", exact: true }),
    ).toBeVisible();
    await expect(a.getByLabel("Twoja wiadomość")).toHaveAttribute(
      "readonly",
      "",
    );
    expect(dropped).toBe(true);
    await a
      .getByRole("button", { name: "Ponów tę samą wiadomość", exact: true })
      .click();
    await expect(a.getByLabel("Twoja wiadomość")).toHaveValue("");
    await expect(a.getByLabel("Twoja wiadomość")).not.toHaveAttribute(
      "readonly",
      "",
    );
    await expect(
      a.getByRole("button", { name: "Wyślij wiadomość", exact: true }),
    ).toBeVisible();
    await expect(a.getByLabel("Twoja wiadomość")).toBeEnabled();
    await a.unroute(`**/app/community/chat/${chat}`);
    expect(
      await checked(
        db
          .from("community_chat_messages")
          .select("id")
          .eq("chat_id", chat)
          .eq("body", body),
      ),
    ).toHaveLength(1);
    const notices = await checked(
      apiB
        .from("notifications")
        .select("id,kind,entity_id,chat_id")
        .eq("chat_id", chat),
    );
    expect(notices).toEqual([
      expect.objectContaining({
        kind: "community_chat_message",
        entity_id: chat,
        chat_id: chat,
      }),
    ]);
    await b
      .getByRole("button", { name: "Odśwież rozmowę", exact: true })
      .click();
    await expect(b.getByText(body, { exact: true })).toBeVisible();
    for (const api of [staff, outsiderApi]) {
      expect(
        await checked(
          api.from("community_chat_messages").select("id").eq("chat_id", chat),
        ),
      ).toEqual([]);
      expect(
        Boolean(
          (await api.rpc("community_chat_messages_page", { p_chat: chat }))
            .error,
        ),
      ).toBe(true);
    }
    for (const page of [a, b]) {
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth + 1,
        ),
      ).toBe(true);
      await expect(page.getByText(ownerA.email, { exact: true })).toHaveCount(
        0,
      );
      await expect(page.getByText(ownerB.email, { exact: true })).toHaveCount(
        0,
      );
      await page.screenshot({
        path: info.outputPath(`chat-${page.viewportSize()!.width}.png`),
        fullPage: true,
      });
    }

    // Simulate an inactive tab with forty new rows, with a known chronological
    // range. Fixture inserts avoid rate-limiting a human-speed scenario.
    const burst = Array.from({ length: 40 }, (_, i) => ({
      id: randomUUID(),
      chat_id: chat,
      sender_id: ownerB.id,
      request_id: randomUUID(),
      body: `Historia ${i + 1}`,
      created_at: new Date(Date.now() + 1000 + i).toISOString(),
    }));
    await checked(db.from("community_chat_messages").insert(burst));
    await a
      .getByRole("button", { name: "Odśwież rozmowę", exact: true })
      .click();
    await expect(
      a.getByText(/Pod Twoją nieobecność pojawiło się wiele wiadomości/),
    ).toBeVisible();
    await expect(a.getByText("Historia 11", { exact: true })).toBeVisible();
    await a
      .getByRole("button", { name: "Starsze wiadomości", exact: true })
      .click();
    await expect(a.getByText("Historia 1", { exact: true })).toBeVisible();
    await expect(a.getByText(body, { exact: true })).toBeVisible();
    await expect(
      a.getByRole("list", { name: "Wiadomości rozmowy" }).getByRole("listitem"),
    ).toHaveCount(41);

    // Transport failure during an explicit refresh is visible and recoverable.
    let failedRefresh = false;
    await a.route(`**/app/community/chat/${chat}`, async (route) => {
      if (!failedRefresh && route.request().method() === "POST") {
        failedRefresh = true;
        await route.abort("failed");
      } else await route.continue();
    });
    await a
      .getByRole("button", { name: "Odśwież rozmowę", exact: true })
      .click();
    await expect(a.getByRole("main").getByRole("alert")).toContainText(
      "Nie udało się odświeżyć",
    );
    await a.unroute(`**/app/community/chat/${chat}`);
    await a
      .getByRole("button", { name: "Odśwież rozmowę", exact: true })
      .click();
    await expect(a.getByRole("main").getByRole("alert")).toHaveCount(0);

    // Revocation while both tabs remain open: an older page and a concurrent
    // send must both reauthorize. Neither tab may retain accessible history.
    await b
      .getByRole("button", { name: "Odśwież rozmowę", exact: true })
      .click();
    // The stale tab must have received the latest page before revocation.
    // A click alone does not await the asynchronous server-action response.
    await expect(b.getByText("Historia 11", { exact: true })).toBeVisible();
    await expect(
      b.getByRole("button", { name: "Starsze wiadomości", exact: true }),
    ).toBeVisible();
    await a.getByLabel("Twoja wiadomość").fill("Nie powinna zostać zapisana");
    const interest = await checked(
      apiA
        .from("psiutki_interests")
        .select("id")
        .eq("from_dog_id", dogA)
        .eq("to_dog_id", dogB)
        .single(),
    );
    await checked(
      apiA.rpc("withdraw_community_interest", { p_interest: interest!.id }),
    );
    await Promise.all([
      a.getByRole("button", { name: "Wyślij wiadomość", exact: true }).click(),
      b
        .getByRole("button", { name: "Starsze wiadomości", exact: true })
        .click(),
    ]);
    for (const page of [a, b]) {
      await expect(page.getByText(/Dostęp do rozmowy wygasł/)).toBeVisible();
      await expect(
        page.getByRole("list", { name: "Wiadomości rozmowy" }),
      ).toHaveCount(0);
      await expect(page.getByLabel("Twoja wiadomość")).toHaveCount(0);
    }
    expect(
      await checked(
        db
          .from("community_chat_messages")
          .select("id")
          .eq("chat_id", chat)
          .eq("body", "Nie powinna zostać zapisana"),
      ),
    ).toEqual([]);

    await checked(apiA.rpc("hide_community_profile", { p_dog: dogA }));
    await publishProfile(apiA, dogA);
    await mutual();
    expect(
      (await checked(apiA.rpc("community_chat_state", { p_chat: chat }))).state,
    ).toBe("access_lost");
    expect(
      Boolean(
        (await apiA.rpc("community_chat_messages_page", { p_chat: chat }))
          .error,
      ),
    ).toBe(true);
    const next = await checked(
      apiA.rpc("join_community_chat", {
        p_from_dog: dogA,
        p_to_dog: dogB,
        p_consent: true,
      }),
    );
    expect(next).not.toBe(chat);
    expect(
      (await checked(apiA.rpc("community_chat_state", { p_chat: next }))).state,
    ).toBe("waiting_other");
    await checked(
      apiB.rpc("join_community_chat", {
        p_from_dog: dogB,
        p_to_dog: dogA,
        p_consent: true,
      }),
    );
    await a.goto(`/app/community/chat/${next}`);
    await expect(
      a.getByText("Rozmowa jest otwarta.", { exact: true }),
    ).toBeVisible();
    await a.getByText("Ustawienia rozmowy", { exact: true }).click();
    a.once("dialog", (dialog) => dialog.accept());
    await a.getByRole("button", { name: "Wycofaj zgodę", exact: true }).click();
    // This must update on the action result, rather than the 20-second poll.
    await expect(
      a.getByText(/Zgoda na tę rozmowę została wycofana/),
    ).toBeVisible({ timeout: 5000 });
    await expect(a.getByLabel("Twoja wiadomość")).toHaveCount(0);
    await checked(
      db.from("dogs").update({ guardian_id: outsider.id }).eq("id", dogA),
    );
    for (const api of [apiA, apiB, outsiderApi, staff]) {
      expect(
        Boolean(
          (await api.rpc("community_chat_messages_page", { p_chat: chat }))
            .error,
        ),
      ).toBe(true);
      expect(
        await checked(
          api.from("community_chat_messages").select("id").eq("chat_id", chat),
        ),
      ).toEqual([]);
    }
  } finally {
    await contextA.close();
    await contextB.close();
    for (const api of [apiA, apiB, outsiderApi, staff])
      await api.auth.signOut();
    await disposeCareFixtures(db, users, dogs, async () => {
      // The established interests table predates cascading dog deletion.
      await checked(
        db.from("psiutki_interests").delete().in("from_dog_id", dogs),
      );
      await checked(
        db.from("psiutki_interests").delete().in("to_dog_id", dogs),
      );
    });
  }
});
