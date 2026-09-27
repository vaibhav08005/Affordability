import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import test from "node:test";
import { spawn } from "node:child_process";
import { chromium } from "playwright";

const root = path.dirname(fileURLToPath(import.meta.url));
const sample = JSON.parse(await readFile(path.join(root, "..", "samples", "halifax", "test-case-1.json"), "utf8"));

test("the extension fills a lender form and leaves Calculate untouched", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.evaluate((input) => {
      globalThis.chrome = { runtime: { sendMessage: async (message) => message.type === "GET_CALCULATOR_JOB" ? { ok: true, job: { lender: "halifax", input } } : { ok: true } } };
      globalThis.calculated = false;
    }, sample);
    await page.setContent(`
      <fieldset aria-label="How many people are applying?"><legend>How many people are applying?</legend><label><input type="radio" name="people" value="1">1</label><label><input type="radio" name="people" value="2+">2+</label></fieldset>
      <label>Property purchase price <input id="property"></label>
      <label>Loan amount <input id="loan"></label>
      <label>Loan term (years) <input id="term"></label>
      <label>Applicant age <input id="age-one"></label>
      <label><input id="employed" type="checkbox">Income from employer(s)</label>
      <label>Gross annual basic salary <input id="salary"></label>
      <button id="calculate" onclick="window.calculated=true">Calculate</button>
    `);
    await page.addScriptTag({ path: path.join(root, "fill-plan.js") });
    const planCount = await page.evaluate((input) => {
      const lenders = ["barclays", "halifax", "hsbc", "kensington", "natwest", "nationwide", "santander", "skipton", "virgin_money"];
      return lenders.map((lender) => globalThis.AffordabilityFillPlan.forLender(lender, { ...input, lender }).length);
    }, sample);
    assert.equal(planCount.length, 9);
    assert.ok(planCount.every((count) => count > 0));
    await page.addScriptTag({ path: path.join(root, "lender.js") });
    await page.waitForFunction(() => document.querySelector("#loan").value === "200000", null, { timeout: 10000 });
    assert.equal(await page.locator("#property").inputValue(), "250000");
    assert.equal(await page.locator("#term").inputValue(), "25");
    assert.equal(await page.locator("#age-one").inputValue(), "30");
    assert.equal(await page.locator("#salary").inputValue(), "45000");
    assert.equal(await page.locator("#employed").isChecked(), true);
    assert.equal(await page.locator('input[name="people"]:checked').inputValue(), "1");
    assert.equal(await page.evaluate(() => window.calculated), false);
  } finally {
    await browser.close();
  }
});

test("the extension follows a lender's Next link without clicking Calculate", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.evaluate(() => {
      globalThis.chrome = { runtime: { sendMessage: async (message) => message.type === "GET_CALCULATOR_JOB" ? { ok: true, job: { lender: "nationwide", input: {} } } : { ok: true } } };
      globalThis.calculated = false;
    });
    await page.setContent(`
      <section id="mortgage"><label>Loan amount <input id="loan"></label><a href="#client" id="next">Next</a></section>
      <section id="client" hidden><label>Applicant age <input id="age"></label><button onclick="window.calculated=true">Calculate</button></section>
      <script>document.querySelector('#next').addEventListener('click', () => {
        document.querySelector('#mortgage').hidden = true;
        document.querySelector('#client').hidden = false;
      });</script>
    `);
    await page.evaluate(() => {
      globalThis.AffordabilityFillPlan = { forLender: () => [
        { name: "Mortgage", anchor: { selectors: ["#loan"] }, items: [{ name: "Loan amount", kind: "field", value: "200000", selectors: ["#loan"], labels: [], required: true, index: 0 }], next: ["Next"] },
        { name: "About your client", anchor: { selectors: ["#age"] }, items: [{ name: "Applicant age", kind: "field", value: "30", selectors: ["#age"], labels: [], required: true, index: 0 }], next: [] }
      ] };
    });
    await page.addScriptTag({ path: path.join(root, "lender.js") });
    await page.waitForFunction(() => document.querySelector("#age")?.value === "30", null, { timeout: 10000 });
    assert.equal(await page.locator("#loan").inputValue(), "200000");
    assert.equal(await page.evaluate(() => window.calculated), false);
  } finally {
    await browser.close();
  }
});

test("extension API maps a case for its selected lender and checks the website origin", async () => {
  const port = 20000 + Math.floor(Math.random() * 10000);
  const origin = `http://localhost:${port}`;
  let serverOutput = "";
  const server = spawn(process.execPath, [path.join(root, "..", "dist", "server.js")], {
    cwd: path.join(root, ".."),
    env: { ...process.env, PORT: String(port), RUN_STATE_BACKEND: "memory" },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true
  });
  server.stdout.on("data", (chunk) => { serverOutput += chunk.toString(); });
  server.stderr.on("data", (chunk) => { serverOutput += chunk.toString(); });
  try {
    let ready = false;
    for (let attempt = 0; attempt < 150; attempt += 1) {
      try {
        ready = (await fetch(`${origin}/health`)).ok;
        if (ready) break;
      } catch { /* server is starting */ }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    assert.ok(ready, `server started: ${serverOutput}`);
    assert.match(await (await fetch(origin)).text(), /Open filled calculator/);
    const cases = await (await fetch(`${origin}/api/cases`)).json();
    const caseId = cases.cases[0].id;
    const body = JSON.stringify({ caseId, lender: "halifax" });
    const rejected = await fetch(`${origin}/api/extension-input`, { method: "POST", headers: { "content-type": "application/json" }, body });
    assert.equal(rejected.status, 403);
    const accepted = await fetch(`${origin}/api/extension-input`, { method: "POST", headers: { "content-type": "application/json", origin }, body });
    assert.equal(accepted.status, 200);
    const payload = await accepted.json();
    assert.equal(payload.caseId, caseId);
    assert.equal(payload.lender, "halifax");
    assert.equal(payload.input.lender, "halifax");
    assert.equal(accepted.headers.get("cache-control"), "no-store");
  } finally {
    server.kill();
  }
});

test("installed extension opens a lender tab and fills it from a website request", async () => {
  let handoffOrigin;
  const context = await chromium.launchPersistentContext("", {
    channel: "chromium",
    headless: true,
    args: [`--disable-extensions-except=${root}`, `--load-extension=${root}`]
  });
  try {
    await context.route("**/*", async (route) => {
      const url = new URL(route.request().url());
      if (url.hostname === "localhost" && url.pathname === "/api/extension-input") {
        handoffOrigin = route.request().headers().origin;
        await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ caseId: "fixture", lender: "halifax", input: sample }) });
      } else if (url.hostname === "localhost") {
        await route.fulfill({ status: 200, contentType: "text/html", body: "<!doctype html><html><body>Website fixture</body></html>" });
      } else if (url.hostname === "www2.halifax-intermediariesonline.co.uk") {
        await route.fulfill({ status: 200, contentType: "text/html", body: `<!doctype html><html><body>
          <fieldset aria-label="How many people are applying?"><legend>How many people are applying?</legend><label><input type="radio" name="people" value="1">1</label><label><input type="radio" name="people" value="2+">2+</label></fieldset>
          <label>Property purchase price <input id="property"></label><label>Loan amount <input id="loan"></label>
          <label>Loan term (years) <input id="term"></label><label>Applicant age <input id="age-one"></label>
          <label><input id="employed" type="checkbox">Income from employer(s)</label>
          <label>Gross annual basic salary <input id="salary"></label><button id="calculate" onclick="window.calculated=true">Calculate</button>
        </body></html>` });
      } else {
        await route.abort();
      }
    });
    const website = await context.newPage();
    await website.goto("http://localhost:3000/mock");
    const opened = context.waitForEvent("page", { timeout: 10000 });
    await website.evaluate(() => window.postMessage({ channel: "mortgage-affordability-extension-v1", type: "OPEN_REQUEST", requestId: "test-request", caseId: "fixture", lender: "halifax" }, location.origin));
    const lender = await opened;
    await lender.waitForURL("https://www2.halifax-intermediariesonline.co.uk/**", { timeout: 10000 });
    await lender.waitForFunction(() => document.querySelector("#loan")?.value === "200000", null, { timeout: 10000 });
    assert.equal(await lender.locator("#property").inputValue(), "250000");
    assert.equal(handoffOrigin, "http://localhost:3000");
    assert.equal(await lender.evaluate(() => window.calculated === true), false);
  } finally {
    await context.close();
  }
});
