import type { AffordabilityResult, LenderId, LenderReadyInput } from "../domain/contracts.js";
import type { Page } from "playwright";

export interface RunContext {
  executionMode: "managed" | "attached";
  browserWSEndpoint?: string;
  headless: boolean;
  timeoutMs: number;
  screenshotDir: string;
  failureDir: string;
  purpose?: "calculate" | "open_filled";
  page?: Page;
}

export interface LenderAdapter {
  lender: LenderId;
  run(input: LenderReadyInput, context: RunContext): Promise<AffordabilityResult>;
}
