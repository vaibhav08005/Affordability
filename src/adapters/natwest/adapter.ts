import { chromium, type Locator, type Page } from "playwright";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { AffordabilityResult, Applicant, LenderReadyInput } from "../../domain/contracts.js";
import type { LenderAdapter, RunContext } from "../types.js";
import {
  customerTypeLabels,
  employmentStatusLabels,
  epcLabels,
  mortgagePurposeLabels,
  NATWEST_CALCULATOR_URL,
  repaymentTypeLabels,
  selfEmploymentLabels,
  tenureLabels
} from "./mapping.js";

export const natwestAdapter: LenderAdapter = {
  lender: "natwest",
  async run(input, context) {
    const startedAt = new Date().toISOString();
    const session = await createBrowserSession(context);
    const page = session.page;
    page.setDefaultTimeout(context.timeoutMs);
    page.setDefaultNavigationTimeout(context.timeoutMs);

    try {
      await openNatWestCalculator(page, context);
      await fillNatWestCalculator(page, input);
      await waitBeforeCalculate(page);
      await clickFirstAvailableButton(page, ["Calculate", "Get results", "See how much they could borrow"]);
      await waitForResult(page, context);

      const result = await extractResult(page);
      if (result.maximumBorrowing == null) {
        const validationMessages = result.messages.filter((message) => /please|minimum|criteria|error|required|select|enter/i.test(message));
        if (validationMessages.length > 0) {
          throw new Error(`NatWest did not return a maximum borrowing amount. Validation messages: ${validationMessages.slice(0, 5).join(" | ")}`);
        }

        throw new Error("Result extraction failed: NatWest did not return a maximum borrowing amount.");
      }

      const screenshotPath = await captureEvidence(page, context, "natwest-success");
      return {
        lender: "natwest",
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
      const screenshotPath = await captureEvidence(page, context, "natwest-failed").catch(() => undefined);
      return {
        lender: "natwest",
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
      width: 1365,
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

async function openNatWestCalculator(page: Page, context: RunContext): Promise<void> {
  await page.goto(NATWEST_CALCULATOR_URL, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1000);
  await acceptCookies(page);
  await page.waitForLoadState("domcontentloaded").catch(() => undefined);
  await page.locator("body").waitFor({ state: "visible", timeout: Math.min(context.timeoutMs, 15000) });
}

async function fillNatWestCalculator(page: Page, input: LenderReadyInput): Promise<void> {
  await chooseNatWestApplicantCount(page, input.case.numberOfApplicants);
  await chooseFirstAvailableOption(page, mortgagePurposeLabels[input.case.mortgagePurpose]);
  await chooseFirstAvailableOption(page, customerTypeLabels[input.case.customerType]);
  await selectFirstAvailableOption(page, ["Repayment method", "Repayment type"], repaymentTypeLabels[input.case.repaymentType]);
  await chooseFirstAvailableOption(page, input.property.isInScotland ? ["Yes"] : ["No"], ["Is the property in Scotland?", "Scotland"]);
  await chooseFirstAvailableOption(page, tenureLabels[input.property.tenure], ["Property tenure", "Tenure"]);
  await selectFirstAvailableOption(page, ["Property EPC rating", "EPC rating"], epcLabels[input.property.epcRating]);

  await fillFirstAvailableText(page, ["Loan to value", "Loan to value in %"], ltvValue(input));
  await fillFirstAvailableCurrency(page, ["Property value", "Purchase price", "Property purchase price", "Estimated property value"], input.loan.propertyValue);
  await fillFirstAvailableCurrency(page, ["Loan amount", "Mortgage amount", "Amount to borrow", "Required loan amount", "Capital and Interest"], input.loan.loanAmount);
  await fillTermYears(page, input.case.termYears);

  if (input.case.hasInterestOnly) {
    await fillFirstAvailableCurrency(page, ["Interest only amount", "Interest-only amount", "Interest only loan amount"], input.case.interestOnlyLoanAmount ?? 0);
    await fillFirstAvailableCurrency(page, ["Current Value Of Interest Only Repayment Strategy", "Current value of interest only repayment strategy"], input.case.interestOnlyLoanAmount ?? input.loan.loanAmount);
    await selectFirstAvailableOption(page, ["Is Repayment Strategy Sale Of Main Residence?", "Repayment Strategy Sale Of Main Residence"], ["No"]);
  }

  for (const applicant of input.applicants) {
    await fillApplicant(page, applicant, input.property.isInScotland);
  }

  await selectFirstAvailableOption(page, ["Total number of dependants", "Number of dependants", "Financial dependants", "Dependants"], [String(input.household.dependants.length)]);
  await fillFirstAvailableCurrency(page, ["Credit card balances", "Credit/store card balances", "Total credit card balances", "Total credit card/store card/overdraft/mail order/budget account balance"], input.outgoings.creditCardBalances + input.outgoings.overdraftBalances);
  await fillFirstAvailableCurrency(page, ["Monthly loan repayments", "Loan commitments", "Monthly credit commitments", "Monthly loan payments"], input.outgoings.monthlyLoanRepayments);
  await fillFirstAvailableCurrency(page, ["Other monthly outgoings", "Other committed expenditure", "Other financial commitments", "Maintenance / other committed expenditure"], input.outgoings.otherMonthlyOutgoings);
  await fillFirstAvailableCurrency(page, ["Monthly Buy to Let mortgage payments", "Buy to Let mortgage payments", "Monthly BTL payments"], input.outgoings.monthlyBuyToLetPayments);
  await selectFirstAvailableOption(page, ["Are there any personal changes that will affect the customers ability to pay this mortgage over the next 5 years"], ["No"]);

  await fillOtherMortgages(page, input);
}

async function fillApplicant(page: Page, applicant: Applicant, isInScotland: boolean): Promise<void> {
  const scope = await applicantScope(page, applicant.index);
  await selectApplicantResidence(page, applicant.index, isInScotland);
  await chooseFirstAvailableOption(scope, employmentStatusLabels[applicant.employment.type]);

  if (applicant.employment.type === "employed") {
    await fillFirstAvailableCurrency(page, [`Applicant ${applicant.index} main income annual gross`, "Annual basic income", "Gross annual income", "Annual gross income", "Basic salary"], applicant.employment.annualGrossIncome ?? 0);
    await fillFirstAvailableCurrency(page, [`Applicant ${applicant.index} gross annual guaranteed bonus / discretionary bonus paid monthly or quarterly`, "Annual overtime", "Overtime"], (applicant.employment.annualOvertime ?? 0) + (applicant.employment.annualCommission ?? 0));
    await fillFirstAvailableCurrency(page, [`Applicant ${applicant.index} gross annual discretionary bonus paid half yearly or annually`, "Annual bonus", "Bonus"], applicant.employment.annualBonus ?? 0);
    await fillFirstAvailableCurrency(scope, ["Annual commission", "Commission"], applicant.employment.annualCommission ?? 0);
  }

  if (applicant.employment.type === "self_employed") {
    if (applicant.employment.businessType) {
      await selectFirstAvailableOption(scope, ["Self employment type", "Type of self-employment"], selfEmploymentLabels[applicant.employment.businessType]);
    }
    await fillFirstAvailableCurrency(page, [`Applicant ${applicant.index} main income annual gross`, "Latest year", "Current year", "Net profit current year", "Annual income before tax"], applicant.employment.netProfitCurrentYear ?? 0);
    await fillFirstAvailableCurrency(scope, ["Previous year", "Net profit previous year"], applicant.employment.netProfitPreviousYear ?? 0);
  }

  await fillFirstAvailableCurrency(page, [`Applicant ${applicant.index} pension contributions on completion of this mortgage`, "Annual pension income", "Pension income"], applicant.employment.annualPensionIncome ?? 0);
  await fillFirstAvailableCurrency(scope, ["Other annual pension income", "Other pension income"], applicant.employment.otherAnnualPensionIncome ?? 0);
  await fillFirstAvailableCurrency(scope, ["Other annual income", "Other income"], totalOtherIncome(applicant));
}

async function fillOtherMortgages(page: Page, input: LenderReadyInput): Promise<void> {
  const hasOtherMortgages = input.otherProperties.length > 0 || input.outgoings.otherMortgageCommitments.length > 0;
  await chooseFirstAvailableOption(page, hasOtherMortgages ? ["Yes"] : ["No"], ["Other mortgages", "Existing mortgages", "Other properties"]);

  const totalOtherMortgagePayments =
    input.outgoings.monthlyBuyToLetPayments +
    input.otherProperties.reduce((sum, property) => sum + property.monthlyMortgagePayment, 0);
  const totalOtherMortgageBalances =
    input.otherProperties.reduce((sum, property) => sum + (property.currentBalance ?? 0), 0) +
    input.outgoings.otherMortgageCommitments.reduce((sum, commitment) => sum + commitment.outstandingBalance, 0);

  await fillFirstAvailableCurrency(page, ["Other mortgage monthly payments", "Total monthly payments for other mortgages"], totalOtherMortgagePayments);
  await fillFirstAvailableCurrency(page, ["Other mortgage balances", "Total outstanding balances for other mortgages"], totalOtherMortgageBalances);
  await fillFirstAvailableText(page, ["Number of other mortgages", "Number of existing mortgages"], String(input.otherProperties.length + input.outgoings.otherMortgageCommitments.length));
}

async function applicantScope(page: Page, index: 1 | 2): Promise<Page | Locator> {
  const heading = page.getByRole("heading", { name: new RegExp(`Applicant\\s*${index}`, "i") });
  if (await heading.count() === 0) return page;
  const section = heading.first().locator("xpath=ancestor::*[self::section or self::fieldset or self::div][1]");
  return await section.count() > 0 ? section : page;
}

async function chooseNatWestApplicantCount(page: Page, count: 1 | 2): Promise<void> {
  const label = count === 1 ? "Sole" : "Joint";
  const radio = page.locator(`input[type="radio"][value="${label}"], input[type="radio"][aria-label="${label}"]`);
  if (await radio.count() > 0) {
    const target = radio.first();
    await target.click({ force: true });
    if (await applicantCountSelected(page, count)) return;

    const id = await target.getAttribute("id");
    if (id) {
      const labelForInput = page.locator(`label[for="${cssAttributeText(id)}"]`);
      if (await labelForInput.count() > 0) {
        await labelForInput.first().click({ force: true });
        if (await applicantCountSelected(page, count)) return;
      }
    }

    const clickableContainer = target.locator("xpath=ancestor::*[self::label or self::div][1]");
    if (await clickableContainer.count() > 0) {
      await clickableContainer.first().click({ force: true });
      if (await applicantCountSelected(page, count)) return;
    }
  }

  const labelText = page.getByText(new RegExp(`^${label}$`, "i"));
  if (await labelText.count() > 0) {
    await labelText.first().click({ force: true });
    await page.waitForTimeout(500);
    return;
  }

  await chooseFirstAvailableOption(page, count === 1 ? ["Sole", "Single", "One applicant"] : ["Joint", "Two applicants"]);
  await applicantCountSelected(page, count);
}

async function applicantCountSelected(page: Page, count: 1 | 2): Promise<boolean> {
  await page.waitForTimeout(500);
  if (count === 1) {
    return true;
  }

  const applicantTwoField = page.getByText(/Applicant 2/i);
  return await applicantTwoField.count() > 0;
}

async function selectApplicantResidence(page: Page, applicantIndex: 1 | 2, isInScotland: boolean): Promise<void> {
  const words = applicantIndex === 1 ? ["One", "1"] : ["Two", "2"];
  const residenceOptions = isInScotland
    ? ["Scotland"]
    : ["England & Wales", "England and Wales", "England/Wales", "England", "Wales"];
  for (const word of words) {
    const select = page.locator(
      `select[id*="applicant${word}ResideAfterCompletion" i], select[name*="applicant${word}ResideAfterCompletion" i]`
    );
    if (await select.count() > 0) {
      await selectMatchingOption(select.first(), residenceOptions);
      return;
    }
  }

  await selectFirstAvailableOption(
    page,
    [`Applicant ${applicantIndex} on completion of the mortgage where will the applicant`],
    residenceOptions
  );
}

async function acceptCookies(page: Page): Promise<void> {
  await clickFirstAvailableButton(page, ["Allow All Cookies", "Accept all cookies", "Accept cookies", "Accept"]).catch(() => undefined);
}

async function waitBeforeCalculate(page: Page): Promise<void> {
  await page.waitForTimeout(1000);
}

async function waitForResult(page: Page, context: RunContext): Promise<void> {
  await page.waitForFunction(
    () => {
      const text = document.body.innerText;
      return (
        /maximum\s+(borrowing|loan|amount)|could\s+(borrow|lend)|may\s+be\s+able\s+to\s+borrow|we\s+could\s+lend|result/i.test(text) ||
        /please\s+(enter|select)|required|must|error/i.test(text)
      );
    },
    undefined,
    { timeout: Math.min(context.timeoutMs, 8000) }
  ).catch(() => undefined);
  await page.waitForTimeout(500);
}

async function extractResult(page: Page): Promise<{
  maximumBorrowing: number | null;
  monthlyPayment: number | null;
  messages: string[];
}> {
  const text = await page.locator("body").innerText();
  return {
    maximumBorrowing: extractMaximumCurrency(text),
    monthlyPayment: extractMonthlyPayment(text),
    messages: text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .slice(0, 30)
  };
}

async function chooseFirstAvailableOption(scope: Page | Locator, options: string[], groupHints: string[] = []): Promise<void> {
  for (const groupHint of groupHints) {
    const group = scope.getByRole("group", { name: new RegExp(escapeRegExp(groupHint), "i") });
    if (await group.count() > 0 && await chooseWithinScope(group.first(), options)) return;
    const radioGroup = scope.getByRole("radiogroup", { name: new RegExp(escapeRegExp(groupHint), "i") });
    if (await radioGroup.count() > 0 && await chooseWithinScope(radioGroup.first(), options)) return;
  }

  if (await chooseWithinScope(scope, options)) return;
}

async function chooseWithinScope(scope: Page | Locator, options: string[]): Promise<boolean> {
  for (const option of options) {
    const radio = scope.getByRole("radio", { name: new RegExp(`^${escapeRegExp(option)}$`, "i") });
    if (await radio.count() > 0) {
      await radio.first().click({ force: true });
      return true;
    }

    const checkbox = scope.getByRole("checkbox", { name: new RegExp(`^${escapeRegExp(option)}$`, "i") });
    if (await checkbox.count() > 0) {
      await checkbox.first().check({ force: true });
      return true;
    }

    const text = scope.getByText(new RegExp(`^${escapeRegExp(option)}$`, "i"));
    const count = await text.count();
    for (let index = 0; index < count; index += 1) {
      const candidate = text.nth(index);
      if (await candidate.isVisible().catch(() => false)) {
        await candidate.click({ force: true });
        return true;
      }
    }
  }

  return false;
}

async function fillFirstAvailableCurrency(scope: Page | Locator, labels: string[], value: number): Promise<void> {
  await fillFirstAvailableText(scope, labels, currencyValue(value));
}

async function fillFirstAvailableText(scope: Page | Locator, labels: string[], value: string): Promise<void> {
  for (const label of labels) {
    const field = scope.getByLabel(new RegExp(escapeRegExp(label), "i"));
    const count = await field.count();
    for (let index = 0; index < count; index += 1) {
      const candidate = field.nth(index);
      if (await isFillableField(candidate)) {
        await candidate.fill(value);
        return;
      }
    }

    const inputByPlaceholder = scope.getByPlaceholder(new RegExp(escapeRegExp(label), "i"));
    const placeholderCount = await inputByPlaceholder.count();
    for (let index = 0; index < placeholderCount; index += 1) {
      const candidate = inputByPlaceholder.nth(index);
      if (await isFillableField(candidate)) {
        await candidate.fill(value);
        return;
      }
    }

    const inputByTestId = scope.locator(`input[data-testid*="${cssAttributeText(label)}" i]`);
    if (await inputByTestId.count() > 0 && await isFillableField(inputByTestId.first())) {
      await inputByTestId.first().fill(value);
      return;
    }

    const afterLabel = scope.locator(`xpath=//*[contains(normalize-space(.), "${xpathLiteralText(label)}")]/following::input[1]`);
    if (await afterLabel.count() > 0 && await afterLabel.first().isVisible().catch(() => false)) {
      await afterLabel.first().fill(value);
      return;
    }
  }
}

async function fillTermYears(page: Page, termYears: number): Promise<void> {
  const years = page.getByPlaceholder(/^Years$/i);
  if (await years.count() > 0) {
    await years.first().fill(String(termYears));
    await fillTermMonths(page);
    return;
  }

  const termField = page.locator('input[data-testid*="mortgageTerm" i], input[name*="mortgageTerm" i]').first();
  if (await termField.count() > 0) {
    await termField.fill(String(termYears));
    await fillTermMonths(page);
    return;
  }

  await fillFirstAvailableText(page, ["Term of mortgage", "Mortgage term", "Loan term"], String(termYears));
  await fillTermMonths(page);
}

async function fillTermMonths(page: Page): Promise<void> {
  const months = page.getByPlaceholder(/^Months$/i);
  if (await months.count() > 0) {
    await months.first().fill("0");
  }
}

async function isEditableField(locator: Locator): Promise<boolean> {
  return locator.evaluate((node) => {
    const element = node as HTMLElement;
    const tagName = element.tagName.toLowerCase();
    return tagName === "input" || tagName === "textarea" || tagName === "select" || element.isContentEditable;
  }).catch(() => false);
}

async function isFillableField(locator: Locator): Promise<boolean> {
  return locator.evaluate((node) => {
    const element = node as HTMLElement;
    const tagName = element.tagName.toLowerCase();
    return tagName === "input" || tagName === "textarea" || element.isContentEditable;
  }).catch(() => false);
}

async function selectFirstAvailableOption(scope: Page | Locator, labels: string[], optionLabels: string[]): Promise<void> {
  for (const label of labels) {
    const select = scope.getByLabel(new RegExp(escapeRegExp(label), "i"));
    if (await select.count() > 0) {
      const selectField = select.first();
      if (await selectMatchingOption(selectField, optionLabels)) return;
    }
  }

  await chooseFirstAvailableOption(scope, optionLabels, labels);
}

async function selectMatchingOption(selectField: Locator, optionLabels: string[]): Promise<boolean> {
  const options = await selectField.locator("option").evaluateAll((nodes) =>
    nodes.map((node, index) => ({
      index,
      label: node.textContent?.trim() ?? "",
      value: (node as HTMLOptionElement).value
    }))
  );

  for (const optionLabel of optionLabels) {
    const option = options.find((candidate) => {
      const label = candidate.label.toLowerCase();
      const wanted = optionLabel.toLowerCase();
      return label === wanted || label.includes(wanted);
    });
    if (option) {
      await selectField.selectOption(option.value ? { value: option.value } : { index: option.index });
      return true;
    }
  }

  const firstRealOption = options.find((option) => option.index > 0 && option.value);
  if (firstRealOption) {
    await selectField.selectOption({ value: firstRealOption.value });
    return true;
  }

  return false;
}

async function clickFirstAvailableButton(page: Page, labels: string[]): Promise<void> {
  for (const label of labels) {
    const button = page.getByRole("button", { name: new RegExp(escapeRegExp(label), "i") });
    if (await button.count() > 0) {
      await button.first().click({ force: true });
      return;
    }

    const textButton = page.getByText(new RegExp(`^${escapeRegExp(label)}$`, "i"));
    if (await textButton.count() > 0 && await textButton.first().isVisible().catch(() => false)) {
      await textButton.first().click({ force: true });
      return;
    }
  }
}

function totalOtherIncome(applicant: Applicant): number {
  return applicant.otherIncome.reduce((sum, income) => sum + income.annualAmount, 0);
}

function currencyValue(value: number): string {
  return String(Math.round(value));
}

function ltvValue(input: LenderReadyInput): string {
  if (input.loan.propertyValue <= 0) return "0";
  return ((input.loan.loanAmount / input.loan.propertyValue) * 100).toFixed(2);
}

function extractMaximumCurrency(text: string): number | null {
  const focusedPatterns = [
    /(?:maximum|could|can|able to|lend|borrow)[^£]{0,80}£\s*([0-9][0-9,]*)/i,
    /£\s*([0-9][0-9,]*)[^.\n]{0,80}(?:maximum|borrow|lend|afford)/i
  ];

  for (const pattern of focusedPatterns) {
    const match = text.match(pattern);
    if (match?.[1]) return Number(match[1].replace(/,/g, ""));
  }

  const matches = [...text.matchAll(/£\s*([0-9][0-9,]*)/g)];
  if (matches.length === 0) return null;
  return Math.max(...matches.map((match) => Number(match[1]?.replace(/,/g, ""))));
}

function extractMonthlyPayment(text: string): number | null {
  const match = text.match(/monthly[^£]{0,80}£\s*([0-9][0-9,]*)/i);
  return match?.[1] ? Number(match[1].replace(/,/g, "")) : null;
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
  if (message.includes("unavailable") || message.includes("problem")) return "lender_unavailable";
  return "field_fill";
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function xpathLiteralText(value: string): string {
  return value.replace(/"/g, '\\"');
}

function cssAttributeText(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}
