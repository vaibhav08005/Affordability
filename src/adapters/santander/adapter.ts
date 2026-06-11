import type { Page } from "playwright";
import type { AffordabilityResult, Applicant, LenderReadyInput, RepaymentType } from "../../domain/contracts.js";
import type { LenderAdapter, RunContext } from "../types.js";
import {
  captureEvidence,
  categorizeError,
  chooseFirstAvailableOption,
  clickFirstAvailableButton,
  createBrowserSession,
  extractMaximumCurrency,
  fillFirstAvailableCurrency,
  fillFirstAvailableText,
  fillVisibleById,
  resultMessages,
  selectFirstAvailableOption,
  selectVisibleById
} from "../shared/browser.js";
import { saveFailureBundle } from "../shared/failure-artifacts.js";
import { capturePageEvidence, createEvidencePdf, type PageEvidence } from "../shared/pdf-evidence.js";
import {
  mortgageTypeLabels,
  remortgageReasonLabels,
  repaymentMethodLabels,
  otherPropertyUseLabels,
  otherPropertyRepaymentLabels,
  SANTANDER_CALCULATOR_URL
} from "./mapping.js";

export const santanderAdapter: LenderAdapter = {
  lender: "santander",
  async run(input, context) {
    const startedAt = new Date().toISOString();
    const session = await createBrowserSession(context, SANTANDER_CALCULATOR_URL);
    const page = session.page;
    page.setDefaultTimeout(context.timeoutMs);
    page.setDefaultNavigationTimeout(context.timeoutMs);
    const pageEvidence: PageEvidence[] = [];

    try {
      await openSantanderCalculator(page, context);
      await fillSantanderCalculator(page, input, context, pageEvidence);
      await waitForResult(page, context);
      await capturePageEvidence(page, context, pageEvidence, "santander", "05-results");

      const result = await extractResult(page);
      if (result.maximumBorrowing == null) {
        throw new Error("Result extraction failed: Santander did not return a maximum borrowing amount.");
      }

      const pdfPath = await createEvidencePdf(context, "santander-filled-pages", pageEvidence);
      return {
        lender: "santander",
        status: "success",
        maximumBorrowing: result.maximumBorrowing,
        monthlyPayment: result.monthlyPayment,
        messages: result.messages,
        evidence: {
          pdfPath,
          screenshotPaths: pageEvidence.map((item) => item.path),
          timestamp: startedAt
        }
      };
    } catch (error) {
      const category = categorizeError(error);
      const screenshotPath = await captureEvidence(page, context, "santander-failed").catch(() => undefined);
      const failureBundlePath = await saveFailureBundle({ page, context, input, error, category, screenshotPath, timestamp: startedAt });
      return {
        lender: "santander",
        status: "failed",
        maximumBorrowing: null,
        monthlyPayment: null,
        messages: [],
        evidence: {
          screenshotPath,
          failureBundlePath,
          timestamp: startedAt
        },
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

async function openSantanderCalculator(page: Page, context: RunContext): Promise<void> {
  await page.goto(SANTANDER_CALCULATOR_URL, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1000);
  await clickFirstAvailableButton(page, ["Accept all cookies", "Reject all", "No, continue"]).catch(() => undefined);
  await page.locator("#AffordabilityCalculator").waitFor({ state: "visible", timeout: Math.min(context.timeoutMs, 20000) });
  await clickFirstAvailableButton(page, ["Accept all cookies", "Reject all", "No, continue"]).catch(() => undefined);
}

async function fillSantanderCalculator(page: Page, input: LenderReadyInput, context: RunContext, pageEvidence: PageEvidence[]): Promise<void> {
  await fillMortgageDetails(page, input);
  await capturePageEvidence(page, context, pageEvidence, "santander", "01-mortgage-details");
  await advance(page);
  await page.getByText(/^Other properties$/i).first().waitFor({ state: "visible", timeout: 10000 }).catch(() => undefined);
  await fillOtherProperties(page, input);
  await capturePageEvidence(page, context, pageEvidence, "santander", "02-other-properties");
  await advance(page);
  if (!(await isSantanderSection(page, "Annual gross income"))) {
    if (await isSantanderSection(page, "Commitments and expenditure")) {
      await setSantanderIncomeStore(page, input);
      await fillOutgoings(page, input);
      await capturePageEvidence(page, context, pageEvidence, "santander", "04-commitments-and-expenditure");
      if (!(await clickLastCalculatorButton(page, ["Calculate", "Get results", "Continue"]))) {
        await clickFirstAvailableButton(page, ["Calculate", "Get results", "Continue"]);
      }
      return;
    }
    throw new Error(`Santander did not advance from Other properties to Income. ${await santanderFailureContext(page)}`);
  }
  await fillIncome(page, input);
  await capturePageEvidence(page, context, pageEvidence, "santander", "03-income");
  await advance(page);
  if (!(await isSantanderSection(page, "Commitments and expenditure"))) {
    throw new Error(`Santander did not advance from Income to Commitments and expenditure. ${await santanderFailureContext(page)}`);
  }
  await fillOutgoings(page, input);
  await capturePageEvidence(page, context, pageEvidence, "santander", "04-commitments-and-expenditure");
  if (!(await clickLastCalculatorButton(page, ["Calculate", "Get results", "Continue"]))) {
    await clickFirstAvailableButton(page, ["Calculate", "Get results", "Continue"]);
  }
}

async function fillMortgageDetails(page: Page, input: LenderReadyInput): Promise<void> {
  await chooseFirstAvailableOption(page, [input.case.numberOfApplicants === 1 ? "Single" : "Joint"], ["application"]);
  await selectFirstAvailableOption(page, ["Number of financial dependants", "Dependants"], [
    dependantOption(input.household.dependants.length)
  ]);
  await chooseFirstAvailableOption(page, mortgageTypeLabels[input.case.mortgagePurpose], ["Mortgage type"]);
  if (input.case.mortgagePurpose !== "purchase") {
    await page.locator("#RemortgageReason").waitFor({ state: "visible", timeout: 10000 }).catch(() => undefined);
    await selectVisibleById(page, "RemortgageReason", remortgageReasonLabels[input.case.mortgagePurpose][0]) ||
      await selectFirstAvailableOption(page, ["Reason for remortgaging"], remortgageReasonLabels[input.case.mortgagePurpose]) ||
      await chooseFirstAvailableOption(page, remortgageReasonLabels[input.case.mortgagePurpose], ["Remortgage"]);
  }
  await fillVisibleById(page, "PropertyValue", String(Math.round(input.loan.propertyValue))) ||
    await fillFirstAvailableCurrency(page, ["Estimated property value", "Property value"], input.loan.propertyValue);
  if (input.case.mortgagePurpose !== "purchase") {
    await fillSantanderCurrentBalance(page, input);
    await chooseBorrowersSameAsCurrentMortgage(page);
    await fillSantanderCurrentBalance(page, input);
  }
  await selectFirstAvailableOption(page, ["Repayment method"], santanderRepaymentMethodLabels(input));
  if (input.case.repaymentType !== "capital_and_interest") {
    await chooseCombinedGrossIncomeOver200k(page, totalApplicantsGrossIncome(input) >= 200000 ? "Yes" : "No");
  }
  if (input.case.repaymentType !== "capital_and_interest") {
    await fillVisibleById(page, "InterestOnlyAmt", String(Math.round(input.case.interestOnlyLoanAmount ?? input.loan.loanAmount))) ||
      await fillFirstAvailableCurrency(page, ["Amount required on interest only"], input.case.interestOnlyLoanAmount ?? input.loan.loanAmount);
  }
  await fillVisibleById(
    page,
    "CapitalAndInterestAmt",
    String(Math.round(input.case.repaymentType === "interest_only" ? 0 : input.loan.loanAmount - (input.case.interestOnlyLoanAmount ?? 0)))
  ) || await fillFirstAvailableCurrency(
      page,
      ["Amount required on capital and interest"],
      input.case.repaymentType === "interest_only" ? 0 : input.loan.loanAmount - (input.case.interestOnlyLoanAmount ?? 0)
    );
  await fillFirstAvailableText(page, ["How old will the oldest applicant be on their next birthday"], String(oldestApplicantNextBirthdayAge(input)));
  await selectVisibleById(page, "TermYears", String(input.case.termYears));
  await selectVisibleById(page, "TermMonths", "0");
  await setSantanderDetailsStore(page, input);
  await fillVisibleById(page, "PropertyValue", String(Math.round(input.loan.propertyValue)));
  if (input.case.mortgagePurpose !== "purchase") {
    await fillSantanderCurrentBalance(page, input);
    await chooseBorrowersSameAsCurrentMortgage(page);
    await fillSantanderCurrentBalance(page, input);
  }
  await fillFirstAvailableText(page, ["How old will the oldest applicant be on their next birthday"], String(oldestApplicantNextBirthdayAge(input)));
  await selectVisibleById(page, "TermYears", String(input.case.termYears));
  await selectVisibleById(page, "TermMonths", "0");
  await setSantanderDetailsStore(page, input);
  if (input.case.mortgagePurpose !== "purchase") {
    await chooseBorrowersSameAsCurrentMortgage(page);
    await fillSantanderCurrentBalance(page, input);
  }
}

async function fillSantanderCurrentBalance(page: Page, input: LenderReadyInput): Promise<void> {
  const currentBalance = santanderCurrentBalance(input);
  await fillInputAfterText(page, "What's their current total balance?", currentBalance);
  await fillVisibleById(page, "CurrentBalance", String(currentBalance)) ||
    await fillVisibleById(page, "ExistingMortgageBalance", String(currentBalance)) ||
    await fillFirstAvailableCurrency(page, ["What's their current total balance", "Current balance", "customer's current balance"], currentBalance);
}

async function fillOtherProperties(page: Page, input: LenderReadyInput): Promise<void> {
  const propertyCards = santanderOtherPropertyCards(input);
  const hasOtherProperties = propertyCards.length > 0;
  await chooseButtonByLabelFor(page, "OtherPropertiesYN", hasOtherProperties ? "Yes" : "No");
  await page.waitForTimeout(300);
  if (!hasOtherProperties) return;
  await chooseButtonByLabelFor(page, "OtherPropertiesOver90", loanToValue(input) > 0.9 ? "Yes" : "No");
  await page.waitForTimeout(300);
  await chooseButtonByLabelFor(page, "OtherPropertiesProvideDetailsYN", "Yes");
  await page.waitForTimeout(300);

  await selectFirstAvailableOption(page, ["How many mortgaged properties", "mortgaged properties"], [
    String(Math.min(propertyCards.length, 5))
  ]);
  await selectFirstAvailableOption(page, ["How many mortgage free properties", "mortgage free"], ["0"]);
  await setSantanderOtherPropertiesStore(page, propertyCards, input);
  await page.waitForTimeout(500);

  for (const card of propertyCards.slice(0, 5)) {
    const cardHeading = `Mortgaged property ${card.index + 1}`;
    const requiredMonthlyPropertyCost = card.isRental ? 0 : 1;
    await selectAfterHeading(page, cardHeading, "Property use", [
      card.isRental ? otherPropertyUseLabels.alreadyLet : otherPropertyUseLabels.holidayHomeOrSecondHome
    ]);
    await page.waitForTimeout(300);
    await fillCurrencyAfterHeading(page, cardHeading, "Estimated property value", card.propertyValue);
    await fillCurrencyAfterHeading(page, cardHeading, "Mortgage balance", card.mortgageBalance);
    await chooseOptionAfterHeadingQuestion(
      page,
      cardHeading,
      "on completion will the lender be Santander",
      card.onCompletionLenderSantander ? "Yes" : "No"
    );
    await selectAfterHeading(page, cardHeading, "Type of mortgage", otherPropertyRepaymentLabels[card.repaymentType]);
    if (card.repaymentType === "part_and_part") {
      await fillCurrencyAfterHeading(page, cardHeading, "Repayment balance", Math.max(0, card.mortgageBalance - card.interestOnlyBalance));
      await fillCurrencyAfterHeading(page, cardHeading, "Interest only balance", card.interestOnlyBalance);
    }
    await selectAfterHeading(page, cardHeading, "Remaining term", [String(card.remainingTermYears)], 0);
    await selectAfterHeading(page, cardHeading, "Remaining term", ["0"], 1);
    await fillCurrencyAfterHeading(page, cardHeading, "Monthly mortgage payment", card.monthlyMortgagePayment);
    await fillCurrencyAfterHeading(page, cardHeading, "Monthly gross rent", card.monthlyRent);
    await chooseOptionAfterHeadingQuestion(page, cardHeading, "Will the rent be received in a foreign currency?", "No");
    await setTextInputById(page, `MortgagedsPropertyUtilities${card.index}`, String(requiredMonthlyPropertyCost));
    await setTextInputById(page, `MortgagedsPropertyCouncil${card.index}`, String(requiredMonthlyPropertyCost));
    await setTextInputById(page, `MortgagedsPropertyMaintenance${card.index}`, "0");
    await setTextInputById(page, `MortgagedsPropertyGRSC${card.index}`, "0");
    await setTextInputById(page, `MortgagedsPropertyOtherCosts${card.index}`, "0");
    await fillCurrencyAfterHeading(page, cardHeading, "Monthly utilities", requiredMonthlyPropertyCost);
    await fillCurrencyAfterHeading(page, cardHeading, "Monthly council tax", requiredMonthlyPropertyCost);
    await fillCurrencyAfterHeading(page, cardHeading, "Monthly property maintenance", 0);
    await fillCurrencyAfterHeading(page, cardHeading, "Monthly ground rent", 0);
    await fillCurrencyAfterHeading(page, cardHeading, "Other monthly costs", 0);
    await chooseOptionAfterHeadingQuestion(
      page,
      cardHeading,
      "Are all owners willing to switch the whole loan to interest only if they experience financial difficulties?",
      "No"
    );
    await chooseOptionAfterHeadingQuestion(page, cardHeading, "rented at the full market value", card.isRental ? "Yes" : "No");
    await fillSantanderOtherPropertyCosts(page, card.index, {
      utilities: requiredMonthlyPropertyCost,
      council: requiredMonthlyPropertyCost,
      maintenance: 0,
      groundRentAndServiceCharges: 0,
      otherCosts: 0
    }, { requireVisible: !card.isRental });
  }
}

async function fillIncome(page: Page, input: LenderReadyInput): Promise<void> {
  await setSantanderIncomeStore(page, input);
  for (const applicant of input.applicants) {
    await fillApplicantIncome(page, applicant);
  }
}

async function setSantanderOtherPropertiesStore(page: Page, propertyCards: SantanderOtherPropertyCard[], input: LenderReadyInput): Promise<void> {
  const cards = propertyCards.slice(0, 5).map((card) => {
    const interestOnlyAmt = card.repaymentType === "capital_and_interest"
      ? 0
      : Math.round(card.interestOnlyBalance || card.mortgageBalance);
    const capitalAndInterestAmt = card.repaymentType === "interest_only"
      ? 0
      : Math.max(0, Math.round(card.mortgageBalance - interestOnlyAmt));

    return {
      mortgaged: true,
      use: card.isRental ? "It's already let" : "Holiday home/second home (for own use)",
      propertyValue: Math.round(card.propertyValue),
      balance: Math.round(card.mortgageBalance),
      santander: card.onCompletionLenderSantander ? "Yes" : "No",
      repaymentMethod: otherPropertyRepaymentLabels[card.repaymentType][0],
      capitalAndInterestAmt,
      interestOnlyAmt,
      totalMonths: Math.max(1, Math.round(card.remainingTermYears * 12)),
      monthlyPmt: Math.round(card.monthlyMortgagePayment),
      rent: Math.round(card.monthlyRent),
      foreignCurrency: "No",
      willingSwitch: "No",
      utilities: card.isRental ? 0 : 1,
      council: card.isRental ? 0 : 1,
      maintenance: 0,
      grsc: 0,
      otherCosts: 0,
      finalIncome: 0,
      finalCosts: 0,
      valid: true
    };
  });

  await page.evaluate(
    ({ otherPropertyCards, over90 }) => {
      const app = document.querySelector("#AffordabilityCalculator") as (Element & { __vue_app__?: unknown }) | null;
      const context = (app?.__vue_app__ as { _context?: { provides?: Record<PropertyKey, unknown> } } | undefined)?._context;
      const pinia = Reflect.ownKeys(context?.provides ?? {})
        .map((key) => context?.provides?.[key])
        .find((candidate): candidate is { _s?: Map<string, Record<string, unknown> & { $patch?: (values: Record<string, unknown>) => void }> } =>
          !!candidate &&
          typeof candidate === "object" &&
          "_s" in candidate
        );
      const store = pinia?._s?.get("otherProperties");
      if (!store) return;

      const values = {
        otherPropertiesYN: otherPropertyCards.length > 0 ? "Yes" : "No",
        otherPropertiesOver90: over90 ? "Yes" : "No",
        otherPropertiesProvideDetailsYN: otherPropertyCards.length > 0 ? "Yes" : "",
        mortgagedCount: otherPropertyCards.length,
        mortgageFreeCount: 0,
        mortgaged: otherPropertyCards,
        mortgageFree: []
      };

      if (typeof store.$patch === "function") {
        store.$patch(values);
      } else {
        Object.assign(store, values);
      }
    },
    { otherPropertyCards: cards, over90: loanToValue(input) > 0.9 }
  ).catch(() => undefined);
}

async function fillApplicantIncome(page: Page, applicant: Applicant): Promise<void> {
  const prefix = applicant.index === 1 ? "Applicant 1" : "Applicant 2";
  const basicIncome = applicant.employment.type === "self_employed" ? 0 : applicant.employment.annualGrossIncome ?? 0;
  await fillVisibleById(page, `Applicant${applicant.index}Basic`, String(Math.round(basicIncome)));
  await fillFirstAvailableCurrency(page, [`${prefix} gross basic income`, "Gross basic income", "Gross annual income"], basicIncome);
  await fillSelfEmploymentIncome(page, applicant);
  await fillFirstAvailableCurrency(page, [`${prefix} pension income`, "Pension income"], applicant.employment.annualPensionIncome ?? 0);
  await fillVariableEmploymentIncome(page, applicant);
  await fillAllowanceIncome(page, applicant);
  await fillGovernmentBenefits(page, applicant);
  await fillOtherAnnualIncome(page, applicant);
  await fillMonthlyDeductions(page, applicant);
  await fillFirstAvailableCurrency(page, [`${prefix} other income`, "Other income"], totalOtherIncome(applicant));
}

async function fillVariableEmploymentIncome(page: Page, applicant: Applicant): Promise<void> {
  const applicantId = `Applicant${applicant.index}`;
  const bonusOrCommission = Math.round((applicant.employment.annualBonus ?? 0) + (applicant.employment.annualCommission ?? 0));
  const overtime = Math.round(applicant.employment.annualOvertime ?? 0);

  await chooseButtonByLabelFor(page, `${applicantId}BonusYN`, bonusOrCommission > 0 ? "Yes" : "No");
  if (bonusOrCommission > 0) {
    await chooseButtonByLabelFor(page, `${applicantId}BonusMonthlyYN`, "No");
    await selectVisibleById(page, `${applicantId}BonusFreq`, "Annually");
    await page.waitForTimeout(150);
    await setTextInputById(page, `${applicantId}AnnualBonus1`, String(bonusOrCommission));
  }

  await chooseButtonByLabelFor(page, `${applicantId}OvertimeYN`, overtime > 0 ? "Yes" : "No");
  if (overtime > 0) {
    await chooseButtonByLabelFor(page, `${applicantId}OvertimeMonthlyYN`, "No");
    await page.waitForTimeout(150);
    await setTextInputById(page, `${applicantId}AnnualOvertime`, String(overtime));
  }
}

async function fillAllowanceIncome(page: Page, applicant: Applicant): Promise<void> {
  const applicantId = `Applicant${applicant.index}`;
  const carAllowance = incomeAmount(applicant, ["town_area_or_car_allowance"]);
  const shiftAllowance = incomeAmount(applicant, ["shift_allowance"]);
  const hasAllowances = carAllowance > 0 || shiftAllowance > 0;

  await chooseButtonByLabelFor(page, `${applicantId}AllowanceYN`, hasAllowances ? "Yes" : "No");
  if (!hasAllowances) return;

  await page.waitForTimeout(150);
  await setTextInputById(page, `${applicantId}CarAllowance`, String(carAllowance));
  await setTextInputById(page, `${applicantId}London`, "0");
  await setTextInputById(page, `${applicantId}ShiftAllowance`, String(shiftAllowance));
  await setTextInputById(page, `${applicantId}IndefiniteSubsidy`, "0");
  await setTextInputById(page, `${applicantId}LongSubsidyPrivatePension`, "0");
}

async function fillGovernmentBenefits(page: Page, applicant: Applicant): Promise<void> {
  const applicantId = `Applicant${applicant.index}`;
  const childBenefit = incomeAmount(applicant, ["child_benefit"]);
  const childTaxCredits = incomeAmount(applicant, ["child_tax_credit"]);
  const workingTaxCredits = incomeAmount(applicant, ["working_tax_credit"]);
  const indefiniteBenefits = incomeAmount(applicant, [
    "attendance_allowance",
    "carers_allowance",
    "constant_attendance_allowance",
    "disability_living_allowance",
    "employment_support_allowance",
    "income_support",
    "industrial_injuries_disablement_benefit",
    "personal_independence_payment",
    "widowed_parents_allowance"
  ]);
  const universalCredit = incomeAmount(applicant, ["universal_credit"]);
  const hasBenefits = childBenefit + childTaxCredits + workingTaxCredits + indefiniteBenefits + universalCredit > 0;

  await chooseButtonByLabelFor(page, `${applicantId}GovtBenefitsYN`, hasBenefits ? "Yes" : "No");
  if (!hasBenefits) return;

  await page.waitForTimeout(150);
  await setTextInputById(page, `${applicantId}ChildBenefit`, String(childBenefit));
  await setTextInputById(page, `${applicantId}ChildTaxCredits`, String(childTaxCredits));
  await setTextInputById(page, `${applicantId}WorkingTaxCredits`, String(workingTaxCredits));
  await setTextInputById(page, `${applicantId}IndefiniteBenefits`, String(indefiniteBenefits));
  await setTextInputById(page, `${applicantId}UniversalCredit`, String(universalCredit));
}

async function fillOtherAnnualIncome(page: Page, applicant: Applicant): Promise<void> {
  const applicantId = `Applicant${applicant.index}`;
  const secondJob = incomeAmount(applicant, ["additional_duty_hours", "nursing_bank"]);
  const investment = incomeAmount(applicant, ["investment_income", "trust_income"]);
  const maintenance = incomeAmount(applicant, ["maintenance"]);
  const surplusRent = incomeAmount(applicant, ["rental_income_btl"]);
  const hasOtherIncome = secondJob + investment + maintenance + surplusRent > 0;

  await chooseButtonByLabelFor(page, `${applicantId}OtherIncomeYN`, hasOtherIncome ? "Yes" : "No");
  if (!hasOtherIncome) return;

  await page.waitForTimeout(150);
  await setTextInputById(page, `${applicantId}SecondJob`, String(secondJob));
  await setTextInputById(page, `${applicantId}Investment`, String(investment));
  await setTextInputById(page, `${applicantId}MaintenanceIncome`, String(maintenance));
  await setTextInputById(page, `${applicantId}SurplusRent`, String(surplusRent));
  await setTextInputById(page, `${applicantId}Fostering`, "0");
}

async function fillMonthlyDeductions(page: Page, applicant: Applicant): Promise<void> {
  const applicantId = `Applicant${applicant.index}`;
  const hasStudentLoan = (applicant.studentLoanBalance ?? 0) > 0 || (applicant.monthlyStudentLoanPayment ?? 0) > 0;
  await setTextInputById(page, `${applicantId}PreTaxDeductions`, String(Math.round(applicant.monthlyPensionContribution ?? 0)));
  await setTextInputById(page, `${applicantId}PostTaxDeductions`, "0");
  await chooseButtonByLabelFor(page, `${applicantId}StudentLoans`, hasStudentLoan ? "Yes" : "No");
}

async function setTextInputById(page: Page, id: string, value: string): Promise<boolean> {
  const filled = await page.evaluate(
    ({ controlId, textValue }) => {
      const input = document.getElementById(controlId) as HTMLInputElement | null;
      if (!input) return false;

      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      setter?.call(input, textValue);
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
      input.dispatchEvent(new Event("blur", { bubbles: true }));
      return true;
    },
    { controlId: id, textValue: value }
  ).catch(() => false);

  if (!filled) {
    return fillVisibleById(page, id, value);
  }

  return true;
}

async function fillSantanderOtherPropertyCosts(
  page: Page,
  index: number,
  values: {
    utilities: number;
    council: number;
    maintenance: number;
    groundRentAndServiceCharges: number;
    otherCosts: number;
  },
  options: { requireVisible: boolean }
): Promise<void> {
  const fields = [
    { id: `MortgagedsPropertyUtilities${index}`, value: values.utilities },
    { id: `MortgagedsPropertyCouncil${index}`, value: values.council },
    { id: `MortgagedsPropertyMaintenance${index}`, value: values.maintenance },
    { id: `MortgagedsPropertyGRSC${index}`, value: values.groundRentAndServiceCharges },
    { id: `MortgagedsPropertyOtherCosts${index}`, value: values.otherCosts }
  ];

  for (const field of fields) {
    await fillExactSantanderCurrencyById(page, field.id, field.value, options);
  }
}

async function fillExactSantanderCurrencyById(
  page: Page,
  id: string,
  value: number,
  options: { requireVisible: boolean }
): Promise<void> {
  const locator = page.locator(`#${id}`);
  await locator.first().waitFor({ state: options.requireVisible ? "visible" : "attached", timeout: 5000 }).catch(() => undefined);

  const textValue = String(Math.round(value));
  const visible = await locator.first().isVisible().catch(() => false);
  if (visible) {
    await fillVisibleById(page, id, textValue).catch(() => undefined);
  }

  await setTextInputById(page, id, textValue);
  await page.waitForTimeout(50);

  const actualValue = await locator.first().inputValue().catch(() => "");
  if (normalizeCurrencyInputValue(actualValue) !== textValue) {
    await setTextInputById(page, id, textValue);
  }
}

function normalizeCurrencyInputValue(value: string): string {
  return value.replace(/[,\s]/g, "");
}

async function chooseButtonByLabelFor(page: Page, labelFor: string, option: "Yes" | "No"): Promise<boolean> {
  const label = page.locator(`#AffordabilityCalculator label[for="${labelFor}"]`);
  await label.waitFor({ state: "visible", timeout: 5000 }).catch(() => undefined);

  const button = label.locator(
    `xpath=ancestor::*[contains(concat(" ", normalize-space(@class), " "), " form-group ")][1]//button[normalize-space(.)="${xpathLiteralText(option)}" or @value="${xpathLiteralText(option)}"]`
  );
  if (await button.count() > 0 && await button.first().isVisible().catch(() => false)) {
    await button.first().click({ force: true });
    await page.waitForTimeout(150);
    return true;
  }

  const clicked = await page.evaluate(
    ({ controlId, optionText }) => {
      const root = document.querySelector("#AffordabilityCalculator");
      const label = root?.querySelector(`label[for="${controlId}"]`);
      if (!root || !label) return false;

      const container = label.closest(".form-group") ?? label.parentElement;
      const buttons = Array.from(container?.querySelectorAll("button, [role='button']") ?? []) as HTMLElement[];
      const button = buttons.find((candidate) => candidate.textContent?.trim() === optionText || candidate.getAttribute("value") === optionText);
      if (!button) return false;

      button.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, view: window }));
      button.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true, view: window }));
      button.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));
      button.click();
      return true;
    },
    { controlId: labelFor, optionText: option }
  ).catch(() => false);

  if (clicked) await page.waitForTimeout(150);
  return clicked;
}

async function fillSelfEmploymentIncome(page: Page, applicant: Applicant): Promise<void> {
  if (applicant.employment.type !== "self_employed") return;

  const applicantId = `Applicant${applicant.index}`;
  const latestProfit = Math.round(applicant.employment.netProfitCurrentYear ?? 0);
  const previousProfit = Math.round(applicant.employment.netProfitPreviousYear ?? latestProfit);

  if (applicant.employment.businessType === "limited_company") {
    await chooseFirstAvailableOption(page, ["Yes"], ["salary for a director of a limited company", "limited company"]);
    await page.waitForTimeout(250);
    await fillVisibleById(page, `${applicantId}DirectorSalaryLatest`, String(Math.round(applicant.employment.annualGrossIncome ?? 0)));
    await fillVisibleById(page, `${applicantId}DirectorSalaryPrevious`, String(Math.round(applicant.employment.annualGrossIncome ?? 0)));
    await fillVisibleById(page, `${applicantId}DividendsLatest`, String(latestProfit));
    await fillVisibleById(page, `${applicantId}DividendsPrevious`, String(previousProfit));
    return;
  }

  await chooseFirstAvailableOption(page, ["Yes"], ["net profit from a sole trader", "sole trader/partnership"]);
  await page.waitForTimeout(250);
  await fillVisibleById(page, `${applicantId}SoleTraderLatest`, String(latestProfit));
  await fillVisibleById(page, `${applicantId}SoleTraderPrevious`, String(previousProfit));
}

async function fillOutgoings(page: Page, input: LenderReadyInput): Promise<void> {
  await setSantanderOutgoingsStore(page, input);
  await fillFirstAvailableCurrency(
    page,
    [
      "Please enter the total monthly payments for all credit commitments excluding credit cards and mortgages on other properties",
      "Total monthly payments of any outstanding loans",
      "Total monthly loan payments"
    ],
    input.outgoings.monthlyLoanRepayments
  );
  await fillFirstAvailableCurrency(
    page,
    [
      "Credit cards only: please enter the total outstanding balance for all credit cards",
      "Total outstanding credit card balances",
      "Outstanding credit card balances"
    ],
    input.outgoings.creditCardBalances
  );
  await setTextInputById(page, "CreditCardBalance", String(Math.round(input.outgoings.creditCardBalances)));
  const childcareAndEducation = input.outgoings.monthlyChildcareAndEducation ?? 0;
  const maintenancePayments = input.outgoings.monthlyMaintenancePayments ?? 0;
  const insuranceAndPensions = input.outgoings.monthlyInsuranceAndPensions ?? 0;
  const additionalCommitments = input.outgoings.otherMonthlyOutgoings;
  const otherMonthlyCommitted = childcareAndEducation + maintenancePayments + insuranceAndPensions + additionalCommitments;
  if (!(await chooseButtonByLabelFor(page, "OtherCommittedExpenditureYN", otherMonthlyCommitted > 0 ? "Yes" : "No"))) {
    await chooseFirstAvailableOption(page, [otherMonthlyCommitted > 0 ? "Yes" : "No"], [
      "Do you want to enter any other monthly committed expenditure",
      "other monthly committed expenditure"
    ]);
  }
  if (otherMonthlyCommitted > 0) {
    await page.waitForTimeout(150);
    await setTextInputById(page, "Childcare", String(Math.round(childcareAndEducation)));
    await setTextInputById(page, "MaintenancePayments", String(Math.round(maintenancePayments)));
    await setTextInputById(page, "Insurances", String(Math.round(insuranceAndPensions)));
    await setTextInputById(page, "GroundRent", "0");
    await setTextInputById(page, "ServiceCharge", "0");
    await setTextInputById(page, "FeudalCommitments", "0");
    await setTextInputById(page, "AdditionalCommitments", String(Math.round(additionalCommitments)));
  }
}

async function setSantanderOutgoingsStore(page: Page, input: LenderReadyInput): Promise<void> {
  const values = {
    monthlyLoanRepayments: Math.round(input.outgoings.monthlyLoanRepayments),
    creditCardBalances: Math.round(input.outgoings.creditCardBalances),
    childcareAndEducation: Math.round(input.outgoings.monthlyChildcareAndEducation ?? 0),
    maintenancePayments: Math.round(input.outgoings.monthlyMaintenancePayments ?? 0),
    insuranceAndPensions: Math.round(input.outgoings.monthlyInsuranceAndPensions ?? 0),
    additionalCommitments: Math.round(input.outgoings.otherMonthlyOutgoings)
  };

  await page.evaluate((storeValues) => {
    const app = document.querySelector("#AffordabilityCalculator") as (Element & { __vue_app__?: unknown }) | null;
    const context = (app?.__vue_app__ as { _context?: { provides?: Record<PropertyKey, unknown> } } | undefined)?._context;
    const pinia = Reflect.ownKeys(context?.provides ?? {})
      .map((key) => context?.provides?.[key])
      .find((candidate): candidate is { state: { value: Record<string, Record<string, unknown>> } } =>
        !!candidate &&
        typeof candidate === "object" &&
        "state" in candidate &&
        !!(candidate as { state?: unknown }).state
      );
    const commitments = pinia?.state.value.commitments as Record<string, unknown> | undefined;
    if (!commitments) return;
    Object.assign(commitments, {
      loanRepayments: storeValues.monthlyLoanRepayments,
      monthlyLoanRepayments: storeValues.monthlyLoanRepayments,
      totalMonthlyPayments: storeValues.monthlyLoanRepayments,
      creditCardBalance: storeValues.creditCardBalances,
      creditCardBalances: storeValues.creditCardBalances,
      otherCommittedExpenditureYN: storeValues.childcareAndEducation + storeValues.maintenancePayments + storeValues.insuranceAndPensions + storeValues.additionalCommitments > 0 ? "Yes" : "No",
      childcare: storeValues.childcareAndEducation,
      maintenancePayments: storeValues.maintenancePayments,
      insurances: storeValues.insuranceAndPensions,
      groundRent: 0,
      serviceCharge: 0,
      feudalCommitments: 0,
      additionalCommitments: storeValues.additionalCommitments
    });
  }, values).catch(() => undefined);
}

async function advance(page: Page): Promise<void> {
  if (!(await clickLastCalculatorButton(page, ["Continue", "Next"])) && !(await clickFirstCalculatorButton(page, ["Continue", "Next"]))) {
    throw new Error("Santander calculator Continue/Next button was not available.");
  }
  await page.waitForTimeout(1500);
}

async function clickLastCalculatorButton(page: Page, labels: string[]): Promise<boolean> {
  for (const label of labels) {
    const candidates = page.locator("#AffordabilityCalculator button").filter({ hasText: new RegExp(`^\\s*${label}\\s*$`, "i") });
    for (let index = (await candidates.count()) - 1; index >= 0; index -= 1) {
      const candidate = candidates.nth(index);
      if (await candidate.isVisible().catch(() => false) && await candidate.isEnabled().catch(() => false)) {
        await candidate.scrollIntoViewIfNeeded().catch(() => undefined);
        await candidate.click({ force: true });
        return true;
      }
    }
  }

  return false;
}

async function clickFirstCalculatorButton(page: Page, labels: string[]): Promise<boolean> {
  for (const label of labels) {
    const candidates = page.locator("#AffordabilityCalculator button").filter({ hasText: new RegExp(`^\\s*${label}\\s*$`, "i") });
    for (let index = 0; index < await candidates.count(); index += 1) {
      const candidate = candidates.nth(index);
      if (await candidate.isVisible().catch(() => false) && await candidate.isEnabled().catch(() => false)) {
        await candidate.scrollIntoViewIfNeeded().catch(() => undefined);
        await candidate.click({ force: true });
        return true;
      }
    }
  }

  return false;
}

async function waitForResult(page: Page, context: RunContext): Promise<void> {
  await page.waitForFunction(
    () => {
      const app = document.querySelector("#AffordabilityCalculator") as (Element & { __vue_app__?: { config?: { globalProperties?: { $route?: { name?: string } } } } }) | null;
      const routeName = app?.__vue_app__?.config?.globalProperties?.$route?.name;
      const text = document.body.innerText;
      return !/loading/i.test(text) && (routeName === "Results" || /the following errors|error|required|please enter|please select/i.test(text));
    },
    undefined,
    { timeout: Math.min(context.timeoutMs, 60000) }
  ).catch(() => undefined);
}

async function waitForSantanderSection(page: Page, title: string): Promise<void> {
  const marker = title === "Annual gross income" ? "Employed and contract income" : "Credit commitments";
  await page.locator("#AffordabilityCalculator").getByText(new RegExp(marker, "i")).first().waitFor({ state: "visible", timeout: 10000 });
}

async function isSantanderSection(page: Page, title: string): Promise<boolean> {
  const marker = title === "Commitments and expenditure" ? "Credit commitments" : "Employed and contract income";
  return page.locator("#AffordabilityCalculator").getByText(new RegExp(marker, "i")).first().isVisible().catch(() => false);
}

interface SantanderOtherPropertyCard {
  index: number;
  propertyValue: number;
  mortgageBalance: number;
  monthlyMortgagePayment: number;
  monthlyRent: number;
  remainingTermYears: number;
  interestOnlyBalance: number;
  isRental: boolean;
  repaymentType: RepaymentType;
  onCompletionLenderSantander: boolean;
  source: "otherProperties";
}

function santanderOtherPropertyCards(input: LenderReadyInput): SantanderOtherPropertyCard[] {
  return input.otherProperties.map((property, index) => ({
    index,
    propertyValue: Math.round(property.propertyValue),
    mortgageBalance: Math.round(property.currentBalance ?? 0),
    monthlyMortgagePayment: santanderOtherPropertyMonthlyPayment(property),
    monthlyRent: Math.round(property.monthlyRent ?? 0),
    remainingTermYears: Math.max(1, Math.round(property.remainingTermYears ?? input.case.termYears)),
    interestOnlyBalance: Math.round(property.interestOnlyBalance ?? 0),
    isRental: property.isRental,
    repaymentType: property.repaymentType ?? "capital_and_interest",
    onCompletionLenderSantander: /santander/i.test(property.currentLender ?? ""),
    source: "otherProperties"
  }));
}

async function fillNthAvailableCurrency(page: Page, labels: string[], itemIndex: number, value: number): Promise<boolean> {
  const textValue = String(Math.round(value));
  for (const label of labels) {
    const labelled = page.getByLabel(new RegExp(escapeRegExp(label), "i"));
    const labelledCount = await labelled.count();
    if (labelledCount > itemIndex) {
      const candidate = labelled.nth(itemIndex);
      if (await candidate.isVisible().catch(() => false)) {
        await candidate.fill(textValue, { force: true });
        return true;
      }
    }

    const afterLabel = page.locator(`xpath=.//*[contains(normalize-space(.), "${xpathLiteralText(label)}")]/following::input[1]`);
    const afterLabelCount = await afterLabel.count();
    if (afterLabelCount > itemIndex) {
      const candidate = afterLabel.nth(itemIndex);
      if (await candidate.isVisible().catch(() => false)) {
        await candidate.fill(textValue, { force: true });
        return true;
      }
    }
  }

  return false;
}

async function selectNthAvailableOption(page: Page, labels: string[], itemIndex: number, optionLabels: string[]): Promise<boolean> {
  for (const label of labels) {
    const labelled = page.getByLabel(new RegExp(escapeRegExp(label), "i"));
    const labelledCount = await labelled.count();
    if (labelledCount > itemIndex) {
      const candidate = labelled.nth(itemIndex);
      if (await candidate.isVisible().catch(() => false)) {
        if (await selectLocatorMatchingOption(candidate, optionLabels)) return true;
      }
    }

    const afterLabel = page.locator(`xpath=.//*[contains(normalize-space(.), "${xpathLiteralText(label)}")]/following::select[1]`);
    const afterLabelCount = await afterLabel.count();
    if (afterLabelCount > itemIndex) {
      const candidate = afterLabel.nth(itemIndex);
      if (await candidate.isVisible().catch(() => false)) {
        if (await selectLocatorMatchingOption(candidate, optionLabels)) return true;
      }
    }
  }

  return false;
}

async function selectFollowingSelectByLabelIndex(page: Page, label: string, selectIndex: number, optionLabels: string[]): Promise<boolean> {
  const select = page.locator(`xpath=.//*[contains(normalize-space(.), "${xpathLiteralText(label)}")]/following::select`);
  if (await select.count() <= selectIndex) return false;
  const candidate = select.nth(selectIndex);
  if (!(await candidate.isVisible().catch(() => false))) return false;
  return selectLocatorMatchingOption(candidate, optionLabels);
}

async function fillCurrencyAfterHeading(page: Page, heading: string, label: string, value: number): Promise<boolean> {
  const input = page.locator(
    `xpath=.//*[normalize-space(.)="${xpathLiteralText(heading)}"]/following::*[contains(normalize-space(.), "${xpathLiteralText(label)}")]/following::input[1]`
  );
  if (await input.count() === 0 || !(await input.first().isVisible().catch(() => false))) return false;
  await input.first().fill(String(Math.round(value)), { force: true });
  return true;
}

async function fillInputAfterText(page: Page, label: string, value: number): Promise<boolean> {
  return page.evaluate(
    ({ labelText, textValue }) => {
      const root = document.querySelector("#AffordabilityCalculator");
      if (!root) return false;
      const labelNode = Array.from(root.querySelectorAll("*")).find((element) =>
        Array.from(element.childNodes).some((node) =>
          node.nodeType === Node.TEXT_NODE && node.textContent?.replace(/\s+/g, " ").trim().includes(labelText)
        )
      );
      if (!labelNode) return false;
      const input = Array.from(root.querySelectorAll("input")).find((candidate) =>
        Boolean(labelNode.compareDocumentPosition(candidate) & Node.DOCUMENT_POSITION_FOLLOWING) &&
        !!(candidate.offsetWidth || candidate.offsetHeight || candidate.getClientRects().length)
      );
      if (!input) return false;
      input.value = textValue;
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
      return true;
    },
    { labelText: label, textValue: String(Math.round(value)) }
  ).catch(() => false);
}

async function selectAfterHeading(
  page: Page,
  heading: string,
  label: string,
  optionLabels: string[],
  selectOffset = 0
): Promise<boolean> {
  const select = page.locator(
    `xpath=.//*[normalize-space(.)="${xpathLiteralText(heading)}"]/following::*[contains(normalize-space(.), "${xpathLiteralText(label)}")]/following::select`
  );
  if (await select.count() <= selectOffset) return false;
  const candidate = select.nth(selectOffset);
  if (!(await candidate.isVisible().catch(() => false))) return false;
  return selectLocatorMatchingOption(candidate, optionLabels);
}

async function selectLocatorMatchingOption(locator: ReturnType<Page["locator"]>, optionLabels: string[]): Promise<boolean> {
  const options = await locator.locator("option").evaluateAll((nodes) =>
    nodes.map((node, index) => ({
      index,
      label: node.textContent?.trim() ?? "",
      value: (node as HTMLOptionElement).value
    }))
  ).catch(() => []);

  for (const optionLabel of optionLabels) {
    const wanted = optionLabel.toLowerCase();
    const option = options.find((candidate) => {
      const label = candidate.label.toLowerCase();
      const value = candidate.value.toLowerCase();
      return label === wanted || value === wanted || label.includes(wanted);
    });
    if (option) {
      await locator.selectOption(option.value ? { value: option.value } : { index: option.index }, { force: true });
      return true;
    }
  }

  return false;
}

async function chooseOptionAfterQuestion(page: Page, question: string, option: string): Promise<boolean> {
  return chooseOptionAfterQuestionIndex(page, question, 0, option);
}

async function chooseOptionAfterQuestionIndex(page: Page, question: string, itemIndex: number, option: string): Promise<boolean> {
  const scopedClick = await chooseButtonInQuestionGroup(page, question, itemIndex, option);
  if (scopedClick) return true;

  await page
    .locator(`xpath=.//*[text()[contains(normalize-space(.), "${xpathLiteralText(question)}")]]`)
    .first()
    .waitFor({ state: "visible", timeout: 3000 })
    .catch(() => undefined);

  const optionButton = page.locator(
    `xpath=.//*[text()[contains(normalize-space(.), "${xpathLiteralText(question)}")]]/following::button[normalize-space(.)="${xpathLiteralText(option)}"]`
  );
  const visibleButton = await nthVisibleLocator(optionButton, itemIndex);
  if (visibleButton) {
    await visibleButton.click({ force: true });
    return true;
  }

  const optionText = page.locator(
    `xpath=.//*[text()[contains(normalize-space(.), "${xpathLiteralText(question)}")]]/following::*[normalize-space(.)="${xpathLiteralText(option)}"]`
  );
  const visibleText = await nthVisibleLocator(optionText, itemIndex);
  if (visibleText) {
    await visibleText.click({ force: true });
    return true;
  }

  return false;
}

async function chooseButtonInQuestionGroup(page: Page, question: string, itemIndex: number, option: string): Promise<boolean> {
  await page
    .locator("#AffordabilityCalculator")
    .getByText(new RegExp(escapeRegExp(question), "i"))
    .first()
    .waitFor({ state: "visible", timeout: 5000 })
    .catch(() => undefined);

  const promptCandidates = page
    .locator("#AffordabilityCalculator label, #AffordabilityCalculator p")
    .filter({ hasText: new RegExp(escapeRegExp(question), "i") });
  let visiblePromptIndex = 0;
  const promptCount = await promptCandidates.count().catch(() => 0);
  for (let index = 0; index < promptCount; index += 1) {
    const prompt = promptCandidates.nth(index);
    if (!(await prompt.isVisible().catch(() => false))) continue;
    if (visiblePromptIndex !== itemIndex) {
      visiblePromptIndex += 1;
      continue;
    }

    const button = prompt.locator(
      `xpath=ancestor::*[contains(concat(" ", normalize-space(@class), " "), " form-group ")][1]//button[normalize-space(.)="${xpathLiteralText(option)}" or @value="${xpathLiteralText(option)}"]`
    );
    if (await button.count() > 0 && await button.first().isVisible().catch(() => false)) {
      await button.first().click({ force: true });
      await page.waitForTimeout(150);
      return true;
    }
    break;
  }

  const clicked = await page.evaluate(
    ({ questionText, itemOffset, optionText }) => {
      const root = document.querySelector("#AffordabilityCalculator");
      if (!root) return false;

      const normalizeText = (value: string) => value.replace(/\s+/g, " ").trim().toLowerCase();
      const wantedQuestion = normalizeText(questionText);
      const prompts = Array.from(root.querySelectorAll("label, p, h1, h2, h3, h4, div"))
        .filter((element) => {
          const text = normalizeText(element.textContent ?? "");
          if (!text.includes(wantedQuestion)) return false;
          const box = element.getBoundingClientRect();
          return box.width > 0 && box.height > 0;
        })
        .sort((left, right) => (left.textContent?.length ?? 0) - (right.textContent?.length ?? 0));

      const prompt = prompts[itemOffset] as HTMLElement | undefined;
      if (!prompt) return false;

      const container = prompt.closest(".form-group") ?? prompt.parentElement;
      const buttons = Array.from(container?.querySelectorAll("button, [role='button']") ?? []) as HTMLElement[];
      const button = buttons.find((candidate) =>
        candidate.textContent?.trim() === optionText || candidate.getAttribute("value") === optionText
      );
      if (!button) return false;

      button.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, view: window }));
      button.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true, view: window }));
      button.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));
      button.click();
      return true;
    },
    { questionText: question, itemOffset: itemIndex, optionText: option }
  ).catch(() => false);

  if (clicked) await page.waitForTimeout(150);
  return clicked;
}

async function nthVisibleLocator(locator: ReturnType<Page["locator"]>, visibleIndex: number): Promise<ReturnType<Page["locator"]> | null> {
  let seenVisible = 0;
  const count = await locator.count().catch(() => 0);
  for (let index = 0; index < count; index += 1) {
    const candidate = locator.nth(index);
    const isUsable = await candidate.isVisible().catch(() => false) && await candidate.isEnabled().catch(() => false);
    if (!isUsable) continue;
    if (seenVisible === visibleIndex) return candidate;
    seenVisible += 1;
  }

  return null;
}

async function chooseOptionAfterHeadingQuestion(page: Page, heading: string, question: string, option: string): Promise<boolean> {
  const optionButton = page.locator(
    `xpath=.//*[normalize-space(.)="${xpathLiteralText(heading)}"]/following::*[text()[contains(normalize-space(.), "${xpathLiteralText(question)}")]]/following::button[normalize-space(.)="${xpathLiteralText(option)}"][1]`
  );
  if (await optionButton.count() > 0 && await optionButton.first().isVisible().catch(() => false)) {
    await optionButton.first().click({ force: true });
    return true;
  }

  return page.evaluate(
    ({ headingText, questionText, optionText }) => {
      const root = document.querySelector("#AffordabilityCalculator");
      if (!root) return false;

      const normalizedQuestion = questionText.toLowerCase();
      const headingNode = Array.from(root.querySelectorAll("*")).find((element) =>
        element.textContent?.replace(/\s+/g, " ").trim() === headingText
      );
      if (!headingNode) return false;

      const prompt = Array.from(root.querySelectorAll("*")).find((element) => {
        const text = element.textContent?.replace(/\s+/g, " ").trim().toLowerCase() ?? "";
        return Boolean(headingNode.compareDocumentPosition(element) & Node.DOCUMENT_POSITION_FOLLOWING) &&
          text.includes(normalizedQuestion);
      });
      if (!prompt) return false;

      const promptBox = prompt.getBoundingClientRect();
      const controls = Array.from(root.querySelectorAll("button, [role='button'], label, span, div")) as HTMLElement[];
      const candidate = controls.find((element) => {
        const box = element.getBoundingClientRect();
        return element.textContent?.trim() === optionText &&
          Boolean(prompt.compareDocumentPosition(element) & Node.DOCUMENT_POSITION_FOLLOWING) &&
          box.top >= promptBox.top &&
          box.top <= promptBox.top + 140 &&
          box.width > 0 &&
          box.height > 0;
      });

      if (!candidate) return false;
      candidate.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, view: window }));
      candidate.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true, view: window }));
      candidate.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));
      candidate.click();
      return true;
    },
    { headingText: heading, questionText: question, optionText: option }
  ).catch(() => false);
}

async function chooseBorrowersSameAsCurrentMortgage(page: Page): Promise<void> {
  const prompts = page.getByText(/Are all borrowers the same as those named on the current mortgage/i);
  const promptCount = await prompts.count().catch(() => 0);
  for (let index = 0; index < promptCount; index += 1) {
    const prompt = prompts.nth(index);
    const yesCandidates = [
      prompt.locator('xpath=following::label[normalize-space(.)="Yes"][1]'),
      prompt.locator('xpath=following::button[normalize-space(.)="Yes"][1]'),
      prompt.locator('xpath=following::*[normalize-space(.)="Yes"][1]')
    ];
    for (const yes of yesCandidates) {
      if (await yes.count() > 0 && await yes.first().isVisible().catch(() => false)) {
        await yes.first().click({ force: true }).catch(() => undefined);
        break;
      }
    }
  }

  await page.evaluate(() => {
    const phrase = "Are all borrowers the same as those named on the current mortgage";
    const root = document.querySelector("#AffordabilityCalculator");
    if (!root) return;

    const promptNodes = Array.from(root.querySelectorAll("*")).filter((element) =>
      Array.from(element.childNodes).some((node) => node.nodeType === Node.TEXT_NODE && node.textContent?.includes(phrase))
    );

    for (const prompt of promptNodes) {
      const promptBox = prompt.getBoundingClientRect();
      const following = Array.from(root.querySelectorAll("button, [role='button'], label, span, div, a")) as HTMLElement[];
      const candidates = following.filter((element) => {
        const box = element.getBoundingClientRect();
        return Boolean(prompt.compareDocumentPosition(element) & Node.DOCUMENT_POSITION_FOLLOWING) &&
          box.top >= promptBox.top &&
          box.top <= promptBox.top + 120;
      });
      const yes = candidates.find((element) => element.textContent?.trim() === "Yes");
      yes?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));
      yes?.click();
    }
  }).catch(() => undefined);
  await page.waitForTimeout(250);
}

async function chooseCombinedGrossIncomeOver200k(page: Page, option: "Yes" | "No"): Promise<void> {
  const clicked = await page.evaluate((wantedOption) => {
    const root = document.querySelector("#AffordabilityCalculator");
    if (!root) return false;

    const prompt = Array.from(root.querySelectorAll("*")).find((element) =>
      Array.from(element.childNodes).some((node) => {
        const text = node.textContent?.replace(/\s+/g, " ").trim() ?? "";
        return node.nodeType === Node.TEXT_NODE &&
          /combined gross income/i.test(text) &&
          /200,000/.test(text);
      })
    );
    if (!prompt) return false;

    const promptBox = prompt.getBoundingClientRect();
    const controls = Array.from(root.querySelectorAll("button, [role='button'], label, span, div")) as HTMLElement[];
    const candidate = controls.find((element) => {
      const box = element.getBoundingClientRect();
      return element.textContent?.trim() === wantedOption &&
        Boolean(prompt.compareDocumentPosition(element) & Node.DOCUMENT_POSITION_FOLLOWING) &&
        box.top >= promptBox.top &&
        box.top <= promptBox.top + 140 &&
        box.width > 0 &&
        box.height > 0;
    });

    if (!candidate) return false;
    candidate.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, view: window }));
    candidate.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true, view: window }));
    candidate.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));
    candidate.click();
    return true;
  }, option).catch(() => false);

  if (!clicked) {
    await chooseOptionAfterQuestion(page, "combined gross income", option);
  }
  await page.waitForTimeout(250);
}

async function santanderFailureContext(page: Page): Promise<string> {
  const [routeName, heading, validationMessages] = await Promise.all([
    santanderRouteName(page),
    santanderCurrentHeading(page),
    santanderValidationMessages(page)
  ]);
  return `Route: ${routeName || "unknown"}. Heading: ${heading || "unknown"}. Validation messages: ${validationMessages}`;
}

async function santanderRouteName(page: Page): Promise<string> {
  return page.evaluate(() => {
    const app = document.querySelector("#AffordabilityCalculator") as (Element & { __vue_app__?: { config?: { globalProperties?: { $route?: { name?: string } } } } }) | null;
    return app?.__vue_app__?.config?.globalProperties?.$route?.name ?? "";
  }).catch(() => "");
}

async function santanderCurrentHeading(page: Page): Promise<string> {
  return page
    .locator("#AffordabilityCalculator h1, #AffordabilityCalculator h2, #AffordabilityCalculator h3")
    .evaluateAll((nodes) => nodes.map((node) => node.textContent?.replace(/\s+/g, " ").trim() ?? "").find(Boolean) ?? "")
    .catch(() => "");
}

async function santanderValidationMessages(page: Page): Promise<string> {
  const messages = await page
    .locator("#AffordabilityCalculator .calculator-card_error-list, #AffordabilityCalculator .calculator_info-text--error")
    .allInnerTexts()
    .catch(() => []);
  return messages.map((message) => message.replace(/\s+/g, " ").trim()).filter(Boolean).join(" | ") || "none visible";
}

async function extractResult(page: Page): Promise<{
  maximumBorrowing: number | null;
  monthlyPayment: number | null;
  messages: string[];
}> {
  const resultState = await page.evaluate(() => {
    const app = document.querySelector("#AffordabilityCalculator") as (Element & { __vue_app__?: { config?: { globalProperties?: { $route?: { name?: string } } } } }) | null;
    const routeName = app?.__vue_app__?.config?.globalProperties?.$route?.name;
    const context = (app?.__vue_app__ as { _context?: { provides?: Record<PropertyKey, unknown> } } | undefined)?._context;
    const pinia = Reflect.ownKeys(context?.provides ?? {})
      .map((key) => context?.provides?.[key])
      .find((candidate): candidate is { state: { value: Record<string, Record<string, unknown>> } } =>
        !!candidate &&
        typeof candidate === "object" &&
        "state" in candidate &&
        !!(candidate as { state?: unknown }).state
      );
    const results = pinia?.state.value.results;
    return {
      routeName,
      result1Output: typeof results?.result1Output === "string" ? results.result1Output : "",
      result2Output: typeof results?.result2Output === "string" ? results.result2Output : "",
      resultText: typeof results?.resultText === "string" ? results.resultText : "",
      errorMessage: typeof results?.errorMessage === "string" ? results.errorMessage : "",
      errorList: Array.isArray(results?.errorList) ? results.errorList.map(String) : []
    };
  });

  if (resultState.routeName !== "Results") {
    const visibleCalculatorText = await page.locator("#AffordabilityCalculator").innerText().catch(() => "");
    return {
      maximumBorrowing: null,
      monthlyPayment: null,
      messages: resultMessages(visibleCalculatorText)
    };
  }

  const visibleResultText = await page.locator("#AffordabilityCalculator").innerText().catch(() => "");
  const visibleValidation = await santanderValidationMessages(page);
  const hasVisibleValidation = visibleValidation !== "none visible";
  const hasResultLanguage = /results?|borrow|lend|maximum|affordability/i.test(visibleResultText);
  if (hasVisibleValidation || !hasResultLanguage) {
    return {
      maximumBorrowing: null,
      monthlyPayment: null,
      messages: resultMessages([visibleValidation, visibleResultText].filter(Boolean).join("\n"))
    };
  }

  const resultText = [
    resultState.result1Output,
    resultState.result2Output,
    resultState.resultText,
    resultState.errorMessage,
    ...resultState.errorList
  ].filter(Boolean).join("\n");

  return {
    maximumBorrowing: extractMaximumCurrency(resultText) ?? extractMaximumCurrency(visibleResultText),
    monthlyPayment: null,
    messages: resultMessages(resultText || visibleResultText || await page.locator("body").innerText())
  };
}

async function setSantanderDetailsStore(page: Page, input: LenderReadyInput): Promise<void> {
  const details = {
    applicationType: input.case.numberOfApplicants === 1 ? "Single" : "Joint",
    dependants: input.household.dependants.length,
    mortgageType: input.case.mortgagePurpose === "purchase" ? "Purchase" : "Remortgage",
    remortgageReason: input.case.mortgagePurpose === "purchase" ? "" : remortgageReasonLabels[input.case.mortgagePurpose][0],
    existingSantanderCustomerYN: "No",
    depositOrEquity: Math.max(0, Math.round(input.loan.propertyValue - input.loan.loanAmount)),
    propertyValue: Math.round(input.loan.propertyValue),
    currentBalance: santanderCurrentBalance(input),
    repaymentMethod: santanderRepaymentMethodLabels(input)[0],
    interestOnlyAmt: Math.round(input.case.repaymentType === "capital_and_interest" ? 0 : input.case.interestOnlyLoanAmount ?? input.loan.loanAmount),
    capitalAndInterestAmt: Math.round(input.case.repaymentType === "interest_only" ? 0 : input.loan.loanAmount - (input.case.interestOnlyLoanAmount ?? 0)),
    oldestApplicantAge: oldestApplicantNextBirthdayAge(input),
    totalMonths: input.case.termYears * 12,
    mortgageTerm: input.case.termYears * 12
  };

  await page.evaluate(async (values) => {
    const app = document.querySelector("#AffordabilityCalculator") as (Element & { __vue_app__?: unknown }) | null;
    const context = (app?.__vue_app__ as { _context?: { provides?: Record<PropertyKey, unknown> } } | undefined)?._context;
    const pinia = Reflect.ownKeys(context?.provides ?? {})
      .map((key) => context?.provides?.[key])
      .find((candidate): candidate is { state: { value: Record<string, { details?: Record<string, unknown> } | Record<string, unknown>> } } =>
        !!candidate &&
        typeof candidate === "object" &&
        "state" in candidate &&
        !!(candidate as { state?: unknown }).state
      );
    const state = pinia?.state.value.details as Record<string, unknown> | undefined;
    if (!state) return;
    state.applicationType = values.applicationType;
    state.dependants = values.dependants;
    state.mortgageType = values.mortgageType;
    await new Promise((resolve) => setTimeout(resolve, 250));
    Object.assign(state, values);
    state.existingMortgageBalance = values.currentBalance;
    Object.assign(state, {
      allBorrowersSameAsCurrentMortgageYN: "Yes",
      allBorrowersSameYN: "Yes",
      borrowerSameYN: "Yes",
      borrowersSameYN: "Yes",
      borrowersSameAsCurrentMortgageYN: "Yes",
      currentMortgageBorrowersSameYN: "Yes",
      currentTotalBalance: values.currentBalance,
      currentTotalMortgageBalance: values.currentBalance,
      customerCurrentBalance: values.currentBalance
    });
  }, details);
}

async function setSantanderIncomeStore(page: Page, input: LenderReadyInput): Promise<void> {
  const applicants = input.applicants.map((applicant) => {
    const basic = Math.round(applicant.employment.annualGrossIncome ?? 0);
    const soleTraderLatest = Math.round(applicant.employment.netProfitCurrentYear ?? 0);
    const soleTraderPrevious = Math.round(applicant.employment.netProfitPreviousYear ?? soleTraderLatest);
    const privatePension = Math.round(applicant.employment.annualPensionIncome ?? 0);
    const statePension = Math.round(applicant.employment.otherAnnualPensionIncome ?? 0);
    const annualBonus1 = Math.round(applicant.employment.annualBonus ?? 0);
    const annualOvertime = Math.round(applicant.employment.annualOvertime ?? 0);
    const annualCommission = Math.round(applicant.employment.annualCommission ?? 0);
    const carAllowance = incomeAmount(applicant, ["town_area_or_car_allowance"]);
    const shiftAllowance = incomeAmount(applicant, ["shift_allowance"]);
    const childBenefit = incomeAmount(applicant, ["child_benefit"]);
    const childTaxCredits = incomeAmount(applicant, ["child_tax_credit"]);
    const workingTaxCredits = incomeAmount(applicant, ["working_tax_credit"]);
    const indefiniteBenefits = incomeAmount(applicant, [
      "attendance_allowance",
      "carers_allowance",
      "constant_attendance_allowance",
      "disability_living_allowance",
      "employment_support_allowance",
      "income_support",
      "industrial_injuries_disablement_benefit",
      "personal_independence_payment",
      "widowed_parents_allowance"
    ]);
    const universalCredit = incomeAmount(applicant, ["universal_credit"]);
    const secondJob = incomeAmount(applicant, ["additional_duty_hours", "nursing_bank"]);
    const investment = incomeAmount(applicant, ["investment_income", "trust_income"]);
    const maintenanceIncome = incomeAmount(applicant, ["maintenance"]);
    const surplusRent = incomeAmount(applicant, ["rental_income_btl"]);
    const otherIncome = Math.round(totalOtherIncome(applicant));
    const isSoleTrader = applicant.employment.type === "self_employed" && ["sole_trader", "partnership", "llp"].includes(applicant.employment.businessType ?? "sole_trader");
    const isDirector = applicant.employment.type === "self_employed" && applicant.employment.businessType === "limited_company";
    const selfEmploymentIncome = isDirector ? basic + soleTraderLatest : isSoleTrader ? soleTraderLatest : 0;
    const employedIncome = applicant.employment.type === "self_employed" ? 0 : basic;
    const nonRegularIncome = annualBonus1 + annualOvertime + annualCommission;
    const regularIncome = employedIncome + selfEmploymentIncome + privatePension + statePension + otherIncome;
    const taxableGrossIncome = regularIncome + nonRegularIncome;
    const monthlyNet = estimateMonthlyNetIncome(taxableGrossIncome);

    return {
      index: applicant.index,
      basic,
      employedIncome,
      soleTraderLatest,
      soleTraderPrevious,
      privatePension,
      statePension,
      annualBonus1,
      annualOvertime,
      annualCommission,
      carAllowance,
      shiftAllowance,
      childBenefit,
      childTaxCredits,
      workingTaxCredits,
      indefiniteBenefits,
      universalCredit,
      secondJob,
      investment,
      maintenanceIncome,
      surplusRent,
      otherIncome,
      preTaxDeductions: Math.round(applicant.monthlyPensionContribution ?? 0),
      nonRegularIncome,
      regularIncome,
      taxableGrossIncome,
      monthlyNet,
      isSoleTrader,
      isDirector
    };
  });

  await page.evaluate((values) => {
    const app = document.querySelector("#AffordabilityCalculator") as (Element & { __vue_app__?: unknown }) | null;
    const context = (app?.__vue_app__ as { _context?: { provides?: Record<PropertyKey, unknown> } } | undefined)?._context;
    const pinia = Reflect.ownKeys(context?.provides ?? {})
      .map((key) => context?.provides?.[key])
      .find((candidate): candidate is { state: { value: Record<string, Record<string, unknown>> } } =>
        !!candidate &&
        typeof candidate === "object" &&
        "state" in candidate &&
        !!(candidate as { state?: unknown }).state
      );
    const income = pinia?.state.value.income as Record<string, Record<string, unknown>> | undefined;
    if (!income) return;

    for (const applicant of values) {
      const target = income[`applicant${applicant.index}`];
      if (!target) continue;
      Object.assign(target, {
        basic: applicant.basic,
        mainAnnualIncome: applicant.basic,
        grossIncome: applicant.taxableGrossIncome,
        taxableGrossIncome: applicant.taxableGrossIncome,
        annualTaxable: applicant.taxableGrossIncome,
        annualNontaxable: 0,
        monthlyTaxable: Math.round(applicant.taxableGrossIncome / 12),
        monthlyNonTax: 0,
        monthlyNet: applicant.monthlyNet,
        netIncomeCalc: applicant.monthlyNet,
        grossBasic: applicant.regularIncome,
        grossBasicModified: applicant.regularIncome,
        grossNonRegular: applicant.nonRegularIncome,
        grossNonRegularModified: applicant.nonRegularIncome,
        soleTraderLatest: applicant.soleTraderLatest,
        soleTraderPrevious: applicant.soleTraderPrevious,
        soleTraderIncome: applicant.isSoleTrader ? Math.round((applicant.soleTraderLatest + applicant.soleTraderPrevious) / 2) : 0,
        soleTraderYN: applicant.isSoleTrader ? "Yes" : "No",
        directorYN: applicant.isDirector ? "Yes" : "No",
        directorSalaryLatest: applicant.isDirector ? applicant.basic : 0,
        directorSalaryPrevious: applicant.isDirector ? applicant.basic : 0,
        directorSalaryIncome: applicant.isDirector ? applicant.basic : 0,
        dividendsLatest: applicant.isDirector ? applicant.soleTraderLatest : 0,
        dividendsPrevious: applicant.isDirector ? applicant.soleTraderPrevious : 0,
        dividendsIncome: applicant.isDirector ? Math.round((applicant.soleTraderLatest + applicant.soleTraderPrevious) / 2) : 0,
        totalLatest: applicant.isDirector ? applicant.basic + applicant.soleTraderLatest : 0,
        totalPrevious: applicant.isDirector ? applicant.basic + applicant.soleTraderPrevious : 0,
        totalAverage: applicant.isDirector ? Math.round((applicant.basic + applicant.soleTraderLatest + applicant.basic + applicant.soleTraderPrevious) / 2) : 0,
        privatePension: applicant.privatePension,
        statePension: applicant.statePension,
        bonusYN: applicant.annualBonus1 + applicant.annualCommission > 0 ? "Yes" : "No",
        bonusMonthlyYN: "No",
        bonusFreq: applicant.annualBonus1 + applicant.annualCommission > 0 ? "Annually" : "",
        annualBonus1: applicant.annualBonus1,
        annualBonus2: 0,
        annualBonus3: applicant.annualBonus1 + applicant.annualCommission,
        bonusEntered: applicant.annualBonus1 + applicant.annualCommission > 0,
        primaryBonus: applicant.annualBonus1 + applicant.annualCommission,
        secondaryBonus: 0,
        bonusCalcFinal: applicant.annualBonus1 + applicant.annualCommission,
        bonusAnnualFinal: applicant.annualBonus1 + applicant.annualCommission,
        overtimeYN: applicant.annualOvertime > 0 ? "Yes" : "No",
        overtimeMonthlyYN: "No",
        overtimeCalcType: applicant.annualOvertime > 0 ? "Other" : "",
        annualOvertime: applicant.annualOvertime,
        overtimeEntered: applicant.annualOvertime > 0,
        primaryOvertime: applicant.annualOvertime,
        secondaryOvertime: 0,
        overtimeCalcFinal: applicant.annualOvertime,
        annualCommission: applicant.annualCommission,
        allowanceYN: applicant.carAllowance + applicant.shiftAllowance > 0 ? "Yes" : "No",
        carAllowance: applicant.carAllowance,
        london: 0,
        shiftAllowance: applicant.shiftAllowance,
        indefiniteSubsidy: 0,
        longSubsidyPrivatePension: 0,
        govtBenefitsYN: applicant.childBenefit + applicant.childTaxCredits + applicant.workingTaxCredits + applicant.indefiniteBenefits + applicant.universalCredit > 0 ? "Yes" : "No",
        childBenefit: applicant.childBenefit,
        childTaxCredits: applicant.childTaxCredits,
        workingTaxCredits: applicant.workingTaxCredits,
        indefiniteBenefits: applicant.indefiniteBenefits,
        universalCredit: applicant.universalCredit,
        otherIncomeYN: applicant.secondJob + applicant.investment + applicant.maintenanceIncome + applicant.surplusRent > 0 ? "Yes" : "No",
        secondJob: applicant.secondJob,
        investment: applicant.investment,
        maintenanceIncome: applicant.maintenanceIncome,
        surplusRent: applicant.surplusRent,
        fostering: 0,
        preTaxDeductions: applicant.preTaxDeductions,
        postTaxDeductions: 0,
        studentLoans: "No",
        otherAnnualIncome: applicant.otherIncome
      });
    }
  }, applicants);
}

function estimateMonthlyNetIncome(annualGrossIncome: number): number {
  if (annualGrossIncome <= 0) return 0;

  const personalAllowance = annualGrossIncome > 125140 ? 0 : Math.max(0, 12570 - Math.max(0, annualGrossIncome - 100000) / 2);
  const taxable = Math.max(0, annualGrossIncome - personalAllowance);
  const basicRateTax = Math.min(taxable, 37700) * 0.2;
  const higherRateTax = Math.min(Math.max(0, taxable - 37700), 87440) * 0.4;
  const additionalRateTax = Math.max(0, taxable - 125140) * 0.45;
  const nationalInsurance = Math.max(0, Math.min(annualGrossIncome, 50270) - 12570) * 0.08 + Math.max(0, annualGrossIncome - 50270) * 0.02;

  return Math.round((annualGrossIncome - basicRateTax - higherRateTax - additionalRateTax - nationalInsurance) / 12);
}

function dependantOption(count: number): string {
  if (count >= 21) return "21+";
  return String(Math.max(0, count));
}

function oldestApplicantNextBirthdayAge(input: LenderReadyInput): number {
  return Math.max(...input.applicants.map((applicant) => applicant.age + 1));
}

function totalApplicantsGrossIncome(input: LenderReadyInput): number {
  return input.applicants.reduce((sum, applicant) => {
    const employment = applicant.employment;
    return sum +
      (employment.annualGrossIncome ?? 0) +
      (employment.annualBonus ?? 0) +
      (employment.annualOvertime ?? 0) +
      (employment.annualCommission ?? 0) +
      (employment.annualPensionIncome ?? 0) +
      (employment.otherAnnualPensionIncome ?? 0) +
      (employment.netProfitCurrentYear ?? 0) +
      totalOtherIncome(applicant);
  }, 0);
}

function santanderCurrentBalance(input: LenderReadyInput): number {
  return Math.round(input.loan.currentBalance ?? input.loan.loanAmount);
}

function santanderRepaymentMethodLabels(input: LenderReadyInput): string[] {
  if (input.case.repaymentType === "part_and_part" && input.case.mortgagePurpose !== "purchase") {
    return [
      "Part and part - endowment or investment",
      "Part and part - sale of mortgaged property"
    ];
  }

  return repaymentMethodLabels[input.case.repaymentType];
}

function loanToValue(input: LenderReadyInput): number {
  if (input.loan.propertyValue <= 0) return 0;
  return input.loan.loanAmount / input.loan.propertyValue;
}

function santanderOtherPropertyMonthlyPayment(property: LenderReadyInput["otherProperties"][number]): number {
  const enteredPayment = Math.round(property.monthlyMortgagePayment);
  const termMonths = Math.max(1, Math.round(property.remainingTermYears ?? 1) * 12);
  const capitalBalance = Math.max(0, Math.round((property.currentBalance ?? 0) - (property.interestOnlyBalance ?? 0)));
  if ((property.repaymentType ?? "capital_and_interest") === "interest_only") return enteredPayment;
  return Math.max(enteredPayment, Math.ceil(capitalBalance / termMonths));
}

function totalOtherIncome(applicant: Applicant): number {
  return applicant.otherIncome.reduce((sum, income) => sum + income.annualAmount, applicant.employment.otherAnnualPensionIncome ?? 0);
}

function incomeAmount(applicant: Applicant, types: Applicant["otherIncome"][number]["type"][]): number {
  return Math.round(applicant.otherIncome.reduce((sum, income) => types.includes(income.type) ? sum + income.annualAmount : sum, 0));
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function xpathLiteralText(value: string): string {
  return value.replace(/"/g, '\\"');
}
