import { chromium, type Browser, type Locator, type Page } from "playwright";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { AffordabilityResult, Applicant, LenderReadyInput } from "../../domain/contracts.js";
import type { LenderAdapter, RunContext } from "../types.js";
import { BARCLAYS_CALCULATOR_URL, employmentStatusLabels, repaymentMethodLabels } from "./mapping.js";

export const barclaysAdapter: LenderAdapter = {
  lender: "barclays",
  async run(input, context) {
    const startedAt = new Date().toISOString();
    const session = await createBrowserSession(context);
    const page = session.page;
    await page.setViewportSize({ width: 584, height: 900 }).catch(() => undefined);
    page.setDefaultTimeout(context.timeoutMs);
    page.setDefaultNavigationTimeout(context.timeoutMs);

    try {
      await openBarclaysCalculator(page, context);
      await fillMortgageRequirements(page, input);
      await fillIncomeAndCommitments(page, input);
      await fillOtherMortgages(page, input);
      await waitForResult(page, context);
      await page.waitForTimeout(1000);

      const result = await extractResult(page);
      if (result.maximumBorrowing == null) {
        throw new Error("Result extraction failed: Barclays did not return a maximum borrowing amount.");
      }

      const screenshotPath = await captureEvidence(page, context, "barclays-success");
      return {
        lender: "barclays",
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
      const screenshotPath = await captureEvidence(page, context, "barclays-failed").catch(() => undefined);
      return {
        lender: "barclays",
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

async function openBarclaysCalculator(page: Page, context: RunContext): Promise<void> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await page.goto(BARCLAYS_CALCULATOR_URL, { waitUntil: "domcontentloaded" });
    const firstField = page.getByLabel("Estimated property price or value (optional)", { exact: true });
    await firstField.waitFor({ state: "visible", timeout: Math.min(context.timeoutMs, 15000) }).catch(() => undefined);
    if (await firstField.count() > 0) return;
  }

  throw new Error("Barclays calculator did not render the mortgage requirements step.");
}

interface BrowserSession {
  page: Page;
  close(): Promise<void>;
}

async function createBrowserSession(context: RunContext): Promise<BrowserSession> {
  if (context.executionMode === "attached") {
    if (!context.browserWSEndpoint) {
      throw new Error("Attached browser execution requires BROWSER_WS_ENDPOINT.");
    }

    const browser = await chromium.connectOverCDP(context.browserWSEndpoint);
    const browserContext = browser.contexts()[0] ?? await browser.newContext();
    const page = browserContext.pages()[0] ?? await browserContext.newPage();
    return {
      page,
      async close() {
        await browser.close();
      }
    };
  }

  const browser = await chromium.launch({ headless: context.headless });
  const browserContext = await browser.newContext({
    locale: "en-GB",
    timezoneId: "Europe/London",
    viewport: {
      width: 584,
      height: 900
    }
  });

  return {
    page: await browserContext.newPage(),
    async close() {
      await browser.close();
    }
  };
}

async function fillMortgageRequirements(page: Page, input: LenderReadyInput): Promise<void> {
  await fillCurrency(page, "Estimated property price or value (optional)", input.loan.propertyValue);
  await fillCurrency(page, "Total mortgage amount (optional)", input.loan.loanAmount);
  await chooseRadio(page, "Is this property in Scotland?", input.property.isInScotland ? "Yes" : "No");
  await chooseRadio(page, "Split this mortgage into multiple parts? Select 'Yes' to choose the payment terms for each part of the mortgage", "No");
  await chooseRadio(page, "Do you know the rate you’re recommending for client?", "No");
  await page.getByLabel("Years", { exact: true }).fill(String(input.case.termYears));
  await page.getByLabel("Months", { exact: true }).fill("0");
  await chooseRadio(page, "Select a repayment method", repaymentMethodLabels[input.case.repaymentType]);
  await clickNext(page);
  await ensureIncomeStepVisible(page);
}

async function fillIncomeAndCommitments(page: Page, input: LenderReadyInput): Promise<void> {
  await chooseLooseRadio(page, input.case.numberOfApplicants === 1 ? "Single" : "Joint");

  for (const applicant of input.applicants) {
    await fillApplicantIncome(page, applicant);
  }

  await fillCurrency(page, "Total outstanding credit card, store card and overdraft balances (if applicable)", input.outgoings.creditCardBalances + input.outgoings.overdraftBalances);
  await fillCurrency(page, "Any other monthly financial commitments including council tax (if applicable)", input.outgoings.otherMonthlyOutgoings + input.outgoings.monthlyLoanRepayments);
  await page.getByLabel("Number of financial dependants (if applicable)", { exact: true }).fill(String(input.household.dependants.length));
  await chooseRadio(page, "Does your client have an equity loan for the property in this application?", input.case.sharedOwnershipOrEquity ? "Yes" : "No");
  await clickNextOrCalculate(page);
}

async function fillApplicantIncome(page: Page, applicant: Applicant): Promise<void> {
  const employmentLabel = applicant.employment.isContractor
    ? "Fixed-term contractor"
    : employmentStatusLabels[applicant.employment.type];

  const employmentGroups = page.getByRole("radiogroup", { name: "Select your client's main employment status" });
  const employmentGroup = employmentGroups.nth(applicant.index - 1);
  await chooseLooseRadio(employmentGroup, employmentLabel);

  if (employmentLabel === "Fixed-term contractor") {
    await fillNthCurrency(page, "Annualised income before tax", 0, applicant.employment.annualGrossIncome ?? 0);
  } else if (employmentLabel === "Employed") {
    await fillFirstAvailableCurrencyAtIndex(
      page,
      [
        "Annual gross income and taxable allowance",
        "Annual income before tax",
        "Annual basic salary",
        "Gross annual basic salary"
      ],
      applicant.index - 1,
      applicant.employment.annualGrossIncome ?? 0
    );
    await chooseLooseRadioAtIndex(page, "Does your client receive any bonuses, overtime, or commission?", applicant.index - 1, hasVariableIncome(applicant) ? "Yes" : "No");
    if (hasVariableIncome(applicant)) {
      await chooseVariableIncomeFrequency(page, applicant);
      await fillOptionalCurrency(page, ["Annual bonuses, overtime, or commission", "Bonuses, overtime, or commission"], variableIncomeTotal(applicant));
    }
  } else if (employmentLabel === "Self-employed") {
    await selectFirstOption(page.getByLabel("Select the type of self-employment", { exact: true }).nth(selfEmploymentIndex(page, applicant.index)));
    await fillApplicantCurrencyAfterText(page, applicant.index, "Latest year", applicant.employment.netProfitCurrentYear ?? 0);
    await fillApplicantCurrencyAfterText(page, applicant.index, "Previous year", applicant.employment.netProfitPreviousYear ?? 0);
  }

  await fillNthCurrency(page, "Annual pension income (if applicable)", applicant.index - 1, applicant.employment.annualPensionIncome ?? 0);
  await fillNthCurrency(page, "Any other annual income (if applicable)", applicant.index - 1, totalOtherIncome(applicant));
}

async function fillOtherMortgages(page: Page, input: LenderReadyInput): Promise<void> {
  await ensureOtherMortgagesStepVisible(page);
  const residentialCommitments = input.outgoings.otherMortgageCommitments;
  const buyToLetProperties = input.otherProperties.filter((property) => property.isRental);
  const hasOtherMortgages = buyToLetProperties.length > 0 || residentialCommitments.length > 0;
  await chooseRadio(page, "Does your client have any existing mortgages?", hasOtherMortgages ? "Yes" : "No");

  if (hasOtherMortgages) {
    const rows = [
      ...buyToLetProperties.map((property) => ({
        type: "Buy-to-let or residential with permission-to-let",
        balance: property.currentBalance ?? 0,
        monthlyPayment: property.monthlyMortgagePayment
      })),
      ...residentialCommitments.map((commitment) => ({
        type: "Any other residential mortgage",
        balance: commitment.outstandingBalance,
        monthlyPayment: 0
      }))
    ];

    let buyToLetPaymentIndex = 0;
    let residentialIndex = 0;
    for (let index = 0; index < rows.length; index += 1) {
      if (index > 0) {
        await page.getByRole("button", { name: "Add another mortgage" }).click();
      }

      await chooseMortgageType(page, index, rows[index].type);
      if (rows[index].type === "Buy-to-let or residential with permission-to-let") {
        await fillOptionalCurrencyAtIndex(page, [
          "Monthly mortgage payment",
          "Monthly payment",
          "Monthly mortgage payments"
        ], buyToLetPaymentIndex, rows[index].monthlyPayment);
        buyToLetPaymentIndex += 1;
      } else {
        await fillOptionalCurrencyAtIndex(page, [
          "Outstanding mortgage balance",
          "Outstanding balance",
          "Mortgage balance",
          "Current mortgage balance"
        ], residentialIndex, rows[index].balance);
        await fillOptionalTextAtIndex(page, ["Years"], residentialIndex, String(residentialCommitments[residentialIndex]?.remainingTermYears ?? 0));
        await fillOptionalTextAtIndex(page, ["Months"], residentialIndex, "0");
        residentialIndex += 1;
      }
    }
  }

  await clickNextOrCalculate(page);
}

async function chooseMortgageType(page: Page, index: number, optionName: string): Promise<void> {
  const groups = page
    .getByRole("radiogroup")
    .filter({ hasText: "Buy-to-let or residential with permission-to-let" })
    .filter({ hasText: "Any other residential mortgage" });
  const group = groups.nth(index);
  const radio = group.getByRole("radio", { name: optionName });
  if (await radio.count() === 1) {
    await radio.click({ force: true });
    return;
  }

  const optionText = group.getByText(optionName, { exact: true });
  if (await optionText.count() > 0) {
    await optionText.first().click({ force: true });
    return;
  }

  throw new Error(`Unable to choose Barclays mortgage ${index + 1} type "${optionName}".`);
}

async function fillOtherMortgageSummary(page: Page, input: LenderReadyInput): Promise<void> {
  const totalMortgagePayments =
    input.outgoings.monthlyBuyToLetPayments +
    input.otherProperties
      .filter((property) => !property.isRental)
      .reduce((sum, property) => sum + property.monthlyMortgagePayment, 0);

  const totalMortgageBalances =
    input.otherProperties.reduce((sum, property) => sum + (property.currentBalance ?? 0), 0) +
    input.outgoings.otherMortgageCommitments.reduce((sum, commitment) => sum + commitment.outstandingBalance, 0);

  const totalRentalIncome = input.otherProperties.reduce((sum, property) => sum + (property.monthlyRent ?? 0), 0);

  await fillOptionalCurrency(page, [
    "Total monthly payments for all other mortgages",
    "Monthly payments for all other mortgages",
    "Total monthly mortgage payments",
    "Monthly mortgage payments"
  ], totalMortgagePayments);

  await fillOptionalCurrency(page, [
    "Total outstanding balances for all other mortgages",
    "Outstanding balance for all other mortgages",
    "Total outstanding mortgage balances",
    "Outstanding mortgage balance"
  ], totalMortgageBalances);

  await fillOptionalCurrency(page, [
    "Total monthly rental income",
    "Monthly rental income",
    "Rental income"
  ], totalRentalIncome);

  await fillOptionalText(page, [
    "Number of other mortgages",
    "How many other mortgages?"
  ], String(input.otherProperties.length + input.outgoings.otherMortgageCommitments.length));
}

async function waitForResult(page: Page, context: RunContext): Promise<void> {
  const resultTimeoutMs = Math.min(context.timeoutMs, 15000);
  await page.waitForFunction(
    () => {
      const text = document.body.innerText;
      return (
        /\bResult\b/i.test(text) ||
        /lend\s+them\s+up\s+to/i.test(text) ||
        /could\s+lend/i.test(text) ||
        /There are errors on this page/i.test(text)
      );
    },
    undefined,
    { timeout: resultTimeoutMs }
  ).catch(() => undefined);
}

async function ensureIncomeStepVisible(page: Page): Promise<void> {
  if (await page.getByRole("radio", { name: "Single" }).count() > 0) return;

  await page.getByRole("button", { name: "Back" }).click().catch(() => undefined);
  await page.getByRole("button", { name: "Next" }).click().catch(() => undefined);
  await page.getByRole("radio", { name: "Single" }).waitFor({ state: "visible", timeout: 10000 }).catch(() => undefined);

  if (await page.getByRole("radio", { name: "Single" }).count() === 0) {
    throw new Error("Barclays Step 2 did not render income and commitments fields.");
  }
}

async function ensureOtherMortgagesStepVisible(page: Page): Promise<void> {
  const text = page.getByText("Other mortgages", { exact: true });
  await text.waitFor({ state: "visible", timeout: 10000 }).catch(() => undefined);
}

async function extractResult(page: Page): Promise<{
  maximumBorrowing: number | null;
  monthlyPayment: number | null;
  messages: string[];
}> {
  const text = await page.locator("body").innerText();
  const maximumBorrowing = extractMaximumCurrency(text);

  return {
    maximumBorrowing,
    monthlyPayment: null,
    messages: text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .slice(0, 25)
  };
}

async function chooseRadio(scope: Page | Locator, groupName: string, optionName: string): Promise<void> {
  const group = scope.getByRole("radiogroup", { name: groupName });
  const radio = group.getByRole("radio", { name: optionName });
  if (await radio.count() === 1) {
    await radio.click({ force: true });
    return;
  }

  await chooseLooseRadio(group, optionName);
}

async function chooseLooseRadio(scope: Page | Locator, optionName: string): Promise<void> {
  const radio = scope.getByRole("radio", { name: optionName });
  const count = await radio.count();
  if (count === 1) {
    await radio.click({ force: true });
    return;
  }

  const text = scope.getByText(optionName, { exact: true });
  if (await text.count() >= 1) {
    await text.first().click({ force: true });
    return;
  }

  throw new Error(`Unable to choose Barclays radio option "${optionName}".`);
}

async function chooseLooseRadioAtIndex(page: Page, groupName: string, index: number, optionName: string): Promise<void> {
  const group = page.getByRole("radiogroup", { name: groupName }).nth(index);
  if (await group.count() > 0) {
    await chooseLooseRadio(group, optionName);
    return;
  }

  await chooseLooseRadio(page, optionName);
}

async function chooseVariableIncomeFrequency(page: Page, applicant: Applicant): Promise<void> {
  if ((applicant.employment.annualOvertime ?? 0) > 0 || (applicant.employment.annualCommission ?? 0) > 0) {
    await checkFirstAvailable(page, ["Weekly, fortnightly, or monthly"]);
    return;
  }

  if ((applicant.employment.annualBonus ?? 0) > 0) {
    await checkFirstAvailable(page, ["Two-monthly, quarterly, half-yearly or yearly"]);
  }
}

async function checkFirstAvailable(scope: Page | Locator, labels: string[]): Promise<void> {
  for (const label of labels) {
    const checkbox = scope.getByRole("checkbox", { name: label });
    if (await checkbox.count() > 0) {
      await checkbox.first().check({ force: true });
      return;
    }
  }
}

async function fillCurrency(scope: Page | Locator, label: string, value: number): Promise<void> {
  await scope.getByLabel(label, { exact: true }).fill(currencyValue(value));
}

async function fillNthCurrency(page: Page, label: string, index: number, value: number): Promise<void> {
  const field = page.getByLabel(label, { exact: true }).nth(index);
  await field.fill(currencyValue(value));
}

async function fillFirstAvailableCurrency(scope: Page | Locator, labels: string[], value: number): Promise<void> {
  for (const label of labels) {
    const field = scope.getByLabel(label, { exact: true });
    if (await field.count() > 0) {
      await field.first().fill(currencyValue(value));
      return;
    }
  }

  throw new Error(`Unable to find Barclays currency field: ${labels.join(", ")}.`);
}

async function fillFirstAvailableCurrencyAtIndex(scope: Page | Locator, labels: string[], index: number, value: number): Promise<void> {
  for (const label of labels) {
    const field = scope.getByLabel(label, { exact: true });
    if (await field.count() > index) {
      await field.nth(index).fill(currencyValue(value));
      return;
    }
  }

  throw new Error(`Unable to find Barclays currency field at index ${index}: ${labels.join(", ")}.`);
}

async function fillApplicantCurrencyAfterText(page: Page, applicantIndex: 1 | 2, text: string, value: number): Promise<void> {
  const field = page.locator(
    `xpath=//*[normalize-space(.)="Applicant ${applicantIndex}"]/following::*[normalize-space(.)="${text}"][1]/following::input[1]`
  );
  if (await field.count() === 0) {
    throw new Error(`Unable to find Barclays currency field after text "${text}" for applicant ${applicantIndex}.`);
  }

  await field.first().fill(currencyValue(value));
}

async function fillOptionalCurrency(scope: Page | Locator, labels: string[], value: number): Promise<void> {
  for (const label of labels) {
    const field = scope.getByLabel(label, { exact: true });
    if (await field.count() > 0) {
      await field.first().fill(currencyValue(value));
      return;
    }
  }
}

async function fillOptionalCurrencyAtIndex(scope: Page | Locator, labels: string[], index: number, value: number): Promise<void> {
  for (const label of labels) {
    const field = scope.getByLabel(label, { exact: true });
    if (await field.count() > index) {
      await field.nth(index).fill(currencyValue(value));
      return;
    }
  }
}

async function fillOptionalText(scope: Page | Locator, labels: string[], value: string): Promise<void> {
  for (const label of labels) {
    const field = scope.getByLabel(label, { exact: true });
    if (await field.count() > 0) {
      await field.first().fill(value);
      return;
    }
  }
}

async function fillOptionalTextAtIndex(scope: Page | Locator, labels: string[], index: number, value: string): Promise<void> {
  for (const label of labels) {
    const field = scope.getByLabel(label, { exact: true });
    if (await field.count() > index) {
      await field.nth(index).fill(value);
      return;
    }
  }
}

async function selectFirstOption(select: Locator): Promise<void> {
  if (await select.count() === 1) {
    await select.selectOption({ index: 1 });
  }
}

async function clickNext(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Next" }).click();
}

async function clickNextOrCalculate(page: Page): Promise<void> {
  const calculate = page.getByRole("button", { name: "Calculate" });
  if (await calculate.count() > 0) {
    await page.waitForTimeout(2000);
    await calculate.click();
    return;
  }

  await clickNext(page);
}

function totalOtherIncome(applicant: Applicant): number {
  return applicant.otherIncome.reduce((sum, income) => sum + income.annualAmount, applicant.employment.otherAnnualPensionIncome ?? 0);
}

function hasVariableIncome(applicant: Applicant): boolean {
  return variableIncomeTotal(applicant) > 0;
}

function variableIncomeTotal(applicant: Applicant): number {
  return (
    (applicant.employment.annualOvertime ?? 0) +
    (applicant.employment.annualBonus ?? 0) +
    (applicant.employment.annualCommission ?? 0)
  );
}

function currencyValue(value: number): string {
  return String(Math.round(value));
}

function extractMaximumCurrency(text: string): number | null {
  const lendUpTo = text.match(/lend\s+them\s+up\s+to\s+\u00a3\s*([0-9][0-9,]*)/i);
  if (lendUpTo) return Number(lendUpTo[1]?.replace(/,/g, ""));

  const couldLend = text.match(/could\s+lend[^£]*\u00a3\s*([0-9][0-9,]*)/i);
  if (couldLend) return Number(couldLend[1]?.replace(/,/g, ""));

  const matches = [...text.matchAll(/\u00a3\s*([0-9][0-9,]*)/g)];
  if (matches.length === 0) return null;
  return Math.max(...matches.map((match) => Number(match[1]?.replace(/,/g, ""))));
}

function selfEmploymentIndex(_page: Page, applicantIndex: 1 | 2): number {
  return applicantIndex - 1;
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
  if (message.includes("result")) return "result_extraction";
  if (message.includes("calculate")) return "calculate";
  if (message.includes("unavailable") || message.includes("problem")) return "lender_unavailable";
  return "field_fill";
}
