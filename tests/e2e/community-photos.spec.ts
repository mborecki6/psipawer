import { test, expect, type Page } from "@playwright/test";
import sharp from "sharp";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import {
  account,
  checked,
  disposeCareFixtures,
  localClients,
  login,
} from "./local-fixtures";

// Signing responses and image URLs contain temporary credentials.
test.use({ trace: "off" });
test("separate community photo → consent and moderation → replacement, removal and hiding", async ({
  browser,
  baseURL,
}) => {
  const { db, client } = localClients(baseURL);
  const users: string[] = [],
    dogs: string[] = [],
    paths: string[] = [];
  const own = client(),
    other = client(),
    staff = client(),
    anonymous = client();
  const ownerContext = await browser.newContext({
    baseURL,
    viewport: { width: 390, height: 844 },
  });
  const staffContext = await browser.newContext({ baseURL });
  const otherContext = await browser.newContext({ baseURL });
  const ownerPage = await ownerContext.newPage(),
    staffPage = await staffContext.newPage(),
    otherPage = await otherContext.newPage();
  const bucket = "community-avatars";
  let folder = "";
  try {
    const owner = await account(db, users, "client"),
      observer = await account(db, users, "client"),
      leader = await account(db, users, "admin");
    for (const [session, user] of [
      [own, owner],
      [other, observer],
      [staff, leader],
    ] as const)
      await checked(
        session.auth.signInWithPassword({
          email: user.email,
          password: user.password,
        }),
      );
    const dog = await checked(
      own
        .from("dogs")
        .insert({
          guardian_id: owner.id,
          name: `Prywatna Figa ${crypto.randomUUID().slice(0, 8)}`,
        })
        .select("id")
        .single(),
    );
    dogs.push(dog!.id);
    folder = `${owner.id}/${dog!.id}`;
    const publicName = `Psiutek ${crypto.randomUUID().slice(0, 8)}`;
    const source = await sharp({
      create: { width: 100, height: 60, channels: 3, background: "#e2bd9a" },
    })
      .withMetadata({ orientation: 6 })
      .withExifMerge({ IFD0: { Artist: "Private metadata" } })
      .jpeg()
      .toBuffer();
    const privatePath = `${folder}/private.webp`;
    paths.push(privatePath);
    await checked(
      own.storage
        .from("dog-avatars")
        .upload(privatePath, source, { contentType: "image/jpeg" }),
    );
    await checked(
      own.rpc("set_dog_avatar", {
        p_dog: dog!.id,
        p_expected_path: null,
        p_path: privatePath,
      }),
    );
    await login(ownerPage, owner, "client");
    await login(staffPage, leader, "admin");
    await login(otherPage, observer, "client");
    await ownerPage.goto("/app/community?tab=mine");
    const card = ownerPage.locator(`#my-${dog!.id}`);
    await card.getByText("Utwórz wizytówkę psa", { exact: true }).click();
    await card.getByLabel("Imię w Psiutkach").fill(publicName);
    await card.getByLabel("Kilka słów o mnie").fill("Lubię spokojne węszenie");
    await card
      .getByLabel("Jakiego towarzystwa szukamy?")
      .fill("Spokojnego kompana");
    await card.getByLabel(/Zgadzam się na pokazanie tej wizytówki/).check();
    await card
      .getByRole("button", {
        name: "Dodaj wizytówkę do sprawdzenia",
        exact: true,
      })
      .click();
    await expect(card.getByRole("status")).toContainText("Wizytówka wysłana");
    await card.getByText("Zdjęcie do Psiutków", { exact: true }).click();
    const photoForm = card
      .locator("form")
      .filter({ has: ownerPage.locator('input[name="file"]') });
    const choose = async (page: Page, name: string) => {
      const form = page
        .locator(`#my-${dog!.id} form`)
        .filter({ has: page.locator('input[name="file"]') });
      await form
        .getByLabel(/^Zdjęcie psa/)
        .setInputFiles({ name, mimeType: "image/jpeg", buffer: source });
      await form.getByLabel(/Zgadzam się na pokazanie tego zdjęcia/).check();
      return form;
    };
    await choose(ownerPage, "do-publikacji.jpg");
    await photoForm
      .getByRole("button", {
        name: "Dodaj zdjęcie do sprawdzenia",
        exact: true,
      })
      .click();
    await expect(photoForm.getByRole("status")).toContainText("Zdjęcie dodane");
    const profile = async () =>
      await checked(
        own
          .from("psiutki_profiles")
          .select("avatar_path,updated_at,published,headline,moderation_status")
          .eq("dog_id", dog!.id)
          .single(),
      );
    const first = (await profile())!.avatar_path;
    paths.push(first);
    expect(first).not.toBe(privatePath);
    const download = await checked(own.storage.from(bucket).download(first));
    const info = await sharp(
      Buffer.from(await download!.arrayBuffer()),
    ).metadata();
    expect([
      info.format,
      info.width,
      info.height,
      info.exif,
      info.orientation,
    ]).toEqual(["webp", 60, 100, undefined, undefined]);
    expect(
      (await other.storage.from(bucket).download(first)).error,
    ).not.toBeNull();
    expect(
      (await anonymous.storage.from(bucket).createSignedUrl(first, 30)).error,
    ).not.toBeNull();
    await expect(
      photoForm.getByLabel(/Zgadzam się na pokazanie tego zdjęcia/),
    ).not.toBeChecked();
    await expect(
      photoForm.locator('input[name="expected_updated_at"]'),
    ).toHaveValue((await profile())!.updated_at);
    const approve = async () => {
      await staffPage.goto("/admin/community?tab=moderation");
      const pending = staffPage.locator("article").filter({
        has: staffPage.getByRole("heading", {
          name: publicName,
          exact: true,
        }),
      });
      await pending.getByText("Sprawdź i zdecyduj", { exact: true }).click();
      await pending.getByLabel("Decyzja o wizytówce").selectOption("approved");
      await pending
        .getByLabel("Wiadomość dla opiekuna")
        .fill("Opis i zdjęcie zatwierdzone");
      await pending
        .getByRole("button", { name: "Zapisz decyzję", exact: true })
        .click();
      await expect(pending.getByRole("status")).toContainText(
        "zatwierdzona i opublikowana",
      );
    };
    await approve();
    await otherPage.goto("/app/community?tab=catalog");
    const publicCard = otherPage.locator(`#psiutek-${dog!.id}`);
    await expect(publicCard).toBeVisible();
    await expect(publicCard.locator("img")).toBeVisible();
    await checked(other.storage.from(bucket).download(first));
    expect(
      (await other.storage.from("dog-avatars").download(privatePath)).error,
    ).not.toBeNull();
    expect(await checked(other.storage.from(bucket).remove([first]))).toEqual(
      [],
    );
    expect(await checked(own.storage.from(bucket).remove([first]))).toEqual([]);
    expect(
      (
        await other.storage
          .from(bucket)
          .upload(`${folder}/forged.webp`, source, {
            contentType: "image/jpeg",
          })
      ).error,
    ).not.toBeNull();

    await ownerPage.goto("/app/community?tab=mine");
    await card.getByText("Zdjęcie do Psiutków", { exact: true }).click();
    const stale = await ownerContext.newPage();
    await stale.goto("/app/community?tab=mine");
    await stale
      .locator(`#my-${dog!.id}`)
      .getByText("Zdjęcie do Psiutków", { exact: true })
      .click();
    const staleForm = await choose(stale, "starsza-wizytowka.jpg");
    const staleVersion = await staleForm
      .locator('input[name="expected_updated_at"]')
      .inputValue();
    await choose(ownerPage, "nowa-wizytowka.jpg");
    await photoForm
      .getByRole("button", {
        name: "Dodaj zdjęcie do sprawdzenia",
        exact: true,
      })
      .click();
    await expect(photoForm.getByRole("status")).toContainText("Zdjęcie dodane");
    const second = (await profile())!.avatar_path;
    paths.push(second);
    expect(second).not.toBe(first);
    expect((await profile())!.published).toBe(false);
    expect(
      (await own.storage.from(bucket).download(first)).error,
    ).not.toBeNull();
    expect(
      (await other.storage.from(bucket).download(second)).error,
    ).not.toBeNull();
    await staleForm
      .getByRole("button", {
        name: "Dodaj zdjęcie do sprawdzenia",
        exact: true,
      })
      .click();
    await expect(staleForm.getByRole("alert")).toContainText(
      "zmienił się w międzyczasie",
    );
    await expect(staleForm.getByRole("alert")).toBeFocused();
    await expect(
      staleForm.locator('input[name="expected_updated_at"]'),
    ).toHaveValue(staleVersion);
    expect(
      await staleForm
        .locator('input[name="file"]')
        .evaluate((input) => (input as HTMLInputElement).files?.[0]?.name),
    ).toBe("starsza-wizytowka.jpg");
    await stale.close();
    // A second upload in the same editor uses its own acknowledged revision.
    await choose(ownerPage, "kolejna-wizytowka.jpg");
    await photoForm
      .getByRole("button", {
        name: "Dodaj zdjęcie do sprawdzenia",
        exact: true,
      })
      .click();
    await expect
      .poll(async () => (await profile())!.avatar_path)
      .not.toBe(second);
    await expect
      .poll(async () =>
        Boolean((await own.storage.from(bucket).download(second)).error),
      )
      .toBe(true);
    await expect(photoForm.getByRole("status")).toContainText("Zdjęcie dodane");
    const third = (await profile())!.avatar_path;
    await expect(
      photoForm.locator('input[name="expected_updated_at"]'),
    ).toHaveValue((await profile())!.updated_at);
    paths.push(third);
    expect(third).not.toBe(second);
    expect(
      (await own.storage.from(bucket).download(second)).error,
    ).not.toBeNull();
    const screenshots = resolve("output/photos");
    await mkdir(screenshots, { recursive: true });
    for (const width of [320, 390, 1440]) {
      await ownerPage.setViewportSize({ width, height: 900 });
      await ownerPage.evaluate(async () => {
        (document.activeElement as HTMLElement | null)?.blur();
        window.scrollTo({ top: 0, behavior: "instant" });
        await new Promise<void>((done) =>
          requestAnimationFrame(() => requestAnimationFrame(() => done())),
        );
      });
      expect(
        await ownerPage.evaluate(
          () => document.documentElement.scrollWidth > window.innerWidth + 1,
        ),
      ).toBe(false);
      await ownerPage.screenshot({
        path: resolve(screenshots, `community-${width}.png`),
        fullPage: true,
      });
    }
    await approve();
    await ownerPage.goto("/app/community?tab=mine");
    await card.getByText("Edytuj wizytówkę", { exact: true }).click();
    await card.getByLabel("Usuń zdjęcie z wizytówki przy zapisie").check();
    await card.getByLabel(/Zgadzam się na pokazanie tej wizytówki/).check();
    await card
      .getByRole("button", {
        name: "Zapisz i przekaż do sprawdzenia",
        exact: true,
      })
      .click();
    await expect(card.getByRole("status")).toContainText("Wizytówka wysłana");
    expect((await profile())!.avatar_path).toBeNull();
    expect(
      (await own.storage.from(bucket).download(third)).error,
    ).not.toBeNull();
    expect((await profile())!.headline).toBe("Lubię spokojne węszenie");
    await approve();
    await ownerPage.goto("/app/community?tab=mine");
    await card
      .locator("summary")
      .filter({ hasText: "Ukryj wizytówkę" })
      .click();
    ownerPage.once("dialog", (dialog) => dialog.accept());
    await card
      .getByRole("button", { name: "Ukryj wizytówkę", exact: true })
      .click();
    await expect(card.getByRole("status")).toContainText("Wizytówka ukryta");
    await otherPage.goto("/app/community?tab=catalog");
    await expect(publicCard).toHaveCount(0);
    expect(
      await checked(
        other.from("psiutki_profiles").select("dog_id").eq("dog_id", dog!.id),
      ),
    ).toEqual([]);
    for (const path of paths.filter((p) => p !== privatePath))
      expect(
        (await checked(
          db
            .from("avatar_cleanup")
            .select("completed_at")
            .eq("bucket_id", bucket)
            .eq("object_path", path)
            .single(),
        ))!.completed_at,
      ).not.toBeNull();
  } finally {
    await Promise.all([
      ownerContext.close(),
      staffContext.close(),
      otherContext.close(),
    ]);
    if (dogs.length) {
      await checked(
        db.from("dogs").update({ avatar_path: null }).in("id", dogs),
      );
      await checked(
        db
          .from("psiutki_profiles")
          .update({ avatar_path: null })
          .in("dog_id", dogs),
      );
    }
    if (folder)
      for (const b of [bucket, "dog-avatars"]) {
        const files = await checked(db.storage.from(b).list(folder));
        if (files?.length)
          await checked(
            db.storage
              .from(b)
              .remove(files.map((file) => `${folder}/${file.name}`)),
          );
      }
    if (users.length)
      await checked(
        db.from("avatar_uploads").delete().in("guardian_id", users),
      );
    if (users.length)
      await checked(
        db.from("avatar_cleanup").delete().in("guardian_id", users),
      );
    for (const session of [own, other, staff]) await session.auth.signOut();
    await disposeCareFixtures(db, users, dogs);
  }
});
