import express from "express";
import { randomUUID } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { parse as parseYaml } from "yaml";
import { loadRunContext } from "./config.js";
import { runAffordabilityAutomation } from "./service.js";
import type { AffordabilityResult, LenderId, LenderReadyInput, RunStatus } from "./domain/contracts.js";
import { lenderReadyInputSchema } from "./domain/validation.js";
import { mapBarclaysRawInput } from "./mappers/barclays/raw-to-lender-ready.js";
import { mapHalifaxRawInput } from "./mappers/halifax/raw-to-lender-ready.js";
import { mapHsbcRawInput } from "./mappers/hsbc/raw-to-lender-ready.js";
import { mapKensingtonRawInput } from "./mappers/kensington/raw-to-lender-ready.js";
import { mapNatWestRawInput } from "./mappers/natwest/raw-to-lender-ready.js";
import { mapNationwideRawInput } from "./mappers/nationwide/raw-to-lender-ready.js";
import { mapSantanderRawInput } from "./mappers/santander/raw-to-lender-ready.js";
import { mapSkiptonRawInput } from "./mappers/skipton/raw-to-lender-ready.js";
import { mapVirginMoneyRawInput } from "./mappers/virgin-money/raw-to-lender-ready.js";
import { CloudTasksLenderTaskDispatcher, InlineLenderTaskDispatcher, cloudTasksConfigured, type LenderTaskPayload } from "./infrastructure/cloud-tasks-dispatcher.js";
import { createArtifactReadStream, parseStorageUri, uploadResultArtifacts } from "./infrastructure/cloud-storage-artifacts.js";
import { FirestoreRunStateRepository } from "./repositories/firestore-run-state-repository.js";
import { InMemoryRunRepository, runResultKey } from "./repositories/run-repository.js";
import { InMemoryRunStateRepository, type LenderRunRecord, type RunStateRepository } from "./repositories/run-state.js";

const app = express();
const rootDir = process.cwd();
const productionCasesDir = path.join(rootDir, "samples", "test-cases");
const publicDir = path.join(rootDir, "public");
const runRepository = new InMemoryRunRepository();
const runStateRepository = createRunStateRepository();
type MappedLender =
  | "barclays"
  | "halifax"
  | "hsbc"
  | "kensington"
  | "natwest"
  | "nationwide"
  | "santander"
  | "skipton"
  | "virgin_money";
const mappedLenders: MappedLender[] = [
  "barclays",
  "halifax",
  "hsbc",
  "kensington",
  "natwest",
  "nationwide",
  "santander",
  "skipton",
  "virgin_money"
];
const defaultLenderRunBatchSize = 3;
const resultRetentionMs = 24 * 60 * 60 * 1000;

app.use(express.json({ limit: "1mb" }));
app.use(express.static(publicDir));

app.get("/api/artifact", (request, response) => {
  const storageUri = typeof request.query.uri === "string" ? request.query.uri : "";
  if (storageUri) {
    const storageParts = parseStorageUri(storageUri);
    if (!storageParts || storageParts.bucketName !== process.env.EVIDENCE_BUCKET) {
      response.status(400).json({ error: "Invalid artifact URI." });
      return;
    }

    const stream = createArtifactReadStream(storageUri);
    if (!stream) {
      response.status(400).json({ error: "Invalid artifact URI." });
      return;
    }

    if (storageUri.toLowerCase().endsWith(".pdf")) {
      response.type("application/pdf");
    } else if (storageUri.toLowerCase().endsWith(".png")) {
      response.type("image/png");
    }

    stream.on("error", () => {
      if (!response.headersSent) {
        response.status(404).json({ error: "Artifact not found." });
      } else {
        response.end();
      }
    });
    stream.pipe(response);
    return;
  }

  const requestedPath = typeof request.query.path === "string" ? request.query.path : "";
  const resolvedPath = path.resolve(rootDir, requestedPath);
  const allowedArtifactRoots = [
    path.resolve(rootDir, "artifacts"),
    path.resolve(rootDir, loadRunContext().screenshotDir)
  ];

  if (!allowedArtifactRoots.some((root) => isPathInside(resolvedPath, root))) {
    response.status(400).json({ error: "Invalid artifact path." });
    return;
  }

  response.sendFile(resolvedPath, (error) => {
    if (error) {
      response.status(404).json({ error: "Artifact not found." });
    }
  });
});

app.get("/health", (_request, response) => {
  response.json({ status: "ok" });
});

app.get("/api/cases", async (_request, response) => {
  try {
    const cases = await loadCaseSummaries();
    response.json({ cases });
  } catch (error) {
    response.status(500).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

app.get("/api/cases/:caseId", async (request, response) => {
  try {
    const caseDetails = await loadCaseDetails(request.params.caseId);
    if (!caseDetails) {
      response.status(404).json({ error: "Case not found." });
      return;
    }

    response.json(caseDetails);
  } catch (error) {
    response.status(500).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

app.get("/api/cases/:caseId/input", async (request, response) => {
  try {
    const rawInput = await loadRawInputForCase(request.params.caseId);
    if (!rawInput) {
      response.status(404).json({ error: "Case not found." });
      return;
    }

    response.json(rawInput);
  } catch (error) {
    response.status(500).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

app.post("/api/cases/:caseId/run-affordability", async (request, response) => {
  try {
    const caseSample = await loadHalifaxCaseSample(request.params.caseId);
    if (!caseSample) {
      response.status(404).json({ error: "Case not found." });
      return;
    }

    if (lenderWorkerFanoutEnabled()) {
      const run = await runStateRepository.createCaseRun(request.params.caseId, mappedLenders);
      const dispatcher = createLenderTaskDispatcher();
      await Promise.all(mappedLenders.map((lender) => dispatcher.enqueueLenderTask({
        runId: run.runId,
        caseId: request.params.caseId,
        lender
      })));

      response.status(202).json({
        caseId: request.params.caseId,
        runId: run.runId,
        status: run.status,
        totalLenders: run.totalLenders,
        results: await lenderRunViewsForRun(run.runId)
      });
      return;
    }

    const results = await runMappedLendersForCaseInBatches(request.params.caseId);

    response.json({
      caseId: request.params.caseId,
      results
    });
  } catch (error) {
    response.status(500).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

app.get("/api/runs/:runId", async (request, response) => {
  try {
    const run = await runStateRepository.getCaseRun(request.params.runId);
    if (!run) {
      response.status(404).json({ error: "Run not found." });
      return;
    }

    response.json({
      ...run,
      results: await lenderRunViewsForRun(request.params.runId)
    });
  } catch (error) {
    response.status(500).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

app.post("/runs", async (request, response) => {
  const runId = randomUUID();
  try {
    const result = await runAffordabilityAutomation(request.body, loadRunContext());
    await rememberRunResult(request.body, result);
    response.status(result.status === "success" ? 200 : 422).json({ runId, result });
  } catch (error) {
    const lender = isLenderId(request.body?.lender) ? request.body.lender : "halifax";
    const result = failedResult(lender, error instanceof Error ? error.message : String(error));
    await rememberRunResult(request.body, result);
    response.status(400).json({
      runId,
      result
    });
  }
});

app.post("/worker/lender-task", async (request, response) => {
  try {
    if (!workerRequestAuthorized(request.headers["x-worker-secret"])) {
      response.status(401).json({ error: "Unauthorized worker request." });
      return;
    }

    const payload = parseLenderTaskPayload(request.body);
    await runOneLenderTask(payload);
    response.json({ status: "ok", ...payload });
  } catch (error) {
    response.status(500).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

const port = Number(process.env.PORT ?? 3000);
app.listen(port, () => {
  console.log(`Affordability automation API listening on ${port}`);
});

interface CaseSample {
  id: string;
  title: string;
  lender: LenderId;
  input: LenderReadyInput;
  filePath: string;
}

interface RawCaseInput {
  caseId: string;
  fileName: string;
  format: "yaml" | "json";
  content: string;
}

interface RawCaseFile extends RawCaseInput {
  filePath: string;
  raw: Record<string, unknown>;
}

interface CaseSummary {
  id: string;
  title: string;
  mortgagePurpose: string;
  applicationType: string;
  loanAmount: number;
  propertyValue: number;
  lendersRun: number;
}

interface LenderRunView {
  lender: LenderId;
  status: RunStatus | "not_run" | "queued" | "running" | "timed_out";
  affordabilityAmount: number | null;
  monthlyPayment: number | null;
  message: string;
  output: LenderReadyInput | null;
  evidenceUrl: string | null;
  evidenceType: "pdf" | "image" | null;
}

function createRunStateRepository(): RunStateRepository {
  return process.env.RUN_STATE_BACKEND === "firestore" || cloudTasksConfigured()
    ? new FirestoreRunStateRepository()
    : new InMemoryRunStateRepository();
}

function createLenderTaskDispatcher() {
  return cloudTasksConfigured()
    ? new CloudTasksLenderTaskDispatcher()
    : new InlineLenderTaskDispatcher(runOneLenderTask);
}

function lenderWorkerFanoutEnabled(): boolean {
  return process.env.LENDER_WORKER_FANOUT === "true" || cloudTasksConfigured();
}

async function loadCaseSummaries(): Promise<CaseSummary[]> {
  const samples = await loadCaseSamples();
  const grouped = groupSamplesByCase(samples);

  return Array.from(grouped.values())
    .map((caseSamples) => {
      const first = caseSamples[0];
      return {
        id: first.id,
        title: first.title,
        mortgagePurpose: humanize(first.input.case.mortgagePurpose),
        applicationType: humanize(first.input.case.applicationType),
        loanAmount: first.input.loan.loanAmount,
        propertyValue: first.input.loan.propertyValue,
        lendersRun: mappedLenders.length
      };
    })
    .sort((left, right) => left.title.localeCompare(right.title, undefined, { numeric: true }));
}

async function loadCaseDetails(caseId: string) {
  const samples = await loadCaseSamples();
  const matchingSamples = samples.filter((sample) => sample.id === caseId);

  if (matchingSamples.length === 0) {
    return null;
  }

  const first = matchingSamples[0];
  const latestRun = await runStateRepository.findLatestCaseRunForCase(caseId, retentionSinceIso());
  if (latestRun) {
    return {
      ...caseDetailsFromSample(first),
      latestRun: {
        runId: latestRun.runId,
        status: latestRun.status,
        totalLenders: latestRun.totalLenders,
        completedCount: latestRun.completedCount,
        successCount: latestRun.successCount,
        failureCount: latestRun.failureCount,
        updatedAt: latestRun.updatedAt,
        expiresAt: latestRun.expiresAt
      },
      lenders: await lenderRunViewsForRun(latestRun.runId)
    };
  }

  const lenders = await Promise.all(
    mappedLenders.map<Promise<LenderRunView>>(async (lender) => {
      const sample = await loadMappedSampleForCase(caseId, lender);
      const result =
        (await runRepository.getLenderResult(caseId, lender)) ??
        (sample ? await runRepository.getLenderResult(caseIdFromInput(sample.input), lender) : undefined);

      return {
        lender,
        status: result?.status ?? "not_run",
        affordabilityAmount: result?.maximumBorrowing ?? null,
        monthlyPayment: result?.monthlyPayment ?? null,
        message:
          result?.error?.message ??
          result?.messages[0] ??
          (sample ? "No run result saved for this server session." : "No mapped input found for this lender and case."),
        output: result && sample ? sample.input : null,
        evidenceUrl: result ? evidenceUrl(result) : null,
        evidenceType: result ? evidenceType(result) : null
      };
    })
  );

  return {
    ...caseDetailsFromSample(first),
    lenders
  };
}

function caseDetailsFromSample(first: CaseSample) {
  return {
    id: first.id,
    title: first.title,
    summary: {
      mortgagePurpose: humanize(first.input.case.mortgagePurpose),
      applicationType: humanize(first.input.case.applicationType),
      repaymentType: humanize(first.input.case.repaymentType),
      loanAmount: first.input.loan.loanAmount,
      propertyValue: first.input.loan.propertyValue,
      termYears: first.input.case.termYears
    }
  };
}

async function loadCaseSamples(): Promise<CaseSample[]> {
  const files = await findInputFiles(productionCasesDir);
  const samples = await Promise.all(files.map(readProductionCaseSample));

  return samples
    .filter((sample): sample is CaseSample => sample !== null)
    .filter(dedupeLenderCases());
}

async function loadHalifaxCaseSample(caseId: string): Promise<CaseSample | null> {
  const samples = await loadCaseSamples();
  return samples.find((sample) => sample.id === caseId) ?? null;
}

async function loadMappedSampleForCase(caseId: string, lender: MappedLender): Promise<CaseSample | null> {
  const rawCase = await loadRawCaseFileForCase(caseId);
  if (!rawCase) return null;

  return {
    id: rawCase.caseId,
    title: titleFromCaseId(rawCase.caseId),
    lender,
    input: mapRawInputForLender(rawCase.raw, lender),
    filePath: rawCase.filePath
  };
}

async function loadRawInputForCase(caseId: string): Promise<RawCaseInput | null> {
  const rawCase = await loadRawCaseFileForCase(caseId);
  if (!rawCase) return null;

  return {
    caseId: rawCase.caseId,
    fileName: rawCase.fileName,
    format: rawCase.format,
    content: rawCase.content
  };
}

async function runMappedLenderForCase(caseId: string, lender: MappedLender): Promise<LenderRunView> {
  const sample = await loadMappedSampleForCase(caseId, lender);
  if (!sample) {
    const result = failedResult(lender, "No mapped input found for this lender and case.");
    await rememberCaseRunResult(caseId, result);
    return toLenderRunView(result);
  }

  try {
    const result = await runAffordabilityAutomation(sample.input, loadRunContext());
    await rememberRunResult(sample.input, result);
    await rememberCaseRunResult(caseId, result);
    return toLenderRunView(result);
  } catch (error) {
    const result = failedResult(lender, error instanceof Error ? error.message : String(error));
    await rememberRunResult(sample.input, result);
    await rememberCaseRunResult(caseId, result);
    return toLenderRunView(result);
  }
}

async function runOneLenderTask(payload: LenderTaskPayload): Promise<void> {
  const started = Date.now();
  await runStateRepository.markLenderRunning(payload.runId, payload.caseId, payload.lender);
  const sample = await loadMappedSampleForCase(payload.caseId, payload.lender as MappedLender);
  if (!sample) {
    const result = failedResult(payload.lender, "No mapped input found for this lender and case.");
    await runStateRepository.saveLenderRunResult(payload.runId, payload.caseId, result, Date.now() - started);
    await rememberCaseRunResult(payload.caseId, result);
    return;
  }

  try {
    const result = await runAffordabilityAutomation(sample.input, loadRunContext());
    const uploadedResult = await uploadResultArtifacts(result, payload.runId, payload.caseId);
    await rememberRunResult(sample.input, uploadedResult);
    await rememberCaseRunResult(payload.caseId, uploadedResult);
    await runStateRepository.saveLenderRunResult(payload.runId, payload.caseId, uploadedResult, Date.now() - started);
  } catch (error) {
    const result = failedResult(payload.lender, error instanceof Error ? error.message : String(error));
    await rememberRunResult(sample.input, result);
    await rememberCaseRunResult(payload.caseId, result);
    await runStateRepository.saveLenderRunFailure(payload.runId, payload.caseId, payload.lender, result.error?.message ?? "Worker failed.", Date.now() - started);
  }
}

async function lenderRunViewsForRun(runId: string): Promise<LenderRunView[]> {
  const lenderRuns = await runStateRepository.listLenderRuns(runId);
  return Promise.all(lenderRuns.map(lenderRunToView));
}

async function lenderRunToView(record: LenderRunRecord): Promise<LenderRunView> {
  const sample = await loadMappedSampleForCase(record.caseId, record.lender as MappedLender);
  const result = record.result;
  return {
    lender: record.lender,
    status: result?.status ?? record.status,
    affordabilityAmount: result?.maximumBorrowing ?? null,
    monthlyPayment: result?.monthlyPayment ?? null,
    message: result?.error?.message ?? result?.messages[0] ?? record.error ?? statusMessage(record.status),
    output: result && sample ? sample.input : null,
    evidenceUrl: result ? evidenceUrl(result) : null,
    evidenceType: result ? evidenceType(result) : null
  };
}

async function runMappedLendersForCaseInBatches(caseId: string): Promise<LenderRunView[]> {
  const results: LenderRunView[] = [];
  const batchSize = lenderRunBatchSize();

  for (let index = 0; index < mappedLenders.length; index += batchSize) {
    const batch = mappedLenders.slice(index, index + batchSize);
    const batchResults = await Promise.all(batch.map((lender) => runMappedLenderForCase(caseId, lender)));
    results.push(...batchResults);
  }

  return results;
}

function lenderRunBatchSize(): number {
  const configured = Number(process.env.LENDER_RUN_BATCH_SIZE ?? defaultLenderRunBatchSize);
  if (!Number.isFinite(configured) || configured < 1) return defaultLenderRunBatchSize;
  return Math.floor(configured);
}

async function findInputFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        return findInputFiles(entryPath);
      }

      return entry.isFile() && /\.(ya?ml|json)$/i.test(entry.name) ? [entryPath] : [];
    })
  );

  return files.flat();
}

async function loadRawCaseFileForCase(caseId: string): Promise<RawCaseFile | null> {
  const files = await findInputFiles(productionCasesDir);
  const filePath = files.find((file) => caseIdFromPath(file) === caseId);
  return filePath ? readRawCaseFile(filePath) : null;
}

async function readRawCaseFile(filePath: string): Promise<RawCaseFile | null> {
  try {
    const fileName = path.basename(filePath);
    const extension = path.extname(fileName).toLowerCase();
    const content = await readFile(filePath, "utf8");
    const raw = extension === ".json" ? JSON.parse(content) : parseYaml(content);

    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      return null;
    }

    return {
      caseId: caseIdFromPath(filePath),
      fileName,
      format: extension === ".json" ? "json" : "yaml",
      content,
      filePath,
      raw: raw as Record<string, unknown>
    };
  } catch {
    return null;
  }
}

async function readProductionCaseSample(filePath: string): Promise<CaseSample | null> {
  const rawCase = await readRawCaseFile(filePath);
  if (!rawCase) return null;

  const input = mapRawInputForLender(rawCase.raw, "halifax");
  return {
    id: rawCase.caseId,
    title: titleFromCaseId(rawCase.caseId),
    lender: input.lender,
    input,
    filePath
  };
}

async function readCaseSample(filePath: string): Promise<CaseSample | null> {
  try {
    if (/^case-\d+$/i.test(path.basename(filePath, ".json"))) {
      return null;
    }

    const input = JSON.parse(await readFile(filePath, "utf8")) as Partial<LenderReadyInput>;
    if (!isLenderReadyInput(input)) {
      return null;
    }

    const id = caseIdFromPath(filePath);
    return {
      id,
      title: titleFromCaseId(id),
      lender: input.lender,
      input,
      filePath
    };
  } catch {
    return null;
  }
}

async function findJsonFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        return findJsonFiles(entryPath);
      }

      return entry.isFile() && entry.name.toLowerCase().endsWith(".json") ? [entryPath] : [];
    })
  );

  return files.flat();
}

function isLenderReadyInput(value: Partial<LenderReadyInput>): value is LenderReadyInput {
  return typeof value.lender === "string" && typeof value.case === "object" && typeof value.loan === "object";
}

function mapRawInputForLender(raw: Record<string, unknown>, lender: MappedLender): LenderReadyInput {
  const result =
    lender === "barclays" ? mapBarclaysRawInput(raw) :
    lender === "halifax" ? mapHalifaxRawInput(raw) :
    lender === "hsbc" ? mapHsbcRawInput(raw) :
    lender === "kensington" ? mapKensingtonRawInput(raw) :
    lender === "natwest" ? mapNatWestRawInput(raw) :
    lender === "nationwide" ? mapNationwideRawInput(raw) :
    lender === "santander" ? mapSantanderRawInput(raw) :
    lender === "skipton" ? mapSkiptonRawInput(raw) :
    mapVirginMoneyRawInput(raw);

  return lenderReadyInputSchema.parse(result.input);
}

function groupSamplesByCase(samples: CaseSample[]): Map<string, CaseSample[]> {
  return samples.reduce((grouped, sample) => {
    const existing = grouped.get(sample.id) ?? [];
    existing.push(sample);
    grouped.set(sample.id, existing);
    return grouped;
  }, new Map<string, CaseSample[]>());
}

function dedupeLenderCases() {
  const seen = new Set<string>();
  return (sample: CaseSample) => {
    const key = runResultKey(sample.id, sample.lender);
    if (seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  };
}

async function rememberRunResult(value: unknown, result: AffordabilityResult): Promise<void> {
  if (!isLenderReadyInput(value as Partial<LenderReadyInput>)) {
    return;
  }

  const input = value as LenderReadyInput;
  await runRepository.saveLenderResult(caseIdFromInput(input), result);
}

async function rememberCaseRunResult(caseId: string, result: AffordabilityResult): Promise<void> {
  await runRepository.saveLenderResult(caseId, result);
}

function failedResult(lender: LenderId, message: string): AffordabilityResult {
  return {
    lender,
    status: "failed",
    maximumBorrowing: null,
    monthlyPayment: null,
    messages: [],
    evidence: { timestamp: new Date().toISOString() },
    error: {
      category: "validation",
      message
    }
  };
}

function parseLenderTaskPayload(value: unknown): LenderTaskPayload {
  const body = value as Partial<LenderTaskPayload>;
  if (!body || typeof body.runId !== "string" || typeof body.caseId !== "string" || !isLenderId(body.lender)) {
    throw new Error("Invalid lender task payload.");
  }

  return {
    runId: body.runId,
    caseId: body.caseId,
    lender: body.lender
  };
}

function workerRequestAuthorized(secretHeader: string | string[] | undefined): boolean {
  const expected = process.env.WORKER_SHARED_SECRET;
  if (!expected) return true;
  const actual = Array.isArray(secretHeader) ? secretHeader[0] : secretHeader;
  return actual === expected;
}

function statusMessage(status: string): string {
  if (status === "queued") return "Queued for lender worker.";
  if (status === "running") return "Lender worker is running.";
  if (status === "timed_out") return "Lender worker timed out.";
  return "";
}

function toLenderRunView(result: AffordabilityResult): LenderRunView {
  return {
    lender: result.lender,
    status: result.status,
    affordabilityAmount: result.maximumBorrowing,
    monthlyPayment: result.monthlyPayment,
    message: result.error?.message ?? result.messages[0] ?? "",
    output: null,
    evidenceUrl: evidenceUrl(result),
    evidenceType: evidenceType(result)
  };
}

function evidenceUrl(result: AffordabilityResult): string | null {
  const artifactUri = result.evidence.pdfUri ?? result.evidence.screenshotUri;
  if (artifactUri) return `/api/artifact?uri=${encodeURIComponent(artifactUri)}`;

  const artifactPath = result.evidence.pdfPath ?? result.evidence.screenshotPath;
  if (artifactPath) return `/api/artifact?path=${encodeURIComponent(artifactPath)}`;
  return null;
}

function evidenceType(result: AffordabilityResult): "pdf" | "image" | null {
  if (result.evidence.pdfPath || result.evidence.pdfUri) return "pdf";
  if (result.evidence.screenshotPath || result.evidence.screenshotUri) return "image";
  return null;
}

function retentionSinceIso(): string {
  return new Date(Date.now() - resultRetentionMs).toISOString();
}

function isLenderId(value: unknown): value is LenderId {
  return (
    value === "halifax" ||
    value === "barclays" ||
    value === "natwest" ||
    value === "hsbc" ||
    value === "santander" ||
    value === "nationwide" ||
    value === "skipton" ||
    value === "virgin_money" ||
    value === "kensington"
  );
}

function caseIdFromInput(input: LenderReadyInput): string {
  return [
    input.case.mortgagePurpose,
    input.case.applicationType,
    input.case.repaymentType,
    input.loan.propertyValue,
    input.loan.loanAmount,
    input.case.termYears
  ].join("-");
}

function caseIdFromPath(filePath: string): string {
  const basename = path.basename(filePath).replace(/\.(ya?ml|json)$/i, "").toLowerCase();
  return basename
    .replace(/^(barclays|halifax|hsbc|kensington|natwest|nationwide|santander|skipton|virgin-money)-raw-case-/, "")
    .replace(/^additional-raw-case-/, "")
    .replace(/^case-/, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function titleFromCaseId(caseId: string): string {
  return caseId
    .split("-")
    .filter(Boolean)
    .map((part) => (part.match(/^\d+$/) ? part : part[0].toUpperCase() + part.slice(1)))
    .join(" ");
}

function humanize(value: string): string {
  return value.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function isPathInside(candidatePath: string, rootPath: string): boolean {
  const relativePath = path.relative(rootPath, candidatePath);
  return relativePath !== "" && !relativePath.startsWith("..") && !path.isAbsolute(relativePath);
}
