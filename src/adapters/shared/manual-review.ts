import type { Page } from "playwright";
import type { BrowserSession, RunContext } from "../types.js";
import { createManualBrowserSession } from "./browser.js";

export async function prepareManualCalculator(
  context: RunContext,
  calculatorUrl: string,
  prepare: (page: Page) => Promise<void>
): Promise<BrowserSession> {
  const session = await createManualBrowserSession(context, calculatorUrl);
  const page = session.page;

  try {
    page.setDefaultTimeout(context.timeoutMs);
    page.setDefaultNavigationTimeout(context.timeoutMs);
    await prepare(page);
    await page.bringToFront().catch(() => undefined);
    return session;
  } catch (error) {
    await session.close().catch(() => undefined);
    throw error;
  }
}
