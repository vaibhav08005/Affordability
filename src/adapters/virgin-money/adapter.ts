import { chromium, type Page } from "playwright";
import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { AffordabilityResult, Applicant, LenderReadyInput } from "../../domain/contracts.js";
import type { LenderAdapter, RunContext } from "../types.js";
import { captureEvidence, categorizeError, clickFirstAvailableButton, createBrowserSession, resultMessages } from "../shared/browser.js";
import { saveFailureBundle } from "../shared/failure-artifacts.js";
import {
  employmentStatusValues,
  loanTypeIds,
  locationRadioIds,
  repaymentTypeIds,
  VIRGIN_MONEY_CALCULATOR_URL
} from "./mapping.js";

interface PageEvidence {
  title: string;
  path: string;
}

export const virginMoneyAdapter: LenderAdapter = {
  lender: "virgin_money",
  async run(input, context) {
    const startedAt = new Date().toISOString();
    const session = await createBrowserSession(context, VIRGIN_MONEY_CALCULATOR_URL);
    const page = session.page;
    page.setDefaultTimeout(context.timeoutMs);
    page.setDefaultNavigationTimeout(context.timeoutMs);
    const pageEvidence: PageEvidence[] = [];

    try {
      await openVirginMoneyCalculator(page, context);
      await fillVirginMoneyCalculator(page, input, context, pageEvidence);
      await waitForResult(page, context);
      await capturePageEvidence(page, context, pageEvidence, "04-results");

      const result = await extractResult(page);
      if (result.maximumBorrowing == null) {
        throw new Error("Result extraction failed: Virgin Money did not return a lending amount on the results page.");
      }

      const pdfPath = await createEvidencePdf(context, "virgin-money-filled-pages", pageEvidence);
      return {
        lender: "virgin_money",
        status: "success",
        maximumBorrowing: result.maximumBorrowing,
        monthlyPayment: null,
        messages: result.messages,
        evidence: {
          pdfPath,
          screenshotPaths: pageEvidence.map((item) => item.path),
          timestamp: startedAt
        }
      };
    } catch (error) {
      const category = categorizeError(error);
      const screenshotPath = await captureEvidence(page, context, "virgin-money-failed").catch(() => undefined);
      const failureBundlePath = await saveFailureBundle({ page, context, input, error, category, screenshotPath, timestamp: startedAt });
      return {
        lender: "virgin_money",
        status: "failed",
        maximumBorrowing: null,
        monthlyPayment: null,
        messages: [],
        evidence: { screenshotPath, failureBundlePath, timestamp: startedAt },
        error: {
          category,
          message: error instanceof Error ? error.message : String(error)
        }
      };
    } finally {
      await session.close();
    }
  }
};

async function openVirginMoneyCalculator(page: Page, context: RunContext): Promise<void> {
  await page.goto(VIRGIN_MONEY_CALCULATOR_URL, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1000);
  await clickFirstAvailableButton(page, ["Reject optional cookies", "Accept all cookies"]).catch(() => undefined);
  await page.locator("#purchase, #remortgage").first().waitFor({ state: "visible", timeout: Math.min(context.timeoutMs, 20000) });
}

async function fillVirginMoneyCalculator(page: Page, input: LenderReadyInput, context: RunContext, pageEvidence: PageEvidence[]): Promise<void> {
  await fillLoanDetails(page, input);
  await capturePageEvidence(page, context, pageEvidence, "01-loan-details");
  await continueToNextPage(page, "personal-details");
  await fillPersonalDetails(page, input);
  await capturePageEvidence(page, context, pageEvidence, "02-personal-details");
  await continueToNextPage(page, "outgoings");
  await fillOutgoings(page, input);
  await capturePageEvidence(page, context, pageEvidence, "03-outgoings");
  await continueToNextPage(page, "results");
}

async function fillLoanDetails(page: Page, input: LenderReadyInput): Promise<void> {
  await checkById(page, loanTypeIds[input.case.mortgagePurpose]);
  if (input.case.mortgagePurpose === "purchase") {
    await checkById(page, input.case.sharedOwnershipOrEquity ? "hbs-yes-shared-ownership" : "hbs-no-shared-ownership");
  }
  await checkById(page, repaymentTypeIds[input.case.repaymentType]);
  await setInputValueById(page, "Form_LoanDetails_RepaymentTerm", String(input.case.termYears));
  await checkById(page, "yes_pfto");
  await setInputValueById(page, "Form_LoanDetails_ProductInterestRate", "5.2");

  if (input.case.mortgagePurpose === "purchase") {
    await setInputValueById(page, "Form_LoanDetails_PurchasePrice", money(input.loan.propertyValue));
    await setInputValueById(page, "Form_LoanDetails_MortgageLoanAmount", money(input.loan.loanAmount));
    await setInputValueById(page, "Form_LoanDetails_SharePercentage", "50");
  } else {
    await setInputValueById(page, "Form_LoanDetails_PropertyValue", money(input.loan.propertyValue));
    await setInputValueById(page, "Form_LoanDetails_CurrentMortgageBalance", money(input.loan.currentBalance ?? input.loan.loanAmount));
    await setInputValueById(
      page,
      "Form_LoanDetails_AdditionalBorrowingAmount",
      money(input.case.mortgagePurpose === "remortgage_no_additional_borrowing" ? 0 : Math.max(0, input.loan.loanAmount - (input.loan.currentBalance ?? 0)))
    );
  }

  if (input.case.repaymentType === "part_and_part") {
    const interestOnlyAmount = input.case.interestOnlyLoanAmount ?? 0;
    await setInputValueById(page, "Form_LoanDetails_CILoanAmount", money(Math.max(0, input.loan.loanAmount - interestOnlyAmount)));
    await setInputValueById(page, "Form_LoanDetails_IOLoanAmount", money(interestOnlyAmount));
  }
}

async function fillPersonalDetails(page: Page, input: LenderReadyInput): Promise<void> {
  await checkById(page, input.case.numberOfApplicants === 1 ? "single-application" : "joint-application");
  await setSelectValueById(page, "Form_FirstPersonalDetails_Dependants", String(Math.min(input.household.dependants.length, 9)));
  await fillApplicantPersonalDetails(page, input.applicants[0], "FirstPersonalDetails", "1", input.property.isInScotland);

  if (input.case.numberOfApplicants === 2 && input.applicants[1]) {
    await fillApplicantPersonalDetails(page, input.applicants[1], "SecondPersonalDetails", "2", input.property.isInScotland);
  }
}

async function fillApplicantPersonalDetails(
  page: Page,
  applicant: Applicant,
  prefix: "FirstPersonalDetails" | "SecondPersonalDetails",
  applicantNumber: "1" | "2",
  isInScotland: boolean
): Promise<void> {
  await setSelectValueById(page, `Form_${prefix}_Age`, String(Math.min(Math.max(applicant.age, 18), 70)));
  if (prefix === "FirstPersonalDetails") {
    await checkById(page, isInScotland ? locationRadioIds.scotland : locationRadioIds.england);
  }

  const employmentValue = applicant.employment.isContractor ? "Contractor" : employmentStatusValues[applicant.employment.type];
  await setSelectValueById(page, `Form_${prefix}_Employment1_EmploymentStatus`, employmentValue);
  await fillEmploymentIncome(page, applicant, prefix, "Employment1");

  const hasSecondIncome = secondIncome(applicant) > 0;
  await checkById(page, hasSecondIncome ? `yes-employment-${applicantNumber}-1` : `no-employment-${applicantNumber}-1`);
  if (hasSecondIncome) {
    await setSelectValueById(page, `Form_${prefix}_Employment2_EmploymentStatus`, "Not Employed");
    await setInputValueById(page, `Form_${prefix}_Employment2_BenefitsOtherIncome`, money(secondIncome(applicant)));
  }
}

async function fillEmploymentIncome(page: Page, applicant: Applicant, prefix: "FirstPersonalDetails" | "SecondPersonalDetails", employmentPrefix: "Employment1" | "Employment2"): Promise<void> {
  const base = `Form_${prefix}_${employmentPrefix}`;
  if (applicant.employment.isContractor) {
    await setInputValueById(page, `${base}_ContractorGrossAnnualIncome`, money(applicant.employment.annualGrossIncome ?? 0));
    return;
  }
  if (applicant.employment.type === "self_employed") {
    await setInputValueById(page, `${base}_MostRecentNetProfit`, money(applicant.employment.netProfitCurrentYear ?? applicant.employment.annualGrossIncome ?? 0));
    await setInputValueById(page, `${base}_PreviousYearNetProfit`, money(applicant.employment.netProfitPreviousYear ?? applicant.employment.netProfitCurrentYear ?? 0));
    return;
  }
  if (applicant.employment.type === "pension") {
    await setInputValueById(page, `${base}_GrossAnnualPensionIncome`, money(totalPensionIncome(applicant)));
    return;
  }
  if (applicant.employment.type === "other") {
    await setInputValueById(page, `${base}_BenefitsOtherIncome`, money(totalOtherIncome(applicant) || applicant.employment.annualGrossIncome || 0));
    return;
  }
  await setInputValueById(page, `${base}_EmployedGrossAnnualSalary`, money(applicant.employment.annualGrossIncome ?? 0));
  await setInputValueById(page, `${base}_OvertimeBonusCommission`, money(variableIncome(applicant)));
}

async function fillOutgoings(page: Page, input: LenderReadyInput): Promise<void> {
  await checkById(page, "total-monthly-expenditure");
  await setInputValueById(
    page,
    "Form_Outgoings_MonthlyHouseholdExpenditure",
    money(input.outgoings.otherMonthlyOutgoings + (input.case.monthlySharedOwnershipRent ?? 0))
  );
  await setInputValueById(page, "Form_Outgoings_MonthlyGroundRent", "0");
  await setInputValueById(page, "Form_Outgoings_MonthlyServiceCharge", "0");
  await setInputValueById(page, "Form_Outgoings_MonthlyChildcareEducation", "0");
  await setInputValueById(page, "Form_Outgoings_MonthlyMaintenanceCSA", "0");
  const hasOtherResidential = input.otherProperties.length > 0 || input.outgoings.otherMortgageCommitments.length > 0;
  await checkById(page, hasOtherResidential ? "YesOtherResi" : "NoOtherResi");
  await checkById(page, input.outgoings.monthlyBuyToLetPayments > 0 ? "YesOtherBTL" : "NoOtherBTL");
  if (hasOtherResidential) {
    await setInputValueById(
      page,
      "Form_Outgoings_OtherResidentialMortgagesMonthlyRepayment",
      money(otherResidentialMonthlyRepayments(input))
    );
  }
  if (input.outgoings.monthlyBuyToLetPayments > 0) {
    await setInputValueById(page, "Form_Outgoings_OtherBuyToLetMortgagesMonthlyRepayment", money(input.outgoings.monthlyBuyToLetPayments));
    await setInputValueById(page, "Form_Outgoings_OtherBuyToLetMortgagesRentalIncome", money(otherPropertyRent(input)));
  }
  await setInputValueById(page, "Form_Outgoings_MonthlySharedOwnershipRent", money(input.case.monthlySharedOwnershipRent ?? 0));
  await setInputValueById(page, "Form_Outgoings_OutstandingCredit", money(input.outgoings.creditCardBalances + input.outgoings.overdraftBalances));
  await setInputValueById(page, "Form_Outgoings_OutstandingCreditCompletion", money(input.outgoings.creditCardBalances + input.outgoings.overdraftBalances));
  await setInputValueById(page, "Form_Outgoings_CurrentLoanRepayments", money(input.outgoings.monthlyLoanRepayments));
  await setInputValueById(page, "Form_Outgoings_RepaymentsAfterCompletion", money(input.outgoings.monthlyLoanRepayments));
}

async function continueToNextPage(page: Page, expectedUrlPart: string): Promise<void> {
  await page.getByRole("button", { name: "Continue" }).click();
  await page.waitForLoadState("domcontentloaded").catch(() => undefined);
  await page.waitForTimeout(1000);
  const text = await page.locator("body").innerText().catch(() => "");
  if (/There are errors on this page|field is required|must be|Please select|Enter /i.test(text) && !page.url().includes(expectedUrlPart)) {
    throw new Error(`Virgin Money validation blocked navigation to ${expectedUrlPart}: ${validationMessages(text)}`);
  }
}

async function waitForResult(page: Page, context: RunContext): Promise<void> {
  await page.waitForFunction(
    () => location.pathname.includes("/results/") || /There are errors on this page|field is required|Please select/i.test(document.body.innerText),
    undefined,
    { timeout: Math.min(context.timeoutMs, 60000) }
  ).catch(() => undefined);
}

async function extractResult(page: Page): Promise<{ maximumBorrowing: number | null; monthlyPayment: null; messages: string[] }> {
  const text = await page.locator("body").innerText();
  const isResultPage = page.url().includes("/results/") || /Affordability results/i.test(text);
  if (!isResultPage || /There are errors on this page|field is required|Please select/i.test(text)) {
    return { maximumBorrowing: null, monthlyPayment: null, messages: resultMessages(text) };
  }

  const resultMatch = text.match(/Based on a £[0-9][0-9,]* property we could lend:\s*£([0-9][0-9,]*)/i);
  const fallbackMatch = text.match(/we could lend:\s*£([0-9][0-9,]*)/i);
  const value = resultMatch?.[1] ?? fallbackMatch?.[1];
  if (!value && (/It looks like we can.t help|won.t be able to lend/i.test(text) || isResultPage)) {
    return {
      maximumBorrowing: 0,
      monthlyPayment: null,
      messages: resultMessages(text.slice(Math.max(text.search(/Affordability results/i), 0)))
    };
  }
  return {
    maximumBorrowing: value ? Number(value.replace(/,/g, "")) : null,
    monthlyPayment: null,
    messages: resultMessages(text.slice(Math.max(text.search(/Affordability results/i), 0)))
  };
}

async function checkById(page: Page, id: string): Promise<boolean> {
  const field = page.locator(`#${cssAttributeValue(id)}`);
  if (await field.count() === 0) return false;
  await field.first().check({ force: true }).catch(async () => {
    await field.first().evaluate((node) => {
      const input = node as HTMLInputElement;
      input.checked = true;
      input.click();
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
  });
  await page.waitForTimeout(200);
  return true;
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
  await page.waitForTimeout(500);
  return true;
}

function validationMessages(text: string): string {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /There are errors|field is required|must be|Please select|Enter /i.test(line))
    .slice(0, 12)
    .join(" | ");
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

function secondIncome(applicant: Applicant): number {
  if (applicant.employment.type === "other") return 0;
  return totalOtherIncome(applicant) + (applicant.employment.type === "pension" ? 0 : applicant.employment.otherAnnualPensionIncome ?? 0);
}

function otherResidentialMonthlyRepayments(input: LenderReadyInput): number {
  const propertyPayments = input.otherProperties.reduce((sum, property) => sum + property.monthlyMortgagePayment, 0);
  const commitments = input.outgoings.otherMortgageCommitments.length * 1;
  return Math.max(1, propertyPayments + commitments);
}

function otherPropertyRent(input: LenderReadyInput): number {
  return Math.max(1, input.otherProperties.reduce((sum, property) => sum + (property.monthlyRent ?? 0), 0));
}

async function capturePageEvidence(page: Page, context: RunContext, pageEvidence: PageEvidence[], name: string): Promise<void> {
  await page.waitForTimeout(300);
  const path = await captureEvidence(page, context, `virgin-money-${name}`);
  pageEvidence.push({
    title: evidenceTitle(name),
    path
  });
}

async function createEvidencePdf(context: RunContext, name: string, pageEvidence: PageEvidence[]): Promise<string> {
  if (pageEvidence.length === 0) {
    throw new Error("Unable to create Virgin Money evidence PDF because no page screenshots were captured.");
  }

  await mkdir(context.screenshotDir, { recursive: true });
  const pdfPath = join(context.screenshotDir, `${name}-${Date.now()}.pdf`);
  const html = await evidencePdfHtml(pageEvidence);
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "load" });
    await page.pdf({
      path: pdfPath,
      format: "A4",
      printBackground: true,
      margin: {
        top: "10mm",
        right: "8mm",
        bottom: "10mm",
        left: "8mm"
      }
    });
  } finally {
    await browser.close();
  }

  return pdfPath;
}

async function evidencePdfHtml(pageEvidence: PageEvidence[]): Promise<string> {
  const sections = await Promise.all(
    pageEvidence.map(async (item, index) => {
      const image = await readFile(item.path);
      const dataUrl = `data:image/png;base64,${image.toString("base64")}`;
      return `
        <section class="page-shot">
          <h1>${escapeHtml(`${index + 1}. ${item.title}`)}</h1>
          <img src="${dataUrl}" alt="${escapeHtml(item.title)}" />
        </section>
      `;
    })
  );

  return `
    <!doctype html>
    <html>
      <head>
        <meta charset="utf-8" />
        <style>
          * { box-sizing: border-box; }
          body {
            margin: 0;
            background: #ffffff;
            color: #111827;
            font-family: Arial, Helvetica, sans-serif;
          }
          .page-shot {
            break-after: page;
            page-break-after: always;
          }
          .page-shot:last-child {
            break-after: auto;
            page-break-after: auto;
          }
          h1 {
            margin: 0 0 10px;
            font-size: 14px;
            font-weight: 700;
          }
          img {
            display: block;
            width: 100%;
            height: auto;
            border: 1px solid #d1d5db;
          }
        </style>
      </head>
      <body>${sections.join("\n")}</body>
    </html>
  `;
}

function evidenceTitle(name: string): string {
  return name
    .replace(/^\d+-/, "")
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function cssAttributeValue(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}
