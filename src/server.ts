import express from "express";
import { randomUUID } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { loadRunContext } from "./config.js";
import { runAffordabilityAutomation } from "./service.js";
import type { AffordabilityResult, LenderId, LenderReadyInput, RunStatus } from "./domain/contracts.js";

const app = express();
const rootDir = process.cwd();
const samplesDir = path.join(rootDir, "samples", "halifax-mapped-cases");
const publicDir = path.join(rootDir, "public");
const runResults = new Map<string, AffordabilityResult>();
type MappedLender = "barclays" | "halifax" | "hsbc" | "skipton" | "virgin_money";
const mappedLenders: MappedLender[] = ["barclays", "halifax", "hsbc", "skipton", "virgin_money"];
const lenderSampleFolders: Record<MappedLender, string[]> = {
  barclays: ["barclays-mapped-cases", "barclays-additional-mapped-cases"],
  halifax: ["halifax-mapped-cases"],
  hsbc: ["hsbc-mapped-cases", "hsbc-additional-mapped-cases"],
  skipton: ["skipton-mapped-cases", "skipton-additional-mapped-cases"],
  virgin_money: ["virgin-money-mapped-cases", "virgin-money-additional-mapped-cases"]
};

app.use(express.json({ limit: "1mb" }));
app.use(express.static(publicDir));

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

app.post("/api/cases/:caseId/run-affordability", async (request, response) => {
  try {
    const caseSample = await loadHalifaxCaseSample(request.params.caseId);
    if (!caseSample) {
      response.status(404).json({ error: "Case not found." });
      return;
    }

    const results = await Promise.all(
      mappedLenders.map((lender) => runMappedLenderForCase(request.params.caseId, lender))
    );

    response.json({
      caseId: request.params.caseId,
      results
    });
  } catch (error) {
    response.status(500).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

app.post("/runs", async (request, response) => {
  const runId = randomUUID();
  try {
    const result = await runAffordabilityAutomation(request.body, loadRunContext());
    rememberRunResult(request.body, result);
    response.status(result.status === "success" ? 200 : 422).json({ runId, result });
  } catch (error) {
    const lender = isLenderId(request.body?.lender) ? request.body.lender : "halifax";
    const result = failedResult(lender, error instanceof Error ? error.message : String(error));
    rememberRunResult(request.body, result);
    response.status(400).json({
      runId,
      result
    });
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
  status: RunStatus | "not_run";
  affordabilityAmount: number | null;
  monthlyPayment: number | null;
  message: string;
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
  const lenders = await Promise.all(
    mappedLenders.map<Promise<LenderRunView>>(async (lender) => {
      const sample = await loadMappedSampleForCase(caseId, lender);
      const result =
        runResults.get(runResultKey(caseId, lender)) ??
        (sample ? runResults.get(runResultKey(caseIdFromInput(sample.input), lender)) : undefined);

      return {
        lender,
        status: result?.status ?? "not_run",
        affordabilityAmount: result?.maximumBorrowing ?? null,
        monthlyPayment: result?.monthlyPayment ?? null,
        message:
          result?.error?.message ??
          result?.messages[0] ??
          (sample ? "No run result saved for this server session." : "No mapped input found for this lender and case.")
      };
    })
  );

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
    },
    lenders
  };
}

async function loadCaseSamples(): Promise<CaseSample[]> {
  const files = await findJsonFiles(samplesDir);
  const samples = await Promise.all(files.map(readCaseSample));

  return samples
    .filter((sample): sample is CaseSample => sample !== null)
    .filter(dedupeLenderCases());
}

async function loadHalifaxCaseSample(caseId: string): Promise<CaseSample | null> {
  const samples = await loadCaseSamples();
  return samples.find((sample) => sample.id === caseId) ?? null;
}

async function loadMappedSampleForCase(caseId: string, lender: MappedLender): Promise<CaseSample | null> {
  for (const folder of lenderSampleFolders[lender]) {
    const directory = path.join(rootDir, "samples", folder);
    const files = await findJsonFiles(directory);
    const filePath = files.find((file) => caseIdFromPath(file) === caseId);

    if (filePath) {
      return readCaseSample(filePath);
    }
  }

  return null;
}

async function runMappedLenderForCase(caseId: string, lender: MappedLender): Promise<LenderRunView> {
  const sample = await loadMappedSampleForCase(caseId, lender);
  if (!sample) {
    const result = failedResult(lender, "No mapped input found for this lender and case.");
    rememberCaseRunResult(caseId, result);
    return toLenderRunView(result);
  }

  try {
    const result = await runAffordabilityAutomation(sample.input, loadRunContext());
    rememberRunResult(sample.input, result);
    rememberCaseRunResult(caseId, result);
    return toLenderRunView(result);
  } catch (error) {
    const result = failedResult(lender, error instanceof Error ? error.message : String(error));
    rememberRunResult(sample.input, result);
    rememberCaseRunResult(caseId, result);
    return toLenderRunView(result);
  }
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

function rememberRunResult(value: unknown, result: AffordabilityResult): void {
  if (!isLenderReadyInput(value as Partial<LenderReadyInput>)) {
    return;
  }

  const input = value as LenderReadyInput;
  runResults.set(runResultKey(caseIdFromInput(input), result.lender), result);
}

function rememberCaseRunResult(caseId: string, result: AffordabilityResult): void {
  runResults.set(runResultKey(caseId, result.lender), result);
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

function toLenderRunView(result: AffordabilityResult): LenderRunView {
  return {
    lender: result.lender,
    status: result.status,
    affordabilityAmount: result.maximumBorrowing,
    monthlyPayment: result.monthlyPayment,
    message: result.error?.message ?? result.messages[0] ?? ""
  };
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
  const basename = path.basename(filePath, ".json").toLowerCase();
  return basename
    .replace(/^(barclays|halifax|hsbc|skipton|virgin-money)-raw-case-/, "")
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

function runResultKey(caseId: string, lender: LenderId): string {
  return `${caseId}:${lender}`;
}

function humanize(value: string): string {
  return value.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}
