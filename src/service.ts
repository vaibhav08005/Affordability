import type { AffordabilityResult } from "./domain/contracts.js";
import { parseLenderReadyInput } from "./domain/validation.js";
import { getAdapter } from "./adapters/registry.js";
import type { RunContext } from "./adapters/types.js";
import type { BrowserSession } from "./adapters/types.js";

export async function runAffordabilityAutomation(
  value: unknown,
  context: RunContext
): Promise<AffordabilityResult> {
  const input = parseLenderReadyInput(value);
  const adapter = getAdapter(input.lender);
  return adapter.run(input, context);
}

export async function prepareCalculatorForReview(value: unknown, context: RunContext): Promise<BrowserSession> {
  const input = parseLenderReadyInput(value);
  const adapter = getAdapter(input.lender);
  if (!adapter.prepareForReview) throw new Error(`Live calculator review is not supported for ${input.lender}.`);
  return adapter.prepareForReview(input, context);
}
