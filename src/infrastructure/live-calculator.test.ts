import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import test from "node:test";
import { chromium, type Page } from "playwright";
import { WebSocket } from "ws";
import type { RunContext } from "../adapters/types.js";
import type { LenderReadyInput } from "../domain/contracts.js";
import { installLiveCalculator } from "./live-calculator.js";

const context: RunContext = {
  executionMode: "managed",
  headless: true,
  timeoutMs: 5000,
  screenshotDir: "unused",
  failureDir: "unused"
};

test("a hosted viewer streams the real page and relays edits without running an affordability result", { timeout: 30_000 }, async () => {
  const server = createServer((_request, response) => {
    response.setHeader("content-type", "text/html");
    response.end('<input id="loan" style="position:absolute;left:40px;top:40px;width:200px;height:40px"><button id="calculate">Calculate</button>');
  });
  let page: Page | undefined;
  installLiveCalculator(server, {
    enabled: true,
    maxSessions: 1,
    idleMs: 60_000,
    maxAgeMs: 120_000,
    loadInput: async () => ({ lender: "halifax" }) as LenderReadyInput,
    loadContext: () => context,
    prepareSession: async () => {
      const browser = await chromium.launch({ headless: true });
      page = await browser.newPage({ viewport: { width: 400, height: 300 } });
      const address = server.address();
      assert(address && typeof address !== "string");
      await page.goto(`http://127.0.0.1:${address.port}/fixture`);
      return { page, close: () => browser.close() };
    }
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert(address && typeof address !== "string");
  const origin = `http://127.0.0.1:${address.port}`;
  const websocket = new WebSocket(`ws://127.0.0.1:${address.port}/api/live-calculator?caseId=case-1&lender=halifax`, { origin });

  try {
    const ready = new Promise<void>((resolve, reject) => {
      websocket.on("message", (data, binary) => {
        if (binary) return;
        const message = JSON.parse(data.toString()) as { type: string; status?: string };
        if (message.type === "ready") resolve();
        if (message.status === "error") reject(new Error(data.toString()));
      });
      websocket.once("error", reject);
    });
    const frame = new Promise<void>((resolve) => {
      websocket.on("message", (_data, binary) => { if (binary) resolve(); });
    });
    await within(ready, 10_000);
    await within(frame, 10_000);
    const extra = new WebSocket(`ws://127.0.0.1:${address.port}/api/live-calculator?caseId=case-1&lender=halifax`, { origin });
    assert.equal(await within(rejectionCode(extra), 5000), 429);
    const crossOrigin = new WebSocket(`ws://127.0.0.1:${address.port}/api/live-calculator?caseId=case-1&lender=halifax`, { origin: "https://other.example" });
    assert.equal(await within(rejectionCode(crossOrigin), 5000), 403);
    assert(page);
    const box = await page.locator("#loan").boundingBox();
    assert(box);
    const point = { x: box.x + 10, y: box.y + 10 };
    websocket.send(JSON.stringify({ type: "mouse", action: "down", ...point }));
    websocket.send(JSON.stringify({ type: "mouse", action: "up", ...point }));
    websocket.send(JSON.stringify({ type: "key", action: "down", key: "a" }));
    websocket.send(JSON.stringify({ type: "key", action: "up", key: "a" }));
    await page.waitForFunction(() => (document.querySelector("#loan") as HTMLInputElement).value === "a");
    assert.equal(await page.locator("#loan").inputValue(), "a");
    assert.equal(await page.locator("#calculate").textContent(), "Calculate");
  } finally {
    websocket.close();
    await Promise.race([once(websocket, "close"), new Promise((resolve) => setTimeout(resolve, 2000))]);
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

async function within<T>(promise: Promise<T>, milliseconds: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_resolve, reject) => { timer = setTimeout(() => reject(new Error("Timed out waiting for live viewer")), milliseconds); })
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function rejectionCode(websocket: WebSocket): Promise<number> {
  return new Promise((resolve, reject) => {
    websocket.once("unexpected-response", (_request, response) => {
      const code = response.statusCode ?? 0;
      response.resume();
      websocket.terminate();
      resolve(code);
    });
    websocket.once("error", reject);
  });
}
