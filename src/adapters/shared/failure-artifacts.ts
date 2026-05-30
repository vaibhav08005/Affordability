import type { Page } from "playwright";
import { copyFile, mkdir, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import type { AffordabilityResult, LenderReadyInput } from "../../domain/contracts.js";
import type { RunContext } from "../types.js";

interface SaveFailureBundleOptions {
  page: Page;
  context: RunContext;
  input: LenderReadyInput;
  error: unknown;
  category: NonNullable<AffordabilityResult["error"]>["category"];
  screenshotPath?: string;
  timestamp: string;
}

export async function saveFailureBundle(options: SaveFailureBundleOptions): Promise<string | undefined> {
  try {
    const folder = failureFolderPath(options);
    await mkdir(folder, { recursive: true });

    const pageUrl = options.page.url();
    const [html, visibleText, title] = await Promise.all([
      options.page.content().catch((error) => `Unable to capture page HTML: ${errorMessage(error)}`),
      options.page.locator("body").innerText().catch((error) => `Unable to capture visible text: ${errorMessage(error)}`),
      options.page.title().catch(() => "")
    ]);

    const localScreenshotPath = await copyFailureScreenshot(folder, options.screenshotPath);
    const failure = {
      lender: options.input.lender,
      category: options.category,
      message: errorMessage(options.error),
      timestamp: options.timestamp,
      url: pageUrl,
      title,
      inputSummary: {
        journey: options.input.case.journey,
        mortgagePurpose: options.input.case.mortgagePurpose,
        applicationType: options.input.case.applicationType,
        repaymentType: options.input.case.repaymentType,
        applicants: options.input.case.numberOfApplicants,
        loanAmount: options.input.loan.loanAmount,
        propertyValue: options.input.loan.propertyValue
      },
      artifacts: {
        input: "input.json",
        html: "page.html",
        visibleText: "visible-text.txt",
        screenshot: localScreenshotPath ? basename(localScreenshotPath) : undefined,
        repairPrompt: "repair-prompt.md"
      }
    };

    await Promise.all([
      writeJson(join(folder, "failure.json"), failure),
      writeJson(join(folder, "input.json"), options.input),
      writeFile(join(folder, "page.html"), html, "utf8"),
      writeFile(join(folder, "visible-text.txt"), visibleText, "utf8"),
      writeFile(join(folder, "repair-prompt.md"), repairPrompt(folder, failure), "utf8")
    ]);

    return folder;
  } catch {
    return undefined;
  }
}

function failureFolderPath(options: SaveFailureBundleOptions): string {
  const safeTimestamp = options.timestamp.replace(/[:.]/g, "-");
  const safeCase = [
    options.input.case.journey,
    options.input.case.applicationType,
    options.input.case.mortgagePurpose,
    options.input.case.repaymentType
  ]
    .filter(Boolean)
    .join("-")
    .replace(/[^a-z0-9]+/gi, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase();

  return join(options.context.failureDir, options.input.lender, `${safeTimestamp}-${safeCase || "case"}`);
}

async function copyFailureScreenshot(folder: string, screenshotPath?: string): Promise<string | undefined> {
  if (!screenshotPath) return undefined;
  const destination = join(folder, "screenshot.png");
  await copyFile(screenshotPath, destination).catch(() => undefined);
  return destination;
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function repairPrompt(folder: string, failure: { lender: string; category: string; message: string }): string {
  return `Investigate and fix this lender automation failure.

Failure folder:
${folder}

Lender: ${failure.lender}
Category: ${failure.category}
Error: ${failure.message}

Please:
1. Read failure.json, input.json, page.html, visible-text.txt, and screenshot.png if present.
2. First classify the failure as one of:
   - code_repair_needed: selector, label, option, flow, mapping, result extraction, or site structure changed.
   - no_code_change_needed: valid lender policy decline, invalid input, expected validation, lender downtime, or unsupported scenario.
3. Do not modify code if this is a valid lender policy/input validation failure. In that case, explain the rule or validation reason and stop.
4. If code repair is needed, identify the root cause and patch only the relevant adapter or mapping files.
5. Run the exact failed input from input.json.
6. Report the classification, code change if any, and verification result.
`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
