import type { AffordabilityResult, LenderId, LenderReadyInput } from "../domain/contracts.js";

export interface RunContext {
  executionMode: "managed" | "attached";
  browserWSEndpoint?: string;
  headless: boolean;
  timeoutMs: number;
  screenshotDir: string;
  failureDir: string;
}

export interface LenderAdapter {
  lender: LenderId;
  run(input: LenderReadyInput, context: RunContext): Promise<AffordabilityResult>;
}
