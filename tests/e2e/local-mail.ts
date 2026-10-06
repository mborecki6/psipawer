import { expect, type Page } from "@playwright/test";

const mailbox = "http://127.0.0.1:54324";
type MailSummary = { ID: string; Subject: string; To: { Address: string }[] };
export async function mailRequest(path: string, init?: RequestInit) {
  try {
    const response = await fetch(`${mailbox}${path}`, {
      ...init,
      redirect: "error",
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) throw new Error("mailbox response");
    return response;
  } catch {
    throw new Error("Local test mailbox is unavailable.");
  }
}
export async function findMessages(email: string): Promise<MailSummary[]> {
  if (!/^psi-e2e-.+@example\.test$/.test(email))
    throw new Error("Expected an isolated test mailbox address.");
  const response = await mailRequest(
    `/api/v1/search?query=${encodeURIComponent(`to:${email}`)}`,
  );
  const data = await response.json();
  return (data.messages as MailSummary[]).filter((m) =>
    m.To.some((to) => to.Address === email),
  );
}
export async function emailedLink(
  email: string,
  path: string,
  app: string,
  excludeIds: string[] = [],
) {
  let messages: MailSummary[] = [];
  await expect
    .poll(
      async () => {
        messages = (await findMessages(email)).filter(
          (m) => !excludeIds.includes(m.ID),
        );
        return messages.some((m) =>
          path.endsWith("invitation")
            ? m.Subject.includes("Zaproszenie")
            : m.Subject.includes("hasło"),
        );
      },
      { timeout: 15000 },
    )
    .toBe(true);
  const summary = messages.find((m) =>
    path.endsWith("invitation")
      ? m.Subject.includes("Zaproszenie")
      : m.Subject.includes("hasło"),
  )!;
  const message = await (
    await mailRequest(`/api/v1/message/${encodeURIComponent(summary.ID)}`)
  ).json();
  const links = [...String(message.HTML).matchAll(/href="([^"]+)"/g)].map((m) =>
    m[1].replaceAll("&amp;", "&"),
  );
  for (const link of links) {
    const parsed = new URL(link);
    if (
      parsed.origin === new URL(app).origin &&
      parsed.pathname === path &&
      /^[A-Za-z0-9_-]{32,256}$/.test(
        parsed.searchParams.get("token_hash") || "",
      )
    )
      return link;
  }
  throw new Error(
    "The local message does not contain the expected application link.",
  );
}
export async function savePassword(page: Page, password: string) {
  await page.getByLabel("Nowe hasło", { exact: true }).fill(password);
  await page.getByLabel("Powtórz nowe hasło", { exact: true }).fill(password);
  await page
    .getByRole("button", { name: "Zapisz nowe hasło", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Hasło zostało zapisane." }),
  ).toBeVisible();
}
export async function openPrivateLink(page: Page, link: string) {
  try {
    await page.goto(link);
  } catch {
    throw new Error("Could not open the local authentication page.");
  }
}
export async function expectSecurityStage(
  page: Page,
  stage: "activated" | "recovered",
) {
  // Never print the current URL on failure: it may still hold a one-time token.
  // Allow the same development navigation deadline as password login.
  await expect
    .poll(
      () => {
        const current = new URL(page.url());
        return (
          current.pathname === "/account/security" &&
          current.searchParams.get(stage) === "1"
        );
      },
      { timeout: 15000 },
    )
    .toBe(true);
}
export async function inspectLinkWithoutConsuming(link: string) {
  // Mail scanners and repeated GETs must not activate a session or consume OTP.
  for (let i = 0; i < 2; i++) {
    let response: Response;
    try {
      response = await fetch(link, {
        redirect: "error",
        signal: AbortSignal.timeout(10000),
      });
    } catch {
      throw new Error("Could not inspect the local authentication page.");
    }
    expect(response.status).toBe(200);
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(response.headers.get("set-cookie")).toBeNull();
    await response.text();
  }
}
