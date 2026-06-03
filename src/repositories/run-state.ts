import { randomUUID } from "node:crypto";
import type { AffordabilityResult, LenderId } from "../domain/contracts.js";

export type CaseRunStatus = "queued" | "running" | "completed" | "completed_with_failures" | "failed" | "timed_out";
export type LenderTaskStatus = "queued" | "running" | "success" | "failed" | "timed_out";

export interface CaseRunRecord {
  runId: string;
  caseId: string;
  status: CaseRunStatus;
  lenders: LenderId[];
  totalLenders: number;
  completedCount: number;
  successCount: number;
  failureCount: number;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
  completedAt?: string;
}

export interface LenderRunRecord {
  runId: string;
  caseId: string;
  lender: LenderId;
  status: LenderTaskStatus;
  queuedAt: string;
  expiresAt: string;
  startedAt?: string;
  completedAt?: string;
  durationMs?: number;
  result?: AffordabilityResult;
  error?: string;
}

export interface RunStateRepository {
  createCaseRun(caseId: string, lenders: LenderId[]): Promise<CaseRunRecord>;
  getCaseRun(runId: string): Promise<CaseRunRecord | undefined>;
  findLatestCaseRunForCase(caseId: string, sinceIso: string): Promise<CaseRunRecord | undefined>;
  listLenderRuns(runId: string): Promise<LenderRunRecord[]>;
  markLenderRunning(runId: string, caseId: string, lender: LenderId): Promise<void>;
  saveLenderRunResult(runId: string, caseId: string, result: AffordabilityResult, durationMs: number): Promise<void>;
  saveLenderRunFailure(runId: string, caseId: string, lender: LenderId, message: string, durationMs: number): Promise<void>;
}

export class InMemoryRunStateRepository implements RunStateRepository {
  private readonly caseRuns = new Map<string, CaseRunRecord>();
  private readonly lenderRuns = new Map<string, LenderRunRecord>();

  async createCaseRun(caseId: string, lenders: LenderId[]): Promise<CaseRunRecord> {
    const now = new Date().toISOString();
    const expiresAt = expiryIso();
    const runId = randomUUID();
    const record: CaseRunRecord = {
      runId,
      caseId,
      status: "queued",
      lenders,
      totalLenders: lenders.length,
      completedCount: 0,
      successCount: 0,
      failureCount: 0,
      createdAt: now,
      updatedAt: now,
      expiresAt
    };

    this.caseRuns.set(runId, record);
    for (const lender of lenders) {
      this.lenderRuns.set(lenderRunKey(runId, lender), {
        runId,
        caseId,
        lender,
        status: "queued",
        queuedAt: now,
        expiresAt
      });
    }

    return record;
  }

  async getCaseRun(runId: string): Promise<CaseRunRecord | undefined> {
    return this.caseRuns.get(runId);
  }

  async findLatestCaseRunForCase(caseId: string, sinceIso: string): Promise<CaseRunRecord | undefined> {
    return Array.from(this.caseRuns.values())
      .filter((record) => record.caseId === caseId && record.createdAt >= sinceIso)
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0];
  }

  async listLenderRuns(runId: string): Promise<LenderRunRecord[]> {
    return Array.from(this.lenderRuns.values())
      .filter((record) => record.runId === runId)
      .sort((left, right) => left.lender.localeCompare(right.lender));
  }

  async markLenderRunning(runId: string, caseId: string, lender: LenderId): Promise<void> {
    const now = new Date().toISOString();
    this.lenderRuns.set(lenderRunKey(runId, lender), {
      ...(this.lenderRuns.get(lenderRunKey(runId, lender)) ?? { runId, caseId, lender, queuedAt: now, expiresAt: expiryIso() }),
      status: "running",
      startedAt: now
    });
    await this.updateCaseAggregate(runId);
  }

  async saveLenderRunResult(runId: string, caseId: string, result: AffordabilityResult, durationMs: number): Promise<void> {
    const now = new Date().toISOString();
    const existing = this.lenderRuns.get(lenderRunKey(runId, result.lender));
    this.lenderRuns.set(lenderRunKey(runId, result.lender), {
      ...(existing ?? { runId, caseId, lender: result.lender, queuedAt: now, expiresAt: expiryIso() }),
      status: result.status,
      completedAt: now,
      durationMs,
      result
    });
    await this.updateCaseAggregate(runId);
  }

  async saveLenderRunFailure(runId: string, caseId: string, lender: LenderId, message: string, durationMs: number): Promise<void> {
    const now = new Date().toISOString();
    const existing = this.lenderRuns.get(lenderRunKey(runId, lender));
    this.lenderRuns.set(lenderRunKey(runId, lender), {
      ...(existing ?? { runId, caseId, lender, queuedAt: now, expiresAt: expiryIso() }),
      status: "failed",
      completedAt: now,
      durationMs,
      error: message
    });
    await this.updateCaseAggregate(runId);
  }

  private async updateCaseAggregate(runId: string): Promise<void> {
    const record = this.caseRuns.get(runId);
    if (!record) return;

    const lenders = await this.listLenderRuns(runId);
    const completed = lenders.filter((lender) => ["success", "failed", "timed_out"].includes(lender.status));
    const successCount = completed.filter((lender) => lender.status === "success").length;
    const failureCount = completed.length - successCount;
    const status = completed.length === record.totalLenders
      ? failureCount > 0 ? "completed_with_failures" : "completed"
      : completed.length > 0 || lenders.some((lender) => lender.status === "running") ? "running" : "queued";

    this.caseRuns.set(runId, {
      ...record,
      status,
      completedCount: completed.length,
      successCount,
      failureCount,
      updatedAt: new Date().toISOString(),
      completedAt: completed.length === record.totalLenders ? new Date().toISOString() : undefined
    });
  }
}

function lenderRunKey(runId: string, lender: LenderId): string {
  return `${runId}:${lender}`;
}

function expiryIso(): string {
  return new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
}
