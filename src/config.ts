import type { RunContext } from "./adapters/types.js";

export function loadRunContext(): RunContext {
  const executionMode = process.env.BROWSER_EXECUTION_MODE === "attached" ? "attached" : "managed";

  return {
    executionMode,
    browserWSEndpoint: process.env.BROWSER_WS_ENDPOINT,
    headless: process.env.HEADLESS !== "false",
    timeoutMs: Number(process.env.AUTOMATION_TIMEOUT_MS ?? 60000),
    screenshotDir: process.env.SCREENSHOT_DIR ?? "./artifacts/screenshots"
  };
}
