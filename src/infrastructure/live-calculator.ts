import type { IncomingMessage, Server } from "node:http";
import type { Duplex } from "node:stream";
import type { Page } from "playwright";
import { WebSocket, WebSocketServer } from "ws";
import type { BrowserSession, RunContext } from "../adapters/types.js";
import type { LenderReadyInput } from "../domain/contracts.js";
import { prepareCalculatorForReview } from "../service.js";

interface LiveCalculatorOptions {
  enabled: boolean;
  maxSessions: number;
  idleMs: number;
  maxAgeMs: number;
  loadInput(caseId: string, lender: string): Promise<LenderReadyInput | null>;
  loadContext(): RunContext;
  prepareSession?: (input: LenderReadyInput, context: RunContext) => Promise<BrowserSession>;
}

type ViewerInput =
  | { type: "mouse"; action: "move" | "down" | "up"; x: number; y: number; button?: "left" | "middle" | "right" }
  | { type: "wheel"; deltaX: number; deltaY: number; x: number; y: number }
  | { type: "key"; action: "down" | "up"; key: string }
  | { type: "text"; text: string };

export function installLiveCalculator(server: Server, options: LiveCalculatorOptions): void {
  const websocketServer = new WebSocketServer({ noServer: true, maxPayload: 4096 });
  const connections = new Set<WebSocket>();

  server.on("upgrade", (request, socket, head) => {
    let url: URL;
    try {
      url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
    } catch {
      rejectUpgrade(socket, 400);
      return;
    }
    if (url.pathname !== "/api/live-calculator") {
      rejectUpgrade(socket, 404);
      return;
    }
    if (!options.enabled) {
      rejectUpgrade(socket, 503);
      return;
    }
    if (!sameOrigin(request)) {
      rejectUpgrade(socket, 403);
      return;
    }
    if (connections.size >= options.maxSessions) {
      rejectUpgrade(socket, 429);
      return;
    }
    const caseId = url.searchParams.get("caseId") ?? "";
    const lender = url.searchParams.get("lender") ?? "";
    if (!/^[a-z0-9-]{1,150}$/.test(caseId) || !/^[a-z_]{1,32}$/.test(lender)) {
      rejectUpgrade(socket, 400);
      return;
    }

    websocketServer.handleUpgrade(request, socket, head, (websocket) => {
      connections.add(websocket);
      void serveLiveCalculator(websocket, caseId, lender, options).finally(() => connections.delete(websocket));
    });
  });

  server.on("close", () => {
    for (const websocket of connections) websocket.close(1001, "Server stopping");
    websocketServer.close();
  });
}

async function serveLiveCalculator(
  websocket: WebSocket,
  caseId: string,
  lender: string,
  options: LiveCalculatorOptions
): Promise<void> {
  let browserSession: BrowserSession | undefined;
  let frameTimer: ReturnType<typeof setInterval> | undefined;
  let idleWarningSent = false;
  let lastInputAt = Date.now();
  const openedAt = Date.now();
  const idleTimer = setInterval(() => {
    if (websocket.readyState !== WebSocket.OPEN) return;
    const idleFor = Date.now() - lastInputAt;
    if (Date.now() - openedAt >= options.maxAgeMs || idleFor >= options.idleMs) {
      sendJson(websocket, { type: "status", status: "expired", message: "The live calculator session has ended." });
      websocket.close(1000, "Session expired");
    } else if (!idleWarningSent && options.idleMs - idleFor <= 60_000) {
      idleWarningSent = true;
      sendJson(websocket, { type: "status", status: "warning", message: "This session will close soon because it is idle." });
    }
  }, 10_000);
  idleTimer.unref?.();

  const closed = new Promise<void>((resolve) => websocket.once("close", resolve));
  const cleanup = async () => {
    clearInterval(idleTimer);
    if (frameTimer) clearInterval(frameTimer);
    if (browserSession) await browserSession.close().catch(() => undefined);
  };

  try {
    sendJson(websocket, { type: "status", status: "preparing", message: `Filling the ${lender.replace(/_/g, " ")} calculator…` });
    const input = await options.loadInput(caseId, lender);
    if (!input) throw new Error("The selected case or lender is unavailable.");
    if (websocket.readyState !== WebSocket.OPEN) return;

    browserSession = await (options.prepareSession ?? prepareCalculatorForReview)(input, options.loadContext());
    if (websocket.readyState !== WebSocket.OPEN) return;

    const page = browserSession.page;
    const viewport = page.viewportSize() ?? { width: 1365, height: 900 };
    sendJson(websocket, {
      type: "ready",
      width: viewport.width,
      height: viewport.height,
      host: safeHostname(page.url()),
      message: "The lender form is ready. You can edit it and calculate on the lender website."
    });

    let pendingInputs = 0;
    let inputQueue = Promise.resolve();
    websocket.on("message", (raw, isBinary) => {
      if (isBinary || pendingInputs >= 32) return;
      let inputEvent: ViewerInput;
      try {
        inputEvent = JSON.parse(raw.toString()) as ViewerInput;
      } catch {
        return;
      }
      if (!validViewerInput(inputEvent, viewport)) return;
      lastInputAt = Date.now();
      idleWarningSent = false;
      pendingInputs += 1;
      inputQueue = inputQueue
        .then(() => dispatchViewerInput(page, inputEvent))
        .catch(() => undefined)
        .finally(() => { pendingInputs -= 1; });
    });
    page.on("close", () => websocket.close(1000, "Calculator closed"));
    page.on("framenavigated", (frame) => {
      if (frame === page.mainFrame()) sendJson(websocket, { type: "host", host: safeHostname(page.url()) });
    });

    let frameInFlight = false;
    let lastFrameAt = 0;
    const sendFrame = async () => {
      if (frameInFlight || websocket.readyState !== WebSocket.OPEN || websocket.bufferedAmount > 1_000_000) return;
      const interval = Date.now() - lastInputAt < 10_000 ? 500 : 2500;
      if (Date.now() - lastFrameAt < interval) return;
      frameInFlight = true;
      try {
        const frame = await page.screenshot({ type: "jpeg", quality: 65, timeout: 4000 });
        lastFrameAt = Date.now();
        if (websocket.readyState === WebSocket.OPEN) websocket.send(frame, { binary: true });
      } catch {
        // A navigation can interrupt a frame. The next interval will retry.
      } finally {
        frameInFlight = false;
      }
    };
    await sendFrame();
    frameTimer = setInterval(() => { void sendFrame(); }, 500);
    frameTimer.unref?.();
    await closed;
  } catch (error) {
    if (websocket.readyState === WebSocket.OPEN) {
      sendJson(websocket, {
        type: "status",
        status: "error",
        message: error instanceof Error ? error.message : "Could not open the calculator."
      });
      websocket.close(1011, "Calculator error");
    }
  } finally {
    await cleanup();
  }
}

function sameOrigin(request: IncomingMessage): boolean {
  const origin = request.headers.origin;
  const host = request.headers.host;
  if (!origin || !host) return false;
  try {
    const parsed = new URL(origin);
    return (parsed.protocol === "https:" || parsed.protocol === "http:") && parsed.host === host;
  } catch {
    return false;
  }
}

function rejectUpgrade(socket: Duplex, status: number): void {
  socket.end(`HTTP/1.1 ${status} ${status === 429 ? "Too Many Requests" : "Unavailable"}\r\nConnection: close\r\n\r\n`);
}

function sendJson(websocket: WebSocket, value: Record<string, unknown>): void {
  if (websocket.readyState === WebSocket.OPEN) websocket.send(JSON.stringify(value));
}

function safeHostname(value: string): string {
  try { return new URL(value).hostname; } catch { return "lender website"; }
}

function finiteCoordinate(value: unknown, maximum: number): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= maximum;
}

function validViewerInput(value: ViewerInput, viewport: { width: number; height: number }): boolean {
  if (!value || typeof value !== "object") return false;
  if (value.type === "mouse") {
    return ["move", "down", "up"].includes(value.action) &&
      finiteCoordinate(value.x, viewport.width) && finiteCoordinate(value.y, viewport.height) &&
      (!value.button || ["left", "middle", "right"].includes(value.button));
  }
  if (value.type === "wheel") {
    return finiteCoordinate(value.x, viewport.width) && finiteCoordinate(value.y, viewport.height) &&
      typeof value.deltaX === "number" && Number.isFinite(value.deltaX) && Math.abs(value.deltaX) <= 2000 &&
      typeof value.deltaY === "number" && Number.isFinite(value.deltaY) && Math.abs(value.deltaY) <= 2000;
  }
  if (value.type === "key") return ["down", "up"].includes(value.action) && typeof value.key === "string" && value.key.length <= 32;
  if (value.type === "text") return typeof value.text === "string" && value.text.length <= 1000;
  return false;
}

async function dispatchViewerInput(page: Page, input: ViewerInput): Promise<void> {
  if (input.type === "mouse") {
    await page.mouse.move(input.x, input.y);
    if (input.action === "down") await page.mouse.down({ button: input.button ?? "left" });
    if (input.action === "up") await page.mouse.up({ button: input.button ?? "left" });
  } else if (input.type === "wheel") {
    await page.mouse.move(input.x, input.y);
    await page.mouse.wheel(input.deltaX, input.deltaY);
  } else if (input.type === "key") {
    if (input.action === "down") await page.keyboard.down(input.key);
    else await page.keyboard.up(input.key);
  } else if (input.type === "text") {
    await page.keyboard.insertText(input.text);
  }
}
