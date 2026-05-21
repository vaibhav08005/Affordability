import { chromium, type Locator, type Page } from "playwright";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { AffordabilityResult, Applicant, LenderId, LenderReadyInput } from "../../domain/contracts.js";
import type { LenderAdapter, RunContext } from "../types.js";
import {
  applicationTypeLabels,
  customerTypeApplicationLabels,
  employmentStatusLabels,
  HSBC_CALCULATOR_URL,
  repaymentBasisLabels,
  residentialStatusLabels,
  selfEmploymentStatusLabels
} from "./mapping.js";

export const hsbcAdapter: LenderAdapter = {
  lender: "hsbc" as LenderId,
  async run(input, context) {
    const startedAt = new Date().toISOString();
    const session = await createBrowserSession(context);
    const page = session.page;
    page.setDefaultTimeout(context.timeoutMs);
    page.setDefaultNavigationTimeout(context.timeoutMs);

    try {
      await openHsbcCalculator(page, context);
      await fillHsbcCalculator(page, input);
      await acceptCookies(page);
      await clickFirstAvailableButton(page, ["Calculate", "Get results", "See how much I could borrow"]);
      await waitForResult(page, context);

      const result = await extractResult(page);
      if (result.maximumBorrowing == null) {
        const validationMessages = result.messages.filter((message) => /please|required|select|enter|error|invalid/i.test(message));
        if (validationMessages.length > 0) {
          throw new Error(`HSBC did not return a maximum borrowing amount. Validation messages: ${validationMessages.slice(0, 5).join(" | ")}`);
        }

        throw new Error("Result extraction failed: HSBC did not return a maximum borrowing amount.");
      }

      const screenshotPath = await captureEvidence(page, context, "hsbc-success");
      return {
        lender: "hsbc" as LenderId,
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
      const screenshotPath = await captureEvidence(page, context, "hsbc-failed").catch(() => undefined);
      return {
        lender: "hsbc" as LenderId,
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
    const page = browserContext.pages().find((candidate) => candidate.url().startsWith(HSBC_CALCULATOR_URL)) ??
      browserContext.pages()[0] ??
      await browserContext.newPage();
    await page.setViewportSize({ width: 1365, height: 900 }).catch(() => undefined);

    return {
      page,
      async close() {
        await browser.close();
      }
    };
  }

  const browser = await chromium.launch({ headless: context.headless });
  const browserContext = await browser.newContext({
    colorScheme: "light",
    extraHTTPHeaders: {
      "Accept-Language": "en-GB,en;q=0.9"
    },
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

async function openHsbcCalculator(page: Page, context: RunContext): Promise<void> {
  await page.goto(HSBC_CALCULATOR_URL, { waitUntil: "domcontentloaded" });
  await acceptCookies(page);
  await page.locator("body").waitFor({ state: "visible", timeout: Math.min(context.timeoutMs, 15000) });
  await assertCalculatorAvailable(page);
}

async function assertCalculatorAvailable(page: Page): Promise<void> {
  const text = await page.locator("body").innerText({ timeout: 10000 }).catch(() => "");
  if (/temporarily unavailable|try again later|technical problem|access denied/i.test(text)) {
    throw new Error("HSBC calculator is unavailable: the site returned an unavailable or error page.");
  }
}

async function fillHsbcCalculator(page: Page, input: LenderReadyInput): Promise<void> {
  await fillPageAndAdvance(page, async () => {
    await fillCaseDetails(page, input);
    await fillApplicants(page, input);
    await fillPropertyAndMortgage(page, input);
    await fillIncome(page, input);
    await fillExpenditure(page, input);
  });
}

async function fillPageAndAdvance(page: Page, fillVisibleFields: () => Promise<void>): Promise<void> {
  for (let step = 0; step < 8; step += 1) {
    await acceptCookies(page);
    const before = await page.locator("body").innerText().catch(() => "");
    await fillVisibleFields();

    if (await resultIsVisible(page)) return;
    await acceptCookies(page);
    if (await clickFirstAvailableButton(page, ["Calculate", "Get results", "Continue", "Next"])) {
      await page.waitForLoadState("domcontentloaded").catch(() => undefined);
      await page.waitForTimeout(700);
    } else {
      return;
    }

    const after = await page.locator("body").innerText().catch(() => "");
    if (normalizePageText(before) === normalizePageText(after) && !(await nextOrCalculateIsVisible(page))) return;
  }
}

async function fillCaseDetails(page: Page, input: LenderReadyInput): Promise<void> {
  const applicationLabels =
    input.case.mortgagePurpose === "purchase"
      ? customerTypeApplicationLabels[input.case.customerType]
      : applicationTypeLabels[input.case.mortgagePurpose];

  const applicationTypeId =
    input.case.mortgagePurpose === "purchase" && input.case.customerType === "first_time_buyer"
      ? "applicationType-FTB-radio-item"
      : input.case.mortgagePurpose === "purchase"
        ? "applicationType-MOVER-radio-item"
        : "applicationType-REPFOB-radio-item";
  await checkRadioById(page, applicationTypeId);
  await chooseFirstAvailableOption(page, applicationLabels, ["Application type"]);
  await checkRadioById(page, applicationTypeId);
  const applicantTypeId = input.case.numberOfApplicants === 1 ? "applicantType-1-radio-item" : "applicantType-2-radio-item";
  await checkRadioById(page, applicantTypeId);
  await chooseFirstAvailableOption(page, input.case.numberOfApplicants === 1 ? ["Sole"] : ["Joint"], [
    "Sole/Joint",
    "Joint application",
    "Application"
  ]);
  await checkRadioById(page, applicantTypeId);
  await checkRadioById(page, "isPremierAccount-no-radio-item");
  await chooseYesNo(page, ["Premier account", "HSBC Premier"], false);
  await checkRadioById(page, "isPremierAccount-no-radio-item");
}

async function fillApplicants(page: Page, input: LenderReadyInput): Promise<void> {
  for (const applicant of input.applicants) {
    const applicantIndex = applicant.index - 1;
    const dob = dateParts(applicant.dateOfBirth ?? dateOfBirthFromAge(applicant.age));
    await fillByIdVariant(page, "dateOfBirth", applicantIndex, ".dob-date-day-field", dob.day);
    await fillByIdVariant(page, "dateOfBirth", applicantIndex, ".dob-date-month-field", dob.month);
    await fillByIdVariant(page, "dateOfBirth", applicantIndex, ".dob-date-year-field", dob.year);
    await selectByIdVariant(page, "dateOfBirth", applicantIndex, ".retirementAge-field", [String(applicant.retirementAge ?? 70)]);
    await selectByIdVariant(page, "income", applicantIndex, ".employementStatus-field", employmentLabels(applicant));
    await checkRadioByIdVariant(page, "income", applicantIndex, ".currencyCheck-no-radio-item");

    const scope = await applicantScope(page, applicant.index);
    await fillFirstAvailableText(scope, retirementAgeLabels(applicant.index), String(applicant.retirementAge ?? 70));
    await chooseFirstAvailableOption(scope, employmentLabels(applicant), ["Employment status", `Applicant ${applicant.index}`]);
    await chooseFirstAvailableOption(scope, ["No"], ["foreign currency income", "Foreign currency"]);
    await chooseFirstAvailableOption(scope, residentialStatusLabels[input.case.customerType], ["Residential status"]);
    await fillByIdVariant(page, "dateOfBirth", applicantIndex, ".dob-date-day-field", dob.day);
    await fillByIdVariant(page, "dateOfBirth", applicantIndex, ".dob-date-month-field", dob.month);
    await fillByIdVariant(page, "dateOfBirth", applicantIndex, ".dob-date-year-field", dob.year);
    await selectByIdVariant(page, "dateOfBirth", applicantIndex, ".retirementAge-field", [String(applicant.retirementAge ?? 70)]);
    await selectByIdVariant(page, "income", applicantIndex, ".employementStatus-field", employmentLabels(applicant));
    await checkRadioByIdVariant(page, "income", applicantIndex, ".currencyCheck-no-radio-item");
  }

  await selectById(page, "dependentDetailsChildren-field", [dependantOption(input, "child")]);
  await selectById(page, "dependentDetailsAdult-field", [dependantOption(input, "adult")]);
  await fillFirstAvailableText(page, ["Total dependent children", "Dependent children", "Number of dependent children"], String(dependantCount(input, "child")));
  await fillFirstAvailableText(page, ["Total dependent adults", "Dependent adults", "Number of dependent adults"], String(dependantCount(input, "adult")));
  await fillFirstAvailableText(page, ["Total dependants", "Total number of dependants", "Number of dependants"], String(input.household.dependants.length));
}

async function fillPropertyAndMortgage(page: Page, input: LenderReadyInput): Promise<void> {
  await fillById(page, "purchasePriceAmount-field", currencyValue(input.loan.propertyValue));
  await fillFirstAvailableCurrency(page, ["Property value", "Purchase price", "Estimated property value"], input.loan.propertyValue);
  await fillFirstAvailableCurrency(page, ["Mortgage amount", "Loan amount", "Amount to borrow"], input.loan.loanAmount);
  await fillById(page, "addressPostalCode-field", "SW1A 1AA");
  await fillFirstAvailableText(page, ["Property postcode", "Postcode"], "SW1A 1AA");
  await checkRadioById(page, input.case.hasInterestOnly || input.case.repaymentType !== "capital_and_interest" ? "repaymentTypeCode-yes-radio-item" : "repaymentTypeCode-no-radio-item");
  await chooseYesNo(page, ["Assess on interest only basis", "Interest only basis"], input.case.hasInterestOnly || input.case.repaymentType !== "capital_and_interest");
  await chooseFirstAvailableOption(page, repaymentBasisLabels[input.case.repaymentType], ["Interest only basis"]);
  await page.waitForTimeout(500);
  await fillTerm(page, input.case.termYears);
  await page.waitForTimeout(300);
  await fillTerm(page, input.case.termYears);
}

async function fillIncome(page: Page, input: LenderReadyInput): Promise<void> {
  for (const applicant of input.applicants) {
    const applicantIndex = applicant.index - 1;
    await fillByIdVariant(page, "income", applicantIndex, ".incomeFields.grossAnnualIncome-field", currencyValue(applicant.employment.annualGrossIncome ?? 0));
    await fillByIdVariant(page, "income", applicantIndex, ".incomeFields.latestYearprofit-field", currencyValue(applicant.employment.netProfitCurrentYear ?? 0));
    await fillByIdVariant(page, "income", applicantIndex, ".incomeFields.previousYearprofit-field", currencyValue(applicant.employment.netProfitPreviousYear ?? 0));
    await fillByIdVariant(page, "income", applicantIndex, ".incomeFields.otherTaxableIncome-field", currencyValue(totalOtherIncome(applicant)));
    await fillByIdVariant(page, "income", applicantIndex, ".incomeFields.bonusCommissionOvertime-field", currencyValue(variableIncomeTotal(applicant)));

    const scope = await applicantScope(page, applicant.index);
    await fillFirstAvailableCurrency(scope, incomeLabels(applicant.index, ["Gross annual income", "Annual gross income", "Basic salary"]), applicant.employment.annualGrossIncome ?? 0);
    await fillFirstAvailableCurrency(scope, incomeLabels(applicant.index, ["Latest year Limited Company net profits", "Latest year net profits", "Latest year"]), applicant.employment.netProfitCurrentYear ?? 0);
    await fillFirstAvailableCurrency(scope, incomeLabels(applicant.index, ["Previous year Limited Company net profits", "Previous year net profits", "Previous year"]), applicant.employment.netProfitPreviousYear ?? 0);
    await fillFirstAvailableCurrency(scope, incomeLabels(applicant.index, ["Other non-taxable income", "Other income"]), totalOtherIncome(applicant));
    await fillFirstAvailableCurrency(scope, incomeLabels(applicant.index, ["Bonus / Commission / Overtime", "Bonus", "Commission", "Overtime"]), variableIncomeTotal(applicant));
    await fillFirstAvailableCurrency(scope, incomeLabels(applicant.index, ["Pension income", "Annual pension income"]), applicant.employment.annualPensionIncome ?? 0);
  }

  const monthlyRentalIncome = input.otherProperties.reduce((sum, property) => sum + (property.monthlyRent ?? 0), 0);
  await fillFirstAvailableCurrency(page, ["Existing monthly BTL rental income", "Monthly BTL rental income", "BTL rental income"], monthlyRentalIncome);
}

async function fillExpenditure(page: Page, input: LenderReadyInput): Promise<void> {
  for (const applicant of input.applicants) {
    const applicantIndex = applicant.index - 1;
    const hasApplicantOutgoings = applicant.index === 1;
    await fillByIdVariant(page, "expenditure", applicantIndex, ".monthlyPaymentAmount-field", currencyValue(hasApplicantOutgoings ? input.outgoings.monthlyLoanRepayments : 0));
    await fillByIdVariant(page, "expenditure", applicantIndex, ".balanceOutstandingAmount-field", currencyValue(hasApplicantOutgoings ? input.outgoings.creditCardBalances + input.outgoings.overdraftBalances : 0));
    await fillByIdVariant(page, "expenditure", applicantIndex, ".paymentMonthlyAmountOTHRVP-field", currencyValue(hasApplicantOutgoings ? input.case.monthlyRepaymentPlanPremium ?? 0 : 0));
    await fillByIdVariant(page, "expenditure", applicantIndex, ".paymentMonthlyAmountGRDRNT-field", "0");
    await fillByIdVariant(page, "expenditure", applicantIndex, ".paymentMonthlyAmountESSTVL-field", "0");
    await fillByIdVariant(page, "expenditure", applicantIndex, ".paymentMonthlyAmountCHDSPT-field", "0");
    await fillByIdVariant(page, "expenditure", applicantIndex, ".paymentMonthlyAmountSPSMAN-field", "0");
    await fillByIdVariant(page, "expenditure", applicantIndex, ".paymentMonthlyAmountEFEES-field", "0");
    await fillByIdVariant(page, "expenditure", applicantIndex, ".paymentMonthlyAmountCHDCST-field", "0");
    await fillByIdVariant(page, "expenditure", applicantIndex, ".paymentMonthlyAmountSTLOAN-field", "0");
    await fillByIdVariant(page, "expenditure", applicantIndex, ".paymentMonthlyAmountOTHER-field", currencyValue(hasApplicantOutgoings ? input.outgoings.otherMonthlyOutgoings : 0));
  }

  await fillFirstAvailableCurrency(page, ["Total monthly loan payments", "Monthly loan payments", "Loan payments"], input.outgoings.monthlyLoanRepayments);
  await fillFirstAvailableCurrency(page, ["Total credit card balances", "Credit card balances"], input.outgoings.creditCardBalances + input.outgoings.overdraftBalances);
  await fillFirstAvailableCurrency(page, ["Payment to fund repayment strategy for Interest Only mortgage", "Repayment strategy"], input.case.monthlyRepaymentPlanPremium ?? 0);
  await fillFirstAvailableCurrency(page, ["Ground rent / Service charge", "Ground rent", "Service charge"], 0);
  await fillFirstAvailableCurrency(page, ["Travel costs"], 0);
  await fillFirstAvailableCurrency(page, ["Child maintenance"], 0);
  await fillFirstAvailableCurrency(page, ["Spouse / Partner maintenance", "Partner maintenance"], 0);
  await fillFirstAvailableCurrency(page, ["School fees"], 0);
  await fillFirstAvailableCurrency(page, ["Childcare"], 0);
  await fillFirstAvailableCurrency(page, ["Other outgoings including BTL", "Other outgoings"], input.outgoings.otherMonthlyOutgoings);
  await fillFirstAvailableCurrency(page, ["Student Loan payment", "Student loan"], 0);

  const btlBalances = input.otherProperties
    .filter((property) => property.isRental)
    .reduce((sum, property) => sum + (property.currentBalance ?? 0), 0);
  const btlPayments = input.outgoings.monthlyBuyToLetPayments +
    input.otherProperties.filter((property) => property.isRental).reduce((sum, property) => sum + property.monthlyMortgagePayment, 0);
  await fillFirstAvailableCurrency(page, ["Existing BTL mortgage balances", "BTL mortgage balances"], btlBalances);
  await fillFirstAvailableCurrency(page, ["Existing BTL mortgage payments", "BTL mortgage payments"], btlPayments);

  const residentialCommitment = input.outgoings.otherMortgageCommitments[0];
  await fillFirstAvailableCurrency(page, ["Residential mortgage balance", "Existing residential mortgage balance"], residentialCommitment?.outstandingBalance ?? 0);
  await fillFirstAvailableText(page, ["Residential mortgage term", "Existing residential mortgage term"], String(residentialCommitment?.remainingTermYears ?? 0));
  await fillFirstAvailableCurrency(page, ["Residential monthly mortgage payment", "Existing residential mortgage payment"], 0);
}

async function applicantScope(page: Page, index: 1 | 2): Promise<Page | Locator> {
  const heading = page.getByRole("heading", { name: new RegExp(`Applicant\\s*${index}`, "i") });
  if (await heading.count() === 0) return page;
  const section = heading.first().locator("xpath=ancestor::*[self::section or self::fieldset or self::form or self::div][1]");
  return await section.count() > 0 ? section : page;
}

function employmentLabels(applicant: Applicant): string[] {
  if (applicant.employment.type === "self_employed" && applicant.employment.businessType) {
    return selfEmploymentStatusLabels[applicant.employment.businessType];
  }

  return employmentStatusLabels[applicant.employment.type];
}

function dobLabels(index: 1 | 2): string[] {
  return [`Applicant ${index} DOB`, `Applicant ${index} date of birth`, "DOB", "Date of birth"];
}

function retirementAgeLabels(index: 1 | 2): string[] {
  return [`Applicant ${index} retirement age`, "Retirement age", "Expected retirement age"];
}

function incomeLabels(index: 1 | 2, labels: string[]): string[] {
  return labels.flatMap((label) => [`Applicant ${index} ${label}`, label]);
}

async function chooseYesNo(page: Page | Locator, groupHints: string[], value: boolean): Promise<void> {
  await chooseFirstAvailableOption(page, value ? ["Yes"] : ["No"], groupHints);
}

async function acceptCookies(page: Page): Promise<void> {
  const labels = [
    "Accept optional cookies",
    "Decline optional cookies",
    "Accept all cookies",
    "Allow all cookies",
    "Accept cookies",
    "Accept"
  ];
  await clickFirstAvailableButton(page, labels).catch(() => undefined);
  for (const label of labels) {
    const button = page.getByText(new RegExp(`^${escapeRegExp(label)}$`, "i"));
    if (await button.count() > 0 && await button.first().isVisible().catch(() => false)) {
      await button.first().click({ force: true }).catch(() => undefined);
      await page.waitForTimeout(300);
      return;
    }
  }
}

async function chooseFirstAvailableOption(scope: Page | Locator, options: readonly string[], groupHints: string[] = []): Promise<boolean> {
  for (const groupHint of groupHints) {
    const group = scope.getByRole("group", { name: new RegExp(escapeRegExp(groupHint), "i") });
    if (await group.count() > 0 && await chooseWithinScope(group.first(), options)) return true;
    const radioGroup = scope.getByRole("radiogroup", { name: new RegExp(escapeRegExp(groupHint), "i") });
    if (await radioGroup.count() > 0 && await chooseWithinScope(radioGroup.first(), options)) return true;
  }

  return chooseWithinScope(scope, options);
}

async function chooseWithinScope(scope: Page | Locator, options: readonly string[]): Promise<boolean> {
  for (const option of options) {
    const radio = scope.getByRole("radio", { name: new RegExp(`^${escapeRegExp(option)}$`, "i") });
    if (await radio.count() > 0) {
      await radio.first().click({ force: true });
      return true;
    }

    const optionText = scope.getByText(new RegExp(`^${escapeRegExp(option)}$`, "i"));
    const count = await optionText.count();
    for (let index = 0; index < count; index += 1) {
      const candidate = optionText.nth(index);
      if (await candidate.isVisible().catch(() => false)) {
        await candidate.click({ force: true });
        return true;
      }
    }

    const select = scope.locator("select").filter({ has: scope.locator(`option`, { hasText: new RegExp(escapeRegExp(option), "i") }) });
    if (await select.count() > 0 && await selectMatchingOption(select.first(), [option])) return true;
  }

  return false;
}

async function fillFirstAvailableCurrency(scope: Page | Locator, labels: string[], value: number): Promise<boolean> {
  return fillFirstAvailableText(scope, labels, currencyValue(value));
}

async function fillFirstAvailableText(scope: Page | Locator, labels: string[], value: string): Promise<boolean> {
  for (const label of labels) {
    const labelField = scope.getByLabel(new RegExp(escapeRegExp(label), "i"));
    if (await fillFirstUsableField(labelField, value)) return true;

    const placeholderField = scope.getByPlaceholder(new RegExp(escapeRegExp(label), "i"));
    if (await fillFirstUsableField(placeholderField, value)) return true;

    const byName = scope.locator(`input[name*="${cssAttributeText(label)}" i], input[id*="${cssAttributeText(label)}" i]`);
    if (await fillFirstUsableField(byName, value)) return true;

    const followingInput = scope.locator(`xpath=.//*[contains(normalize-space(.), "${xpathLiteralText(label)}")]/following::input[1]`);
    if (await fillFirstUsableField(followingInput, value)) return true;
  }

  return false;
}

async function fillFirstUsableField(locator: Locator, value: string): Promise<boolean> {
  const count = await locator.count();
  for (let index = 0; index < count; index += 1) {
    const candidate = locator.nth(index);
    if (await isFillableField(candidate)) {
      await candidate.fill(value);
      return true;
    }
  }

  return false;
}

async function fillTerm(page: Page, termYears: number): Promise<void> {
  const yearsFilled =
    await selectById(page, "yearsAndMonths.years-field", [String(termYears)]) ||
    await selectFirstAvailableOption(page, ["Mortgage term", "Mortgage term years", "Term years", "Years"], [String(termYears)]) ||
    await fillFirstAvailableText(page, ["Mortgage term years", "Term years"], String(termYears));

  await selectById(page, "yearsAndMonths.months-field", ["0"]) ||
  await selectFirstAvailableOption(page, ["Mortgage term months", "Term months", "Months"], ["0"]) ||
    await fillFirstAvailableText(page, ["Mortgage term months", "Term months"], "0");

  if (!yearsFilled) {
    await fillFirstAvailableText(page, ["Mortgage term", "Loan term"], String(termYears));
  }
}

async function checkRadioById(page: Page, id: string): Promise<boolean> {
  const radio = locatorById(page, id);
  if (await radio.count() === 0) return false;
  const label = page.locator(`label[for="${cssAttributeText(id)}"]`);
  if (await label.count() > 0 && await label.first().isVisible().catch(() => false)) {
    await label.first().click({ force: true }).catch(() => undefined);
  }

  await radio.first().evaluate((node) => {
    const input = node as HTMLInputElement;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "checked")?.set;
    setter?.call(input, true);
    input.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
    input.blur();
  });
  return true;
}

async function checkRadioByIdVariant(page: Page, prefix: string, index: number, suffix: string): Promise<boolean> {
  for (const id of indexedIdVariants(prefix, index, suffix)) {
    if (await checkRadioById(page, id)) return true;
  }

  return false;
}

async function fillById(page: Page, id: string, value: string): Promise<boolean> {
  const field = locatorById(page, id);
  if (await field.count() === 0 || !(await isFillableField(field.first()))) return false;
  await field.first().evaluate((node, nextValue) => {
    const input = node as HTMLInputElement | HTMLTextAreaElement;
    const prototype = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
    setter?.call(input, nextValue);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
    input.blur();
  }, value);
  return true;
}

async function fillByIdVariant(page: Page, prefix: string, index: number, suffix: string, value: string): Promise<boolean> {
  for (const id of indexedIdVariants(prefix, index, suffix)) {
    if (await fillById(page, id, value)) return true;
  }

  return false;
}

async function selectById(page: Page, id: string, optionLabels: string[]): Promise<boolean> {
  const field = locatorById(page, id);
  if (await field.count() === 0 || !(await isVisibleSelect(field.first()))) return false;
  const selected = await selectMatchingOption(field.first(), optionLabels);
  if (!selected) return false;
  await field.first().evaluate((node) => {
    node.dispatchEvent(new Event("input", { bubbles: true }));
    node.dispatchEvent(new Event("change", { bubbles: true }));
    (node as HTMLSelectElement).blur();
  });
  return true;
}

async function selectByIdVariant(page: Page, prefix: string, index: number, suffix: string, optionLabels: string[]): Promise<boolean> {
  for (const id of indexedIdVariants(prefix, index, suffix)) {
    if (await selectById(page, id, optionLabels)) return true;
  }

  return false;
}

function locatorById(page: Page, id: string): Locator {
  return page.locator(`[id="${cssAttributeText(id)}"]`);
}

function indexedIdVariants(prefix: string, index: number, suffix: string): string[] {
  return [`${prefix}.${index}${suffix}`, `${prefix}[${index}]${suffix}`];
}

async function isFillableField(locator: Locator): Promise<boolean> {
  return locator.evaluate((node) => {
    const element = node as HTMLInputElement | HTMLTextAreaElement;
    const tagName = element.tagName.toLowerCase();
    const type = (element.getAttribute("type") ?? "text").toLowerCase();
    const textInputTypes = new Set(["", "text", "search", "email", "number", "tel", "url", "password"]);
    const visible = !!(element.offsetWidth || element.offsetHeight || element.getClientRects().length);
    return (
      visible &&
      ((tagName === "input" && textInputTypes.has(type)) || tagName === "textarea" || element.isContentEditable) &&
      !element.disabled &&
      !element.readOnly
    );
  }).catch(() => false);
}

async function selectFirstAvailableOption(scope: Page | Locator, labels: string[], optionLabels: string[]): Promise<boolean> {
  for (const label of labels) {
    const labelled = scope.getByLabel(new RegExp(escapeRegExp(label), "i"));
    const count = await labelled.count();
    for (let index = 0; index < count; index += 1) {
      const candidate = labelled.nth(index);
      if (await isVisibleSelect(candidate) && await selectMatchingOption(candidate, optionLabels)) return true;
    }

    const followingSelect = scope.locator(`xpath=.//*[contains(normalize-space(.), "${xpathLiteralText(label)}")]/following::select[1]`);
    if (await followingSelect.count() > 0 && await isVisibleSelect(followingSelect.first())) {
      if (await selectMatchingOption(followingSelect.first(), optionLabels)) return true;
    }
  }

  return false;
}

async function isVisibleSelect(locator: Locator): Promise<boolean> {
  return locator.evaluate((node) => {
    const element = node as HTMLSelectElement;
    const visible = !!(element.offsetWidth || element.offsetHeight || element.getClientRects().length);
    return node instanceof HTMLSelectElement && visible && !element.disabled;
  }).catch(() => false);
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
      const value = candidate.value.toLowerCase();
      const wanted = optionLabel.toLowerCase();
      return label === wanted || value === wanted || label.includes(wanted);
    });
    if (option) {
      await selectField.evaluate((node, selectedOption) => {
        const select = node as HTMLSelectElement;
        const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set;
        setter?.call(select, selectedOption.value);
        if (!selectedOption.value) {
          select.selectedIndex = selectedOption.index;
        }
        select.dispatchEvent(new Event("input", { bubbles: true }));
        select.dispatchEvent(new Event("change", { bubbles: true }));
        select.blur();
      }, option);
      return true;
    }
  }

  return false;
}

async function clickFirstAvailableButton(page: Page, labels: string[]): Promise<boolean> {
  for (const label of labels) {
    const button = page.getByRole("button", { name: new RegExp(escapeRegExp(label), "i") });
    const count = await button.count();
    for (let index = 0; index < count; index += 1) {
      const candidate = button.nth(index);
      if (await candidate.isVisible().catch(() => false) && await candidate.isEnabled().catch(() => false)) {
        await candidate.click({ force: true });
        return true;
      }
    }

    const link = page.getByRole("link", { name: new RegExp(escapeRegExp(label), "i") });
    if (await link.count() > 0 && await link.first().isVisible().catch(() => false)) {
      await link.first().click({ force: true });
      return true;
    }
  }

  return false;
}

async function waitForResult(page: Page, context: RunContext): Promise<void> {
  await page.waitForFunction(
    () => {
      const text = document.body.innerText;
      if (/processing your application/i.test(text)) return false;
      return (
        /total\s+lending\s+amount\s+based\s+on|maximum\s+(borrowing|loan|amount)|may\s+be\s+able\s+to\s+borrow|we\s+could\s+lend/i.test(text) ||
        /please\s+correct\s+the\s+following|please\s+(enter|select)|required|must|error|invalid/i.test(text)
      );
    },
    undefined,
    { timeout: Math.min(context.timeoutMs, 60000) }
  ).catch(() => undefined);
  await page.waitForTimeout(500);
}

async function resultIsVisible(page: Page): Promise<boolean> {
  const text = await page.locator("body").innerText().catch(() => "");
  return /total\s+lending\s+amount\s+based\s+on|maximum\s+(borrowing|loan|amount)|may\s+be\s+able\s+to\s+borrow|we\s+could\s+lend/i.test(text);
}

async function nextOrCalculateIsVisible(page: Page): Promise<boolean> {
  for (const label of ["Calculate", "Get results", "Continue", "Next"]) {
    const button = page.getByRole("button", { name: new RegExp(escapeRegExp(label), "i") });
    if (await button.count() > 0 && await button.first().isVisible().catch(() => false)) return true;
  }

  return false;
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

function extractMaximumCurrency(text: string): number | null {
  const focusedPatterns = [
    /total\s+lending\s+amount\s+based\s+on\s+affordability[^\u00a3]{0,80}\u00a3\s*([0-9][0-9,]*)/i,
    /total\s+lending\s+amount[^\u00a3]{0,100}\u00a3\s*([0-9][0-9,]*)/i,
    /(?:maximum|could|can|able to|lend|borrow)[^\u00a3]{0,100}\u00a3\s*([0-9][0-9,]*)/i,
    /\u00a3\s*([0-9][0-9,]*)[^.\n]{0,100}(?:maximum|borrow|lend|afford)/i
  ];

  for (const pattern of focusedPatterns) {
    const match = text.match(pattern);
    if (match?.[1]) return Number(match[1].replace(/,/g, ""));
  }

  const matches = [...text.matchAll(/\u00a3\s*([0-9][0-9,]*)/g)];
  if (matches.length === 0) return null;
  return Math.max(...matches.map((match) => Number(match[1]?.replace(/,/g, ""))));
}

function extractMonthlyPayment(text: string): number | null {
  const match = text.match(/monthly[^\u00a3]{0,100}\u00a3\s*([0-9][0-9,]*)/i);
  return match?.[1] ? Number(match[1].replace(/,/g, "")) : null;
}

function dateOfBirthFromAge(age: number): string {
  const today = new Date();
  const year = today.getFullYear() - age;
  return `01/01/${year}`;
}

function dateParts(value: string): { day: string; month: string; year: string } {
  const match = value.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/) ?? value.match(/^(\d{4})[/-](\d{1,2})[/-](\d{1,2})$/);
  if (!match) return { day: "01", month: "01", year: dateOfBirthFromAge(35).slice(-4) };

  if (match[1]?.length === 4) {
    return {
      day: padDatePart(match[3] ?? "1"),
      month: padDatePart(match[2] ?? "1"),
      year: match[1]
    };
  }

  return {
    day: padDatePart(match[1] ?? "1"),
    month: padDatePart(match[2] ?? "1"),
    year: match[3] ?? dateOfBirthFromAge(35).slice(-4)
  };
}

function padDatePart(value: string): string {
  return value.padStart(2, "0");
}

function dependantOption(input: LenderReadyInput, kind: "child" | "adult"): string {
  const count = dependantCount(input, kind);
  return count >= 5 ? "5+" : String(count);
}

function dependantCount(input: LenderReadyInput, kind: "child" | "adult"): number {
  return input.household.dependants.filter((dependant) => {
    const isChild = dependant.age < 18 || /child|son|daughter/i.test(dependant.relationship ?? "");
    return kind === "child" ? isChild : !isChild;
  }).length;
}

function totalOtherIncome(applicant: Applicant): number {
  return applicant.otherIncome.reduce((sum, income) => sum + income.annualAmount, applicant.employment.otherAnnualPensionIncome ?? 0);
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

function normalizePageText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
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
  if (message.includes("unavailable") || message.includes("problem") || message.includes("access denied")) return "lender_unavailable";
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
