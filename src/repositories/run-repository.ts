import type { AffordabilityResult, LenderId } from "../domain/contracts.js";

export interface RunRepository {
  getLenderResult(caseId: string, lender: LenderId): Promise<AffordabilityResult | undefined>;
  saveLenderResult(caseId: string, result: AffordabilityResult): Promise<void>;
}

export class InMemoryRunRepository implements RunRepository {
  private readonly results = new Map<string, AffordabilityResult>();

  async getLenderResult(caseId: string, lender: LenderId): Promise<AffordabilityResult | undefined> {
    return this.results.get(runResultKey(caseId, lender));
  }

  async saveLenderResult(caseId: string, result: AffordabilityResult): Promise<void> {
    this.results.set(runResultKey(caseId, result.lender), result);
  }
}

export function runResultKey(caseId: string, lender: LenderId): string {
  return `${caseId}:${lender}`;
}
