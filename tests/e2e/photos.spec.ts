import { test, expect } from "@playwright/test";
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

// Storage signing responses and browser image URLs contain temporary secrets.
test.use({ trace: "off" });

test("private dog photo → owner and staff access → Storage API isolation", async ({
  browser,
  baseURL,
}) => {
  const { db, client } = localClients(baseURL);
  const users: string[] = [],
    dogs: string[] = [];
  const own = client(),
    stranger = client(),
    staff = client(),
    anonymous = client();
  const context = await browser.newContext({
    baseURL,
    viewport: { width: 390, height: 844 },
  });
  const page = await context.newPage();
  const bucket = "dog-avatars";
  const folders: string[] = [],
    attemptedPaths: string[] = [];
  try {
    const owner = await account(db, users, "client");
    const other = await account(db, users, "client");
    const leader = await account(db, users, "admin");
    for (const [session, user] of [
      [own, owner],
      [stranger, other],
      [staff, leader],
    ] as const)
      await checked(
        session.auth.signInWithPassword({
          email: user.email,
          password: user.password,
        }),
      );
    const dogName = `Zdjęcie testowe ${crypto.randomUUID().slice(0, 8)}`;
    for (const [session, user] of [
      [own, owner],
      [stranger, other],
    ] as const) {
      const dog = await checked(
        session
          .from("dogs")
          .insert({ guardian_id: user.id, name: dogName })
          .select("id")
          .single(),
      );
      dogs.push(dog!.id);
      folders.push(`${user.id}/${dog!.id}`);
    }
    const source = await sharp({
      create: { width: 48, height: 32, channels: 3, background: "#be8174" },
    })
      .png()
      .toBuffer();
    await login(page, owner, "client");
    await page.goto(`/app/dogs/${dogs[0]}`);
    const stale = await context.newPage();
    await stale.goto(`/app/dogs/${dogs[0]}`);
    await stale.getByLabel("Zdjęcie (JPG, PNG, WebP do 1,5 MB)").setInputFiles({
      name: "starsza-karta.png",
      mimeType: "image/png",
      buffer: source,
    });
    await page.getByLabel("Zdjęcie (JPG, PNG, WebP do 1,5 MB)").setInputFiles({
      name: "testowe-zdjecie.png",
      mimeType: "image/png",
      buffer: source,
    });
    await page
      .getByRole("button", { name: "Zapisz zdjęcie", exact: true })
      .click();
    await expect(page.getByRole("status")).toContainText("Zdjęcie zapisane");
    const photo = page.getByRole("img", { name: dogName, exact: true });
    await expect(photo).toBeVisible();
    await expect
      .poll(() =>
        photo.evaluate((element) => (element as HTMLImageElement).naturalWidth),
      )
      .toBe(48);
    const record = await checked(
      own.from("dogs").select("avatar_path").eq("id", dogs[0]).single(),
    );
    const path = String(record!.avatar_path);
    expect(path.startsWith(`${folders[0]}/`)).toBe(true);

    for (const session of [own, staff]) {
      const download = await checked(
        session.storage.from(bucket).download(path),
      );
      const info = await sharp(
        Buffer.from(await download!.arrayBuffer()),
      ).metadata();
      expect([info.format, info.width, info.height]).toEqual(["webp", 48, 32]);
      expect(info.exif).toBeUndefined();
      const signed = await checked(
        session.storage.from(bucket).createSignedUrl(path, 30),
      );
      expect(Boolean(signed?.signedUrl)).toBe(true);
    }
    for (const session of [stranger, anonymous]) {
      const download = await session.storage.from(bucket).download(path);
      expect(Boolean(download.error)).toBe(true);
      expect(download.data).toBeNull();
      const signed = await session.storage
        .from(bucket)
        .createSignedUrl(path, 30);
      expect(Boolean(signed.error)).toBe(true);
      expect(signed.data).toBeNull();
    }
    const otherList = await checked(
      stranger.storage.from(bucket).list(folders[0]),
    );
    expect(otherList).toEqual([]);
    const deleted = await checked(stranger.storage.from(bucket).remove([path]));
    expect(deleted).toEqual([]);
    expect(
      (await checked(own.storage.from(bucket).download(path)))!.size,
    ).toBeGreaterThan(0);

    for (const forged of [
      `${folders[0]}/forged.png`,
      `${other.id}/${dogs[0]}/forged.png`,
    ]) {
      attemptedPaths.push(forged);
      const write = await stranger.storage
        .from(bucket)
        .upload(forged, source, { contentType: "image/png" });
      expect(Boolean(write.error)).toBe(true);
    }
    const overwrite = await stranger.storage
      .from(bucket)
      .update(path, source, { contentType: "image/png" });
    expect(Boolean(overwrite.error)).toBe(true);
    const publicURL = anonymous.storage.from(bucket).getPublicUrl(path)
      .data.publicUrl;
    const publicResponse = await fetch(publicURL, {
      redirect: "error",
      signal: AbortSignal.timeout(10000),
    });
    expect(publicResponse.ok).toBe(false);
    await publicResponse.arrayBuffer();

    // API-level row isolation also prevents changing another dog's attachment.
    const changed = await checked(
      stranger
        .from("dogs")
        .update({ avatar_path: null })
        .eq("id", dogs[0])
        .select("id"),
    );
    expect(changed).toEqual([]);
    expect(
      (await checked(
        own.from("dogs").select("avatar_path").eq("id", dogs[0]).single(),
      ))!.avatar_path,
    ).toBe(path);

    // Owner and staff cannot physically remove a photo still attached to a dog.
    for (const session of [own, staff])
      expect(
        await checked(session.storage.from(bucket).remove([path])),
      ).toEqual([]);
    await stale
      .getByRole("button", { name: "Zapisz zdjęcie", exact: true })
      .click();
    const staleError = stale
      .locator("form")
      .filter({ has: stale.locator('input[name="photo"]') })
      .getByRole("alert");
    await expect(staleError).toContainText("Zdjęcie psa zmieniło się");
    await expect(staleError).toBeFocused();
    expect(
      await stale
        .locator('input[type="file"]')
        .evaluate((input) => (input as HTMLInputElement).files?.[0]?.name),
    ).toBe("starsza-karta.png");
    await expect(
      stale.locator('input[name="expected_avatar_path"]'),
    ).toHaveValue("");
    await stale.close();

    await page.getByLabel("Zdjęcie (JPG, PNG, WebP do 1,5 MB)").setInputFiles({
      name: "uszkodzone.jpg",
      mimeType: "image/jpeg",
      buffer: Buffer.from([255, 216, 255, 0]),
    });
    await page
      .getByRole("button", { name: "Zapisz zdjęcie", exact: true })
      .click();
    await expect(
      page
        .locator("form")
        .filter({ has: page.locator('input[name="photo"]') })
        .getByRole("alert"),
    ).toContainText("Nie można odczytać zdjęcia");
    expect(
      (await checked(own.storage.from(bucket).list(folders[0])))?.length,
    ).toBe(1);
    const replacement = await sharp({
      create: { width: 48, height: 32, channels: 3, background: "#91bfa8" },
    })
      .withMetadata({ orientation: 6 })
      .withExifMerge({ IFD0: { Artist: "Private source owner" } })
      .jpeg()
      .toBuffer();
    await page.getByLabel("Zdjęcie (JPG, PNG, WebP do 1,5 MB)").setInputFiles({
      name: "nowe.jpg",
      mimeType: "image/jpeg",
      buffer: replacement,
    });
    await page
      .getByRole("button", { name: "Zapisz zdjęcie", exact: true })
      .click();
    await expect(page.getByRole("status")).toContainText("Zdjęcie zapisane");
    const replaced = await checked(
      own.from("dogs").select("avatar_path").eq("id", dogs[0]).single(),
    );
    expect(replaced!.avatar_path).not.toBe(path);
    expect(
      (await own.storage.from(bucket).download(path)).error,
    ).not.toBeNull();
    const newImage = await checked(
      own.storage.from(bucket).download(replaced!.avatar_path),
    );
    const newInfo = await sharp(
      Buffer.from(await newImage!.arrayBuffer()),
    ).metadata();
    expect([
      newInfo.format,
      newInfo.width,
      newInfo.height,
      newInfo.exif,
      newInfo.orientation,
    ]).toEqual(["webp", 32, 48, undefined, undefined]);
    expect(
      (await checked(
        db
          .from("avatar_cleanup")
          .select("completed_at")
          .eq("object_path", path)
          .single(),
      ))!.completed_at,
    ).not.toBeNull();
    await expect(
      page.locator('input[name="expected_avatar_path"]'),
    ).toHaveValue(replaced!.avatar_path);
    expect(
      await page
        .locator('input[type="file"]')
        .evaluate((input) => (input as HTMLInputElement).files?.length),
    ).toBe(0);
    const screenshots = resolve("output/photos");
    await mkdir(screenshots, { recursive: true });
    for (const width of [320, 390, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await page.evaluate(async () => {
        (document.activeElement as HTMLElement | null)?.blur();
        window.scrollTo({ top: 0, behavior: "instant" });
        await new Promise<void>((done) =>
          requestAnimationFrame(() => requestAnimationFrame(() => done())),
        );
      });
      await expect(
        page.getByRole("button", { name: "Usuń zdjęcie", exact: true }),
      ).toBeVisible();
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth > window.innerWidth + 1,
        ),
      ).toBe(false);
      await page.screenshot({
        path: resolve(screenshots, `private-${width}.png`),
        fullPage: true,
      });
    }
    page.once("dialog", (dialog) => dialog.accept());
    await page
      .getByRole("button", { name: "Usuń zdjęcie", exact: true })
      .click();
    await expect(page.getByRole("status")).toContainText(
      "Zdjęcie usunięte z karty psa",
    );
    await expect(photo).toHaveCount(0);
    expect(
      (await own.storage.from(bucket).download(replaced!.avatar_path)).error,
    ).not.toBeNull();
    await expect(
      page.getByRole("button", { name: "Usuń zdjęcie", exact: true }),
    ).toHaveCount(0);
    expect(
      (
        await own.storage
          .from(bucket)
          .upload(path, source, { contentType: "image/png" })
      ).error,
    ).not.toBeNull();
  } finally {
    await context.close();
    if (dogs.length)
      await checked(
        db.from("dogs").update({ avatar_path: null }).in("id", dogs),
      );
    for (const folder of folders) {
      const files = await checked(db.storage.from(bucket).list(folder));
      if (files?.length)
        await checked(
          db.storage
            .from(bucket)
            .remove(files.map((file) => `${folder}/${file.name}`)),
        );
    }
    if (attemptedPaths.length)
      await checked(db.storage.from(bucket).remove(attemptedPaths));
    for (const session of [own, stranger, staff]) await session.auth.signOut();
    if (users.length)
      await checked(
        db.from("avatar_uploads").delete().in("guardian_id", users),
      );
    if (users.length)
      await checked(
        db.from("avatar_cleanup").delete().in("guardian_id", users),
      );
    await disposeCareFixtures(db, users, dogs);
  }
});
