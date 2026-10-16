// A component test with actual React state and DOM. It serves no HTTP content,
// starts no app/server and uses no database or account. Server actions and the
// Next navigation boundary are replaced with deterministic fixtures.
import { chromium, expect, expect as browserExpect } from "@playwright/test";
import { createRequire } from "node:module";
import { realpathSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  after as afterAll,
  afterEach,
  before as beforeAll,
  beforeEach,
  describe,
  it,
} from "node:test";
const initial = {
  dogId: "82000000-0000-4000-8000-000000000001",
  requestId: "83000000-0000-4000-8000-000000000001",
  status: "new",
  version: 0,
};
const refreshed = {
  ...initial,
  requestId: "83000000-0000-4000-8000-000000000099",
  status: "suspended",
  version: 1,
};
let browser, page, bundle;
let errors;
beforeAll(async () => {
  const require = createRequire(
    realpathSync(resolve("node_modules/vitest/package.json")),
  );
  const { build } = await import(pathToFileURL(require.resolve("vite")).href);
  const entry = "\0dog-qualification-fixture.js";
  const action = "\0dog-qualification-action.js";
  const navigation = "\0dog-qualification-navigation.js";
  const component = resolve("src/components/dog-qualification-form.tsx");
  const creationRequest = resolve("src/components/dog-creation-request.tsx");
  const output = await build({
    configFile: false,
    logLevel: "error",
    resolve: { alias: { "@": resolve("src") }, dedupe: ["react", "react-dom"] },
    define: { "process.env.NODE_ENV": JSON.stringify("development") },
    plugins: [
      {
        name: "qualification-component-fixture",
        enforce: "pre",
        resolveId(source) {
          if (source.endsWith("virtual:qualification-component")) return entry;
          if (
            source === "@/lib/data/actions" ||
            source === resolve("src/lib/data/actions") ||
            source === resolve("src/lib/data/actions.ts")
          )
            return action;
          if (source === "next/navigation") return navigation;
        },
        load(id) {
          if (id === action)
            return `export async function setDogStatus(previous,data){
          return window.dogQualificationFixture.perform(Object.fromEntries(data));
        }`;
          if (id === navigation)
            return `export function unstable_rethrow(error){
          if(error?.digest?.startsWith('NEXT_')) throw error;
        }`;
          if (id === entry)
            return `
          import { createElement } from 'react';
          import { createRoot } from 'react-dom/client';
          import { flushSync } from 'react-dom';
          import { renderToString } from 'react-dom/server.browser';
          import { DogQualificationForm } from ${JSON.stringify(component)};
          import { DogCreationRequest } from ${JSON.stringify(creationRequest)};
          const root = createRoot(document.getElementById('root'));
          let nonce = 100;
          if (!crypto.randomUUID) Object.defineProperty(crypto,'randomUUID',{
            value:()=> '83000000-0000-4000-8000-'+String(nonce++).padStart(12,'0')
          });
          const receipts = new Map();
          window.dogQualificationFixture = {
            mode:'normal', calls:[], writes:0, remote:{status:'new',version:0},
            serverMarkup:renderToString(createElement(DogQualificationForm,${JSON.stringify(initial)})),
            resolvePending:null,
            render(props) {
              flushSync(()=>root.render(createElement('div',null,
                createElement(DogCreationRequest,{requestId:props.requestId}),
                createElement(DogQualificationForm,{key:props.dogId,...props}))));
            },
            externalDecision(status) { this.remote={status,version:this.remote.version+1};this.writes++; },
            async perform(payload) {
              this.calls.push(payload);
              if(this.mode==='deferred') {
                await new Promise(resolve=>{this.resolvePending=resolve});
                this.mode='normal';
              }
              if(this.mode==='invalid') return {success:'Status psa został zmieniony.'};
              const serialized = JSON.stringify(payload);
              let receipt=receipts.get(payload.request_id);
              if(receipt && receipt.payload!==serialized)
                return {error:'Ten formularz został użyty do innej decyzji.'};
              if(!receipt) {
                if(payload.expected_status!==this.remote.status ||
                  Number(payload.expected_qualification_version)!==this.remote.version)
                  return {error:'Kwalifikacja psa zmieniła się w międzyczasie.'};
                this.remote={status:payload.status,version:this.remote.version+1};this.writes++;
                receipt={payload:serialized,version:this.remote.version,status:payload.status};
                receipts.set(payload.request_id,receipt);
              }
              if(this.mode==='lost') { this.mode='normal';throw new TypeError('Failed to fetch'); }
              return {success:'Status psa został zmieniony.',
                qualificationStatus:receipt.status,qualificationVersion:receipt.version};
            }
          };
          window.dogQualificationFixture.render(${JSON.stringify(initial)});
        `;
        },
      },
    ],
    build: {
      write: false,
      minify: false,
      lib: {
        entry: "virtual:qualification-component",
        formats: ["iife"],
        name: "QualificationFixture",
      },
    },
  });
  const result = Array.isArray(output) ? output[0] : output;
  const chunk = result.output.find(
    (item) => item.type === "chunk" && item.isEntry,
  );
  if (!chunk?.code)
    throw new Error("Component fixture did not produce JavaScript");
  bundle = chunk.code;
  browser = await chromium.launch({ channel: "chrome", headless: true });
});
beforeEach(async () => {
  page = await browser.newPage();
  page.setDefaultTimeout(5000);
  errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.setContent('<div id="root"></div>');
  await page.addScriptTag({ content: bundle });
  expect(errors).toEqual([]);
});
afterEach(async () => {
  await page?.close();
  expect(errors).toEqual([]);
});
afterAll(async () => {
  await browser?.close();
});
async function draft() {
  return page
    .locator("form")
    .evaluate((form) => Object.fromEntries(new FormData(form)));
}
async function fill(status = "approved", note = "Stara decyzja ze szkicu.") {
  await page.getByLabel("Status", { exact: true }).selectOption(status);
  await page
    .getByLabel("Powód / zalecenia (notatka prywatna)", { exact: true })
    .fill(note);
}
async function submit() {
  await page
    .getByRole("button", { name: "Zapisz kwalifikację", exact: true })
    .click();
}
describe("qualification draft survives server props revalidation", () => {
  it("blocks controlled edits before hydration and while awaiting acknowledgement, then clears only the submitted note", async () => {
    expect(
      await page.evaluate(() => {
        const preview = document.createElement("div");
        preview.innerHTML = window.dogQualificationFixture.serverMarkup;
        return {
          status: preview.querySelector("select").matches(":disabled"),
          note: preview.querySelector("textarea").matches(":disabled"),
          submit: preview.querySelector('button[type="submit"]').disabled,
        };
      }),
    ).toEqual({ status: true, note: true, submit: true });
    const status = page.getByLabel("Status", { exact: true });
    const note = page.getByLabel("Powód / zalecenia (notatka prywatna)", {
      exact: true,
    });
    await browserExpect(status).toBeEnabled();
    await browserExpect(note).toBeEnabled();
    await fill("approved", "Uzasadnienie oczekujące na potwierdzenie.");
    await page.evaluate(() => {
      window.dogQualificationFixture.mode = "deferred";
    });
    await submit();
    await browserExpect(status).toBeDisabled();
    await browserExpect(note).toBeDisabled();
    await browserExpect(
      page.getByRole("button", { name: "Proszę czekać…", exact: true }),
    ).toBeDisabled();
    await browserExpect(note).toHaveValue(
      "Uzasadnienie oczekujące na potwierdzenie.",
    );
    expect(
      await page.evaluate(() => window.dogQualificationFixture.writes),
    ).toBe(0);
    await page.evaluate(() => window.dogQualificationFixture.resolvePending());
    await browserExpect(note).toBeEnabled();
    await browserExpect(note).toHaveValue("");
    await browserExpect(status).toBeEnabled();
    await browserExpect(status).toHaveValue("approved");
    expect(
      await page.evaluate(() => window.dogQualificationFixture.writes),
    ).toBe(1);
  });
  it("keeps a new dog's creation request when a refreshed server prop offers a different UUID", async () => {
    const input = page.locator('input[name="creation_request_id"]');
    await browserExpect(input).toHaveValue(initial.requestId);
    await page.evaluate(
      (props) => window.dogQualificationFixture.render(props),
      refreshed,
    );
    await browserExpect(input).toHaveValue(initial.requestId);
    expect(initial.requestId).not.toBe(refreshed.requestId);
  });
  it("reproduces R1: another form refresh cannot give an old decision a new nonce or precondition", async () => {
    await fill();
    const before = await draft();
    await page.evaluate((props) => {
      window.dogQualificationFixture.externalDecision(props.status);
      window.dogQualificationFixture.render(props);
    }, refreshed);
    expect(await draft()).toEqual(before);
    await submit();
    await browserExpect(page.getByRole("alert")).toContainText("zmieniła się");
    expect(await draft()).toEqual(before);
    expect(
      await page.evaluate(() => window.dogQualificationFixture.calls[0]),
    ).toEqual(before);
    expect(
      await page.evaluate(() => window.dogQualificationFixture.remote),
    ).toEqual({ status: "suspended", version: 1 });
    expect(
      await page.evaluate(() => window.dogQualificationFixture.writes),
    ).toBe(1);
  });
  it("retries a lost receipt with the same draft, then starts the next decision only after acknowledgement", async () => {
    await fill();
    const before = await draft();
    await page.evaluate(() => {
      window.dogQualificationFixture.mode = "lost";
    });
    await submit();
    await browserExpect(page.getByRole("alert")).toContainText(
      "Nie udało się potwierdzić",
    );
    expect(await draft()).toEqual(before);
    await page.evaluate(
      (props) => window.dogQualificationFixture.render(props),
      { ...refreshed, status: "approved" },
    );
    expect(await draft()).toEqual(before);
    await submit();
    await browserExpect(page.getByRole("status")).toContainText(
      "Status psa został zmieniony",
    );
    const acknowledged = await draft();
    expect(acknowledged).toMatchObject({
      expected_status: "approved",
      expected_qualification_version: "1",
      status: "approved",
      note: "",
    });
    expect(acknowledged.request_id).not.toBe(before.request_id);
    expect(
      await page.evaluate(() => window.dogQualificationFixture.calls),
    ).toEqual([before, before]);
    expect(
      await page.evaluate(() => window.dogQualificationFixture.writes),
    ).toBe(1);
    await fill("suspended", "Nowa świadoma decyzja.");
    await submit();
    await browserExpect(
      page.locator('input[name="expected_qualification_version"]'),
    ).toHaveValue("2");
    expect(
      await page.evaluate(() => window.dogQualificationFixture.writes),
    ).toBe(2);
  });
  it("uses the receipt version rather than a later refreshed prop when acknowledging an older retry", async () => {
    await fill();
    await page.evaluate(() => {
      window.dogQualificationFixture.mode = "lost";
    });
    await submit();
    await browserExpect(page.getByRole("alert")).toBeVisible();
    await page.evaluate(
      (props) => {
        window.dogQualificationFixture.externalDecision("suspended");
        window.dogQualificationFixture.render(props);
      },
      { ...refreshed, version: 2 },
    );
    await submit();
    await browserExpect(
      page.locator('input[name="expected_qualification_version"]'),
    ).toHaveValue("1");
    expect((await draft()).expected_status).toBe("approved");
    expect(
      await page.evaluate(() => window.dogQualificationFixture.remote),
    ).toEqual({ status: "suspended", version: 2 });
    await fill("needs_review", "Kolejna decyzja wymaga aktualnego widoku.");
    await submit();
    await browserExpect(page.getByRole("alert")).toContainText("zmieniła się");
  });
  it("keeps all fields and the request key if a success lacks its acknowledged version", async () => {
    await fill();
    const before = await draft();
    await page.evaluate(() => {
      window.dogQualificationFixture.mode = "invalid";
    });
    await submit();
    await browserExpect(page.getByRole("alert")).toContainText(
      "Nie udało się potwierdzić kwalifikacji",
    );
    expect(await draft()).toEqual(before);
  });
});
