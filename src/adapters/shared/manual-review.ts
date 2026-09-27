import type { Page } from "playwright";
import { isIP } from "node:net";
import type { BrowserSession, RunContext } from "../types.js";
import { createBrowserSession } from "./browser.js";

export async function prepareManualCalculator(
  context: RunContext,
  calculatorUrl: string,
  fill: (page: Page) => Promise<void>
): Promise<BrowserSession> {
  const session = await createBrowserSession(
    { ...context, executionMode: "managed", headless: true, captureEvidence: false },
    calculatorUrl
  );
  try {
    session.page.setDefaultTimeout(context.timeoutMs);
    session.page.setDefaultNavigationTimeout(context.timeoutMs);
    await session.page.route("**/*", async (route) => {
      if (blockedRemoteUrl(route.request().url())) await route.abort("blockedbyclient");
      else await route.continue();
    });
    await fill(session.page);
    return session;
  } catch (error) {
    await session.close().catch(() => undefined);
    throw error;
  }
}

function blockedRemoteUrl(value: string): boolean {
  let url: URL;
  try { url = new URL(value); } catch { return true; }
  if (url.protocol === "data:" || url.protocol === "blob:" || url.protocol === "about:") return false;
  if (url.protocol !== "http:" && url.protocol !== "https:") return true;
  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  return hostname === "localhost" || hostname.endsWith(".localhost") ||
    hostname.endsWith(".internal") || hostname.endsWith(".local") || isIP(hostname) !== 0;
}
