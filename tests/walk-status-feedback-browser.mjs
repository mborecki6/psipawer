// Actual WalkDetail + ActionForm, deterministic snapshots/actions, no HTTP server or database.
import { createRequire } from "node:module";
import { realpathSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { after, afterEach, before, beforeEach, it } from "node:test";
import { chromium, expect } from "@playwright/test";
const require = createRequire(
  realpathSync(resolve("node_modules/vitest/package.json")),
);
const { build } = await import(pathToFileURL(require.resolve("vite")).href);
let browser, page, bundle;
let errors;
before(async () => {
  const rootDir = resolve("src");
  const virtual = "\0walk-fixture:";
  const result = await build({
    configFile: false,
    logLevel: "error",
    resolve: { alias: { "@": rootDir }, dedupe: ["react", "react-dom"] },
    define: { "process.env.NODE_ENV": JSON.stringify("development") },
    plugins: [
      {
        name: "walk-status-feedback-fixture",
        enforce: "pre",
        resolveId(source) {
          if (source.endsWith("virtual:walk-status-feedback"))
            return virtual + "entry";
          const clean = source
            .replace(rootDir + "/", "@/")
            .replace(/\.tsx?$/, "");
          const mocks = {
            "@/lib/auth/session": "session",
            "@/lib/data/queries": "queries",
            "@/lib/data/actions": "actions",
            "@/lib/data/registration-actions": "actions",
            "next/navigation": "navigation",
            "next/link": "link",
            "@/modules/services/selection": "selection",
            "@/modules/calendar/booking-choice": "booking",
          };
          if (mocks[clean]) return virtual + mocks[clean];
        },
        load(id) {
          if (id === virtual + "session")
            return `export async function requireSession(){return {role:'admin',db:{from(){const q={select(){return q},eq(){return q},async maybeSingle(){return {data:{exact_location:'Zbiórka testowa',map_url:'',instructions:''},error:null}}};return q}}}}`;
          if (id === virtual + "queries")
            return `export async function getSnapshot(){return window.walkFixture.snapshot};export async function allRows(){return []}`;
          if (id === virtual + "navigation")
            return `export function notFound(){throw new Error('not found')};export function unstable_rethrow(e){if(e?.digest?.startsWith('NEXT_')) throw e}`;
          if (id === virtual + "link")
            return `import {createElement} from 'react';export default function Link(p){return createElement('a',p,p.children)}`;
          if (id === virtual + "selection")
            return `export function WalkServiceFields(){return null}`;
          if (id === virtual + "booking")
            return `export function BookingChoice(){return null}`;
          if (id === virtual + "actions")
            return `export async function decideRegistration(previous,data){return window.walkFixture.perform(Object.fromEntries(data))};export const registerDog=decideRegistration,cancelRegistration=decideRegistration,cancelWalk=decideRegistration,markAttendance=decideRegistration,createWalk=decideRegistration,updateWalk=decideRegistration,inviteDog=decideRegistration,reopenRegistration=decideRegistration;`;
          if (id === virtual + "entry")
            return `
          import {createRoot} from 'react-dom/client';import {flushSync} from 'react-dom';
          import {WalkDetail} from ${JSON.stringify(resolve("src/components/walks.tsx"))};
          const root=createRoot(document.getElementById('root'));
          const dog='a1000000-0000-4000-8000-000000000001', walk='a2000000-0000-4000-8000-000000000001';
          window.walkFixture={snapshot:{dogs:[{id:dog,name:'Figa',status:'approved'}],walks:[{id:walk,starts_at:'2099-10-27T12:00:00Z',duration_minutes:60,public_location:'Park testowy',type:'Spacer',price_cents:6000,capacity:4,booking_mode:'approval',status:'open',info:'',cancellation_deadline_hours:24}],registrations:[{id:'registration-fixture',walk_id:walk,dog_id:dog,status:'pending',payment_status:'none',attendance:'pending'}]},
            payload:null,resolvePending:null,
            async render(){const element=await WalkDetail({id:walk});flushSync(()=>root.render(element))},
            async perform(payload){this.payload=payload;return new Promise(resolve=>{this.resolvePending=resolve})},
            async finish(status='accepted',kind='success'){if(kind==='success')this.snapshot.registrations[0]={...this.snapshot.registrations[0],status};await this.render();this.resolvePending(kind==='success'?{success:'Decyzja zapisana.'}:{error:'Błąd decyzji.'})}
          };window.walkFixture.render();`;
        },
      },
    ],
    build: {
      write: false,
      minify: false,
      lib: {
        entry: "virtual:walk-status-feedback",
        formats: ["iife"],
        name: "WalkStatusFeedbackFixture",
      },
    },
  });
  const output = Array.isArray(result) ? result[0].output : result.output;
  bundle = output.find((item) => item.type === "chunk" && item.isEntry)?.code;
  browser = await chromium.launch({ channel: "chrome", headless: true });
});
beforeEach(async () => {
  page = await browser.newPage();
  errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("dialog", (dialog) => dialog.accept());
  await page.setContent('<div id="root"></div>');
  await page.addScriptTag({ content: bundle });
  await expect(
    page.locator("#registration-registration-fixture"),
  ).toBeVisible();
});
afterEach(async () => {
  await page?.close();
  expect(errors).toEqual([]);
});
after(async () => browser?.close());
for (const targetStatus of ["accepted", "waitlisted", "rejected"]) {
  it(`retains the exact pending form and reveals its success after moving to ${targetStatus}`, async () => {
    const registration = page.locator("#registration-registration-fixture");
    const summary = registration
      .locator("summary")
      .filter({ hasText: "Przejdź do decyzji" });
    await summary.click();
    const form = registration
      .locator("form")
      .filter({
        has: page.getByRole("button", { name: "Zapisz decyzję", exact: true }),
      });
    await form.locator('select[name="status"]').selectOption(targetStatus);
    await form
      .locator('input[name="note"]')
      .fill("Decyzja po rozmowie z opiekunem.");
    await form.evaluate((element) => {
      window.originalWalkForm = element;
    });
    await form
      .getByRole("button", { name: "Zapisz decyzję", exact: true })
      .click();
    await expect
      .poll(() =>
        page.evaluate(() => Boolean(window.walkFixture.resolvePending)),
      )
      .toBe(true);
    await summary.click();
    await expect(form).not.toBeVisible();
    await page.evaluate(
      (status) => window.walkFixture.finish(status),
      targetStatus,
    );
    await expect
      .poll(() =>
        page.evaluate(() => document.contains(window.originalWalkForm)),
      )
      .toBe(true);
    await expect(
      registration.getByText("Decyzja zapisana.", { exact: true }),
    ).toBeVisible();
    expect(await page.evaluate(() => window.walkFixture.payload.status)).toBe(
      targetStatus,
    );
  });
}
it("reveals a closed pending form for an error without clearing its note", async () => {
  const registration = page.locator("#registration-registration-fixture");
  const summary = registration
    .locator("summary")
    .filter({ hasText: "Przejdź do decyzji" });
  await summary.click();
  const form = registration.locator("form");
  await form.locator('input[name="note"]').fill("Zachowany szkic.");
  await form
    .getByRole("button", { name: "Zapisz decyzję", exact: true })
    .click();
  await expect
    .poll(() => page.evaluate(() => Boolean(window.walkFixture.resolvePending)))
    .toBe(true);
  await summary.click();
  await page.evaluate(() => window.walkFixture.finish("pending", "error"));
  await expect(registration.getByRole("alert")).toBeFocused();
  await expect(form.locator('input[name="note"]')).toHaveValue(
    "Zachowany szkic.",
  );
});
