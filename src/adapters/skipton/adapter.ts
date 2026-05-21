import type { Page } from "playwright";
import type { AffordabilityResult, Applicant, LenderReadyInput } from "../../domain/contracts.js";
import type { LenderAdapter, RunContext } from "../types.js";
import { captureEvidence, categorizeError, clickFirstAvailableButton, createBrowserSession, resultMessages } from "../shared/browser.js";
import {
  employmentTypeRadioIndex,
  regionValues,
  repaymentTypeRadioIndex,
  selfEmploymentIncomeMode,
  SKIPTON_CALCULATOR_URL
} from "./mapping.js";

export const skiptonAdapter: LenderAdapter = {
  lender: "skipton",
  async run(input, context) {
    const startedAt = new Date().toISOString();
    const session = await createBrowserSession(context, SKIPTON_CALCULATOR_URL);
    const page = session.page;
    page.setDefaultTimeout(context.timeoutMs);
    page.setDefaultNavigationTimeout(context.timeoutMs);

    try {
      await openSkiptonCalculator(page, context);
      await fillSkiptonCalculator(page, input);
      await waitForResult(page, context);

      const result = await extractResult(page);
      if (result.maximumBorrowing == null) {
        throw new Error("Result extraction failed: Skipton did not return a maximum loan amount on the Results step.");
      }

      const screenshotPath = await captureEvidence(page, context, "skipton-success");
      return {
        lender: "skipton",
        status: "success",
        maximumBorrowing: result.maximumBorrowing,
        monthlyPayment: null,
        messages: result.messages,
        evidence: { screenshotPath, timestamp: startedAt }
      };
    } catch (error) {
      const screenshotPath = await captureEvidence(page, context, "skipton-failed").catch(() => undefined);
      return {
        lender: "skipton",
        status: "failed",
        maximumBorrowing: null,
        monthlyPayment: null,
        messages: [],
        evidence: { screenshotPath, timestamp: startedAt },
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

async function openSkiptonCalculator(page: Page, context: RunContext): Promise<void> {
  await page.goto(SKIPTON_CALCULATOR_URL, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1000);
  await clickFirstAvailableButton(page, ["Essential only", "Accept cookies"]).catch(() => undefined);
  const bodyText = await page.locator("body").innerText().catch(() => "");
  if (/Affordability Service Unavailable|service is currently unavailable/i.test(bodyText)) {
    throw new Error("Skipton affordability service unavailable.");
  }
  await page.locator("#MainContent_btnNext").waitFor({ state: "visible", timeout: Math.min(context.timeoutMs, 20000) });
}

async function fillSkiptonCalculator(page: Page, input: LenderReadyInput): Promise<void> {
  await fillApplicationDetails(page, input);
  await next(page, "CONTINUE TO STEP 2");
  await fillApplicantDetails(page, input);
  await next(page, "CONTINUE TO STEP 3");
  await fillIncome(page, input);
  await next(page, "CONTINUE TO STEP 4");
  await fillExpenditure(page, input);
  await calculate(page);
}

async function fillApplicationDetails(page: Page, input: LenderReadyInput): Promise<void> {
  await checkRadioById(page, `MainContent_rblNumberOfApplicants_${input.case.numberOfApplicants - 1}`);
  await setInputValueById(page, "MainContent_txtNoOfAdultDependants", String(adultDependants(input)));
  await setInputValueById(page, "MainContent_txtNoOfChildDependants", String(childDependants(input)));
  await setInputValueById(page, "MainContent_txtPurchasePrice", money(input.loan.propertyValue));
  await setInputValueById(page, "MainContent_txtLoanAmount", money(input.loan.loanAmount));
  await setInputValueById(page, "MainContent_txtProductInterestRate", "5.2");
  await checkRadioById(page, "MainContent_rblNewBuild_1");
  await checkRadioById(page, "MainContent_rblWillTakeLongTermFixedProduct_0");
  await checkRadioById(page, `MainContent_rblRepaymentType_${repaymentTypeRadioIndex[input.case.repaymentType]}`);
  if (input.case.repaymentType === "part_and_part") {
    await setInputValueById(page, "MainContent_txtInterestOnlyAmount", money(input.case.interestOnlyLoanAmount ?? 0));
  }
  await setInputValueById(page, "MainContent_txtTermYears", String(input.case.termYears));
  await setInputValueById(page, "MainContent_txtTermMonths", "0");
  await setSelectValueById(page, "MainContent_ddlRegion", input.property.isInScotland ? regionValues.scotland : regionValues.default);
  await checkRadioById(page, "MainContent_rblMainResidence_0");
  await setInputValueById(page, "MainContent_txtFeeAmount", "0");
}

async function fillApplicantDetails(page: Page, input: LenderReadyInput): Promise<void> {
  for (const applicant of input.applicants) {
    const index = applicant.index - 1;
    await checkRadioById(page, `MainContent_rptApplicants_rblFirstTimeBuyer_${index}_${input.case.customerType === "first_time_buyer" ? 0 : 1}_${index}`);
    const employmentIndex = applicant.employment.isContractor
      ? employmentTypeRadioIndex.other
      : employmentTypeRadioIndex[applicant.employment.type];
    await checkRadioById(page, `MainContent_rptApplicants_rblEmploymentTypes_${index}_${employmentIndex}_${index}`);
    await checkRadioById(page, `MainContent_rptApplicants_rblresidentialStatus_${index}_${input.case.customerType === "first_time_buyer" ? 1 : 0}_${index}`);
  }
}

async function fillIncome(page: Page, input: LenderReadyInput): Promise<void> {
  for (const applicant of input.applicants) {
    await fillApplicantIncome(page, applicant);
  }
}

async function fillApplicantIncome(page: Page, applicant: Applicant): Promise<void> {
  const suffix = String(applicant.index - 1);
  if (applicant.employment.type === "pension") {
    await setInputValueById(page, `MainContent_txtIncome000012${suffix}`, money(totalPensionIncome(applicant)));
  } else if (applicant.employment.type === "self_employed") {
    const latestProfit = applicant.employment.netProfitCurrentYear ?? applicant.employment.annualGrossIncome ?? 0;
    const mode = selfEmploymentIncomeMode[applicant.employment.businessType ?? "sole_trader"];
    await setInputValueById(page, `MainContent_txtIncome000007${suffix}`, money(mode === "profit" ? latestProfit : 0));
    await setInputValueById(page, `MainContent_txtIncome000008${suffix}`, money(mode === "director" ? latestProfit : 0));
    await setInputValueById(page, `MainContent_txtIncome000009${suffix}`, money(mode === "director" ? applicant.employment.annualGrossIncome ?? latestProfit : 0));
  } else {
    const basic = applicant.employment.isContractor
      ? 0
      : applicant.employment.annualGrossIncome ?? 0;
    await setInputValueById(page, `MainContent_txtIncome000001${suffix}`, money(basic));
  }

  const hasAdditionalIncome =
    applicant.employment.isContractor ||
    variableIncome(applicant) > 0 ||
    benefitsIncome(applicant) > 0 ||
    maintenanceIncome(applicant) > 0 ||
    rentalIncome(applicant) > 0 ||
    guaranteedOtherIncome(applicant) > 0 ||
    (applicant.employment.type !== "pension" && totalPensionIncome(applicant) > 0);
  await checkRadioById(page, `MainContent_rblAdditionalIncome${suffix}_${hasAdditionalIncome ? 0 : 1}`);
  if (hasAdditionalIncome) {
    await setInputValueById(page, `MainContent_txtIncome2${suffix}`, money((applicant.employment.annualBonus ?? 0) + guaranteedOtherIncome(applicant)));
    await setInputValueById(page, `MainContent_txtIncome3${suffix}`, money((applicant.employment.annualOvertime ?? 0) + (applicant.employment.annualCommission ?? 0)));
    if (applicant.employment.type !== "self_employed") {
      await setInputValueById(page, `MainContent_txtIncome4${suffix}`, "0");
      await setInputValueById(page, `MainContent_txtIncome5${suffix}`, "0");
      await setInputValueById(page, `MainContent_txtIncome6${suffix}`, "0");
    }
    await setInputValueById(page, `MainContent_txtIncome7${suffix}`, money(benefitsIncome(applicant)));
    await setInputValueById(page, `MainContent_txtIncome8${suffix}`, money(totalPensionIncome(applicant)));
    await setInputValueById(page, `MainContent_txtIncome9${suffix}`, money(maintenanceIncome(applicant)));
    await setInputValueById(page, `MainContent_txtIncome10${suffix}`, money(rentalIncome(applicant)));
    await setInputValueById(page, `MainContent_txtIncome11${suffix}`, money(applicant.employment.isContractor ? contractorIncome(applicant) : 0));
  }
}

async function fillExpenditure(page: Page, input: LenderReadyInput): Promise<void> {
  const applicantCount = input.case.numberOfApplicants;
  for (let index = 0; index < applicantCount; index += 1) {
    await setInputValueById(page, `MainContent_txtExpenditure_000003_${index}`, "0");
    await setInputValueById(page, `MainContent_txtExpenditure_000005_${index}`, "0");
    await setInputValueById(page, `MainContent_txtExpenditure_000006_${index}`, "0");
    await setInputValueById(page, `MainContent_txtExpenditure_000023_${index}`, money(index === 0 ? input.outgoings.creditCardBalances : 0));
    await setInputValueById(page, `MainContent_txtExpenditure_000024_${index}`, "0");
    await setInputValueById(page, `MainContent_txtExpenditure_000031_${index}`, money(index === 0 ? input.outgoings.monthlyLoanRepayments : 0));
    await setInputValueById(page, `MainContent_txtExpenditure_000033_${index}`, "0");
    await setInputValueById(page, `MainContent_txtExpenditure_000034_${index}`, money(index === 0 ? otherMortgageBalance(input) : 0));
    await setInputValueById(page, `MainContent_txtExpenditure_000035_${index}`, "0");
    await setInputValueById(page, `MainContent_txtExpenditure_000036_${index}`, "0");
    await setInputValueById(page, `MainContent_txtExpenditure_000037_${index}`, money(index === 0 ? input.case.monthlySharedOwnershipRent ?? 0 : 0));
    await setInputValueById(page, `MainContent_txtExpenditure_000038_${index}`, "0");
    await setInputValueById(page, `MainContent_txtExpenditure_000041_${index}`, "0");
    await setInputValueById(page, `MainContent_txtExpenditure_000043_${index}`, money(index === 0 ? input.outgoings.overdraftBalances : 0));
  }
}

async function next(page: Page, expectedValue: string): Promise<void> {
  const button = page.locator("#MainContent_btnNext");
  await button.waitFor({ state: "visible", timeout: 15000 });
  const value = await button.getAttribute("value").catch(() => "");
  await button.click({ force: true });
  await page.waitForTimeout(1000);
  const errors = await visibleValidationText(page);
  if (errors && value === expectedValue) {
    throw new Error(`Skipton validation blocked ${expectedValue}: ${errors}`);
  }
}

async function calculate(page: Page): Promise<void> {
  const button = page.locator("#MainContent_btnNext");
  await button.waitFor({ state: "visible", timeout: 15000 });
  await button.click({ force: true });
  await page.waitForFunction(
    () => /\bResults\b|You must|Please specify|Please enter|required/i.test(document.body.innerText),
    undefined,
    { timeout: 15000 }
  ).catch(() => undefined);
}

async function waitForResult(page: Page, context: RunContext): Promise<void> {
  await page.waitForFunction(
    () => /Results/i.test(document.body.innerText) || /You must|Please specify|Please enter|required/i.test(document.body.innerText),
    undefined,
    { timeout: Math.min(context.timeoutMs, 60000) }
  ).catch(() => undefined);
}

async function extractResult(page: Page): Promise<{ maximumBorrowing: number | null; monthlyPayment: null; messages: string[] }> {
  const text = await page.locator("body").innerText();
  if (!/\bResults\b/i.test(text)) {
    return { maximumBorrowing: null, monthlyPayment: null, messages: resultMessages(text) };
  }
  if (/You must|Please specify|Please enter|required/i.test(text)) {
    return { maximumBorrowing: null, monthlyPayment: null, messages: resultMessages(text) };
  }
  const match = text.match(/Maximum loan amount:\s*£\s*([0-9][0-9,]*(?:\.\d{2})?)/i);
  return {
    maximumBorrowing: match?.[1] ? Number(match[1].replace(/,/g, "")) : null,
    monthlyPayment: null,
    messages: resultMessages(text.slice(Math.max(text.search(/\bResults\b/i), 0)))
  };
}

async function checkRadioById(page: Page, id: string): Promise<void> {
  const radio = page.locator(`#${cssAttributeValue(id)}`);
  if (await radio.count() === 0) return;
  await radio.first().evaluate((node) => {
    const input = node as HTMLInputElement;
    input.checked = true;
    input.click();
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await page.waitForTimeout(150);
}

async function setInputValueById(page: Page, id: string, value: string): Promise<boolean> {
  const field = page.locator(`#${cssAttributeValue(id)}`);
  if (await field.count() === 0 || !(await field.first().isVisible().catch(() => false))) return false;
  await field.first().fill(value);
  await field.first().evaluate((node, nextValue) => {
    const input = node as HTMLInputElement;
    input.value = nextValue;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
    input.dispatchEvent(new Event("blur", { bubbles: true }));
  }, value);
  return true;
}

async function setSelectValueById(page: Page, id: string, value: string): Promise<boolean> {
  const field = page.locator(`#${cssAttributeValue(id)}`);
  if (await field.count() === 0 || !(await field.first().isVisible().catch(() => false))) return false;
  await field.first().selectOption(value);
  await field.first().dispatchEvent("change");
  return true;
}

async function visibleValidationText(page: Page): Promise<string> {
  const text = await page.locator("body").innerText().catch(() => "");
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /You must|Please specify|Please enter|required/i.test(line))
    .join(" | ");
}

function childDependants(input: LenderReadyInput): number {
  return input.household.dependants.filter((dependant) => dependant.age < 18).length;
}

function adultDependants(input: LenderReadyInput): number {
  return input.household.dependants.filter((dependant) => dependant.age >= 18).length;
}

function money(value: number): string {
  return String(Math.round(value));
}

function totalOtherIncome(applicant: Applicant): number {
  return applicant.otherIncome.reduce((sum, income) => sum + income.annualAmount, 0);
}

function totalPensionIncome(applicant: Applicant): number {
  return (applicant.employment.annualPensionIncome ?? 0) + (applicant.employment.otherAnnualPensionIncome ?? 0);
}

function variableIncome(applicant: Applicant): number {
  return (applicant.employment.annualBonus ?? 0) + (applicant.employment.annualOvertime ?? 0) + (applicant.employment.annualCommission ?? 0);
}

function benefitsIncome(applicant: Applicant): number {
  const benefitTypes = new Set(["child_benefit", "universal_credit", "attendance_allowance", "carers_allowance", "disability_living_allowance", "employment_support_allowance", "income_support", "personal_independence_payment", "working_tax_credit", "child_tax_credit"]);
  return applicant.otherIncome.filter((income) => benefitTypes.has(income.type)).reduce((sum, income) => sum + income.annualAmount, 0);
}

function maintenanceIncome(applicant: Applicant): number {
  return applicant.otherIncome.filter((income) => income.type === "maintenance").reduce((sum, income) => sum + income.annualAmount, 0);
}

function rentalIncome(applicant: Applicant): number {
  return applicant.otherIncome.filter((income) => income.type === "rental_income_btl").reduce((sum, income) => sum + income.annualAmount, 0);
}

function guaranteedOtherIncome(applicant: Applicant): number {
  const excludedTypes = new Set([
    "child_benefit",
    "universal_credit",
    "attendance_allowance",
    "carers_allowance",
    "disability_living_allowance",
    "employment_support_allowance",
    "income_support",
    "personal_independence_payment",
    "working_tax_credit",
    "child_tax_credit",
    "maintenance",
    "rental_income_btl"
  ]);
  return applicant.otherIncome
    .filter((income) => !excludedTypes.has(income.type))
    .reduce((sum, income) => sum + income.annualAmount, 0);
}

function contractorIncome(applicant: Applicant): number {
  return applicant.employment.annualGrossIncome ?? 0;
}

function otherMortgageBalance(input: LenderReadyInput): number {
  const commitments = input.outgoings.otherMortgageCommitments.reduce((sum, mortgage) => sum + mortgage.outstandingBalance, 0);
  const properties = input.otherProperties.reduce((sum, property) => sum + (property.currentBalance ?? 0), 0);
  return input.loan.currentBalance ?? commitments + properties;
}

function cssAttributeValue(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}
