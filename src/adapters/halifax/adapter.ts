import { chromium, type Locator, type Page } from "playwright";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { AffordabilityResult, Applicant, LenderReadyInput } from "../../domain/contracts.js";
import type { LenderAdapter, RunContext } from "../types.js";
import {
  customerTypeLabels,
  dependantOption,
  epcLabels,
  HALIFAX_CALCULATOR_URL,
  HALIFAX_LANDING_URL,
  mortgagePurposeLabels,
  otherIncomeLabels,
  scottishTenureLabels,
  selfEmploymentLabels,
  sharedOwnershipSchemeLabels,
  tenureLabels
} from "./mapping.js";

export const halifaxAdapter: LenderAdapter = {
  lender: "halifax",
  async run(input, context) {
    const startedAt = new Date().toISOString();
    const session = await createBrowserSession(context);
    const page = session.page;
    page.setDefaultTimeout(context.timeoutMs);
    page.setDefaultNavigationTimeout(context.timeoutMs);

    try {
      await openHalifaxCalculator(page, context);
      await assertCalculatorAvailable(page);
      await fillHalifaxCalculator(page, input);
      await page.getByRole("button", { name: "Calculate" }).click();
      await waitForCalculationToFinish(page, context);

      const result = await extractResult(page);
      if (result.maximumBorrowing == null) {
        throw new Error("Result extraction failed: Halifax did not return a maximum borrowing amount.");
      }
      const screenshotPath = await captureEvidence(page, context, "halifax-success");

      return {
        lender: "halifax",
        status: "success",
        maximumBorrowing: result.maximumBorrowing,
        monthlyPayment: result.monthlyPayment,
        messages: result.messages,
        evidence: {
          screenshotPath,
          timestamp: startedAt
        }
      };
    } catch (error) {
      const screenshotPath = await captureEvidence(page, context, "halifax-failed").catch(() => undefined);
      return {
        lender: "halifax",
        status: "failed",
        maximumBorrowing: null,
        monthlyPayment: null,
        messages: [],
        evidence: {
          screenshotPath,
          timestamp: startedAt
        },
        error: {
          category: categorizeError(error),
          message: error instanceof Error ? error.message : String(error)
        }
      };
    } finally {
      await session.close();
    }
  }
};

interface BrowserSession {
  page: Page;
  close(): Promise<void>;
}

async function createBrowserSession(context: RunContext): Promise<BrowserSession> {
  if (context.executionMode === "attached") {
    return createAttachedBrowserSession(context);
  }

  return createManagedBrowserSession(context);
}

async function createManagedBrowserSession(context: RunContext): Promise<BrowserSession> {
  const browser = await chromium.launch({
    headless: context.headless,
    args: ["--disable-blink-features=AutomationControlled"]
  });
  const browserContext = await browser.newContext({
    acceptDownloads: false,
    colorScheme: "light",
    extraHTTPHeaders: {
      "Accept-Language": "en-GB,en;q=0.9"
    },
    locale: "en-GB",
    timezoneId: "Europe/London",
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    viewport: {
      width: 1365,
      height: 900
    }
  });
  const page = await browserContext.newPage();

  return {
    page,
    async close() {
      await browser.close();
    }
  };
}

async function createAttachedBrowserSession(context: RunContext): Promise<BrowserSession> {
  if (!context.browserWSEndpoint) {
    throw new Error("Attached browser execution requires BROWSER_WS_ENDPOINT.");
  }

  const browser = await chromium.connectOverCDP(context.browserWSEndpoint);
  const browserContext = browser.contexts()[0] ?? await browser.newContext();
  const pages = browserContext.pages();
  const page = pages.find((candidate) => candidate.url().startsWith(HALIFAX_CALCULATOR_URL)) ?? pages[0] ?? await browserContext.newPage();

  await page.setViewportSize({ width: 1365, height: 900 }).catch(() => undefined);

  return {
    page,
    async close() {
      await browser.close();
    }
  };
}

async function openHalifaxCalculator(page: Page, context: RunContext): Promise<void> {
  if (context.executionMode === "attached" && page.url().startsWith(HALIFAX_CALCULATOR_URL)) {
    await page.goto(HALIFAX_CALCULATOR_URL, { waitUntil: "domcontentloaded" });
    return;
  }

  await page.goto(HALIFAX_LANDING_URL, { waitUntil: "domcontentloaded" });
  await page.goto(HALIFAX_CALCULATOR_URL, {
    referer: HALIFAX_LANDING_URL,
    waitUntil: "domcontentloaded"
  });
}

async function fillHalifaxCalculator(page: Page, input: LenderReadyInput): Promise<void> {
  await chooseApplicantCount(page, input.case.numberOfApplicants);
  await fillApplicantAges(page, input.applicants);
  await chooseRadioInGroup(page, "How many child or adult dependants?", dependantOption(input.household.dependants.length));
  await chooseCustomListOption(page, "Loan type", mortgagePurposeLabels[input.case.mortgagePurpose]);
  await chooseRadioInGroupIfPresent(page, "Who is the customer?", customerTypeLabels[input.case.customerType]);

  await fillFirstAvailableCurrency(page, ["Property purchase price", "Property value"], input.loan.propertyValue);
  await fillCurrency(page, "Loan amount", input.loan.loanAmount);
  await page.getByLabel("Loan term (years)").fill(String(input.case.termYears));

  await chooseYesNo(page, "Is the mortgage part of a shared ownership / shared equity scheme?", input.case.sharedOwnershipOrEquity);
  if (input.case.sharedOwnershipOrEquity) {
    await chooseCustomListOption(
      page,
      "Scheme type",
      sharedOwnershipSchemeLabels[input.case.sharedOwnershipScheme ?? "shared_ownership"]
    );
    await fillCurrency(page, "Monthly rent payable", input.case.monthlySharedOwnershipRent ?? 0);
  }

  await chooseYesNo(page, "Is any of the loan interest-only?", input.case.hasInterestOnly);
  if (input.case.hasInterestOnly) {
    await fillCurrency(page, "Interest-only loan amount", input.case.interestOnlyLoanAmount ?? 0);
    await fillCurrency(page, "Monthly premium for repayment plans", input.case.monthlyRepaymentPlanPremium ?? 0);
  }

  await chooseYesNo(page, "Is the property in Scotland?", input.property.isInScotland);
  await chooseCustomListOption(
    page,
    "Property type",
    input.property.isInScotland ? scottishTenureLabels[input.property.tenure] : tenureLabels[input.property.tenure]
  );
  await page.getByLabel("Property EPC rating, if known").selectOption({ label: epcLabels[input.property.epcRating] });

  for (const applicant of input.applicants) {
    await fillApplicantIncome(page, applicant);
  }

  await fillCurrency(page, "Monthly loan repayments", input.outgoings.monthlyLoanRepayments);
  await fillCurrency(page, "Total outstanding credit card balances", input.outgoings.creditCardBalances);
  await fillCurrency(page, "Total outstanding overdraft balances", input.outgoings.overdraftBalances);
  await fillCurrency(page, "Total amount of other monthly outgoings", input.outgoings.otherMonthlyOutgoings);
  await fillCurrency(page, "Monthly Buy to Let mortgage payments", input.outgoings.monthlyBuyToLetPayments);
  await chooseYesNo(page, "Do the applicants have any other properties owned other than Buy to Lets?", input.otherProperties.length > 0);
  await chooseYesNoIfPresent(
    page,
    "Do the applicants have any other mortgage commitments to remain?",
    input.outgoings.otherMortgageCommitments.length > 0
  );
  await fillOtherMortgageCommitments(page, input);
}

async function assertCalculatorAvailable(page: Page): Promise<void> {
  const mainText = await page.locator("main").innerText({ timeout: 10000 }).catch(() => "");
  const normalized = mainText.toLowerCase();

  if (
    normalized.includes("we're having some problems with our systems") ||
    normalized.includes("please try again later") ||
    normalized.includes("error 1007")
  ) {
    throw new Error("Halifax calculator is unavailable: the site returned its system-problem page.");
  }
}

async function chooseApplicantCount(page: Page, count: 1 | 2): Promise<void> {
  await chooseRadioInGroup(page, "How many people are applying?", count === 1 ? "1" : "2+");
}

async function fillApplicantAges(page: Page, applicants: Applicant[]): Promise<void> {
  if (applicants.length === 1) {
    await page.getByLabel("Applicant age").fill(String(applicants[0]?.age));
    return;
  }

  await page.getByLabel("Applicant 1 age").fill(String(applicants[0]?.age));
  await page.getByLabel("Applicant 2 age").fill(String(applicants[1]?.age));
}

async function fillApplicantIncome(page: Page, applicant: Applicant): Promise<void> {
  const section = await applicantSection(page, applicant.index);
  const employment = applicant.employment;

  if (
    employment.type === "employed" ||
    hasPositiveAmount(employment.annualGrossIncome) ||
    hasPositiveAmount(employment.annualOvertime) ||
    hasPositiveAmount(employment.annualBonus) ||
    hasPositiveAmount(employment.annualCommission)
  ) {
    await section.getByRole("checkbox", { name: "Income from employer(s)" }).check();
    await chooseRadioInGroup(section, "Are they a contractor?", employment.isContractor ? "Yes" : "No");
    await fillCurrencyNearText(section, "Gross annual basic salary", employment.annualGrossIncome ?? 0);
    await fillCurrencyNearText(section, "Annual overtime", employment.annualOvertime ?? 0);
    await fillCurrencyNearText(section, "Annual bonus payments", employment.annualBonus ?? 0);
    await fillCurrencyNearText(section, "Annual commission", employment.annualCommission ?? 0);
  }

  if (
    employment.type === "self_employed" ||
    employment.businessType != null ||
    employment.netProfitCurrentYear != null ||
    employment.netProfitPreviousYear != null
  ) {
    await section.getByRole("checkbox", { name: "Self employed" }).check();
    if (employment.businessType) {
      await chooseCustomListOption(section, "Self employment type", selfEmploymentLabels[employment.businessType]);
    }
    await fillFirstAvailableCurrencyNearText(
      section,
      [
        "Net profit (current year)",
        "Total of remuneration package (current year)",
        "Total salary/remuneration + dividends drawn (current year)",
        "Share of net profit (current year)"
      ],
      employment.netProfitCurrentYear ?? 0
    );
    await fillFirstAvailableCurrencyNearText(
      section,
      [
        "Net profit (previous year)",
        "Total of remuneration package (previous year)",
        "Total salary/remuneration + dividends drawn (previous year)",
        "Share of net profit (previous year)"
      ],
      employment.netProfitPreviousYear ?? 0
    );
  }

  if (
    employment.type === "pension" ||
    hasPositiveAmount(employment.annualPensionIncome) ||
    hasPositiveAmount(employment.otherAnnualPensionIncome)
  ) {
    await section.getByRole("checkbox", { name: "Pension" }).check();
    await fillCurrencyNearText(section, "Taxable annual pension income", employment.annualPensionIncome ?? 0);
    await fillCurrencyNearText(section, "Other annual pension income", employment.otherAnnualPensionIncome ?? 0);
  }

  if (applicant.otherIncome.length > 0) {
    await section.getByRole("checkbox", { name: "Other income" }).check();
    for (let index = 0; index < applicant.otherIncome.length; index += 1) {
      if (index > 0) {
        await section.getByRole("button", { name: "+ Add another income" }).click();
      }
      const income = applicant.otherIncome[index];
      await section.getByLabel("Income type").nth(index).selectOption({ label: otherIncomeLabels[income.type] });
      await section.getByLabel("Total annual amount").nth(index).fill(currencyValue(income.annualAmount));
    }
  }
}

async function fillOtherMortgageCommitments(page: Page, input: LenderReadyInput): Promise<void> {
  for (let index = 0; index < input.outgoings.otherMortgageCommitments.length; index += 1) {
    if (index > 0) {
      await page.getByRole("button", { name: "+ Add another commitment" }).click();
    }

    const commitment = input.outgoings.otherMortgageCommitments[index];
    await page.getByLabel("Outstanding balance").nth(index).fill(currencyValue(commitment.outstandingBalance));
    await page.getByLabel("Remaining term (years)").nth(index).fill(String(commitment.remainingTermYears));
  }
}

async function applicantSection(page: Page, index: 1 | 2): Promise<Locator> {
  const heading = page.getByRole("heading", { name: `Applicant ${index}` });
  const visibleHeading = heading.filter({ visible: true });
  if (await visibleHeading.count() === 0) {
    return page.locator("main");
  }

  return visibleHeading.first().locator('xpath=ancestor::*[contains(@class,"grid")][1]');
}

async function chooseYesNo(page: Page, groupName: string, value: boolean): Promise<void> {
  await chooseRadioInGroup(page, groupName, value ? "Yes" : "No");
}

async function chooseYesNoIfPresent(page: Page, groupName: string, value: boolean): Promise<void> {
  await chooseRadioInGroupIfPresent(page, groupName, value ? "Yes" : "No");
}

async function chooseRadioInGroupIfPresent(pageOrLocator: Page | Locator, groupName: string, optionName: string): Promise<void> {
  const group = pageOrLocator.getByRole("group", { name: groupName });
  if (await group.count() === 0) return;
  await chooseRadioInGroup(pageOrLocator, groupName, optionName);
}

async function chooseRadioInGroup(pageOrLocator: Page | Locator, groupName: string, optionName: string): Promise<void> {
  const group = pageOrLocator.getByRole("group", { name: groupName });
  const namedRadio = group.getByRole("radio", { name: optionName });

  if (await namedRadio.count() === 1) {
    try {
      await namedRadio.check({ timeout: 5000 });
      return;
    } catch {
      await namedRadio.click({ timeout: 5000, force: true });
      return;
    }
  }

  const visibleOption = group.getByText(optionName, { exact: true });
  if (await visibleOption.count() === 1) {
    await visibleOption.click({ timeout: 10000 });
    return;
  }

  const globalOption = pageOrLocator.getByText(optionName, { exact: true });
  if (await globalOption.count() === 1) {
    await globalOption.click({ timeout: 10000 });
    return;
  }

  throw new Error(`Unable to choose option "${optionName}" in group "${groupName}".`);
}

async function chooseCustomListOption(pageOrLocator: Page | Locator, groupName: string, optionText: string): Promise<void> {
  const group = pageOrLocator.getByRole("group", { name: groupName });
  const radio = group.getByRole("radio").filter({ has: group.getByText(optionText, { exact: true }) });

  if (await radio.count() === 1) {
    await radio.check();
    return;
  }

  const optionIndex = customOptionIndex(groupName, optionText);
  if (optionIndex != null) {
    const radios = group.getByRole("radio");
    if (await radios.count() > optionIndex) {
      try {
        await radios.nth(optionIndex).check({ force: true });
      } catch {
        await radios.nth(optionIndex).click({ force: true });
      }
      return;
    }
  }

  // Halifax renders some radio labels as sibling list items, so clicking the visible option text is the durable fallback.
  await group.getByText(optionText, { exact: true }).click();
}

function customOptionIndex(groupName: string, optionText: string): number | null {
  const optionsByGroup: Record<string, string[]> = {
    "Loan type": [
      "Purchase",
      "Remortgage with no additional borrowing",
      "Remortgage with capital raising",
      "Further advance"
    ],
    "Scheme type": ["Shared ownership", "Shared equity"],
    "Property type": ["Freehold", "Leasehold"],
    "Self employment type": ["Sole trader", "Limited company", "Partnership", "LLP"]
  };

  const options = optionsByGroup[groupName];
  if (!options) return null;

  if (groupName === "Property type" && optionText === "Outright or absolute ownership") return 0;

  const index = options.indexOf(optionText);
  return index >= 0 ? index : null;
}

async function fillCurrency(page: Page, label: string, value: number): Promise<void> {
  await page.getByLabel(label).fill(currencyValue(value));
}

async function fillFirstAvailableCurrency(page: Page, labels: string[], value: number): Promise<void> {
  for (const label of labels) {
    const field = page.getByLabel(label);
    if (await field.count() === 1) {
      await field.fill(currencyValue(value));
      return;
    }
  }

  throw new Error(`Unable to find any currency field: ${labels.join(", ")}.`);
}

async function fillCurrencyNearText(scope: Page | Locator, text: string, value: number): Promise<void> {
  const labelledField = scope.getByLabel(text);
  if (await labelledField.count() === 1) {
    await labelledField.fill(currencyValue(value));
    return;
  }

  const field = scope
    .locator(`xpath=.//*[normalize-space(.)="${text}"]/following::input[1]`);
  if (await field.count() >= 1) {
    await field.first().fill(currencyValue(value));
    return;
  }

  throw new Error(`Unable to fill currency field "${text}".`);
}

async function fillFirstAvailableCurrencyNearText(scope: Page | Locator, labels: string[], value: number): Promise<void> {
  for (const label of labels) {
    const labelledField = scope.getByLabel(label);
    if (await labelledField.count() === 1) {
      await labelledField.fill(currencyValue(value));
      return;
    }

    const field = scope.locator(`xpath=.//*[normalize-space(.)="${label}"]/following::input[1]`);
    if (await field.count() >= 1) {
      await field.first().fill(currencyValue(value));
      return;
    }
  }

  throw new Error(`Unable to fill any currency field: ${labels.join(", ")}.`);
}

function currencyValue(value: number): string {
  return String(Math.round(value));
}

function hasPositiveAmount(value: number | undefined): boolean {
  return value != null && value > 0;
}

async function extractResult(page: Page): Promise<{
  maximumBorrowing: number | null;
  monthlyPayment: number | null;
  messages: string[];
}> {
  await page.waitForLoadState("networkidle").catch(() => undefined);
  const text = await page.locator("main").innerText();
  const resultText = resultSectionText(text);
  const maximumBorrowing = extractMaximumCurrency(resultText);

  return {
    maximumBorrowing,
    monthlyPayment: null,
    messages: resultText
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .slice(0, 20)
  };
}

async function waitForCalculationToFinish(page: Page, context: RunContext): Promise<void> {
  const pleaseWait = page.getByText("Please wait...", { exact: true });
  await pleaseWait.waitFor({ state: "hidden", timeout: context.timeoutMs }).catch(() => undefined);
}

function resultSectionText(text: string): string {
  const start = text.indexOf("Your results");
  if (start < 0) return text;

  const afterResults = text.slice(start);
  const productStart = afterResults.indexOf("Products available to your customer");
  return productStart >= 0 ? afterResults.slice(0, productStart) : afterResults;
}

function extractMaximumCurrency(text: string): number | null {
  const matches = [...text.matchAll(/\u00a3\s*([0-9][0-9,]*)/g)];
  if (matches.length === 0) return null;

  return Math.max(...matches.map((match) => Number(match[1]?.replace(/,/g, ""))));
}

async function captureEvidence(page: Page, context: RunContext, name: string): Promise<string> {
  await mkdir(context.screenshotDir, { recursive: true });
  const path = join(context.screenshotDir, `${name}-${Date.now()}.png`);
  await page.screenshot({ path, fullPage: true });
  return path;
}

function categorizeError(error: unknown): NonNullable<AffordabilityResult["error"]>["category"] {
  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  if (message.includes("navigation") || message.includes("goto")) return "navigation";
  if (message.includes("calculate")) return "calculate";
  if (message.includes("result")) return "result_extraction";
  if (message.includes("unavailable") || message.includes("problem") || message.includes("error 1007")) return "lender_unavailable";
  return "field_fill";
}
