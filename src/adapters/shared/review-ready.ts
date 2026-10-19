import type { AffordabilityResult, LenderId } from "../../domain/contracts.js";
import type { RunContext } from "../types.js";

export class ReviewReady extends Error {
  constructor() {
    super("Calculator filled and ready for review.");
  }
}

export function stopBeforeCalculation(context: RunContext): void {
  if (context.purpose === "open_filled") throw new ReviewReady();
}

export function reviewResult(lender: LenderId): AffordabilityResult {
  return {
    lender,
    status: "success",
    maximumBorrowing: null,
    monthlyPayment: null,
    messages: ["Calculator filled and ready for review."],
    evidence: { timestamp: new Date().toISOString() }
  };
}
