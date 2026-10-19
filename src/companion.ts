import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";
import { z } from "zod";
import { getAdapter } from "./adapters/registry.js";
import { lenderReadyInputSchema } from "./domain/validation.js";
import { adapterVersion, lenderAdapterVersion } from "./ofc/adapter-version.js";

const handoffSchema = z.object({
  caseId: z.string(),
  lender: z.enum(["halifax", "barclays", "natwest", "hsbc", "santander", "nationwide", "skipton", "virgin_money", "kensington"]),
  input: lenderReadyInputSchema,
  adapterVersion: z.string().regex(/^[a-f0-9]{64}$/),
  lenderAdapterVersion: z.string().regex(/^[a-f0-9]{64}$/).optional()
});

export class AdapterVersionMismatchError extends Error {
  readonly code = "OFC_ADAPTER_MISMATCH";
  constructor(lender: string) {
    super(`The ${lender} adapter has changed on the website. This companion needs an update before filling that lender.`);
  }
}

export interface CompanionSession {
  caseId: string;
  lender: string;
  status: "ready" | "fill_failed";
  message: string;
  close(): Promise<void>;
}

export async function openFilledCalculator(
  serverUrl: string,
  ticket: string,
  onClosed: () => void
): Promise<CompanionSession> {
  const response = await fetch(new URL("/api/ofc/redeem", serverUrl), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ticket }),
    signal: AbortSignal.timeout(15000)
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(typeof body?.error === "string" ? body.error : `Handoff failed (${response.status}).`);
  }
  const handoff = handoffSchema.parse(body);
  if (handoff.input.lender !== handoff.lender) throw new Error("Lender mismatch in handoff.");
  const versionMatches = handoff.lenderAdapterVersion
    ? handoff.lenderAdapterVersion === await lenderAdapterVersion(handoff.lender)
    : handoff.adapterVersion === await adapterVersion();
  if (!versionMatches) {
    throw new AdapterVersionMismatchError(handoff.lender);
  }

  const profileDir = await mkdtemp(join(tmpdir(), "ofc-chrome-"));
  let browserContext;
  try {
    browserContext = await chromium.launchPersistentContext(profileDir, {
      channel: "chrome",
      headless: false,
      acceptDownloads: false,
      colorScheme: "light",
      locale: "en-GB",
      timezoneId: "Europe/London",
      viewport: null,
      args: ["--no-first-run", "--start-maximized"]
    });
  } catch (error) {
    await rm(profileDir, { recursive: true, force: true }).catch(() => undefined);
    throw error;
  }

  const context = browserContext;
  const page = context.pages()[0] ?? await context.newPage();
  let closed = false;
  async function close(): Promise<void> {
    if (closed) return;
    closed = true;
    await context.close().catch(() => undefined);
    await rm(profileDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 250 }).catch(() => undefined);
    onClosed();
  }
  page.once("close", () => { void close(); });
  context.once("close", () => { void close(); });

  try {
    const result = await getAdapter(handoff.lender).run(handoff.input, {
      executionMode: "managed",
      headless: false,
      timeoutMs: 60000,
      screenshotDir: "",
      failureDir: "",
      purpose: "open_filled",
      page
    });
    if (closed) throw new Error("Chrome was closed before the calculator was filled.");
    if (result.status !== "success") throw new Error(result.error?.message ?? "Unable to fill calculator.");
    return {
      caseId: handoff.caseId,
      lender: handoff.lender,
      status: "ready",
      message: "Calculator filled. You can edit it in Chrome.",
      close
    };
  } catch (error) {
    if (closed) throw error;
    return {
      caseId: handoff.caseId,
      lender: handoff.lender,
      status: "fill_failed",
      message: error instanceof Error ? error.message : String(error),
      close
    };
  }
}
