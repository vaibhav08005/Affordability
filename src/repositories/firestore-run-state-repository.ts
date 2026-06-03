import { Firestore } from "@google-cloud/firestore";
import type { AffordabilityResult, LenderId } from "../domain/contracts.js";
import type { CaseRunRecord, LenderRunRecord, RunStateRepository } from "./run-state.js";

export class FirestoreRunStateRepository implements RunStateRepository {
  private readonly firestore = new Firestore({
    ignoreUndefinedProperties: true
  });

  async createCaseRun(caseId: string, lenders: LenderId[]): Promise<CaseRunRecord> {
    const now = new Date().toISOString();
    const expiresAt = expiryIso();
    const runRef = this.firestore.collection("caseRuns").doc();
    const record: CaseRunRecord = {
      runId: runRef.id,
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

    const batch = this.firestore.batch();
    batch.set(runRef, record);
    for (const lender of lenders) {
      const lenderRecord: LenderRunRecord = {
        runId: runRef.id,
        caseId,
        lender,
        status: "queued",
        queuedAt: now,
        expiresAt
      };
      batch.set(this.lenderRef(runRef.id, lender), lenderRecord);
    }
    await batch.commit();
    return record;
  }

  async getCaseRun(runId: string): Promise<CaseRunRecord | undefined> {
    const snapshot = await this.runRef(runId).get();
    return snapshot.exists ? snapshot.data() as CaseRunRecord : undefined;
  }

  async findLatestCaseRunForCase(caseId: string, sinceIso: string): Promise<CaseRunRecord | undefined> {
    const snapshot = await this.firestore.collection("caseRuns")
      .where("caseId", "==", caseId)
      .get();

    return snapshot.docs
      .map((doc) => doc.data() as CaseRunRecord)
      .filter((record) => record.createdAt >= sinceIso)
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0];
  }

  async listLenderRuns(runId: string): Promise<LenderRunRecord[]> {
    const snapshot = await this.runRef(runId).collection("lenderResults").get();
    return snapshot.docs
      .map((doc) => doc.data() as LenderRunRecord)
      .sort((left, right) => left.lender.localeCompare(right.lender));
  }

  async markLenderRunning(runId: string, caseId: string, lender: LenderId): Promise<void> {
    const now = new Date().toISOString();
    await this.lenderRef(runId, lender).set({
      runId,
      caseId,
      lender,
      status: "running",
      expiresAt: expiryIso(),
      startedAt: now
    }, { merge: true });
    await this.updateCaseAggregate(runId);
  }

  async saveLenderRunResult(runId: string, caseId: string, result: AffordabilityResult, durationMs: number): Promise<void> {
    const now = new Date().toISOString();
    await this.lenderRef(runId, result.lender).set({
      runId,
      caseId,
      lender: result.lender,
      status: result.status,
      expiresAt: expiryIso(),
      completedAt: now,
      durationMs,
      result
    }, { merge: true });
    await this.updateCaseAggregate(runId);
  }

  async saveLenderRunFailure(runId: string, caseId: string, lender: LenderId, message: string, durationMs: number): Promise<void> {
    const now = new Date().toISOString();
    await this.lenderRef(runId, lender).set({
      runId,
      caseId,
      lender,
      status: "failed",
      expiresAt: expiryIso(),
      completedAt: now,
      durationMs,
      error: message
    }, { merge: true });
    await this.updateCaseAggregate(runId);
  }

  private async updateCaseAggregate(runId: string): Promise<void> {
    const run = await this.getCaseRun(runId);
    if (!run) return;

    const lenders = await this.listLenderRuns(runId);
    const completed = lenders.filter((lender) => ["success", "failed", "timed_out"].includes(lender.status));
    const successCount = completed.filter((lender) => lender.status === "success").length;
    const failureCount = completed.length - successCount;
    const status = completed.length === run.totalLenders
      ? failureCount > 0 ? "completed_with_failures" : "completed"
      : completed.length > 0 || lenders.some((lender) => lender.status === "running") ? "running" : "queued";

    await this.runRef(runId).set({
      status,
      completedCount: completed.length,
      successCount,
      failureCount,
      updatedAt: new Date().toISOString(),
      completedAt: completed.length === run.totalLenders ? new Date().toISOString() : null
    }, { merge: true });
  }

  private runRef(runId: string) {
    return this.firestore.collection("caseRuns").doc(runId);
  }

  private lenderRef(runId: string, lender: LenderId) {
    return this.runRef(runId).collection("lenderResults").doc(lender);
  }
}

function expiryIso(): string {
  return new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
}
