import { consultationJourney } from "./consultation-journey";
import { test } from "@playwright/test";
import {
  localClients,
  checked,
  account,
  login,
  disposeCareFixtures,
} from "./local-fixtures";

test("consultation → private draft → completed meeting → publication → guardian response", async ({
  browser,
  baseURL,
}) => {
  const { db, client } = localClients(baseURL);
  const users: string[] = [];
  const dogs: string[] = [];
  const staffContext = await browser.newContext({
    baseURL,
    viewport: { width: 1440, height: 1000 },
  });
  const guardianContext = await browser.newContext({
    baseURL,
    viewport: { width: 390, height: 844 },
  });
  const staff = await staffContext.newPage();
  const guardian = await guardianContext.newPage();
  const outsiderDb = client();
  try {
    const staffAccount = await account(db, users, "admin");
    const owner = await account(db, users, "client");
    const outsider = await account(db, users, "client");
    await checked(
      outsiderDb.auth.signInWithPassword({
        email: outsider.email,
        password: outsider.password,
      }),
    );
    await login(staff, staffAccount, "admin");
    await login(guardian, owner, "client");
    await consultationJourney({
      db,
      outsiderDb,
      staff,
      guardian,
      ownerId: owner.id,
      staffId: staffAccount.id,
      dogs,
    });
  } finally {
    await staffContext.close();
    await guardianContext.close();
    await outsiderDb.auth.signOut();
    await disposeCareFixtures(db, users, dogs);
  }
});
